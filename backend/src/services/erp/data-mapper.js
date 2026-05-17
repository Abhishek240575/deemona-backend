// ================================================================
// ERP DATA MAPPER
// File: src/services/erp/data-mapper.js
//
// Maps raw ERP data (QuickBooks / Xero) into Deemona's
// PostgreSQL schema tables and updates KPI snapshots.
// ================================================================

const { query } = require('../database');

// ── Dashboard IDs (matches your DB seed) ─────────────────────
const DASH = {
  PROFIT_LOSS:   1,
  BALANCE_SHEET: 2,
  CASH_FLOW:     3,
  AR_AGING:      4,
  AP_AGING:      5,
  BUDGET_ACTUAL: 6,
  EXPENSE:       7,
  INVOICE:       8,
};

// ================================================================
// MASTER MAPPER — entry point
// Accepts unified data object (same shape for QBO & Xero)
// ================================================================

async function mapAndPersist(tenantId, data, provider) {
  console.log(`[Mapper] Mapping ${provider} data for tenant ${tenantId}`);
  const results = {};

  try {
    if (data.profit_and_loss) {
      results.pnl = await mapProfitAndLoss(tenantId, data.profit_and_loss, provider);
    }
    if (data.balance_sheet) {
      results.bs  = await mapBalanceSheet(tenantId, data.balance_sheet, provider);
    }
    if (data.cash_flow) {
      results.cf  = await mapCashFlow(tenantId, data.cash_flow, provider);
    }
    if (data.ar_aging) {
      results.ar  = await mapARAgingKpis(tenantId, data.ar_aging, provider);
    }
    if (data.ap_aging) {
      results.ap  = await mapAPAgingKpis(tenantId, data.ap_aging, provider);
    }
    if (data.invoices?.length) {
      results.invoices = await mapInvoices(tenantId, data.invoices, provider);
    }
    if (data.bills?.length) {
      results.bills = await mapBills(tenantId, data.bills, provider);
    }
    if (data.accounts?.length) {
      results.accounts = await mapAccounts(tenantId, data.accounts, provider);
    }
    if (data.vendors?.length || data.contacts?.length) {
      const contacts = data.vendors || data.contacts || [];
      results.vendors = await mapVendors(tenantId, contacts.filter(c =>
        c.IsSupplier || c.Vendor || c.VendorRef
      ), provider);
    }
    if (data.purchase_orders?.length) {
      results.pos = await mapPurchaseOrders(tenantId, data.purchase_orders, provider);
    }

    // Update last_sync timestamp
    await query(
      `UPDATE data_connections SET last_sync_at=NOW(), sync_count=sync_count+1
       WHERE tenant_id=$1 AND provider=$2`,
      [tenantId, provider]
    );

    // Log the sync
    await query(
      `INSERT INTO data_imports (tenant_id, source, status, row_count, metadata, created_at)
       VALUES ($1, $2, 'success', $3, $4, NOW())`,
      [tenantId, provider, Object.values(results).reduce((s, r) => s + (r?.count || 0), 0),
       JSON.stringify({ provider, sections: Object.keys(results) })]
    );

    console.log(`[Mapper] Sync complete for tenant ${tenantId}:`, Object.keys(results));
    return { success: true, results };

  } catch (err) {
    console.error(`[Mapper] Error for tenant ${tenantId}:`, err.message);
    await query(
      `INSERT INTO data_imports (tenant_id, source, status, error_log, created_at)
       VALUES ($1, $2, 'failed', $3, NOW())`,
      [tenantId, provider, err.message]
    );
    return { success: false, error: err.message };
  }
}

// ================================================================
// PROFIT & LOSS → kpi_values (dashboard 1)
// ================================================================

