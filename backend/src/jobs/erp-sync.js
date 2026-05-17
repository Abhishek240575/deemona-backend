// ================================================================
// ERP SYNC JOB + WEBHOOK HANDLER
// File: src/jobs/erp-sync.js
//
// 1. Scheduled jobs — pull data from connected ERPs automatically
// 2. Webhook handlers — receive real-time pushes from ERPs
//
// Mount in server.js:
//   const erpSync = require('./jobs/erp-sync');
//   erpSync.start();          // starts scheduled jobs
//   app.use('/webhooks', erpSync.webhookRouter);
// ================================================================

const express    = require('express');
const cron       = require('node-cron');
const QBO        = require('../services/connectors/quickbooks');
const Xero       = require('../services/connectors/xero');
const { mapAndPersist } = require('../services/erp/data-mapper');
const { query }  = require('../services/database');

const webhookRouter = express.Router();

// ================================================================
// SYNC ENGINE
// ================================================================

async function syncTenant(tenantId, provider, mode = 'incremental') {
  console.log(`[ERP-Sync] Starting ${mode} sync — tenant:${tenantId} provider:${provider}`);
  const startAt = Date.now();

  try {
    // Get last sync time for incremental mode
    const conn = await query(
      `SELECT last_sync_at FROM data_connections WHERE tenant_id=$1 AND provider=$2 AND status='active' LIMIT 1`,
      [tenantId, provider]
    );
    const lastSync = conn.rows[0]?.last_sync_at;
    const since    = mode === 'incremental' && lastSync ? lastSync.toISOString() : null;

    let data;
    if (provider === 'quickbooks') {
      data = since ? await QBO.incrementalSync(tenantId, since) : await QBO.fullSync(tenantId);
    } else if (provider === 'xero') {
      data = await Xero.fullSync(tenantId);   // Xero always does full (reports don't support incremental)
    } else {
      throw new Error(`Unknown provider: ${provider}`);
    }

    const result = await mapAndPersist(tenantId, data, provider);
    const elapsed = Date.now() - startAt;
    console.log(`[ERP-Sync] Done — tenant:${tenantId} provider:${provider} elapsed:${elapsed}ms`);
    return { ...result, elapsed };

  } catch (err) {
    console.error(`[ERP-Sync] Error — tenant:${tenantId} provider:${provider}`, err.message);
    // Mark connection as error if auth failure
    if (err.response?.status === 401) {
      await query(
        `UPDATE data_connections SET status='error', error_message=$1 WHERE tenant_id=$2 AND provider=$3`,
        [err.message, tenantId, provider]
      );
    }
    return { success: false, error: err.message };
  }
}

// Sync all active connections for a specific provider
async function syncAllTenants(provider) {
  const conns = await query(
    `SELECT DISTINCT tenant_id FROM data_connections WHERE provider=$1 AND status='active'`,
    [provider]
  );
  console.log(`[ERP-Sync] Syncing ${conns.rows.length} ${provider} connections`);
  for (const { tenant_id } of conns.rows) {
    await syncTenant(tenant_id, provider, 'incremental');
    await new Promise(r => setTimeout(r, 2000)); // Rate limit: 2s between tenants
  }
}

// ================================================================
// SCHEDULED JOBS
// ================================================================

function start() {
  // Every hour — sync daily financial data (cash flow, AR, AP)
  cron.schedule('0 * * * *', async () => {
    console.log('[CRON] Hourly finance sync starting...');
    await syncAllTenants('quickbooks');
    await syncAllTenants('xero');
  });

  // Every day at 2 AM — full sync (P&L, Balance Sheet, full invoices)
  cron.schedule('0 2 * * *', async () => {
    console.log('[CRON] Daily full finance sync starting...');
    const conns = await query(
      `SELECT DISTINCT tenant_id, provider FROM data_connections WHERE status='active' AND provider IN ('quickbooks','xero')`
    );
    for (const { tenant_id, provider } of conns.rows) {
      await syncTenant(tenant_id, provider, 'full');
      await new Promise(r => setTimeout(r, 3000));
    }
  });

  // Every Sunday at 3 AM — refresh token rotation
  cron.schedule('0 3 * * 0', async () => {
    console.log('[CRON] Weekly token rotation check...');
    const conns = await query(
      `SELECT * FROM data_connections WHERE status='active' AND provider IN ('quickbooks','xero') AND token_expires_at < NOW() + INTERVAL '7 days'`
    );
    for (const conn of conns.rows) {
      try {
        let tokens;
        if (conn.provider === 'quickbooks') {
          tokens = await QBO.refreshAccessToken(conn.refresh_token);
        } else {
          tokens = await Xero.refreshAccessToken(conn.refresh_token);
        }
        const expiry = new Date(Date.now() + tokens.expires_in * 1000);
        await query(
          `UPDATE data_connections SET access_token=$1, token_expires_at=$2, updated_at=NOW() WHERE id=$3`,
          [tokens.access_token, expiry, conn.id]
        );
        console.log(`[CRON] Refreshed token for tenant ${conn.tenant_id} provider ${conn.provider}`);
      } catch (e) {
        console.error(`[CRON] Token refresh failed for ${conn.tenant_id}:`, e.message);
      }
    }
  });

  console.log('[ERP-Sync] Scheduled jobs started: hourly sync, daily full sync, weekly token rotation');
}

