// ================================================================
// ERP INTEGRATION ROUTES
// File: src/routes/integrations/finance-erp.js
//
// Mount in src/routes/index.js:
//   const erp = require('./integrations/finance-erp');
//   router.use('/integrations', erp);
// ================================================================

const express    = require('express');
const router     = express.Router();
const QBO        = require('../../services/connectors/quickbooks');
const Xero       = require('../../services/connectors/xero');
const { mapAndPersist } = require('../../services/erp/data-mapper');
const { syncTenant }    = require('../../jobs/erp-sync');
const { query }  = require('../../services/database');
const crypto     = require('crypto');

// In-memory PKCE verifier store (use Redis in production)
const pkceStore  = new Map();

// ── Middleware: get tenant from JWT ──────────────────────────
function getTenantId(req) {
  return req.user?.tenant_id || req.query.tenant_id || req.body?.tenant_id;
}

// ================================================================
// STATUS — list all ERP connections for a tenant
// ================================================================

router.get('/status', async (req, res) => {
  const tenantId = getTenantId(req);
  if (!tenantId) return res.status(400).json({ error: 'tenant_id required' });

  const conns = await query(
    `SELECT id, provider, status, last_sync_at, sync_count, created_at, error_message,
            external_id, COALESCE(metadata->>'company_name', '') as company_name
     FROM data_connections
     WHERE tenant_id=$1 AND provider IN ('quickbooks','xero')
     ORDER BY created_at DESC`,
    [tenantId]
  );

  res.json({
    connections: conns.rows,
    available_providers: [
      { id: 'quickbooks', name: 'QuickBooks Online', logo: 'https://www.intuit.com/content/dam/intuit/qbo-assets/global/images/qbo-logo.svg', auth_url: '/v1/integrations/quickbooks/connect' },
      { id: 'xero', name: 'Xero', logo: 'https://www.xero.com/static/xero-dark.svg', auth_url: '/v1/integrations/xero/connect' },
    ]
  });
});

// ================================================================
// QUICKBOOKS — OAuth connect
// ================================================================

router.get('/quickbooks/connect', async (req, res) => {
  const tenantId = getTenantId(req);
  if (!tenantId) return res.status(400).json({ error: 'tenant_id required' });

  const state = `${tenantId}:${crypto.randomBytes(16).toString('hex')}`;
  const url   = QBO.getAuthUrl(state);
  res.json({ auth_url: url, state });
});

router.get('/quickbooks/callback', async (req, res) => {
  const { code, state, realmId } = req.query;
  if (!code || !state) return res.status(400).send('Missing code or state');

  const [tenantId] = state.split(':');
  if (!tenantId) return res.status(400).send('Invalid state');

  try {
    const tokens = await QBO.exchangeCodeForTokens(code);

    // Fetch company info
    let companyName = 'QuickBooks Company';
    try {
      const { accessToken } = { accessToken: tokens.access_token };
      const info = await QBO.apiGet?.(realmId, accessToken, 'companyinfo/' + realmId);
      companyName = info?.CompanyInfo?.CompanyName || companyName;
    } catch { /* ignore */ }

    const expiry = new Date(Date.now() + tokens.expires_in * 1000);
    await query(`
      INSERT INTO data_connections
        (tenant_id, provider, status, external_id, access_token, refresh_token,
         token_expires_at, metadata, created_at, updated_at)
      VALUES ($1,'quickbooks','active',$2,$3,$4,$5,$6,NOW(),NOW())
      ON CONFLICT (tenant_id, provider) DO UPDATE SET
        status='active', external_id=$2, access_token=$3, refresh_token=$4,
        token_expires_at=$5, metadata=$6, updated_at=NOW()`,
      [tenantId, realmId, tokens.access_token, tokens.refresh_token, expiry,
       JSON.stringify({ company_name: companyName, realm_id: realmId })]
    );

    // Trigger initial full sync
    syncTenant(tenantId, 'quickbooks', 'full');

    // Redirect to ERP management page
    res.redirect(`/erp_integration.html?connected=quickbooks&company=${encodeURIComponent(companyName)}`);

  } catch (err) {
    console.error('[QBO] Callback error:', err.message);
    res.redirect(`/erp_integration.html?error=${encodeURIComponent(err.message)}`);
  }
});

// ================================================================
// XERO — OAuth connect
// ================================================================

router.get('/xero/connect', async (req, res) => {
  const tenantId = getTenantId(req);
  if (!tenantId) return res.status(400).json({ error: 'tenant_id required' });

  const state              = `${tenantId}:${crypto.randomBytes(16).toString('hex')}`;
  const { url, verifier }  = Xero.getAuthUrl(state);
  pkceStore.set(state, verifier);
  res.json({ auth_url: url, state });
});

