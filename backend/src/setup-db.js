// ================================================================
// DEEMONA — Database Routes Setup
// ================================================================

const db = require('./services/database');

let demoTenantId = null;

async function getDemoTenantId() {
  if (demoTenantId) return demoTenantId;
  try {
    const r = await db.query("SELECT id FROM tenants WHERE slug = 'demo' LIMIT 1");
    if (r.rows.length > 0) { 
      demoTenantId = r.rows[0].id; 
      return demoTenantId; 
    }
    const r2 = await db.query("SELECT id FROM tenants ORDER BY created_at LIMIT 1");
    if (r2.rows.length > 0) { 
      demoTenantId = r2.rows[0].id; 
      return demoTenantId; 
    }
  } catch (e) { 
    console.warn('[DB-Setup] Cannot find demo tenant:', e.message); 
  }
  return null;
}

module.exports = function setupDbRoutes(app) {
  console.log('[DB-Setup] Connecting dashboard routes to PostgreSQL...');

  // Tenant context middleware
  app.use('/v1', async (req, res, next) => {
    // Skip health check
    if (req.path === '/health' || req.path === '/v1/health') return next();

    // If user already set by auth middleware
    if (req.user && req.user.tenant_id) {
      req.tenantId = req.user.tenant_id;
      return next();
    }

    // Auto-assign demo tenant
    const tid = await getDemoTenantId();
    if (tid) {
      req.tenantId = tid;
      req.user = req.user || {
        sub: 'demo-user',
        tenant_id: tid,
        role: 'CEO / Board',
        email: 'admin@deemona.com',
        name: 'Admin',
        is_admin: true
      };
    }
    next();
  });

  // Mount all PostgreSQL-backed routes
  // Dashboard Engine
  app.use('/v1/dashboards', require('./routes/dashboards'));
  app.use('/v1/categories', require('./routes/categories'));
  app.use('/v1/roles', require('./routes/roles'));
  app.use('/v1/notifications', require('./routes/notifications'));
  
  // Auth (login/logout with bcrypt + JWT)
  app.use('/v1/auth', require('./routes/auth'));

  // Finance & Accounting
  app.use('/v1/gl', require('./routes/finance/gl'));
  app.use('/v1/invoices', require('./routes/finance/invoices'));
  app.use('/v1/bank-accounts', require('./routes/finance/banking'));
  app.use('/v1/cash-flow', require('./routes/finance/cashflow'));
  app.use('/v1/budgets', require('./routes/finance/budgets'));
  app.use('/v1/fixed-assets', require('./routes/finance/assets'));
  app.use('/v1/expense-claims', require('./routes/finance/expenses'));

  // Sales & Marketing
  app.use('/v1/leads', require('./routes/sales/leads'));
  app.use('/v1/deals', require('./routes/sales/deals'));
  app.use('/v1/campaigns', require('./routes/sales/campaigns'));
  app.use('/v1/regions', require('./routes/sales/regions'));
  app.use('/v1/forecasts', require('./routes/sales/forecasts'));

  // Operations & Supply Chain
  app.use('/v1/products', require('./routes/operations/products'));
  app.use('/v1/inventory', require('./routes/operations/inventory'));
  app.use('/v1/orders', require('./routes/operations/orders'));
  app.use('/v1/suppliers', require('./routes/operations/suppliers'));
  app.use('/v1/purchase-orders', require('./routes/operations/purchaseOrders'));
  app.use('/v1/warehouses', require('./routes/operations/warehouses'));
  app.use('/v1/production', require('./routes/operations/production'));

  // HR & People
  app.use('/v1/employees', require('./routes/hr/employees'));
  app.use('/v1/payroll', require('./routes/hr/payroll'));
  app.use('/v1/attendance', require('./routes/hr/attendance'));
  app.use('/v1/leave-balances', require('./routes/hr/leave'));
  app.use('/v1/training', require('./routes/hr/training'));
  app.use('/v1/recruitment', require('./routes/hr/recruitment'));

  // Compliance & Governance
  app.use('/v1/audit-logs', require('./routes/compliance/audit'));
  app.use('/v1/access-reviews', require('./routes/compliance/access'));
  app.use('/v1/privacy-requests', require('./routes/compliance/privacy'));
  app.use('/v1/incidents', require('./routes/compliance/incidents'));
  app.use('/v1/risks', require('./routes/compliance/risks'));
  app.use('/v1/controls', require('./routes/compliance/controls'));
  app.use('/v1/sla', require('./routes/compliance/sla'));
  app.use('/v1/fraud-alerts', require('./routes/compliance/fraud'));

  // Customer Success
  app.use('/v1/customers', require('./routes/customer/customers'));
  app.use('/v1/tickets', require('./routes/customer/tickets'));
  app.use('/v1/nps', require('./routes/customer/nps'));
  app.use('/v1/renewals', require('./routes/customer/renewals'));
  app.use('/v1/churn', require('./routes/customer/churn'));

  // IT & System Health
  app.use('/v1/services', require('./routes/it/services'));
  app.use('/v1/api-metrics', require('./routes/it/apiMetrics'));
  app.use('/v1/dr-tests', require('./routes/it/drTests'));

  // Product & Innovation
  app.use('/v1/features', require('./routes/product/features'));
  app.use('/v1/releases', require('./routes/product/releases'));
  app.use('/v1/bugs', require('./routes/product/bugs'));
  app.use('/v1/roadmap', require('./routes/product/roadmap'));
  app.use('/v1/usage', require('./routes/product/usage'));

  // Sustainability & ESG
  app.use('/v1/emissions', require('./routes/esg/emissions'));
  app.use('/v1/energy', require('./routes/esg/energy'));
  app.use('/v1/waste', require('./routes/esg/waste'));
  app.use('/v1/diversity', require('./routes/esg/diversity'));
  app.use('/v1/csr-projects', require('./routes/esg/csr'));

  // Executive & Strategic
  app.use('/v1/strategic-goals', require('./routes/executive/goals'));
  app.use('/v1/competitors', require('./routes/executive/competitors'));
  app.use('/v1/scenarios', require('./routes/executive/scenarios'));
  app.use('/v1/investor-relations', require('./routes/executive/investorRelations'));

  // Cross-Cutting Infrastructure
  app.use('/v1/comments', require('./routes/infra/comments'));
  app.use('/v1/attachments', require('./routes/infra/attachments'));
  app.use('/v1/approvals', require('./routes/infra/approvals'));
  app.use('/v1/alert-rules', require('./routes/infra/alertRules'));
  app.use('/v1/scheduled-reports', require('./routes/infra/scheduledReports'));
  app.use('/v1/favorites', require('./routes/infra/favorites'));

  // System Admin
  app.use('/v1/departments', require('./routes/admin/departments'));
  app.use('/v1/fiscal-periods', require('./routes/admin/fiscalPeriods'));
  app.use('/v1/currencies', require('./routes/admin/currencies'));
  app.use('/v1/data-imports', require('./routes/admin/dataImports'));
  app.use('/v1/data-connections', require('./routes/admin/dataConnections'));

  console.log('[DB-Setup] 147 PostgreSQL-backed endpoints mounted successfully');
};
