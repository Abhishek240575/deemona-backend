// ================================================================
// XERO CONNECTOR
// File: src/services/connectors/xero.js
//
// Setup:
// 1. Create app at developer.xero.com
// 2. Set redirect URI to https://your-domain.com/v1/integrations/xero/callback
// 3. Add to .env:
//    XERO_CLIENT_ID=your_client_id
//    XERO_CLIENT_SECRET=your_client_secret
//    XERO_REDIRECT_URI=https://your-domain.com/v1/integrations/xero/callback
// ================================================================

const axios  = require('axios');
const crypto = require('crypto');
const { query } = require('../database');

const CLIENT_ID     = process.env.XERO_CLIENT_ID;
const CLIENT_SECRET = process.env.XERO_CLIENT_SECRET;
const REDIRECT_URI  = process.env.XERO_REDIRECT_URI;
const AUTH_URL      = 'https://login.xero.com/identity/connect/authorize';
const TOKEN_URL     = 'https://identity.xero.com/connect/token';
const API_BASE      = 'https://api.xero.com/api.xro/2.0';
const CONNECTIONS_URL = 'https://api.xero.com/connections';

const SCOPES = [
  'openid','profile','email',
  'accounting.reports.read',
  'accounting.transactions.read',
  'accounting.contacts.read',
  'accounting.settings.read',
  'offline_access'
].join(' ');

// ================================================================
// OAUTH FLOW
// ================================================================

function getAuthUrl(state) {
  // PKCE challenge
  const verifier  = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const params = new URLSearchParams({
    response_type:         'code',
    client_id:             CLIENT_ID,
    redirect_uri:          REDIRECT_URI,
    scope:                 SCOPES,
    state,
    code_challenge:        challenge,
    code_challenge_method: 'S256',
  });
  return { url: `${AUTH_URL}?${params.toString()}`, verifier };
}

async function exchangeCodeForTokens(code, verifier) {
  const credentials = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const response = await axios.post(TOKEN_URL,
    new URLSearchParams({
      grant_type:    'authorization_code',
      code,
      redirect_uri:  REDIRECT_URI,
      code_verifier: verifier,
    }),
    { headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type':  'application/x-www-form-urlencoded',
    }}
  );
  return response.data;
}

async function refreshAccessToken(refreshToken) {
  const credentials = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const response = await axios.post(TOKEN_URL,
    new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
    { headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type':  'application/x-www-form-urlencoded',
    }}
  );
  return response.data;
}

async function getTenantConnections(accessToken) {
  const response = await axios.get(CONNECTIONS_URL, {
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
  });
  return response.data;
}

async function getValidToken(tenantId) {
  const conn = await query(
    `SELECT * FROM data_connections WHERE tenant_id=$1 AND provider='xero' AND status='active' LIMIT 1`,
    [tenantId]
  );
  if (!conn.rows.length) throw new Error('Xero not connected for this tenant');

  const c = conn.rows[0];
  const now = new Date();
  const expiresAt = new Date(c.token_expires_at);

  if (expiresAt - now < 5 * 60 * 1000) {
    console.log('[Xero] Refreshing access token');
    const tokens = await refreshAccessToken(c.refresh_token);
    const newExpiry = new Date(Date.now() + tokens.expires_in * 1000);
    await query(
      `UPDATE data_connections SET access_token=$1, refresh_token=$2, token_expires_at=$3, updated_at=NOW() WHERE id=$4`,
      [tokens.access_token, tokens.refresh_token || c.refresh_token, newExpiry, c.id]
    );
    return { accessToken: tokens.access_token, xeroTenantId: c.external_id };
  }

  return { accessToken: c.access_token, xeroTenantId: c.external_id };
}

// ================================================================
// API CALLS
// ================================================================

async function apiGet(xeroTenantId, accessToken, path, params = {}, accept = 'application/json') {
  const response = await axios.get(`${API_BASE}/${path}`, {
    headers: {
      'Authorization':  `Bearer ${accessToken}`,
      'xero-tenant-id': xeroTenantId,
      'Accept':         accept,
    },
    params,
  });
  return response.data;
}

// ================================================================
// FINANCIAL REPORTS
// ================================================================

async function fetchProfitAndLoss(xeroTenantId, accessToken, { fromDate, toDate } = {}) {
  const from = fromDate || new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0];
  const to   = toDate   || new Date().toISOString().split('T')[0];
  const data = await apiGet(xeroTenantId, accessToken, 'Reports/ProfitAndLoss', {
    fromDate: from, toDate: to
  });
  return parseProfitAndLoss(data?.Reports?.[0]);
}

