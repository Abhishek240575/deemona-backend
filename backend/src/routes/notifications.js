const r = require('express').Router();
const db = require('../services/database');
r.get('/', async (req, res) => {
  const {limit=20, type, dashboard_id} = req.query;
  let w=['n.tenant_id=$1'], p=[req.tenantId], i=2;
  if(type){w.push(`n.type=$${i++}`);p.push(type);}
  if(dashboard_id){w.push(`n.dashboard_id=$${i++}`);p.push(dashboard_id);}
  try { const d = await db.query(`SELECT n.id,n.type,n.title,n.message,n.dashboard_id,n.is_read,n.created_at,d.name AS dashboard_name FROM notifications n LEFT JOIN dashboards d ON n.dashboard_id=d.id WHERE ${w.join(' AND ')} ORDER BY n.created_at DESC LIMIT ${Math.min(parseInt(limit),50)}`,p); res.json({total:d.rows.length, notifications:d.rows}); }
  catch(e){res.status(500).json({error:e.message});}
});
r.patch('/:id/read', async (req, res) => {
  try { await db.query(`UPDATE notifications SET is_read=TRUE, read_at=NOW() WHERE id=$1 AND tenant_id=$2`,[req.params.id,req.tenantId]); res.json({success:true}); }
  catch(e){res.status(500).json({error:e.message});}
});
module.exports = r;