async function mapProfitAndLoss(tenantId, pnl, source) {
  if (!pnl) return { count: 0 };
  const period = pnl.period || new Date().toISOString().split('T')[0];
  const now    = new Date();
  const kpis   = [
    { key: 'revenue',           label: 'Revenue',             raw: pnl.revenue,            fmt: `$${formatM(pnl.revenue)}` },
    { key: 'cogs',              label: 'COGS',                raw: pnl.cogs,               fmt: `$${formatM(pnl.cogs)}` },
    { key: 'gross_profit',      label: 'Gross Profit',        raw: pnl.gross_profit,       fmt: `$${formatM(pnl.gross_profit)}` },
    { key: 'operating_expenses',label: 'Operating Expenses',  raw: pnl.operating_expenses, fmt: `$${formatM(pnl.operating_expenses)}` },
    { key: 'net_income',        label: 'Net Income',          raw: pnl.net_income,         fmt: `$${formatM(pnl.net_income)}` },
    { key: 'gross_margin',      label: 'Gross Margin %',      raw: pnl.revenue > 0 ? (pnl.gross_profit/pnl.revenue)*100 : 0,
                                                               fmt: `${pnl.revenue > 0 ? ((pnl.gross_profit/pnl.revenue)*100).toFixed(1) : 0}%` },
    { key: 'net_margin',        label: 'Net Margin %',        raw: pnl.revenue > 0 ? (pnl.net_income/pnl.revenue)*100 : 0,
                                                               fmt: `${pnl.revenue > 0 ? ((pnl.net_income/pnl.revenue)*100).toFixed(1) : 0}%` },
  ];

  let count = 0;
  for (const kpi of kpis) {
    await upsertKpiValue(tenantId, DASH.PROFIT_LOSS, kpi, source, now);
    count++;
  }

  await updateKpiSnapshot(tenantId, DASH.PROFIT_LOSS, kpis, source);
  return { count };
}

// ================================================================
// BALANCE SHEET → kpi_values (dashboard 2)
// ================================================================

async function mapBalanceSheet(tenantId, bs, source) {
  if (!bs) return { count: 0 };
  const now  = new Date();
  const kpis = [
    { key: 'total_assets',       label: 'Total Assets',       raw: bs.total_assets,       fmt: `$${formatM(bs.total_assets)}` },
    { key: 'current_assets',     label: 'Current Assets',     raw: bs.current_assets,     fmt: `$${formatM(bs.current_assets)}` },
    { key: 'total_liabilities',  label: 'Total Liabilities',  raw: bs.total_liabilities,  fmt: `$${formatM(bs.total_liabilities)}` },
    { key: 'equity',             label: 'Equity',             raw: bs.equity,             fmt: `$${formatM(bs.equity)}` },
    { key: 'working_capital',    label: 'Working Capital',    raw: bs.working_capital,    fmt: `$${formatM(bs.working_capital)}` },
    { key: 'current_ratio',      label: 'Current Ratio',      raw: bs.current_ratio,      fmt: `${bs.current_ratio}x` },
    { key: 'debt_to_equity',     label: 'D/E Ratio',          raw: bs.debt_to_equity,     fmt: `${bs.debt_to_equity}x` },
  ];

  let count = 0;
  for (const kpi of kpis) {
    await upsertKpiValue(tenantId, DASH.BALANCE_SHEET, kpi, source, now);
    count++;
  }
  await updateKpiSnapshot(tenantId, DASH.BALANCE_SHEET, kpis, source);
  return { count };
}

// ================================================================
// CASH FLOW → kpi_values (dashboard 3)
// ================================================================

async function mapCashFlow(tenantId, cf, source) {
  if (!cf) return { count: 0 };
  const now  = new Date();
  const kpis = [
    { key: 'operating_cash_flow',  label: 'Operating Cash Flow',  raw: cf.operating_cash_flow,  fmt: `$${formatM(cf.operating_cash_flow)}` },
    { key: 'investing_cash_flow',  label: 'Investing Cash Flow',  raw: cf.investing_cash_flow,  fmt: `$${formatM(cf.investing_cash_flow)}` },
    { key: 'financing_cash_flow',  label: 'Financing Cash Flow',  raw: cf.financing_cash_flow,  fmt: `$${formatM(cf.financing_cash_flow)}` },
    { key: 'net_cash_change',      label: 'Net Cash Change',      raw: cf.net_cash_change,      fmt: `$${formatM(cf.net_cash_change)}` },
    { key: 'free_cash_flow',       label: 'Free Cash Flow',       raw: cf.operating_cash_flow + cf.investing_cash_flow, fmt: `$${formatM(cf.operating_cash_flow + cf.investing_cash_flow)}` },
  ];

  let count = 0;
  for (const kpi of kpis) {
    await upsertKpiValue(tenantId, DASH.CASH_FLOW, kpi, source, now);
    count++;
  }
  await updateKpiSnapshot(tenantId, DASH.CASH_FLOW, kpis, source);
  return { count };
}

// ================================================================
// A/R AGING → kpi_values (dashboard 4)
// ================================================================

