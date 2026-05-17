// ================================================================
// QUICKBOOKS ONLINE CONNECTOR
// File: src/services/connectors/quickbooks.js
//
// Setup:
// 1. Create app at developer.intuit.com
// 2. Set redirect URI to https://your-domain.com/v1/integrations/quickbooks/callback
// 3. Add to .env:
//    QBO_CLIENT_ID=your_client_id
//    QBO_CLIENT_SECRET=your_client_secret
//    QBO_REDIRECT_URI=https://your-domain.com/v1/integrations/quickbooks/callback
//    QBO_ENVIRONMENT=sandbox   (or production)
// ================================================================

const axios  = require('axios');
const { query } = require('../database');

const QBO_ENV      = process.env.QBO_ENVIRONMENT || 'sandbox';
const BASE_URL     = QBO_ENV === 'production'
  ? 'https://quickbooks.api.intuit.com/v3/company'
  : 'https://sandbox-quickbooks.api.intuit.com/v3/company';
const AUTH_URL     = 'https://appcenter.intuit.com/connect/oauth2';
const TOKEN_URL    = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const CLIENT_ID    = process.env.QBO_CLIENT_ID;
const CLIENT_SECRET= process.env.QBO_CLIENT_SECRET;
const REDIRECT_URI = process.env.QBO_REDIRECT_URI;

// ── Scopes needed ────────────────────────────────────────────
const SCOPES = [
  'com.intuit.quickbooks.accounting',
  'openid','profile','email','phone','address'
].join(' ');

// ================================================================
// OAUTH FLOW
// ================================================================

function getAuthUrl(state) {
  const params = new URLSearchParams({
    client_id:     CLIENT_ID,
    redirect_uri:  REDIRECT_URI,
    response_type: 'code',
    scope:         SCOPES,
    state:         state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

async function exchangeCodeForTokens(code) {
  const credentials = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const response = await axios.post(TOKEN_URL,
    new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI }),
    { headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json'
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
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json'
    }}
  );
  return response.data;
}

// ── Get valid access token (auto-refresh if expired) ─────────
async function getValidToken(tenantId) {
  const conn = await query(
    `SELECT * FROM data_connections WHERE tenant_id=$1 AND provider='quickbooks' AND status='active' LIMIT 1`,
    [tenantId]
  );
  if (!conn.rows.length) throw new Error('QuickBooks not connected for this tenant');

  const c = conn.rows[0];
  const now = new Date();
  const expiresAt = new Date(c.token_expires_at);

  // Refresh if expires within 5 minutes
  if (expiresAt - now < 5 * 60 * 1000) {
    console.log('[QBO] Refreshing access token for tenant', tenantId);
    const tokens = await refreshAccessToken(c.refresh_token);
    const newExpiry = new Date(Date.now() + tokens.expires_in * 1000);
    await query(
      `UPDATE data_connections SET
        access_token=$1, refresh_token=$2, token_expires_at=$3, updated_at=NOW()
       WHERE id=$4`,
      [tokens.access_token, tokens.refresh_token || c.refresh_token, newExpiry, c.id]
    );
    return { accessToken: tokens.access_token, realmId: c.external_id };
  }

  return { accessToken: c.access_token, realmId: c.external_id };
}

// ================================================================
// API CALLS
// ================================================================

async function apiGet(realmId, accessToken, path, params = {}) {
  const url = `${BASE_URL}/${realmId}/${path}`;
  const response = await axios.get(url, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json',
    },
    params: { minorversion: 65, ...params },
  });
  return response.data;
}

async function apiQuery(realmId, accessToken, sql) {
  const url = `${BASE_URL}/${realmId}/query`;
  const response = await axios.get(url, {
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/json' },
    params: { query: sql, minorversion: 65 },
  });
  return response.data.QueryResponse;
}

// ================================================================
// FINANCIAL REPORTS
// ================================================================