router.get('/xero/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!code || !state) return res.status(400).send('Missing code or state');

  const [tenantId] = state.split(':');
  const verifier   = pkceStore.get(state);
  if (!verifier) return res.status(400).send('Invalid or expired state');
  pkceStore.delete(state);

  try {
    const tokens     = await Xero.exchangeCodeForTokens(code, verifier);
    const expiry     = new Date(Date.now() + tokens.expires_in * 1000);
    const orgList    = await Xero.getTenantConnections(tokens.access_token);
    const org        = orgList?.[0];
    const xeroTenantId = org?.tenantId;
    const companyName  = org?.tenantName || 'Xero Organisation';

    await query(`
      INSERT INTO data_connections
        (tenant_id, provider, status, external_id, access_token, refresh_token,
         token_expires_at, metadata, created_at, updated_at)
      VALUES ($1,'xero','active',$2,$3,$4,$5,$6,NOW(),NOW())
      ON CONFLICT (tenant_id, provider) DO UPDATE SET
        status='active', external_id=$2, access_token=$3, refresh_token=$4,
        token_expires_at=$5, metadata=$6, updated_at=NOW()`,
      [tenantId, xeroTenantId, tokens.access_token, tokens.refresh_token, expiry,
       JSON.stringify({ company_name: companyName, tenant_id: xeroTenantId })]
    );

    syncTenant(tenantId, 'xero', 'full');
    res.redirect(`/erp_integration.html?connected=xero&company=${encodeURIComponent(companyName)}`);

  } catch (err) {
    console.error('[Xero] Callback error:', err.message);
    res.redirect(`/erp_integration.html?error=${encodeURIComponent(err.message)}`);
  }
});

// ================================================================
// SYNC — manual trigger
// ================================================================

router.post('/sync', async (req, res) => {
  const { provider, mode = 'incremental' } = req.body;
  const tenantId = getTenantId(req);
  if (!tenantId || !provider) return res.status(400).json({ error: 'tenantId and provider required' });

  res.json({ message: 'Sync started', tenantId, provider, mode });
  syncTenant(tenantId, provider, mode);
});

// ================================================================
// SYNC HISTORY
// ================================================================

router.get('/sync-history', async (req, res) => {
  const tenantId = getTenantId(req);
  if (!tenantId) return res.status(400).json({ error: 'tenant_id required' });

  const history = await query(
    `SELECT source, status, row_count, error_log, created_at
     FROM data_imports
     WHERE tenant_id=$1 AND source IN ('quickbooks','xero')
     ORDER BY created_at DESC LIMIT 50`,
    [tenantId]
  );
  res.json(history.rows);
});

// ================================================================
// DASHBOARD KPIs — serve ERP-sourced data to frontend
// ================================================================

router.get('/kpis/:dashboardId', async (req, res) => {
  const tenantId    = getTenantId(req);
  const dashboardId = parseInt(req.params.dashboardId);
  if (!tenantId) return res.status(400).json({ error: 'tenant_id required' });

  const snap = await query(
    `SELECT snapshot_data, source, refreshed_at
     FROM kpi_snapshots
     WHERE tenant_id=$1 AND dashboard_id=$2`,
    [tenantId, dashboardId]
  );

  if (!snap.rows.length) {
    return res.json({ kpis: {}, source: 'none', message: 'No data yet — connect an ERP to see live metrics' });
  }

  res.json({
    kpis: snap.rows[0].snapshot_data,
    source: snap.rows[0].source,
    refreshed_at: snap.rows[0].refreshed_at,
  });
});

// ================================================================
// DISCONNECT — remove ERP connection
// ================================================================

router.delete('/disconnect/:provider', async (req, res) => {
  const tenantId = getTenantId(req);
  const provider = req.params.provider;
  if (!tenantId) return res.status(400).json({ error: 'tenant_id required' });

  await query(
    `UPDATE data_connections SET status='disconnected', updated_at=NOW()
     WHERE tenant_id=$1 AND provider=$2`,
    [tenantId, provider]
  );
  res.json({ success: true, message: `${provider} disconnected` });
});

// ================================================================
// FIELD MAPPING — view what data was imported
// ================================================================

router.get('/data-summary', async (req, res) => {
  const tenantId = getTenantId(req);
  if (!tenantId) return res.status(400).json({ error: 'tenant_id required' });

  const [invoices, accounts, vendors, pos] = await Promise.all([
    query(`SELECT COUNT(*) as count, MAX(updated_at) as last_update FROM invoices WHERE tenant_id=$1`, [tenantId]),
    query(`SELECT COUNT(*) as count FROM gl_accounts WHERE tenant_id=$1`, [tenantId]),
    query(`SELECT COUNT(*) as count FROM suppliers WHERE tenant_id=$1`, [tenantId]),
    query(`SELECT COUNT(*) as count FROM purchase_orders WHERE tenant_id=$1`, [tenantId]),
  ]);

  res.json({
    tables: {
      invoices:       { count: parseInt(invoices.rows[0]?.count)||0, last_update: invoices.rows[0]?.last_update },
      gl_accounts:    { count: parseInt(accounts.rows[0]?.count)||0 },
      suppliers:      { count: parseInt(vendors.rows[0]?.count)||0 },
      purchase_orders:{ count: parseInt(pos.rows[0]?.count)||0 },
    }
  });
});

module.exports = router;
