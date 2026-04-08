const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || `postgresql://${process.env.DB_USER || 'postgres'}:${process.env.DB_PASSWORD || ''}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 5432}/${process.env.DB_NAME || 'deemona_enterprise'}`,
  ssl: process.env.NODE_ENV === 'production' ? {
    rejectUnauthorized: false
  } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});
// Force connection refresh on startup
pool.on('connect', () => {
  console.log('[DB] New connection established to database');
});

// Clear any stale connections on startup
pool.on('error', (err) => {
  console.error('[DB] Unexpected error on idle client', err);
  process.exit(-1);
});

pool.on('error', function(err) {
  console.error('[DB] Pool error:', err.message);
});

pool.query('SELECT NOW() AS time, current_database() AS db')
  .then(function(r) { console.log('[DB] Connected to', r.rows[0].db, 'at', r.rows[0].time); })
  .catch(function(e) { console.error('[DB] Connection FAILED:', e.message); });

// ═══════════════════════════════════════════════════════════
// DATA GENERATION FUNCTIONS FOR WEBSOCKET
// ═══════════════════════════════════════════════════════════

function generateKpis(dashboardId) {
  // Generate mock KPI data for the given dashboard
  const baseValue = Math.random() * 1000000;
  const trend = Math.random() > 0.5 ? 'up' : 'down';
  const change = (Math.random() * 20 - 10).toFixed(2); // -10% to +10%

  return {
    timestamp: new Date().toISOString(),
    metrics: [
      {
        id: 'revenue',
        label: 'Total Revenue',
        value: baseValue.toFixed(2),
        unit: 'USD',
        change: change,
        trend: trend,
      },
      {
        id: 'transactions',
        label: 'Transactions',
        value: Math.floor(Math.random() * 10000),
        unit: 'count',
        change: (Math.random() * 30 - 15).toFixed(2),
        trend: Math.random() > 0.5 ? 'up' : 'down',
      },
      {
        id: 'active_users',
        label: 'Active Users',
        value: Math.floor(Math.random() * 5000),
        unit: 'count',
        change: (Math.random() * 25 - 10).toFixed(2),
        trend: Math.random() > 0.6 ? 'up' : 'down',
      },
    ],
  };
}

function generateCharts(dashboardId) {
  // Generate mock chart data
  const dataPoints = [];
  const now = Date.now();
  
  for (let i = 11; i >= 0; i--) {
    dataPoints.push({
      timestamp: new Date(now - i * 3600000).toISOString(), // hourly data
      value: Math.random() * 100000 + 50000,
    });
  }

  return {
    timestamp: new Date().toISOString(),
    charts: [
      {
        id: 'revenue_trend',
        type: 'line',
        title: 'Revenue Trend (12h)',
        data: dataPoints,
      },
      {
        id: 'category_breakdown',
        type: 'pie',
        title: 'Revenue by Category',
        data: [
          { label: 'Product Sales', value: Math.random() * 100000 },
          { label: 'Services', value: Math.random() * 80000 },
          { label: 'Subscriptions', value: Math.random() * 60000 },
          { label: 'Other', value: Math.random() * 40000 },
        ],
      },
    ],
  };
}

function generateNotification() {
  const types = ['info', 'warning', 'success', 'critical'];
  const messages = [
    'Revenue target exceeded for Q1',
    'Unusual transaction pattern detected',
    'Monthly budget threshold reached at 85%',
    'New payment gateway integration successful',
    'Cash flow projection updated',
    'Quarterly report generation completed',
  ];

  return {
    id: require('crypto').randomUUID(),
    type: types[Math.floor(Math.random() * types.length)],
    message: messages[Math.floor(Math.random() * messages.length)],
    timestamp: new Date().toISOString(),
    priority: Math.random() > 0.7 ? 'high' : 'normal',
  };
}

module.exports = {
  query: function(text, params) {
    return pool.query(text, params);
  },

tenantQuery: async function(tenantId, text, params) {
  var client = await pool.connect();
  try {
    console.log('[tenantQuery] 1. Setting tenant_id:', tenantId);
    await client.query('SET app.tenant_id = $1', [tenantId]);
    
    console.log('[tenantQuery] 2. Executing main query');
    console.log('[tenantQuery] 3. Query text:', text);
    console.log('[tenantQuery] 4. Params:', params);
    console.log('[tenantQuery] 5. Params type:', typeof params, Array.isArray(params));
    
    var result = await client.query(text, params || []);
    
    console.log('[tenantQuery] 6. Success! Rows:', result.rows.length);
    return result;
  } catch (err) {
    console.error('[tenantQuery] ERROR:', err.message);
    throw err;
  } finally {
    await client.query('RESET app.tenant_id').catch(function() {});
    client.release();
  }
},

  pool: pool,
  
  // WebSocket data generation functions
  generateKpis: generateKpis,
  generateCharts: generateCharts,
  generateNotification: generateNotification,
};

// Force immediate connection to verify database
pool.query('SELECT COUNT(*) FROM users').then(result => {
  console.log('[DB] Startup verification: Total users =', result.rows[0].count);
}).catch(err => {
  console.error('[DB] Startup verification failed:', err.message);
});