async function fetchProfitAndLoss(realmId, accessToken, { startDate, endDate, accounting_method = 'Accrual' } = {}) {
  const start = startDate || new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0];
  const end   = endDate   || new Date().toISOString().split('T')[0];
  const data  = await apiGet(realmId, accessToken, 'reports/ProfitAndLoss', {
    start_date: start, end_date: end, accounting_method
  });
  return parseProfitAndLoss(data);
}

async function fetchBalanceSheet(realmId, accessToken, { asOfDate } = {}) {
  const date = asOfDate || new Date().toISOString().split('T')[0];
  const data = await apiGet(realmId, accessToken, 'reports/BalanceSheet', { date });
  return parseBalanceSheet(data);
}

async function fetchCashFlow(realmId, accessToken, { startDate, endDate } = {}) {
  const start = startDate || new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0];
  const end   = endDate   || new Date().toISOString().split('T')[0];
  const data  = await apiGet(realmId, accessToken, 'reports/CashFlow', {
    start_date: start, end_date: end
  });
  return parseCashFlow(data);
}

async function fetchARAgingDetail(realmId, accessToken) {
  const data = await apiGet(realmId, accessToken, 'reports/AgedReceivableDetail');
  return parseAgingReport(data, 'receivable');
}

async function fetchAPAgingDetail(realmId, accessToken) {
  const data = await apiGet(realmId, accessToken, 'reports/AgedPayableDetail');
  return parseAgingReport(data, 'payable');
}

async function fetchInvoices(realmId, accessToken, { since } = {}) {
  const where = since
    ? `WHERE MetaData.LastUpdatedTime > '${since}'`
    : `WHERE TxnDate > '${new Date(Date.now() - 90*86400000).toISOString().split('T')[0]}'`;
  const sql  = `SELECT * FROM Invoice ${where} ORDER BY TxnDate DESC MAXRESULTS 1000`;
  return await apiQuery(realmId, accessToken, sql);
}

async function fetchBills(realmId, accessToken, { since } = {}) {
  const where = since ? `WHERE MetaData.LastUpdatedTime > '${since}'` : '';
  const sql   = `SELECT * FROM Bill ${where} ORDER BY TxnDate DESC MAXRESULTS 1000`;
  return await apiQuery(realmId, accessToken, sql);
}

async function fetchAccounts(realmId, accessToken) {
  const sql = `SELECT * FROM Account WHERE Active = true MAXRESULTS 1000`;
  return await apiQuery(realmId, accessToken, sql);
}

async function fetchJournalEntries(realmId, accessToken, { since } = {}) {
  const where = since ? `WHERE MetaData.LastUpdatedTime > '${since}'` : '';
  const sql   = `SELECT * FROM JournalEntry ${where} ORDER BY TxnDate DESC MAXRESULTS 1000`;
  return await apiQuery(realmId, accessToken, sql);
}

async function fetchVendors(realmId, accessToken) {
  const sql = `SELECT * FROM Vendor WHERE Active = true MAXRESULTS 1000`;
  return await apiQuery(realmId, accessToken, sql);
}

async function fetchCustomers(realmId, accessToken) {
  const sql = `SELECT * FROM Customer WHERE Active = true MAXRESULTS 1000`;
  return await apiQuery(realmId, accessToken, sql);
}

async function fetchBankTransactions(realmId, accessToken, { since } = {}) {
  const where = since ? `WHERE MetaData.LastUpdatedTime > '${since}'` : '';
  const sql   = `SELECT * FROM BankTransaction ${where} ORDER BY TxnDate DESC MAXRESULTS 1000`;
  return await apiQuery(realmId, accessToken, sql);
}

async function fetchPurchaseOrders(realmId, accessToken, { since } = {}) {
  const where = since ? `WHERE MetaData.LastUpdatedTime > '${since}'` : '';
  const sql   = `SELECT * FROM PurchaseOrder ${where} MAXRESULTS 1000`;
  return await apiQuery(realmId, accessToken, sql);
}

// ================================================================
// REPORT PARSERS — convert QBO report format to flat KPI objects
// ================================================================

