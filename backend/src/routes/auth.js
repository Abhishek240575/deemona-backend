const express = require('express');
const router = express.Router();
const bcryptjs = require('bcryptjs'); // Use bcryptjs everywhere!
const jwt = require('jsonwebtoken');
const db = require('../db');

// POST /v1/auth/login
router.post('/login', async (req, res) => {
  const { email, password, acceptedTerms } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }
  
  try {
    const result = await db.query(
      `SELECT u.id, u.email, u.password_hash, u.first_name, u.last_name, u.tenant_id,
              u.is_admin, r.name AS role_name, r.domain AS role_domain,
              t.name AS tenant_name, t.plan, t.status AS tenant_status
       FROM users u
       JOIN roles r ON u.role_id = r.id
       JOIN tenants t ON u.tenant_id = t.id
       WHERE u.email = $1 AND u.is_active = TRUE AND t.status = 'active'`,
      [email]
    );
    
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const user = result.rows[0];
    
    // Use bcryptjs instead of bcrypt
    const valid = await bcryptjs.compare(password, user.password_hash);
    
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Generate JWT token
    const token = jwt.sign(
      {
        sub: user.id,
        tenant_id: user.tenant_id,
        role: user.role_name,
        email: user.email,
        name: `${user.first_name} ${user.last_name}`,
        is_admin: user.is_admin
      },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    // **THIS WAS MISSING - SEND THE RESPONSE!**
    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: `${user.first_name} ${user.last_name}`,
        tenant: user.tenant_name,
        role: user.role_name,
        is_admin: user.is_admin
      },
      accessible_dashboards: [] // Add your dashboard logic here
    });
    
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});
// POST /v1/auth/signup
router.post('/signup', async (req, res) => {
  try {
    const { name, email, password, acceptedTerms, termsAcceptedAt } = req.body;
    
    // Validate terms acceptance
    if (!acceptedTerms || acceptedTerms !== true) {
      return res.status(400).json({
        error: 'You must accept the Terms and Conditions'
      });
    }
    
    // Validate required fields
    if (!name || !email || !password) {
      return res.status(400).json({
        error: 'Name, email, and password are required'
      });
    }
    
    // Validate password length
    if (password.length < 8) {
      return res.status(400).json({
        error: 'Password must be at least 8 characters'
      });
    }
    
    // Check if user already exists
    const existingUser = await db.query(
      'SELECT * FROM users WHERE email = $1',
      [email.toLowerCase()]
    );
    
    if (existingUser.rows.length > 0) {
      return res.status(409).json({
        error: 'Email already registered'
      });
    }
    
    // Hash password with bcryptjs
    const hashedPassword = await bcryptjs.hash(password, 10);
    
    // Split name into first_name and last_name
    const nameParts = name.trim().split(' ');
    const firstName = nameParts[0];
    const lastName = nameParts.slice(1).join(' ') || '';
    
    // Create a unique tenant slug from email
    const emailPrefix = email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '-');
    const tenantSlug = `${emailPrefix}-${Date.now()}`;
    const tenantName = `${firstName}'s Organization`;
    
    // Start a transaction
    await db.query('BEGIN');
    
    try {
      // Create new tenant - ONLY ESSENTIAL COLUMNS
      const tenantResult = await db.query(
        `INSERT INTO tenants 
         (name, slug, plan, status, primary_color, max_users, max_dashboards) 
         VALUES ($1, $2, $3, $4, $5, $6, $7) 
         RETURNING id`,
        [
          tenantName,
          tenantSlug,
          'free',
          'active',
          '#0D9488',
          5,
          15
        ]
      );
      
      const tenantId = tenantResult.rows[0].id;
      
      // Get default role
      const defaultRole = await db.query(
        `SELECT id FROM roles WHERE name IN ('user', 'viewer', 'member') 
         ORDER BY CASE name WHEN 'user' THEN 1 WHEN 'member' THEN 2 ELSE 3 END 
         LIMIT 1`
      );
      
      if (defaultRole.rows.length === 0) {
        throw new Error('No default role found');
      }
      
      const roleId = defaultRole.rows[0].id;
      
      // Insert new user
      const userResult = await db.query(
        `INSERT INTO users 
         (email, password_hash, first_name, last_name, tenant_id, role_id, 
          is_active, is_admin, created_at) 
         VALUES ($1, $2, $3, $4, $5, $6, TRUE, FALSE, NOW()) 
         RETURNING id, email, first_name, last_name, created_at`,
        [
          email.toLowerCase(), 
          hashedPassword, 
          firstName, 
          lastName, 
          tenantId, 
          roleId
        ]
      );
      
      const newUser = userResult.rows[0];
      
      // Commit transaction
      await db.query('COMMIT');
      
      // Send success response
      res.status(201).json({
        message: 'Account created successfully',
        user: {
          id: newUser.id,
          name: `${newUser.first_name} ${newUser.last_name}`,
          email: newUser.email
        }
      });
      
    } catch (innerError) {
      // Rollback on error
      await db.query('ROLLBACK');
      throw innerError;
    }
    
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({
      error: 'Failed to create account. Please try again.'
    });
  }
});
// POST /v1/auth/signup
router.post('/signup', async (req, res) => {
  try {
    const { name, email, password, acceptedTerms, termsAcceptedAt } = req.body;
    
    // Validate terms acceptance
    if (!acceptedTerms || acceptedTerms !== true) {
      return res.status(400).json({
        error: 'You must accept the Terms and Conditions'
      });
    }
    
    // Validate required fields
    if (!name || !email || !password) {
      return res.status(400).json({
        error: 'Name, email, and password are required'
      });
    }
    
    // Validate password length
    if (password.length < 8) {
      return res.status(400).json({
        error: 'Password must be at least 8 characters'
      });
    }
    
    // Check if user already exists
    const existingUser = await db.query(
      'SELECT * FROM users WHERE email = $1',
      [email.toLowerCase()]
    );
    
    if (existingUser.rows.length > 0) {
      return res.status(409).json({
        error: 'Email already registered'
      });
    }
    
    // Hash password with bcryptjs
    const hashedPassword = await bcryptjs.hash(password, 10);
    
    // Split name into first_name and last_name
    const nameParts = name.trim().split(' ');
    const firstName = nameParts[0];
    const lastName = nameParts.slice(1).join(' ') || '';
    
    // Get default tenant and role (you need to adjust this based on your setup!)
    // Option 1: Get a "default" tenant
    const defaultTenant = await db.query(
      `SELECT id FROM tenants WHERE name = 'Default' OR status = 'active' LIMIT 1`
    );
    
    if (defaultTenant.rows.length === 0) {
      return res.status(500).json({
        error: 'System configuration error. Please contact administrator.'
      });
    }
    
    const tenantId = defaultTenant.rows[0].id;
    
    // Get default role (e.g., "user" or "viewer")
    const defaultRole = await db.query(
      `SELECT id FROM roles WHERE name = 'user' OR name = 'viewer' LIMIT 1`
    );
    
    if (defaultRole.rows.length === 0) {
      return res.status(500).json({
        error: 'System configuration error. Please contact administrator.'
      });
    }
    
    const roleId = defaultRole.rows[0].id;
    
    // Insert new user matching your existing schema
    const result = await db.query(
      `INSERT INTO users 
       (email, password_hash, first_name, last_name, tenant_id, role_id, 
        is_active, is_admin, terms_accepted_at, created_at) 
       VALUES ($1, $2, $3, $4, $5, $6, TRUE, FALSE, $7, NOW()) 
       RETURNING id, email, first_name, last_name, created_at`,
      [
        email.toLowerCase(), 
        hashedPassword, 
        firstName, 
        lastName, 
        tenantId, 
        roleId, 
        termsAcceptedAt || new Date().toISOString()
      ]
    );
    
    const newUser = result.rows[0];
    
    // Send success response
    res.status(201).json({
      message: 'Account created successfully',
      user: {
        id: newUser.id,
        name: `${newUser.first_name} ${newUser.last_name}`,
        email: newUser.email
      }
    });
    
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({
      error: 'Failed to create account. Please try again.'
    });
  }
});

module.exports = router;