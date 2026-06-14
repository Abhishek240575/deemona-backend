const express = require('express');
const router = express.Router();
const bcryptjs = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../services/database');

// POST /v1/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  try {
    const result = await db.query(
      `SELECT u.id, u.email, u.password_hash, u.first_name, u.last_name, u.tenant_id,
              u.is_admin, u.role_name, 'all' AS role_domain,
              t.name AS tenant_name, t.plan, t.status AS tenant_status
       FROM users u
       JOIN tenants t ON u.tenant_id = t.id
       WHERE u.email = $1 AND u.is_active = TRUE AND t.status = 'active'`,
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const valid = await bcryptjs.compare(password, user.password_hash);

    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      {
        sub: user.id,
        tenant_id: user.tenant_id,
        role: user.role_name,
        email: user.email,
        name: `${user.first_name} ${user.last_name}`,
        is_admin: user.is_admin
      },
      process.env.JWT_SECRET || 'deemona-jwt-secret-2024',
      { expiresIn: '24h' }
    );

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
      accessible_dashboards: []
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

    if (!acceptedTerms) {
      return res.status(400).json({ error: 'You must accept the Terms and Conditions' });
    }

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const existingUser = await db.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existingUser.rows.length > 0) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const hashedPassword = await bcryptjs.hash(password, 10);
    const nameParts = name.trim().split(' ');
    const firstName = nameParts[0];
    const lastName = nameParts.slice(1).join(' ') || '';

    const defaultTenant = await db.query(`SELECT id FROM tenants WHERE status = 'active' LIMIT 1`);
    if (defaultTenant.rows.length === 0) {
      return res.status(500).json({ error: 'System configuration error.' });
    }
    const tenantId = defaultTenant.rows[0].id;

    const result = await db.query(
      `INSERT INTO users (email, password_hash, first_name, last_name, tenant_id, role_name,
        is_active, is_admin, created_at)
       VALUES ($1, $2, $3, $4, $5, 'Analyst', TRUE, FALSE, NOW())
       RETURNING id, email, first_name, last_name`,
      [email.toLowerCase(), hashedPassword, firstName, lastName, tenantId]
    );

    res.status(201).json({
      message: 'Account created successfully',
      user: {
        id: result.rows[0].id,
        name: `${result.rows[0].first_name} ${result.rows[0].last_name}`,
        email: result.rows[0].email
      }
    });

  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ error: 'Failed to create account. Please try again.' });
  }
});

// POST /v1/auth/logout
router.post('/logout', (req, res) => {
  res.json({ message: 'Logged out successfully' });
});

// GET /v1/auth/verify
router.get('/verify', (req, res) => {
  res.json({ valid: true });
});

module.exports = router;