async function mapARAgingKpis(tenantId, ar, source) {
  if (!ar) return { count: 0 };
  const now  = new Date();
  const kpis = [
    { key: 'total_ar',          label: 'Total A/R',          raw: ar.total,    fmt: `$${formatM(ar.total)}` },
    { key: 'ar_current',        label: 'Current A/R',        raw: ar.current,  fmt: `$${formatM(ar.current)}` },
    { key: 'ar_overdue',        label: 'Overdue A/R',        raw: ar.overdue,  fmt: `$${formatM(ar.overdue)}` },
    { key: 'ar_1_30',           label: '1–30 Days',          raw: ar.days1_30, fmt: `$${formatM(ar.days1_30)}` },
    { key: 'ar_31_60',          label: '31–60 Days',         raw: ar.days31_60,fmt: `$${formatM(ar.days31_60)}` },
    { key: 'ar_61_90',          label: '61–90 Days',         raw: ar.days61_90,fmt: `$${formatM(ar.days61_90)}` },
    { key: 'ar_over_90',        label: 'Over 90 Days',       raw: ar.over90,   fmt: `$${formatM(ar.over90)}` },
    { key: 'ar_collection_rate',label: 'Collection Rate %',  raw: ar.total > 0 ? (ar.current/ar.total)*100 : 0, fmt: `${ar.total > 0 ? ((ar.current/ar.total)*100).toFixed(1) : 0}%` },
  ];

  let count = 0;
  for (const kpi of kpis) {
    await upsertKpiValue(tenantId, DASH.AR_AGING, kpi, source, now);
    count++;
  }
  await updateKpiSnapshot(tenantId, DASH.AR_AGING, kpis, source);
  return { count };
}

// ================================================================
// A/P AGING → kpi_values (dashboard 5)
// ================================================================

async function mapAPAgingKpis(tenantId, ap, source) {
  if (!ap) return { count: 0 };
  const now  = new Date();
  const kpis = [
    { key: 'total_ap',    label: 'Total A/P',    raw: ap.total,    fmt: `$${formatM(ap.total)}` },
    { key: 'ap_current',  label: 'Current A/P',  raw: ap.current,  fmt: `$${formatM(ap.current)}` },
    { key: 'ap_overdue',  label: 'Overdue A/P',  raw: ap.overdue,  fmt: `$${formatM(ap.overdue)}` },
    { key: 'ap_1_30',     label: '1–30 Days',    raw: ap.days1_30, fmt: `$${formatM(ap.days1_30)}` },
    { key: 'ap_31_60',    label: '31–60 Days',   raw: ap.days31_60,fmt: `$${formatM(ap.days31_60)}` },
    { key: 'ap_61_90',    label: '61–90 Days',   raw: ap.days61_90,fmt: `$${formatM(ap.days61_90)}` },
    { key: 'ap_over_90',  label: 'Over 90 Days', raw: ap.over90,   fmt: `$${formatM(ap.over90)}` },
  ];

  let count = 0;
  for (const kpi of kpis) {
    await upsertKpiValue(tenantId, DASH.AP_AGING, kpi, source, now);
    count++;
  }
  await updateKpiSnapshot(tenantId, DASH.AP_AGING, kpis, source);
  return { count };
}

// ================================================================
// INVOICES → invoices + invoice_line_items tables
// ================================================================