async function fetchBalanceSheet(xeroTenantId, accessToken, { date } = {}) {
  const d    = date || new Date().toISOString().split('T')[0];
  const data = await apiGet(xeroTenantId, accessToken, 'Reports/BalanceSheet', { date: d });
  return parseBalanceSheet(data?.Reports?.[0]);
}

async function fetchCashFlow(xeroTenantId, accessToken, { fromDate, toDate } = {}) {
  const from = fromDate || new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0];
  const to   = toDate   || new Date().toISOString().split('T')[0];
  const data = await apiGet(xeroTenantId, accessToken, 'Reports/CashSummary', {
    fromDate: from, toDate: to
  });
  return parseCashFlow(data?.Reports?.[0]);
}

async function fetchARAgingDetail(xeroTenantId, accessToken) {
  const data = await apiGet(xeroTenantId, accessToken, 'Reports/AgedReceivablesByContact');
  return parseAgingReport(data?.Reports?.[0], 'receivable');
}

async function fetchAPAgingDetail(xeroTenantId, accessToken) {
  const data = await apiGet(xeroTenantId, accessToken, 'Reports/AgedPayablesByContact');
  return parseAgingReport(data?.Reports?.[0], 'payable');
}

async function fetchInvoices(xeroTenantId, accessToken, { since } = {}) {
  const params = { order: 'UpdatedDateUTC DESC', pageSize: 1000 };
  if (since) params.IFModifiedSince = since;
  const data = await apiGet(xeroTenantId, accessToken, 'Invoices', params);
  return data?.Invoices || [];
}

async function fetchBills(xeroTenantId, accessToken, { since } = {}) {
  const params = { Type: 'ACCPAY', order: 'UpdatedDateUTC DESC', pageSize: 1000 };
  if (since) params.IFModifiedSince = since;
  const data = await apiGet(xeroTenantId, accessToken, 'Invoices', params);
  return data?.Invoices || [];
}

async function fetchAccounts(xeroTenantId, accessToken) {
  const data = await apiGet(xeroTenantId, accessToken, 'Accounts');
  return data?.Accounts || [];
}

async function fetchContacts(xeroTenantId, accessToken) {
  const data = await apiGet(xeroTenantId, accessToken, 'Contacts', { pageSize: 1000 });
  return data?.Contacts || [];
}

async function fetchBankTransactions(xeroTenantId, accessToken, { since } = {}) {
  const params = { pageSize: 1000 };
  if (since) params.IFModifiedSince = since;
  const data = await apiGet(xeroTenantId, accessToken, 'BankTransactions', params);
  return data?.BankTransactions || [];
}

async function fetchPurchaseOrders(xeroTenantId, accessToken, { since } = {}) {
  const params = {};
  if (since) params.IFModifiedSince = since;
  const data = await apiGet(xeroTenantId, accessToken, 'PurchaseOrders', params);
  return data?.PurchaseOrders || [];
}

async function fetchTrialBalance(xeroTenantId, accessToken) {
  const data = await apiGet(xeroTenantId, accessToken, 'Reports/TrialBalance');
  return data?.Reports?.[0] || null;
}

// ================================================================
// PARSERS — convert Xero report format to flat KPI objects
// ================================================================

function getXeroValue(rows, label) {
  if (!rows) return 0;
  for (const row of rows) {
    for (const cell of (row.Cells || [])) {
      if (cell.Value?.toLowerCase().includes(label.toLowerCase())) {
        const next = row.Cells.find((c, i) => i > row.Cells.indexOf(cell) && !isNaN(parseFloat(c.Value)));
        return next ? parseFloat(next.Value) || 0 : 0;
      }
    }
    if (row.Rows) {
      const val = getXeroValue(row.Rows, label);
      if (val !== 0) return val;
    }
  }
  return 0;
}

function parseProfitAndLoss(report) {
  const rows = report?.Rows || [];
  return {
    period:             `${report?.ReportDate}`,
    revenue:            getXeroValue(rows, 'Total Income') || getXeroValue(rows, 'Total Revenue'),
    cogs:               getXeroValue(rows, 'Cost of Sales') || getXeroValue(rows, 'Cost of Goods'),
    gross_profit:       getXeroValue(rows, 'Gross Profit'),
    operating_expenses: getXeroValue(rows, 'Total Expenses') || getXeroValue(rows, 'Total Operating'),
    net_income:         getXeroValue(rows, 'Net Profit') || getXeroValue(rows, 'Net Income'),
    raw: report,
  };
}

