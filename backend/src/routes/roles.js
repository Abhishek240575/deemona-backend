const r = require('express').Router();
const db = require('../services/database');
r.get('/', async (req, res) => {
  try { const d = await db.query(`SELECT r.id, r.name, r.domain, r.description, COUNT(dra.dashboard_id) AS dashboard_count, ARRAY_AGG(DISTINCT d.name ORDER BY d.name) AS dashboard_names FROM roles r LEFT JOIN dashboard_role_access dra ON r.id=dra.role_id LEFT JOIN dashboards d ON dra.dashboard_id=d.id GROUP BY r.id ORDER BY r.id`); res.json({ roles: d.rows }); }
  catch(e) { res.status(500).json({error:e.message}); }
});
module.exports = r;