async function mapInvoices(tenantId, invoices, provider) {
  if (!invoices?.length) return { count: 0 };
  let count = 0;

  for (const inv of invoices) {
    // Normalize between QBO and Xero formats
    const normalized = provider === 'quickbooks'
      ? normalizeQBOInvoice(inv)
      : normalizeXeroInvoice(inv);

    try {
      await query(`
        INSERT INTO invoices (
          tenant_id, external_id, external_source, invoice_number,
          customer_name, issue_date, due_date, status,
          subtotal, tax_amount, total_amount, amount_due,
          currency, notes, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW(),NOW())
        ON CONFLICT (tenant_id, external_id, external_source) DO UPDATE SET
          status=$8, total_amount=$11, amount_due=$12, updated_at=NOW()`,
        [tenantId, normalized.externalId, provider, normalized.invoiceNumber,
         normalized.customerName, normalized.issueDate, normalized.dueDate,
         normalized.status, normalized.subtotal, normalized.taxAmount,
         normalized.total, normalized.amountDue, normalized.currency || 'USD',
         normalized.notes]
      );
      count++;
    } catch (e) {
      console.warn('[Mapper] Invoice insert error:', e.message, normalized.externalId);
    }
  }

  // Update Invoice Register KPIs
  const stats = await query(
    `SELECT COUNT(*) as total, SUM(total_amount) as total_value,
            COUNT(*) FILTER(WHERE status='Open') as open_count,
            SUM(total_amount) FILTER(WHERE status='Open') as open_value
     FROM invoices WHERE tenant_id=$1`, [tenantId]
  );
  const s = stats.rows[0];
  const kpis = [
    { key: 'invoiced_total',   label: 'Total Invoiced',    raw: parseFloat(s.total_value)||0, fmt: `$${formatM(parseFloat(s.total_value)||0)}` },
    { key: 'invoice_count',    label: 'Invoice Count',     raw: parseInt(s.total)||0,         fmt: parseInt(s.total)||0 + '' },
    { key: 'open_invoices',    label: 'Open Invoices',     raw: parseInt(s.open_count)||0,    fmt: parseInt(s.open_count)||0 + '' },
    { key: 'open_invoice_val', label: 'Open Value',        raw: parseFloat(s.open_value)||0,  fmt: `$${formatM(parseFloat(s.open_value)||0)}` },
  ];
  await updateKpiSnapshot(tenantId, DASH.INVOICE, kpis, provider);

  return { count };
}

function normalizeQBOInvoice(inv) {
  return {
    externalId:    inv.Id,
    invoiceNumber: inv.DocNumber,
    customerName:  inv.CustomerRef?.name || 'Unknown',
    issueDate:     inv.TxnDate,
    dueDate:       inv.DueDate,
    status:        inv.Balance > 0 ? 'Open' : 'Paid',
    subtotal:      parseFloat(inv.SubTotal) || 0,
    taxAmount:     parseFloat(inv.TxnTaxDetail?.TotalTax) || 0,
    total:         parseFloat(inv.TotalAmt) || 0,
    amountDue:     parseFloat(inv.Balance) || 0,
    currency:      inv.CurrencyRef?.value || 'USD',
    notes:         inv.CustomerMemo?.value || '',
  };
}

function normalizeXeroInvoice(inv) {
  return {
    externalId:    inv.InvoiceID,
    invoiceNumber: inv.InvoiceNumber,
    customerName:  inv.Contact?.Name || 'Unknown',
    issueDate:     inv.Date?.split('T')[0],
    dueDate:       inv.DueDate?.split('T')[0],
    status:        inv.Status === 'PAID' ? 'Paid' : inv.Status === 'VOIDED' ? 'Voided' : 'Open',
    subtotal:      parseFloat(inv.SubTotal) || 0,
    taxAmount:     parseFloat(inv.TotalTax) || 0,
    total:         parseFloat(inv.Total) || 0,
    amountDue:     parseFloat(inv.AmountDue) || 0,
    currency:      inv.CurrencyCode || 'USD',
    notes:         '',
  };
}

// ================================================================
// BILLS → tracked as purchase orders with payable flag
// ================================================================

async function mapBills(tenantId, bills, provider) {
  if (!bills?.length) return { count: 0 };
  let count = 0;
  for (const bill of bills) {
    const normalized = provider === 'quickbooks'
      ? { externalId: bill.Id, vendorName: bill.VendorRef?.name, total: parseFloat(bill.TotalAmt)||0, date: bill.TxnDate, due: bill.DueDate, balance: parseFloat(bill.Balance)||0 }
      : { externalId: bill.InvoiceID, vendorName: bill.Contact?.Name, total: parseFloat(bill.Total)||0, date: bill.Date?.split('T')[0], due: bill.DueDate?.split('T')[0], balance: parseFloat(bill.AmountDue)||0 };

    try {
      await query(`
        INSERT INTO purchase_orders (tenant_id, external_id, external_source, vendor_name, order_date, expected_date, total_amount, status, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW())
        ON CONFLICT (tenant_id, external_id, external_source) DO UPDATE SET
          total_amount=$7, status=$8, updated_at=NOW()`,
        [tenantId, normalized.externalId, provider+'_bill', normalized.vendorName,
         normalized.date, normalized.due, normalized.total,
         normalized.balance > 0 ? 'Open' : 'Paid']
      );
      count++;
    } catch (e) {
      console.warn('[Mapper] Bill insert error:', e.message);
    }
  }
  return { count };
}

// ================================================================
// CHART OF ACCOUNTS → gl_accounts table
// ================================================================