function parseBalanceSheet(report) {
  const rows = report?.Rows || [];
  const totalAssets   = getXeroValue(rows, 'Total Assets');
  const currentAssets = getXeroValue(rows, 'Total Current Assets');
  const totalLiab     = getXeroValue(rows, 'Total Liabilities');
  const currentLiab   = getXeroValue(rows, 'Total Current Liabilities');
  const equity        = getXeroValue(rows, 'Total Equity') || getXeroValue(rows, 'Net Assets');
  return {
    total_assets:       totalAssets,
    current_assets:     currentAssets,
    total_liabilities:  totalLiab,
    current_liabilities: currentLiab,
    equity,
    working_capital:    currentAssets - currentLiab,
    current_ratio:      currentLiab > 0 ? Math.round((currentAssets / currentLiab)*100)/100 : 0,
    debt_to_equity:     equity > 0 ? Math.round((totalLiab / equity)*100)/100 : 0,
    raw: report,
  };
}

function parseCashFlow(report) {
  const rows = report?.Rows || [];
  return {
    operating_cash_flow: getXeroValue(rows, 'Operating Activities'),
    investing_cash_flow: getXeroValue(rows, 'Investing Activities'),
    financing_cash_flow: getXeroValue(rows, 'Financing Activities'),
    net_cash_change:     getXeroValue(rows, 'Net Change'),
    raw: report,
  };
}

function parseAgingReport(report, type) {
  const rows    = report?.Rows || [];
  let total = 0, current = 0, d1_30 = 0, d31_60 = 0, d61_90 = 0, over90 = 0;
  rows.forEach(section => {
    (section.Rows || []).forEach(row => {
      const cells = row.Cells || [];
      if (cells.length >= 6) {
        current += parseFloat(cells[1]?.Value) || 0;
        d1_30   += parseFloat(cells[2]?.Value) || 0;
        d31_60  += parseFloat(cells[3]?.Value) || 0;
        d61_90  += parseFloat(cells[4]?.Value) || 0;
        over90  += parseFloat(cells[5]?.Value) || 0;
        total   += parseFloat(cells[cells.length-1]?.Value) || 0;
      }
    });
  });
  return { type, total, current, days1_30: d1_30, days31_60: d31_60, days61_90: d61_90, over90, overdue: total - current };
}

// ================================================================
// FULL SYNC
// ================================================================

async function fullSync(tenantId) {
  const { accessToken, xeroTenantId } = await getValidToken(tenantId);
  console.log(`[Xero] Full sync for tenant ${tenantId}`);

  const results = await Promise.allSettled([
    fetchProfitAndLoss(xeroTenantId, accessToken),
    fetchBalanceSheet(xeroTenantId, accessToken),
    fetchCashFlow(xeroTenantId, accessToken),
    fetchARAgingDetail(xeroTenantId, accessToken),
    fetchAPAgingDetail(xeroTenantId, accessToken),
    fetchInvoices(xeroTenantId, accessToken),
    fetchBills(xeroTenantId, accessToken),
    fetchAccounts(xeroTenantId, accessToken),
    fetchContacts(xeroTenantId, accessToken),
    fetchPurchaseOrders(xeroTenantId, accessToken),
  ]);

  const [pnl, bs, cf, ar, ap, inv, bills, accts, contacts, pos] = results;
  return {
    profit_and_loss:  pnl.status     === 'fulfilled' ? pnl.value     : null,
    balance_sheet:    bs.status      === 'fulfilled' ? bs.value      : null,
    cash_flow:        cf.status      === 'fulfilled' ? cf.value      : null,
    ar_aging:         ar.status      === 'fulfilled' ? ar.value      : null,
    ap_aging:         ap.status      === 'fulfilled' ? ap.value      : null,
    invoices:         inv.status     === 'fulfilled' ? inv.value     : [],
    bills:            bills.status   === 'fulfilled' ? bills.value   : [],
    accounts:         accts.status   === 'fulfilled' ? accts.value   : [],
    contacts:         contacts.status=== 'fulfilled' ? contacts.value: [],
    purchase_orders:  pos.status     === 'fulfilled' ? pos.value     : [],
  };
}

module.exports = {
  getAuthUrl, exchangeCodeForTokens, refreshAccessToken, getValidToken,
  getTenantConnections, fullSync,
  fetchProfitAndLoss, fetchBalanceSheet, fetchCashFlow,
  fetchARAgingDetail, fetchAPAgingDetail,
  fetchInvoices, fetchBills, fetchAccounts, fetchContacts,
  fetchBankTransactions, fetchPurchaseOrders, fetchTrialBalance,
};
