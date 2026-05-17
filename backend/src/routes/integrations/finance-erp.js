const express  = require('express');
const router   = express.Router();
const { query } = require('../../services/database');
const crypto   = require('crypto');

let QBO = null, Xero = null, erpSync = null;
try { QBO     = require('../../services/connectors/quickbooks'); } catch(e) { console.warn('[ERP] QBO:', e.message); }
try { Xero    = require('../../services/connectors/xero');       } catch(e) { console.warn('[ERP] Xero:', e.message); }
try { erpSync = require('../../jobs/erp-sync');                  } catch(e) { console.warn('[ERP] Sync:', e.message); }

const PKCE = new Map();
function getTenantId(req) {
  return req.user && req.user.tenant_id ? req.user.tenant_id : (req.query.tenant_id || (req.body && req.body.tenant_id) || 'default');
}

router.get('/status', async (req, res) => {
  const tenantId = getTenantId(req);
  const providers = [
    { id: 'quickbooks', name: 'QuickBooks Online', auth_url: '/v1/integrations/quickbooks/connect' },
    { id: 'xero', name: 'Xero', auth_url: '/v1/integrations/xero/connect' },
  ];
  try {
    const conns = await query(
      "SELECT id, provider, status, last_sync_at, created_at, COALESCE(external_id,'') as external_id, COALESCE(metadata->>'company_name','') as company_name FROM data_connections WHERE tenant_id=$1 AND provider IN ('quickbooks','xero') ORDER BY created_at DESC",
      [tenantId]
    );
    res.json({ connections: conns.rows, available_providers: providers });
  } catch (err) {
    res.json({ connections: [], available_providers: providers, note: err.message });
  }
});