// ================================================================
// WEBHOOK HANDLERS — real-time pushes from ERP platforms
// ================================================================

// QuickBooks Data Change Notifications webhook
// Set in QBO Developer → Webhooks: POST /webhooks/quickbooks
webhookRouter.post('/quickbooks', express.json(), async (req, res) => {
  // Verify webhook signature
  const signature   = req.headers['intuit-signature'];
  const webhookKey  = process.env.QBO_WEBHOOK_VERIFIER_TOKEN;
  const isValid     = verifyQBOSignature(req.body, signature, webhookKey);

  if (!isValid) {
    console.warn('[Webhook] Invalid QuickBooks signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  res.json({ received: true }); // Acknowledge immediately

  // Process async (QBO expects < 5s response)
  setImmediate(async () => {
    const notifications = req.body?.eventNotifications || [];
    for (const notif of notifications) {
      const realmId = notif.realmId;
      // Find tenant by realm ID
      const conn = await query(
        `SELECT tenant_id FROM data_connections WHERE external_id=$1 AND provider='quickbooks' AND status='active' LIMIT 1`,
        [realmId]
      );
      if (!conn.rows.length) continue;

      const tenantId   = conn.rows[0].tenant_id;
      const entities   = notif.dataChangeEvent?.entities || [];
      const hasFinancial = entities.some(e => ['Invoice','Bill','Payment','JournalEntry','Account'].includes(e.name));
      if (hasFinancial) {
        console.log(`[Webhook] QBO change detected for tenant ${tenantId} — triggering sync`);
        await syncTenant(tenantId, 'quickbooks', 'incremental');
      }
    }
  });
});

// Xero webhook
// Set in Xero Developer → Webhooks: POST /webhooks/xero
webhookRouter.post('/xero', express.text({ type: '*/*' }), async (req, res) => {
  const signature = req.headers['x-xero-signature'];
  const webhookKey= process.env.XERO_WEBHOOK_KEY;
  const isValid   = verifyXeroSignature(req.body, signature, webhookKey);

  if (!isValid) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  res.json({ received: true });

  setImmediate(async () => {
    try {
      const payload = JSON.parse(req.body);
      const events  = payload.events || [];
      for (const event of events) {
        if (!['Invoice','CreditNote','BankTransaction','Contact'].includes(event.eventCategory)) continue;

        const xeroTenantId = event.tenantId;
        const conn = await query(
          `SELECT tenant_id FROM data_connections WHERE external_id=$1 AND provider='xero' AND status='active' LIMIT 1`,
          [xeroTenantId]
        );
        if (!conn.rows.length) continue;

        console.log(`[Webhook] Xero event ${event.eventCategory} for tenant ${conn.rows[0].tenant_id}`);
        await syncTenant(conn.rows[0].tenant_id, 'xero', 'full');
      }
    } catch (e) {
      console.error('[Webhook] Xero processing error:', e.message);
    }
  });
});

// Verify QuickBooks webhook signature (HMAC-SHA256)
function verifyQBOSignature(payload, signature, verifierToken) {
  if (!verifierToken || !signature) return false;
  const crypto   = require('crypto');
  const body     = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const expected = crypto.createHmac('sha256', verifierToken).update(body).digest('base64');
  return expected === signature;
}

// Verify Xero webhook signature (SHA256 HMAC)
function verifyXeroSignature(body, signature, key) {
  if (!key || !signature) return false;
  const crypto = require('crypto');
  const hash   = crypto.createHmac('sha256', key).update(body).digest('base64');
  return hash === signature;
}

// ================================================================
// MANUAL TRIGGER ROUTE (used by the UI)
// ================================================================

webhookRouter.post('/manual-sync', express.json(), async (req, res) => {
  const { tenantId, provider, mode = 'full' } = req.body;
  if (!tenantId || !provider) {
    return res.status(400).json({ error: 'tenantId and provider required' });
  }
  // Fire and respond immediately
  res.json({ message: 'Sync started', tenantId, provider, mode });
  syncTenant(tenantId, provider, mode);
});

module.exports = { start, syncTenant, syncAllTenants, webhookRouter };
