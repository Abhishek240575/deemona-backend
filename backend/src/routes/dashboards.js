const express = require('express');
const router = express.Router();
const db = require('../services/database');

// GET /v1/dashboards — list all dashboards (filterable)
router.get('/', async (req, res) => {
  const t = req.tenantId;
  const { category, role, cycle, search, page = 1, limit = 100 } = req.query;
  let where = ['d.is_active = TRUE'], params = [], idx = 1;

  if (category) { where.push(`c.name = $${idx++}`); params.push(category); }
  if (cycle) { where.push(`d.refresh_cycle = $${idx++}`); params.push(cycle); }
  if (search) { where.push(`(d.name ILIKE $${idx} OR c.name ILIKE $${idx})`); params.push(`%${search}%`); idx++; }
  if (role) { where.push(`EXISTS (SELECT 1 FROM dashboard_role_access dra JOIN roles r ON dra.role_id=r.id WHERE dra.dashboard_id=d.id AND r.name=$${idx++})`); params.push(role); }

  const q = `SELECT d.id, d.name, d.slug, c.name AS category, c.color, d.refresh_cycle, d.description, d.display_order,
    (SELECT COUNT(*) FROM kpi_definitions WHERE dashboard_id=d.id) AS kpi_count,
    (SELECT COUNT(*) FROM chart_definitions WHERE dashboard_id=d.id) AS chart_count,
    ARRAY(SELECT r.name FROM dashboard_role_access dra JOIN roles r ON dra.role_id=r.id WHERE dra.dashboard_id=d.id) AS roles,
    COALESCE(td.is_enabled, TRUE) AS is_enabled, td.custom_name
    FROM dashboards d
    JOIN categories c ON d.category_id = c.id
    LEFT JOIN tenant_dashboards td ON td.dashboard_id = d.id AND td.tenant_id = '${t}'
    WHERE ${where.join(' AND ')}
    ORDER BY d.display_order LIMIT ${limit} OFFSET ${(page-1)*limit}`;

  try {
    const result = await db.query(q, params);
    const count = await db.query(`SELECT COUNT(*) FROM dashboards d JOIN categories c ON d.category_id=c.id WHERE ${where.join(' AND ')}`, params);
    res.json({ total: parseInt(count.rows[0].count), page: parseInt(page), dashboards: result.rows });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to fetch dashboards' }); }
});

// GET /v1/dashboards/:id
router.get('/:id', async (req, res) => {
  try {
    const r = await db.query(
      `SELECT d.*, c.name AS category, c.color FROM dashboards d JOIN categories c ON d.category_id=c.id WHERE d.id=$1`, [req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Dashboard not found' });
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /v1/dashboards/:id/kpis — real-time KPI data
router.get('/:id/kpis', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT k.key, k.label, k.unit, k.format_pattern, k.target_value,
              s.current_value, s.formatted_value, s.prior_value, s.delta_percent, s.alert_level, s.last_updated
       FROM kpi_snapshots s
       JOIN kpi_definitions k ON s.kpi_def_id = k.id
       WHERE s.dashboard_id = $1
       ORDER BY k.display_order`,
      [req.params.id]
    );
    
    const kpis = {};
    result.rows.forEach(r => {
      kpis[r.key] = { label: r.label, value: r.formatted_value || String(r.current_value),
        raw: parseFloat(r.current_value), delta: parseFloat(r.delta_percent) || 0,
        unit: r.unit, alert_level: r.alert_level, target: r.target_value ? parseFloat(r.target_value) : null,
        last_updated: r.last_updated };
    });
    res.json({ dashboard_id: parseInt(req.params.id), timestamp: new Date().toISOString(), kpis });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /v1/dashboards/:id/charts — chart data formatted for Chart.js
router.get('/:id/charts', async (req, res) => {
  try {
    const chartDefs = await db.query(
      `SELECT id, key, title, chart_type, is_multi_series, config FROM chart_definitions
       WHERE dashboard_id = $1 AND is_active = TRUE ORDER BY display_order`, [req.params.id]);

    const charts = {};
    for (const cd of chartDefs.rows) {
      const series = await db.query(
        `SELECT id, series_key, label, color FROM chart_series WHERE chart_id=$1 ORDER BY display_order`, [cd.id]);
      const points = await db.tenantQuery(req.tenantId,
        `SELECT cdp.label, cdp.value, cs.series_key
         FROM chart_data_points cdp LEFT JOIN chart_series cs ON cdp.series_id=cs.id
         WHERE cdp.chart_id=$1 AND cdp.tenant_id=$2 ORDER BY cdp.period_date`, [cd.id, req.tenantId]);

      const labels = [...new Set(points.rows.map(p => p.label))];
      let datasets;
      if (cd.chart_type === 'doughnut') {
        datasets = [{ data: points.rows.map(p => parseFloat(p.value)) }];
      } else if (cd.is_multi_series) {
        datasets = series.rows.map(s => ({
          label: s.label, data: points.rows.filter(p => p.series_key === s.series_key).map(p => parseFloat(p.value))
        }));
      } else {
        datasets = [{ label: cd.title, data: points.rows.map(p => parseFloat(p.value)) }];
      }
      charts[cd.key] = { key: cd.key, title: cd.title, type: cd.chart_type, labels, datasets, is_multi: cd.is_multi_series };
    }
    res.json({ dashboard_id: parseInt(req.params.id), timestamp: new Date().toISOString(), charts });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /v1/dashboards/:id/full — KPIs + Charts + Metadata combined
router.get('/:id/full', async (req, res) => {
  try {
    const meta = await db.query(`SELECT d.*, c.name AS category, c.color FROM dashboards d JOIN categories c ON d.category_id=c.id WHERE d.id=$1`, [req.params.id]);
    if (meta.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    
    const kpisRes = await db.query(
      `SELECT k.key, k.label, k.unit, s.current_value, s.formatted_value, s.delta_percent, s.alert_level
       FROM kpi_snapshots s JOIN kpi_definitions k ON s.kpi_def_id=k.id
       WHERE s.dashboard_id=$1 ORDER BY k.display_order`, [req.params.id]);
    
    const kpis = {};
    kpisRes.rows.forEach(r => { 
      kpis[r.key] = { label: r.label, value: r.formatted_value || String(r.current_value), 
        raw: parseFloat(r.current_value), delta: parseFloat(r.delta_percent)||0, 
        unit: r.unit, alert_level: r.alert_level }; 
    });
    
    const roles = await db.query(`SELECT r.name FROM dashboard_role_access dra JOIN roles r ON dra.role_id=r.id WHERE dra.dashboard_id=$1`, [req.params.id]);
    
    // ADD CHARTS (empty for now)
    const charts = {};
    
    res.json({ ...meta.rows[0], kpis, charts, roles: roles.rows.map(r => r.name), timestamp: new Date().toISOString() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /v1/dashboards/:id/history — KPI time-series history
router.get('/:id/history', async (req, res) => {
  const { kpi, period = '30d', period_type = 'daily' } = req.query;
  const days = parseInt(period) || 30;
  try {
    let where = `kv.dashboard_id = $1 AND kv.tenant_id = $2 AND kv.period_date >= CURRENT_DATE - $3::INT AND kv.period_type = $4`;
    let params = [req.params.id, req.tenantId, days, period_type];
    if (kpi) { where += ` AND k.key = $5`; params.push(kpi); }
    const result = await db.tenantQuery(req.tenantId,
      `SELECT k.key, k.label, kv.value, kv.delta_percent, kv.period_date, kv.period_label, kv.is_forecast
       FROM kpi_values kv JOIN kpi_definitions k ON kv.kpi_def_id=k.id WHERE ${where} ORDER BY kv.period_date`, params);
    res.json({ dashboard_id: parseInt(req.params.id), period, history: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /v1/dashboards/:id/alerts
router.get('/:id/alerts', async (req, res) => {
  try {
    const result = await db.tenantQuery(req.tenantId,
      `SELECT id, type, title, message, trigger_value, is_read, created_at FROM notifications
       WHERE dashboard_id=$1 AND tenant_id=$2 ORDER BY created_at DESC LIMIT 20`, [req.params.id, req.tenantId]);
    res.json({ dashboard_id: parseInt(req.params.id), alerts: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /v1/dashboards/:id/export
router.post('/:id/export', async (req, res) => {
  const format = (req.body && req.body.format) || 'json';
  try {
    const kpis = await db.tenantQuery(req.tenantId,
      `SELECT k.key, k.label, k.unit, s.current_value, s.delta_percent FROM kpi_snapshots s
       JOIN kpi_definitions k ON s.kpi_def_id=k.id WHERE s.dashboard_id=$1 AND s.tenant_id=$2`, [req.params.id, req.tenantId]);
    const meta = await db.query(`SELECT name FROM dashboards WHERE id=$1`, [req.params.id]);

    // Log export
    await db.query(`INSERT INTO report_exports (tenant_id, user_id, dashboard_id, export_format, file_name)
      VALUES ($1, $2, $3, $4, $5)`, [req.tenantId, req.user.sub, req.params.id, format, `${meta.rows[0]?.name}_${new Date().toISOString().slice(0,10)}.${format}`]);

    if (format === 'csv') {
      let csv = 'Metric,Value,Change (%),Unit\n';
      kpis.rows.forEach(k => { csv += `"${k.label}",${k.current_value},${k.delta_percent || 0},${k.unit}\n`; });
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${meta.rows[0]?.name?.replace(/\s+/g,'_')}.csv"`);
      return res.send(csv);
    }
    res.json({ dashboard: meta.rows[0]?.name, exported_at: new Date().toISOString(), format: 'json', data: kpis.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
