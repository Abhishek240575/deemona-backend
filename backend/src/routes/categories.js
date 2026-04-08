const r = require('express').Router();
const db = require('../services/database');
r.get('/', async (req, res) => {
  try { const d = await db.query(`SELECT c.*, COUNT(d.id) AS dashboard_count FROM categories c LEFT JOIN dashboards d ON d.category_id=c.id AND d.is_active=TRUE GROUP BY c.id ORDER BY c.display_order`); res.json({ categories: d.rows }); }
  catch(e) { res.status(500).json({error:e.message}); }
});
module.exports = r;
