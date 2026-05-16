// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  DEEMONA FINANCE SOLUTION — Master Route Registry                      ║
// ║  147 API Endpoints across 14 domains                                   ║
// ║  Version 3.0 | March 2026                                              ║
// ╚══════════════════════════════════════════════════════════════════════════╝

const express = require('express');
const router = express.Router();
const analytics = require('./analytics');

// Auth and health check are mounted directly in server.js (before auth middleware)
// All routes below require authentication (middleware applied in server.js)

// ── Dashboard Engine (core) ──
router.use('/dashboards', require('./dashboards'));
router.use('/categories', require('./categories'));
router.use('/roles', require('./roles'));
router.use('/notifications', require('./notifications'));
router.use('/analytics', analytics);

// ── Finance & Accounting ──
router.use('/gl', require('./finance/gl'));
router.use('/invoices', require('./finance/invoices'));
router.use('/bank-accounts', require('./finance/banking'));
router.use('/cash-flow', require('./finance/cashflow'));
router.use('/budgets', require('./finance/budgets'));
router.use('/fixed-assets', require('./finance/assets'));
router.use('/expense-claims', require('./finance/expenses'));

// ── Sales & Marketing ──
router.use('/leads', require('./sales/leads'));
router.use('/deals', require('./sales/deals'));
router.use('/campaigns', require('./sales/campaigns'));
router.use('/regions', require('./sales/regions'));
router.use('/forecasts', require('./sales/forecasts'));

// ── Operations & Supply Chain ──
router.use('/products', require('./operations/products'));
router.use('/inventory', require('./operations/inventory'));
router.use('/orders', require('./operations/orders'));
router.use('/suppliers', require('./operations/suppliers'));
router.use('/purchase-orders', require('./operations/purchaseOrders'));
router.use('/warehouses', require('./operations/warehouses'));
router.use('/production', require('./operations/production'));

// ── HR & People ──
router.use('/employees', require('./hr/employees'));
router.use('/payroll', require('./hr/payroll'));
router.use('/attendance', require('./hr/attendance'));
router.use('/leave-balances', require('./hr/leave'));
router.use('/training', require('./hr/training'));
router.use('/recruitment', require('./hr/recruitment'));

// ── Compliance & Governance ──
router.use('/audit-logs', require('./compliance/audit'));
router.use('/access-reviews', require('./compliance/access'));
router.use('/privacy-requests', require('./compliance/privacy'));
router.use('/incidents', require('./compliance/incidents'));
router.use('/risks', require('./compliance/risks'));
router.use('/controls', require('./compliance/controls'));
router.use('/sla', require('./compliance/sla'));
router.use('/fraud-alerts', require('./compliance/fraud'));

// ── Customer Success ──
router.use('/customers', require('./customer/customers'));
router.use('/tickets', require('./customer/tickets'));
router.use('/nps', require('./customer/nps'));
router.use('/renewals', require('./customer/renewals'));
router.use('/churn', require('./customer/churn'));

// ── IT & System Health ──
router.use('/services', require('./it/services'));
router.use('/api-metrics', require('./it/apiMetrics'));
router.use('/dr-tests', require('./it/drTests'));

// ── Product & Innovation ──
router.use('/features', require('./product/features'));
router.use('/releases', require('./product/releases'));
router.use('/bugs', require('./product/bugs'));
router.use('/roadmap', require('./product/roadmap'));
router.use('/usage', require('./product/usage'));

// ── Sustainability & ESG ──
router.use('/emissions', require('./esg/emissions'));
router.use('/energy', require('./esg/energy'));
router.use('/waste', require('./esg/waste'));
router.use('/diversity', require('./esg/diversity'));
router.use('/csr-projects', require('./esg/csr'));

// ── Executive & Strategic ──
router.use('/strategic-goals', require('./executive/goals'));
router.use('/competitors', require('./executive/competitors'));
router.use('/scenarios', require('./executive/scenarios'));
router.use('/investor-relations', require('./executive/investorRelations'));

// ── Cross-Cutting Infrastructure ──
router.use('/comments', require('./infra/comments'));
router.use('/attachments', require('./infra/attachments'));
router.use('/approvals', require('./infra/approvals'));
router.use('/alert-rules', require('./infra/alertRules'));
router.use('/scheduled-reports', require('./infra/scheduledReports'));
router.use('/favorites', require('./infra/favorites'));

// ── System Admin ──
router.use('/departments', require('./admin/departments'));
router.use('/fiscal-periods', require('./admin/fiscalPeriods'));
router.use('/currencies', require('./admin/currencies'));
router.use('/data-imports', require('./admin/dataImports'));
router.use('/data-connections', require('./admin/dataConnections'));

module.exports = router;