async function mapAccounts(tenantId, accounts, provider) {
  if (!accounts?.length) return { count: 0 };
  let count = 0;
  for (const acct of accounts) {
    const normalized = provider === 'quickbooks'
      ? { externalId: acct.Id, code: acct.AcctNum, name: acct.FullyQualifiedName || acct.Name, type: acct.AccountType, subtype: acct.AccountSubType, balance: parseFloat(acct.CurrentBalance)||0 }
      : { externalId: acct.AccountID, code: acct.Code, name: acct.Name, type: acct.Type, subtype: acct.Class, balance: parseFloat(acct.ReportingCodeName)||0 };

    const deemType = mapAccountType(normalized.type);
    try {
      await query(`
        INSERT INTO gl_accounts (tenant_id, external_id, external_source, account_code, account_name, account_type, account_subtype, balance, is_active, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,NOW(),NOW())
        ON CONFLICT (tenant_id, external_id, external_source) DO UPDATE SET
          account_name=$5, balance=$8, updated_at=NOW()`,
        [tenantId, normalized.externalId, provider, normalized.code, normalized.name, deemType, normalized.subtype, normalized.balance]
      );
      count++;
    } catch (e) {
      console.warn('[Mapper] Account insert error:', e.message);
    }
  }
  return { count };
}

function mapAccountType(erpType) {
  const typeMap = {
    'Income':'income','Revenue':'income','Sales':'income',
    'Cost of Goods Sold':'cogs','CostOfGoodsSold':'cogs',
    'Expense':'expense','Expenses':'expense','Operating Expense':'expense',
    'Asset':'asset','Bank':'asset','Other Current Asset':'asset','Fixed Asset':'asset',
    'Liability':'liability','Credit Card':'liability','Long Term Liability':'liability',
    'Equity':'equity','OtherCurrentLiability':'liability',
  };
  return typeMap[erpType] || 'other';
}

// ================================================================
// VENDORS / SUPPLIERS → suppliers table
// ================================================================

async function mapVendors(tenantId, vendors, provider) {
  if (!vendors?.length) return { count: 0 };
  let count = 0;
  for (const v of vendors) {
    const normalized = provider === 'quickbooks'
      ? { externalId: v.Id, name: v.DisplayName || v.CompanyName, email: v.PrimaryEmailAddr?.Address, phone: v.PrimaryPhone?.FreeFormNumber, balance: parseFloat(v.Balance)||0 }
      : { externalId: v.ContactID, name: v.Name, email: v.EmailAddress, phone: v.Phones?.[0]?.PhoneNumber, balance: 0 };

    try {
      await query(`
        INSERT INTO suppliers (tenant_id, external_id, external_source, supplier_name, email, phone, outstanding_balance, status, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,'active',NOW(),NOW())
        ON CONFLICT (tenant_id, external_id, external_source) DO UPDATE SET
          supplier_name=$4, outstanding_balance=$7, updated_at=NOW()`,
        [tenantId, normalized.externalId, provider, normalized.name, normalized.email, normalized.phone, normalized.balance]
      );
      count++;
    } catch (e) {
      console.warn('[Mapper] Vendor insert error:', e.message);
    }
  }
  return { count };
}

// ================================================================
// PURCHASE ORDERS → purchase_orders table
// ================================================================

async function mapPurchaseOrders(tenantId, pos, provider) {
  if (!pos?.length) return { count: 0 };
  let count = 0;
  for (const po of pos) {
    const normalized = provider === 'quickbooks'
      ? { externalId: po.Id, vendorName: po.VendorRef?.name, total: parseFloat(po.TotalAmt)||0, date: po.TxnDate, status: po.POStatus || 'Open' }
      : { externalId: po.PurchaseOrderID, vendorName: po.Contact?.Name, total: parseFloat(po.Total)||0, date: po.Date?.split('T')[0], status: po.Status === 'AUTHORISED' ? 'Open' : 'Closed' };

    try {
      await query(`
        INSERT INTO purchase_orders (tenant_id, external_id, external_source, vendor_name, order_date, total_amount, status, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())
        ON CONFLICT (tenant_id, external_id, external_source) DO UPDATE SET
          total_amount=$6, status=$7, updated_at=NOW()`,
        [tenantId, normalized.externalId, provider, normalized.vendorName, normalized.date, normalized.total, normalized.status]
      );
      count++;
    } catch (e) {
      console.warn('[Mapper] PO insert error:', e.message);
    }
  }
  return { count };
}