function getRowValue(row) {
  if (!row || !row.ColData) return 0;
  const val = row.ColData[1]?.value || '0';
  return parseFloat(val.replace(/,/g, '')) || 0;
}

function findRow(rows, label) {
  if (!rows) return null;
  for (const row of rows) {
    if (row.Summary?.ColData?.[0]?.value?.toLowerCase().includes(label.toLowerCase())) return row;
    if (row.ColData?.[0]?.value?.toLowerCase().includes(label.toLowerCase())) return row;
    if (row.Rows) {
      const found = findRow(row.Rows.Row, label);
      if (found) return found;
    }
  }
  return null;
}

function parseProfitAndLoss(report) {
  const rows = report?.Rows?.Row || [];
  const period = report?.Header?.StartPeriod + ' to ' + report?.Header?.EndPeriod;

  const incomeRow   = findRow(rows, 'total income') || findRow(rows, 'gross profit');
  const cogRow      = findRow(rows, 'cost of goods') || findRow(rows, 'cost of sales');
  const grossRow    = findRow(rows, 'gross profit');
  const expRow      = findRow(rows, 'total expenses');
  const opIncRow    = findRow(rows, 'operating income') || findRow(rows, 'net operating income');
  const netRow      = findRow(rows, 'net income');

  return {
    period,
    revenue:          getRowValue(incomeRow),
    cogs:             getRowValue(cogRow),
    gross_profit:     getRowValue(grossRow),
    operating_expenses: getRowValue(expRow),
    operating_income: getRowValue(opIncRow),
    net_income:       getRowValue(netRow),
    raw: report,
  };
}

function parseBalanceSheet(report) {
  const rows = report?.Rows?.Row || [];

  const assetsRow       = findRow(rows, 'total assets');
  const currentAssetsRow= findRow(rows, 'total current assets');
  const liabRow         = findRow(rows, 'total liabilities');
  const currentLiabRow  = findRow(rows, 'total current liabilities');
  const equityRow       = findRow(rows, 'total equity') || findRow(rows, 'net equity');

  const totalAssets  = getRowValue(assetsRow);
  const currentAssets= getRowValue(currentAssetsRow);
  const totalLiab    = getRowValue(liabRow);
  const currentLiab  = getRowValue(currentLiabRow);
  const equity       = getRowValue(equityRow);

  return {
    total_assets:     totalAssets,
    current_assets:   currentAssets,
    total_liabilities: totalLiab,
    current_liabilities: currentLiab,
    equity,
    working_capital:  currentAssets - currentLiab,
    current_ratio:    currentLiab > 0 ? Math.round((currentAssets / currentLiab) * 100) / 100 : 0,
    debt_to_equity:   equity > 0 ? Math.round((totalLiab / equity) * 100) / 100 : 0,
    raw: report,
  };
}

function parseCashFlow(report) {
  const rows = report?.Rows?.Row || [];

  const opRow  = findRow(rows, 'net cash provided by operating');
  const invRow = findRow(rows, 'net cash provided by investing');
  const finRow = findRow(rows, 'net cash provided by financing');
  const netRow = findRow(rows, 'net change in cash');

  return {
    operating_cash_flow:  getRowValue(opRow),
    investing_cash_flow:  getRowValue(invRow),
    financing_cash_flow:  getRowValue(finRow),
    net_cash_change:      getRowValue(netRow),
    raw: report,
  };
}

function parseAgingReport(report, type) {
  const rows    = report?.Rows?.Row || [];
  const buckets = { current: 0, days1_30: 0, days31_60: 0, days61_90: 0, over90: 0 };
  let total = 0;
  rows.forEach(row => {
    const cols = row.ColData || [];
    const amounts = cols.slice(2).map(c => parseFloat(c.value?.replace(/,/g,'')) || 0);
    if (amounts.length >= 5) {
      buckets.current  += amounts[0] || 0;
      buckets.days1_30 += amounts[1] || 0;
      buckets.days31_60+= amounts[2] || 0;
      buckets.days61_90+= amounts[3] || 0;
      buckets.over90   += amounts[4] || 0;
    }
    const rowTotal = parseFloat(cols[cols.length-1]?.value?.replace(/,/g,'')) || 0;
    total += rowTotal;
  });
  return { type, total, ...buckets, overdue: total - buckets.current };
}

