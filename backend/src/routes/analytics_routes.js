// ================================================================
// DEEMONA FINANCE SOLUTION — Analytics & Activity Logs Routes
// File: src/routes/analytics.js
// Mount in src/routes/index.js:
//   const analytics = require('./analytics');
//   router.use('/analytics', analytics);
// ================================================================

const express = require('express');
const router = express.Router();
const { query } = require('../services/database');

// ── Helper: safe query with fallback ────────────────────────────
async function safeQuery(sql, params = [], fallback = []) {
  try {
    const result = await query(sql, params);
    return result.rows;
  } catch (err) {
    console.error('[Analytics] Query error:', err.message);
    return fallback;
  }
}

// ================================================================
// GET /v1/analytics/overview
// Top-level KPI cards: users, sessions, logins, exports
// ================================================================
router.get('/overview', async (req, res) => {
  try {
    const [users, sessions, logins, exports_, verifications] = await Promise.all([
      safeQuery(`SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE is_active = true) AS active,
        COUNT(*) FILTER (WHERE email_verified = true) AS verified,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') AS new_this_week,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours') AS new_today
        FROM users`, [], [{ total:0, active:0, verified:0, new_this_week:0, new_today:0 }]),

      safeQuery(`SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours') AS today,
        COUNT(*) FILTER (WHERE expires_at > NOW()) AS active_now
        FROM user_sessions`, [], [{ total:0, today:0, active_now:0 }]),

      safeQuery(`SELECT
        COUNT(*) AS total_logins,
        COUNT(*) FILTER (WHERE action = 'login_success') AS successful,
        COUNT(*) FILTER (WHERE action = 'login_failed') AS failed,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours') AS today
        FROM audit_logs WHERE action LIKE 'login%'`, [], [{ total_logins:0, successful:0, failed:0, today:0 }]),

      safeQuery(`SELECT COUNT(*) AS total FROM report_exports`, [], [{ total:0 }]),

      safeQuery(`SELECT
        COUNT(*) FILTER (WHERE email_verified = false) AS pending_verification,
        COUNT(*) FILTER (WHERE is_active = false AND email_verified = true) AS suspended
        FROM users`, [], [{ pending_verification:0, suspended:0 }])
    ]);

    res.json({
      users: users[0],
      sessions: sessions[0],
      logins: logins[0],
      exports: exports_[0],
      verifications: verifications[0],
      generated_at: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================================================================
// GET /v1/analytics/users/trend?days=30
// Daily user registrations for trend chart
// ================================================================
router.get('/users/trend', async (req, res) => {
  const days = Math.min(parseInt(req.query.days) || 30, 90);
  try {
    const rows = await safeQuery(`
      SELECT
        DATE(created_at) AS date,
        COUNT(*) AS registrations,
        COUNT(*) FILTER (WHERE email_verified = true) AS verified,
        COUNT(*) FILTER (WHERE is_active = true) AS active
      FROM users
      WHERE created_at >= NOW() - INTERVAL '${days} days'
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `);

    // Fill missing dates with 0
    const dateMap = {};
    rows.forEach(r => { dateMap[r.date] = r; });
    const filled = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().split('T')[0];
      filled.push(dateMap[key] || { date: key, registrations: 0, verified: 0, active: 0 });
    }
    res.json(filled);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================================================================
// GET /v1/analytics/logins/trend?days=14
// Login activity trend (success vs failed)
// ================================================================
router.get('/logins/trend', async (req, res) => {
  const days = Math.min(parseInt(req.query.days) || 14, 60);
  try {
    const rows = await safeQuery(`
      SELECT
        DATE(created_at) AS date,
        COUNT(*) FILTER (WHERE action = 'login_success') AS successful,
        COUNT(*) FILTER (WHERE action = 'login_failed') AS failed,
        COUNT(*) AS total
      FROM audit_logs
      WHERE action LIKE 'login%'
        AND created_at >= NOW() - INTERVAL '${days} days'
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `);

    const dateMap = {};
    rows.forEach(r => { dateMap[r.date] = r; });
    const filled = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().split('T')[0];
      filled.push(dateMap[key] || { date: key, successful: 0, failed: 0, total: 0 });
    }
    res.json(filled);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================================================================
// GET /v1/analytics/dashboards/usage
// Most accessed dashboards
// ================================================================
router.get('/dashboards/usage', async (req, res) => {
  try {
    const rows = await safeQuery(`
      SELECT
        d.name AS dashboard_name,
        d.category_id,
        c.name AS category_name,
        COUNT(al.id) AS view_count,
        COUNT(DISTINCT al.user_id) AS unique_users,
        MAX(al.created_at) AS last_accessed
      FROM dashboards d
      LEFT JOIN audit_logs al ON al.entity_id = d.id::text AND al.action = 'dashboard_view'
      LEFT JOIN categories c ON c.id = d.category_id
      GROUP BY d.id, d.name, d.category_id, c.name
      ORDER BY view_count DESC
      LIMIT 20
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================================================================
// GET /v1/analytics/roles/distribution
// Users per role
// ================================================================
router.get('/roles/distribution', async (req, res) => {
  try {
    const rows = await safeQuery(`
      SELECT
        r.name AS role_name,
        r.id AS role_id,
        COUNT(u.id) AS user_count,
        COUNT(u.id) FILTER (WHERE u.is_active = true) AS active_count
      FROM roles r
      LEFT JOIN users u ON u.role_id = r.id
      GROUP BY r.id, r.name
      ORDER BY user_count DESC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================================================================
// GET /v1/analytics/sessions/hourly
// Sessions by hour of day (last 7 days)
// ================================================================
router.get('/sessions/hourly', async (req, res) => {
  try {
    const rows = await safeQuery(`
      SELECT
        EXTRACT(HOUR FROM created_at) AS hour,
        COUNT(*) AS session_count
      FROM user_sessions
      WHERE created_at >= NOW() - INTERVAL '7 days'
      GROUP BY EXTRACT(HOUR FROM created_at)
      ORDER BY hour ASC
    `);
    // Fill all 24 hours
    const hourMap = {};
    rows.forEach(r => { hourMap[parseInt(r.hour)] = parseInt(r.session_count); });
    const filled = Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      label: `${h.toString().padStart(2,'0')}:00`,
      count: hourMap[h] || 0
    }));
    res.json(filled);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================================================================
// GET /v1/analytics/exports/summary
// Report export stats by type
// ================================================================
router.get('/exports/summary', async (req, res) => {
  try {
    const rows = await safeQuery(`
      SELECT
        export_format AS format,
        COUNT(*) AS count,
        MAX(created_at) AS last_export
      FROM report_exports
      GROUP BY export_format
      ORDER BY count DESC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================================================================
// GET /v1/activity-logs
// Paginated, filterable audit log
// Query params: page, limit, action, user_id, search, from_date, to_date
// ================================================================
router.get('/activity-logs', async (req, res) => {
  const page  = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, parseInt(req.query.limit) || 50);
  const offset = (page - 1) * limit;

  const conditions = ['1=1'];
  const params = [];
  let pi = 1;

  if (req.query.action && req.query.action !== 'all') {
    conditions.push(`al.action = $${pi++}`);
    params.push(req.query.action);
  }
  if (req.query.user_id) {
    conditions.push(`al.user_id = $${pi++}`);
    params.push(req.query.user_id);
  }
  if (req.query.search) {
    conditions.push(`(u.email ILIKE $${pi} OR al.action ILIKE $${pi} OR al.entity_type ILIKE $${pi} OR al.ip_address ILIKE $${pi})`);
    params.push(`%${req.query.search}%`);
    pi++;
  }
  if (req.query.from_date) {
    conditions.push(`al.created_at >= $${pi++}`);
    params.push(req.query.from_date);
  }
  if (req.query.to_date) {
    conditions.push(`al.created_at <= $${pi++}`);
    params.push(req.query.to_date);
  }

  const where = conditions.join(' AND ');

  try {
    const [logs, countResult] = await Promise.all([
      safeQuery(`
        SELECT
          al.id,
          al.action,
          al.entity_type,
          al.entity_id,
          al.ip_address,
          al.user_agent,
          al.created_at,
          al.metadata,
          u.email AS user_email,
          u.first_name || ' ' || u.last_name AS user_name,
          r.name AS role_name,
          t.name AS tenant_name
        FROM audit_logs al
        LEFT JOIN users u ON u.id = al.user_id
        LEFT JOIN roles r ON r.id = u.role_id
        LEFT JOIN tenants t ON t.id = al.tenant_id
        WHERE ${where}
        ORDER BY al.created_at DESC
        LIMIT $${pi} OFFSET $${pi + 1}
      `, [...params, limit, offset]),

      safeQuery(`
        SELECT COUNT(*) AS total
        FROM audit_logs al
        LEFT JOIN users u ON u.id = al.user_id
        WHERE ${where}
      `, params, [{ total: 0 }])
    ]);

    const total = parseInt(countResult[0]?.total || 0);
    res.json({
      logs,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
        has_next: page * limit < total,
        has_prev: page > 1
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================================================================
// GET /v1/activity-logs/actions
// Distinct action types for filter dropdown
// ================================================================
router.get('/activity-logs/actions', async (req, res) => {
  try {
    const rows = await safeQuery(`
      SELECT action, COUNT(*) AS count
      FROM audit_logs
      GROUP BY action
      ORDER BY count DESC
      LIMIT 50
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================================================================
// GET /v1/activity-logs/live
// Last 20 log entries (for real-time feed, poll every 5s)
// ================================================================
router.get('/activity-logs/live', async (req, res) => {
  try {
    const rows = await safeQuery(`
      SELECT
        al.id, al.action, al.entity_type, al.ip_address, al.created_at,
        u.email AS user_email,
        u.first_name || ' ' || u.last_name AS user_name
      FROM audit_logs al
      LEFT JOIN users u ON u.id = al.user_id
      ORDER BY al.created_at DESC
      LIMIT 20
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================================================================
// POST /v1/activity-logs/export
// Export filtered logs as CSV
// ================================================================
router.post('/activity-logs/export', async (req, res) => {
  const { from_date, to_date, action, search } = req.body;
  const conditions = ['1=1'];
  const params = [];
  let pi = 1;

  if (action && action !== 'all') { conditions.push(`al.action = $${pi++}`); params.push(action); }
  if (search) { conditions.push(`u.email ILIKE $${pi++}`); params.push(`%${search}%`); }
  if (from_date) { conditions.push(`al.created_at >= $${pi++}`); params.push(from_date); }
  if (to_date)   { conditions.push(`al.created_at <= $${pi++}`); params.push(to_date); }

  try {
    const rows = await safeQuery(`
      SELECT al.id, al.action, al.entity_type, al.entity_id, al.ip_address,
             al.created_at, u.email, u.first_name, u.last_name, t.name AS tenant
      FROM audit_logs al
      LEFT JOIN users u ON u.id = al.user_id
      LEFT JOIN tenants t ON t.id = al.tenant_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY al.created_at DESC
      LIMIT 10000
    `, params);

    const header = 'ID,Action,Entity Type,Entity ID,IP Address,User Email,User Name,Tenant,Timestamp';
    const csvRows = rows.map(r =>
      `${r.id},"${r.action}","${r.entity_type||''}","${r.entity_id||''}","${r.ip_address||''}","${r.email||''}","${(r.first_name||'')+' '+(r.last_name||'')}","${r.tenant||''}","${r.created_at}"`
    );
    const csv = [header, ...csvRows].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="deemona_activity_logs_${Date.now()}.csv"`);
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