// ================================================================
// KPI VALUE UPSERT + SNAPSHOT UPDATE
// ================================================================

async function upsertKpiValue(tenantId, dashboardId, kpi, source, date) {
  // Get or create kpi_definition
  const defRes = await query(`
    SELECT id FROM kpi_definitions WHERE tenant_id=$1 AND dashboard_id=$2 AND metric_key=$3 LIMIT 1`,
    [tenantId, dashboardId, kpi.key]
  );

  let defId;
  if (defRes.rows.length) {
    defId = defRes.rows[0].id;
  } else {
    const ins = await query(`
      INSERT INTO kpi_definitions (tenant_id, dashboard_id, metric_key, metric_label, data_type, created_at)
      VALUES ($1,$2,$3,$4,'currency',NOW()) RETURNING id`,
      [tenantId, dashboardId, kpi.key, kpi.label]
    );
    defId = ins.rows[0].id;
  }

  // Upsert kpi_value (by day)
  const dateOnly = (date instanceof Date ? date : new Date(date)).toISOString().split('T')[0];
  await query(`
    INSERT INTO kpi_values (tenant_id, kpi_definition_id, raw_value, formatted_value, source, recorded_at, created_at)
    VALUES ($1,$2,$3,$4,$5,$6,NOW())
    ON CONFLICT (tenant_id, kpi_definition_id, recorded_at) DO UPDATE SET
      raw_value=$3, formatted_value=$4, source=$5`,
    [tenantId, defId, kpi.raw, kpi.fmt, source, dateOnly]
  );
}

async function updateKpiSnapshot(tenantId, dashboardId, kpis, source) {
  // Build snapshot JSON
  const snapshot = {};
  kpis.forEach(k => {
    snapshot[k.key] = { label: k.label, value: k.fmt, raw: k.raw, delta: 0, source };
  });

  await query(`
    INSERT INTO kpi_snapshots (tenant_id, dashboard_id, snapshot_data, source, refreshed_at)
    VALUES ($1,$2,$3,$4,NOW())
    ON CONFLICT (tenant_id, dashboard_id) DO UPDATE SET
      snapshot_data=$3, source=$4, refreshed_at=NOW()`,
    [tenantId, dashboardId, JSON.stringify(snapshot), source]
  );
}

// ================================================================
// HELPERS
// ================================================================

function formatM(n) {
  const v = Math.abs(n || 0);
  if (v >= 1e9) return (n/1e9).toFixed(2) + 'B';
  if (v >= 1e6) return (n/1e6).toFixed(2) + 'M';
  if (v >= 1e3) return (n/1e3).toFixed(1) + 'K';
  return Math.round(n || 0).toLocaleString();
}

// ================================================================
// SCHEMA ADDITIONS needed in PostgreSQL (run once):
// ================================================================
// ALTER TABLE invoices ADD COLUMN IF NOT EXISTS external_id VARCHAR(255);
// ALTER TABLE invoices ADD COLUMN IF NOT EXISTS external_source VARCHAR(50);
// ALTER TABLE invoices ADD COLUMN IF NOT EXISTS customer_name VARCHAR(255);
// ALTER TABLE invoices ADD COLUMN IF NOT EXISTS notes TEXT;
// ALTER TABLE gl_accounts ADD COLUMN IF NOT EXISTS external_id VARCHAR(255);
// ALTER TABLE gl_accounts ADD COLUMN IF NOT EXISTS external_source VARCHAR(50);
// ALTER TABLE gl_accounts ADD COLUMN IF NOT EXISTS account_subtype VARCHAR(100);
// ALTER TABLE gl_accounts ADD COLUMN IF NOT EXISTS balance DECIMAL(18,2) DEFAULT 0;
// ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS external_id VARCHAR(255);
// ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS external_source VARCHAR(50);
// CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_ext ON invoices(tenant_id, external_id, external_source);
// CREATE UNIQUE INDEX IF NOT EXISTS idx_gl_accounts_ext ON gl_accounts(tenant_id, external_id, external_source);
// CREATE UNIQUE INDEX IF NOT EXISTS idx_suppliers_ext ON suppliers(tenant_id, external_id, external_source);
// CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_ext ON purchase_orders(tenant_id, external_id, external_source);
// ALTER TABLE kpi_values ADD CONSTRAINT kpi_values_unique UNIQUE (tenant_id, kpi_definition_id, recorded_at);

module.exports = { mapAndPersist };