router.get('/quickbooks/connect', async (req, res) => {
  if (!QBO) return res.status(503).json({ error: 'QBO not configured. Add QBO_CLIENT_ID and QBO_CLIENT_SECRET to Render environment.' });
  const tenantId = getTenantId(req);
  const state = tenantId + ':' + crypto.randomBytes(16).toString('hex');
  try {
    res.json({ auth_url: QBO.getAuthUrl(state), state });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/quickbooks/callback', async (req, res) => {
  const code = req.query.code, state = req.query.state, realmId = req.query.realmId;
  if (!code || !state) return res.status(400).send('Missing code or state');
  const tenantId = state.split(':')[0];
  try {
    const tokens = await QBO.exchangeCodeForTokens(code);
    const expiry = new Date(Date.now() + tokens.expires_in * 1000);
    await query(
      "INSERT INTO data_connections (tenant_id, provider, status, created_at, updated_at) VALUES ($1, 'quickbooks', 'active', NOW(), NOW()) ON CONFLICT (tenant_id, provider) DO UPDATE SET status='active', updated_at=NOW()",
      [tenantId]
    );
    await query(
      "UPDATE data_connections SET external_id=$1, access_token=$2, refresh_token=$3, token_expires_at=$4, metadata=$5, updated_at=NOW() WHERE tenant_id=$6 AND provider='quickbooks'",
      [realmId, tokens.access_token, tokens.refresh_token, expiry, JSON.stringify({ realm_id: realmId }), tenantId]
    );
    if (erpSync) erpSync.syncTenant(tenantId, 'quickbooks', 'full').catch(console.error);
    res.redirect('/erp_integration.html?connected=quickbooks');
  } catch (err) {
    console.error('[QBO] Callback error:', err.message);
    res.redirect('/erp_integration.html?error=' + encodeURIComponent(err.message));
  }
});

router.get('/xero/connect', async (req, res) => {
  if (!Xero) return res.status(503).json({ error: 'Xero not configured. Add XERO_CLIENT_ID and XERO_CLIENT_SECRET to Render environment.' });
  const tenantId = getTenantId(req);
  const state = tenantId + ':' + crypto.randomBytes(16).toString('hex');
  try {
    const result = Xero.getAuthUrl(state);
    PKCE.set(state, result.verifier);
    res.json({ auth_url: result.url, state });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/xero/callback', async (req, res) => {
  const code = req.query.code, state = req.query.state;
  if (!code || !state) return res.status(400).send('Missing code or state');
  const tenantId = state.split(':')[0];
  const verifier = PKCE.get(state);
  if (!verifier) return res.status(400).send('Invalid state');
  PKCE.delete(state);
  try {
    const tokens = await Xero.exchangeCodeForTokens(code, verifier);
    const expiry = new Date(Date.now() + tokens.expires_in * 1000);
    const orgs = await Xero.getTenantConnections(tokens.access_token);
    const org = orgs && orgs[0] ? orgs[0] : {};
    await query(
      "INSERT INTO data_connections (tenant_id, provider, status, created_at, updated_at) VALUES ($1, 'xero', 'active', NOW(), NOW()) ON CONFLICT (tenant_id, provider) DO UPDATE SET status='active', updated_at=NOW()",
      [tenantId]
    );
    await query(
      "UPDATE data_connections SET external_id=$1, access_token=$2, refresh_token=$3, token_expires_at=$4, metadata=$5, updated_at=NOW() WHERE tenant_id=$6 AND provider='xero'",
      [org.tenantId || '', tokens.access_token, tokens.refresh_token, expiry, JSON.stringify({ company_name: org.tenantName || 'Xero' }), tenantId]
    );
    if (erpSync) erpSync.syncTenant(tenantId, 'xero', 'full').catch(console.error);
    res.redirect('/erp_integration.html?connected=xero&company=' + encodeURIComponent(org.tenantName || 'Xero'));
  } catch (err) {
    console.error('[Xero] Callback error:', err.message);
    res.redirect('/erp_integration.html?error=' + encodeURIComponent(err.message));
  }
});

router.post('/sync', async (req, res) => {
  const provider = req.body && req.body.provider;
  const mode = (req.body && req.body.mode) || 'incremental';
  const tenantId = getTenantId(req);
  if (!provider) return res.status(400).json({ error: 'provider required' });
  if (!erpSync) return res.status(503).json({ error: 'Sync service not available' });
  res.json({ message: 'Sync started', tenantId, provider, mode });
  erpSync.syncTenant(tenantId, provider, mode).catch(console.error);
});

router.get('/sync-history', async (req, res) => {
  const tenantId = getTenantId(req);
  try {
    const h = await query("SELECT source, status, row_count, error_log, created_at FROM data_imports WHERE tenant_id=$1 AND source IN ('quickbooks','xero') ORDER BY created_at DESC LIMIT 50", [tenantId]);
    res.json(h.rows);
  } catch (err) {
    res.json([]);
  }
});

router.get('/kpis/:dashboardId', async (req, res) => {
  const tenantId = getTenantId(req);
  const dashboardId = parseInt(req.params.dashboardId);
  try {
    const snap = await query("SELECT snapshot_data, source, refreshed_at FROM kpi_snapshots WHERE tenant_id=$1 AND dashboard_id=$2", [tenantId, dashboardId]);
    if (!snap.rows.length) return res.json({ kpis: {}, source: 'none' });
    res.json({ kpis: snap.rows[0].snapshot_data, source: snap.rows[0].source, refreshed_at: snap.rows[0].refreshed_at });
  } catch (err) {
    res.json({ kpis: {}, error: err.message });
  }
});

router.get('/data-summary', async (req, res) => {
  const tenantId = getTenantId(req);
  try {
    const inv  = await query("SELECT COUNT(*) as count FROM invoices WHERE tenant_id=$1", [tenantId]);
    const acct = await query("SELECT COUNT(*) as count FROM gl_accounts WHERE tenant_id=$1", [tenantId]);
    const vend = await query("SELECT COUNT(*) as count FROM suppliers WHERE tenant_id=$1", [tenantId]);
    const po   = await query("SELECT COUNT(*) as count FROM purchase_orders WHERE tenant_id=$1", [tenantId]);
    res.json({ tables: {
      invoices:        { count: parseInt(inv.rows[0].count)  || 0 },
      gl_accounts:     { count: parseInt(acct.rows[0].count) || 0 },
      suppliers:       { count: parseInt(vend.rows[0].count) || 0 },
      purchase_orders: { count: parseInt(po.rows[0].count)   || 0 },
    }});
  } catch (err) {
    res.json({ tables: {}, error: err.message });
  }
});

router.delete('/disconnect/:provider', async (req, res) => {
  const tenantId = getTenantId(req);
  try {
    await query("UPDATE data_connections SET status='disconnected', updated_at=NOW() WHERE tenant_id=$1 AND provider=$2", [tenantId, req.params.provider]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