// ================================================================
// FULL SYNC — fetch everything and return structured data
// ================================================================

async function fullSync(tenantId) {
  const { accessToken, realmId } = await getValidToken(tenantId);
  console.log(`[QBO] Starting full sync for tenant ${tenantId}, realm ${realmId}`);

  const [pnl, bs, cf, arAging, apAging, invoices, bills, accounts, vendors, customers, pos] =
    await Promise.allSettled([
      fetchProfitAndLoss(realmId, accessToken),
      fetchBalanceSheet(realmId, accessToken),
      fetchCashFlow(realmId, accessToken),
      fetchARAgingDetail(realmId, accessToken),
      fetchAPAgingDetail(realmId, accessToken),
      fetchInvoices(realmId, accessToken),
      fetchBills(realmId, accessToken),
      fetchAccounts(realmId, accessToken),
      fetchVendors(realmId, accessToken),
      fetchCustomers(realmId, accessToken),
      fetchPurchaseOrders(realmId, accessToken),
    ]);

  return {
    profit_and_loss:  pnl.status      === 'fulfilled' ? pnl.value      : null,
    balance_sheet:    bs.status       === 'fulfilled' ? bs.value       : null,
    cash_flow:        cf.status       === 'fulfilled' ? cf.value       : null,
    ar_aging:         arAging.status  === 'fulfilled' ? arAging.value  : null,
    ap_aging:         apAging.status  === 'fulfilled' ? apAging.value  : null,
    invoices:         invoices.status === 'fulfilled' ? invoices.value : [],
    bills:            bills.status    === 'fulfilled' ? bills.value    : [],
    accounts:         accounts.status === 'fulfilled' ? accounts.value : [],
    vendors:          vendors.status  === 'fulfilled' ? vendors.value  : [],
    customers:        customers.status=== 'fulfilled' ? customers.value: [],
    purchase_orders:  pos.status      === 'fulfilled' ? pos.value      : [],
  };
}

async function incrementalSync(tenantId, since) {
  const { accessToken, realmId } = await getValidToken(tenantId);
  console.log(`[QBO] Incremental sync since ${since} for tenant ${tenantId}`);

  const [pnl, bs, cf, invoices, bills, pos] = await Promise.allSettled([
    fetchProfitAndLoss(realmId, accessToken),
    fetchBalanceSheet(realmId, accessToken),
    fetchCashFlow(realmId, accessToken),
    fetchInvoices(realmId, accessToken, { since }),
    fetchBills(realmId, accessToken, { since }),
    fetchPurchaseOrders(realmId, accessToken, { since }),
  ]);

  return {
    profit_and_loss: pnl.status      === 'fulfilled' ? pnl.value      : null,
    balance_sheet:   bs.status       === 'fulfilled' ? bs.value       : null,
    cash_flow:       cf.status       === 'fulfilled' ? cf.value       : null,
    invoices:        invoices.status === 'fulfilled' ? invoices.value : [],
    bills:           bills.status    === 'fulfilled' ? bills.value    : [],
    purchase_orders: pos.status      === 'fulfilled' ? pos.value      : [],
  };
}

module.exports = {
  getAuthUrl, exchangeCodeForTokens, refreshAccessToken, getValidToken,
  fullSync, incrementalSync,
  fetchProfitAndLoss, fetchBalanceSheet, fetchCashFlow,
  fetchARAgingDetail, fetchAPAgingDetail,
  fetchInvoices, fetchBills, fetchAccounts,
  fetchVendors, fetchCustomers, fetchBankTransactions, fetchPurchaseOrders,
};
