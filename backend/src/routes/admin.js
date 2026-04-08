const express = require('express');
const router = express.Router();
const db = require('../services/database');

// CORS middleware
router.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  
  next();
});

// Admin authentication
const adminAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  console.log('[ADMIN AUTH] Header:', authHeader);
  
  if (authHeader && authHeader.includes('admin_authenticated')) {
    console.log('[ADMIN AUTH] ✅ Authenticated');
    return next();
  }
  
  console.log('[ADMIN AUTH] ❌ Unauthorized');
  return res.status(401).json({ error: 'Unauthorized' });
};

// Test endpoint
router.get('/test', (req, res) => {
  res.json({ 
    message: 'Admin routes working!',
    timestamp: new Date().toISOString()
  });
});

// Get stats - CORRECTED COLUMNS
router.get('/stats', adminAuth, async (req, res) => {
  try {
    console.log('[ADMIN] Fetching stats...');
    
    // Total users
    const totalResult = await db.query('SELECT COUNT(*) as count FROM users');
    const totalUsers = parseInt(totalResult.rows[0].count);
    
    // Verified users (email_verified = true)
    const verifiedResult = await db.query(
      'SELECT COUNT(*) as count FROM users WHERE email_verified = true'
    );
    const verifiedUsers = parseInt(verifiedResult.rows[0].count);
    
    // Pending verification
    const pendingUsers = totalUsers - verifiedUsers;
    
    // New users in last 7 days
    const weekResult = await db.query(
      "SELECT COUNT(*) as count FROM users WHERE created_at >= NOW() - INTERVAL '7 days'"
    );
    const newThisWeek = parseInt(weekResult.rows[0].count);
    
    // Active today (logged in today)
    const todayResult = await db.query(
      "SELECT COUNT(*) as count FROM users WHERE last_login_at >= CURRENT_DATE"
    );
    const activeToday = parseInt(todayResult.rows[0].count);
    
    const stats = {
      totalUsers,
      verifiedUsers,
      pendingUsers,
      activeToday,
      newThisWeek,
      revenue: 0
    };
    
    console.log('[ADMIN] Stats:', stats);
    res.json(stats);
    
  } catch (error) {
    console.error('[ADMIN] Stats error:', error.message);
    res.status(500).json({ error: 'Failed to fetch statistics', details: error.message });
  }
});

// Get users - CORRECTED COLUMNS
router.get('/users', adminAuth, async (req, res) => {
  try {
    console.log('[ADMIN] Fetching users...');
    
    const { search, limit = 100, offset = 0 } = req.query;
    
    let query = `
      SELECT 
        id::text,
        COALESCE(first_name || ' ' || last_name, email) as name,
        email,
        CASE 
          WHEN is_active = false THEN 'suspended'
          WHEN email_verified = true THEN 'verified'
          ELSE 'pending'
        END as status,
        created_at,
        last_login_at,
        email_verified,
        is_active,
        login_count
      FROM users
      WHERE 1=1
    `;
    
    const params = [];
    let paramCount = 1;
    
    if (search) {
      query += ` AND (email ILIKE $${paramCount} OR first_name ILIKE $${paramCount} OR last_name ILIKE $${paramCount})`;
      params.push(`%${search}%`);
      paramCount++;
    }
    
    query += ` ORDER BY created_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    params.push(parseInt(limit), parseInt(offset));
    
    const result = await db.query(query, params);
    
    // Transform to expected format
    const users = result.rows.map(row => ({
      id: row.id,
      name: row.name,
      email: row.email,
      status: row.status,
      created_at: row.created_at,
      last_login: row.last_login_at,
      is_verified: row.email_verified,
      is_suspended: !row.is_active,
      login_count: row.login_count || 0
    }));
    
    console.log('[ADMIN] Users fetched:', users.length);
    
    res.json({
      users: users,
      total: users.length,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
    
  } catch (error) {
    console.error('[ADMIN] Users error:', error.message);
    res.status(500).json({ error: 'Failed to fetch users', details: error.message });
  }
});

// Suspend user (set is_active = false)
router.post('/users/:id/suspend', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    console.log('[ADMIN] Suspending user:', id);
    
    const result = await db.query(
      'UPDATE users SET is_active = false, updated_at = NOW() WHERE id = $1 RETURNING id::text, email',
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({ message: 'User suspended', user: result.rows[0] });
  } catch (error) {
    console.error('[ADMIN] Suspend error:', error.message);
    res.status(500).json({ error: 'Failed to suspend user' });
  }
});

// Unsuspend user (set is_active = true)
router.post('/users/:id/unsuspend', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    console.log('[ADMIN] Unsuspending user:', id);
    
    const result = await db.query(
      'UPDATE users SET is_active = true, updated_at = NOW() WHERE id = $1 RETURNING id::text, email',
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({ message: 'User unsuspended', user: result.rows[0] });
  } catch (error) {
    console.error('[ADMIN] Unsuspend error:', error.message);
    res.status(500).json({ error: 'Failed to unsuspend user' });
  }
});

// Delete user
router.delete('/users/:id', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    console.log('[ADMIN] Deleting user:', id);
    
    const result = await db.query('DELETE FROM users WHERE id = $1 RETURNING id::text', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({ message: 'User deleted', userId: id });
  } catch (error) {
    console.error('[ADMIN] Delete error:', error.message);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// Export CSV
router.get('/export/users', adminAuth, async (req, res) => {
  try {
    console.log('[ADMIN] Exporting users...');
    
    const result = await db.query(`
      SELECT 
        id::text,
        COALESCE(first_name || ' ' || last_name, email) as name,
        email,
        created_at,
        last_login_at,
        email_verified,
        is_active,
        login_count
      FROM users 
      ORDER BY created_at DESC
    `);
    
    const headers = ['ID', 'Name', 'Email', 'Created At', 'Last Login', 'Verified', 'Active', 'Login Count'];
    const csv = [headers.join(',')];
    
    result.rows.forEach(row => {
      csv.push([
        row.id,
        `"${row.name || ''}"`,
        row.email,
        row.created_at,
        row.last_login_at || 'Never',
        row.email_verified,
        row.is_active,
        row.login_count || 0
      ].join(','));
    });
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=users_export.csv');
    res.send(csv.join('\n'));
    
    console.log('[ADMIN] Exported', result.rows.length, 'users');
  } catch (error) {
    console.error('[ADMIN] Export error:', error.message);
    res.status(500).json({ error: 'Failed to export' });
  }
});

module.exports = router;