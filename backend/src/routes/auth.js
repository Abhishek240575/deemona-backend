const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../services/database');
//const { sendPasswordResetEmail } = require('../services/email');
const crypto = require('crypto');
const { sendPasswordResetEmail, sendVerificationEmail } = require('../services/email');

// POST /v1/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

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
    const valid = await bcrypt.compare(password, user.password_hash);

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

    
// Create session
console.log('[AUTH-DEBUG] About to create session for user:', user.email);

const sessionToken = require('crypto').randomBytes(32).toString('hex');
const ipAddress = req.ip || req.connection.remoteAddress;
const userAgent = req.headers['user-agent'] || 'Unknown';
const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

console.log('[AUTH-DEBUG] Session data:', { user_id: user.id, tenant_id: user.tenant_id, ip: ipAddress });

await db.query(
  `INSERT INTO user_sessions (user_id, tenant_id, session_token, ip_address, user_agent, is_active, expires_at)
   VALUES ($1, $2, $3, $4, $5, true, $6)`,
  [user.id, user.tenant_id, sessionToken, ipAddress, userAgent, expiresAt]
);

console.log('[AUTH-DEBUG] Session created successfully!');

// Return success
res.json({
  token,
  user: {
    id: user.id,
    name: `${user.first_name} ${user.last_name}`,
    email: user.email,
    role: user.role_name,
    role_domain: user.role_domain,
    is_admin: user.is_admin,
    tenant: {
      id: user.tenant_id,
      name: user.tenant_name,
      plan: user.plan
    }
  }
});

  } catch (err) {
    console.error('[AUTH] Login error:', err);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

// POST /v1/auth/register
router.post('/register', async (req, res) => {
  const { email, password, firstName, lastName, companyName } = req.body;
  
  // Validation
  if (!email || !password || !firstName || !lastName) {
    return res.status(400).json({ error: 'All fields required' });
  }
  
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }
  
  try {
    // Check if email already exists
    const existing = await db.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Email already registered' });
    }
    
    // Create tenant for new company
    const tenantName = companyName || `${firstName}'s Company`;
    const slug = tenantName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 50);
    const uniqueSlug = slug + '-' + Math.random().toString(36).substring(2, 7);
    
    const tenantResult = await db.query(
      `INSERT INTO tenants (name, slug, plan, status) 
       VALUES ($1, $2, $3, $4) 
       RETURNING id`,
      [tenantName, uniqueSlug, 'trial', 'active']
    );
    const tenantId = tenantResult.rows[0].id;
    
// Hash password
const passwordHash = await bcrypt.hash(password, 10);

// DEBUG - Check database connection
const dbCheck = await db.query('SELECT current_database() as db, current_schema() as schema');
console.log('[AUTH-DEBUG] Connected to database:', dbCheck.rows[0]);

// DEBUG - Check if column exists
const colCheck = await db.query(`
  SELECT column_name 
  FROM information_schema.columns 
  WHERE table_name = 'users' AND column_name = 'email_verified'
`);
console.log('[AUTH-DEBUG] email_verified column exists:', colCheck.rows.length > 0);

console.log('[AUTH-DEBUG] About to create user with email_verified column');
console.log('[AUTH-DEBUG] User data:', { tenantId, email, firstName, lastName });

// Create user (CEO role = 10, as admin, email_verified = false)
const userResult = await db.query(
  `INSERT INTO users (
    tenant_id, email, password_hash, first_name, last_name, 
    role_id, is_admin, is_active, email_verified
  ) VALUES ($1, $2, $3, $4, $5, 10, true, true, false)
  RETURNING id, email, first_name, last_name`,
  [tenantId, email, passwordHash, firstName, lastName]
);
    
    const user = userResult.rows[0];
    
    // Generate verification token
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    
    // Save verification token
    await db.query(
      `INSERT INTO email_verifications (user_id, token, expires_at)
       VALUES ($1, $2, $3)`,
      [user.id, verificationToken, expiresAt]
    );
    
    // Send verification email
    const userName = `${user.first_name} ${user.last_name}`;
    await sendVerificationEmail(email, verificationToken, userName);
    
    // Auto-login: generate token (even though email not verified yet)
    const token = jwt.sign(
      { 
        sub: user.id, 
        tenant_id: tenantId, 
        role: 'CEO / Board', 
        email: user.email,
        name: userName, 
        is_admin: true,
        email_verified: false
      },
      process.env.JWT_SECRET, 
      { expiresIn: '24h' }
    );
    
    res.status(201).json({
      message: 'Account created! Please check your email to verify your account.',
      token,
      user: {
        id: user.id,
        name: userName,
        email: user.email,
        role: 'CEO / Board',
        is_admin: true,
        email_verified: false,
        tenant: { id: tenantId, name: tenantName, plan: 'trial' }
      }
    });
    
  } catch (err) {
    console.error('[AUTH] Registration error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// POST /v1/auth/refresh
router.post('/refresh', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Token required' });
  try {
    const old = jwt.verify(authHeader.replace('Bearer ', ''), process.env.JWT_SECRET, { ignoreExpiration: true });
    const token = jwt.sign({ sub: old.sub, tenant_id: old.tenant_id, role: old.role, email: old.email, name: old.name, is_admin: old.is_admin }, process.env.JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, expires_in: '24h' });
  } catch (err) { res.status(401).json({ error: 'Invalid token' }); }
});

// POST /v1/auth/logout
router.post('/logout', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const tokenHash = require('crypto').createHash('sha256').update(authHeader.replace('Bearer ', '')).digest('hex');
    await db.query(`UPDATE user_sessions SET is_active = FALSE WHERE token_hash = $1`, [tokenHash]);
  }
  res.json({ success: true });
});
// DEBUG: Check database state
router.get('/debug/usercount', async (req, res) => {
  try {
    const result = await db.query('SELECT COUNT(*) as count FROM users');
    const testUsers = await db.query("SELECT email FROM users WHERE email LIKE '%testcompany.com'");
    res.json({
      total_users: result.rows[0].count,
      test_users: testUsers.rows.map(r => r.email),
      connection_info: await db.query('SELECT current_database(), current_user, inet_server_addr()').then(r => r.rows[0])
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// POST /v1/auth/forgot-password
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  
  if (!email) {
    return res.status(400).json({ error: 'Email required' });
  }
  
  try {
    // Find user
    const userResult = await db.query(
      'SELECT id, first_name, last_name FROM users WHERE email = $1 AND is_active = true',
      [email]
    );
    
    // Always return success (don't reveal if user exists)
    if (userResult.rows.length === 0) {
      return res.json({ message: 'If that email exists, we sent a password reset link' });
    }
    
    const user = userResult.rows[0];
    
    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    
    // Save token to database
    await db.query(
      `INSERT INTO password_resets (user_id, token, expires_at)
       VALUES ($1, $2, $3)`,
      [user.id, resetToken, expiresAt]
    );
    
    // Send email
    const userName = `${user.first_name} ${user.last_name}`;
    await sendPasswordResetEmail(email, resetToken, userName);
    
    res.json({ message: 'If that email exists, we sent a password reset link' });
    
  } catch (err) {
    console.error('[AUTH] Forgot password error:', err);
    res.status(500).json({ error: 'Failed to process request' });
  }
});

// POST /v1/auth/reset-password
router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body;
  
  if (!token || !password) {
    return res.status(400).json({ error: 'Token and password required' });
  }
  
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  
  try {
    // Find valid reset token
    const resetResult = await db.query(
      `SELECT user_id FROM password_resets 
       WHERE token = $1 
       AND used = false 
       AND expires_at > NOW()`,
      [token]
    );
    
    if (resetResult.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }
    
    const userId = resetResult.rows[0].user_id;
    
    // Hash new password
    const passwordHash = await bcrypt.hash(password, 10);
    
    // Update user password
    await db.query(
      'UPDATE users SET password_hash = $1 WHERE id = $2',
      [passwordHash, userId]
    );
    
    // Mark token as used
    await db.query(
      'UPDATE password_resets SET used = true WHERE token = $1',
      [token]
    );
    
    // Invalidate all user sessions (force re-login)
    await db.query(
      'UPDATE user_sessions SET is_active = false WHERE user_id = $1',
      [userId]
    );
    
    res.json({ message: 'Password reset successful' });
    
  } catch (err) {
    console.error('[AUTH] Reset password error:', err);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});
// ADMIN: Run database migration
router.post('/admin/migrate', async (req, res) => {
  const { adminSecret } = req.body;
  
  if (adminSecret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  
  try {
    // Log current database
    const dbCheck = await db.query('SELECT current_database() as db');
    console.log('[MIGRATION] Running on database:', dbCheck.rows[0].db);
    
    // Check if column exists BEFORE
    const beforeCheck = await db.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'users' AND column_name = 'email_verified'
    `);
    console.log('[MIGRATION] email_verified exists BEFORE:', beforeCheck.rows.length > 0);
    
    // Add columns to users table
    await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT false`);
    console.log('[MIGRATION] Added email_verified column');
    
    await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMP WITH TIME ZONE`);
    console.log('[MIGRATION] Added email_verified_at column');
    
    // Check if column exists AFTER
    const afterCheck = await db.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'users' AND column_name = 'email_verified'
    `);
    console.log('[MIGRATION] email_verified exists AFTER:', afterCheck.rows.length > 0);
    
    // Create other tables
    await db.query(`
      CREATE TABLE IF NOT EXISTS password_resets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token VARCHAR(255) NOT NULL UNIQUE,
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        used BOOLEAN DEFAULT false,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    await db.query(`CREATE INDEX IF NOT EXISTS idx_password_resets_token ON password_resets(token)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_password_resets_user_id ON password_resets(user_id)`);
    
    await db.query(`ALTER TABLE user_sessions ALTER COLUMN token_hash DROP NOT NULL`);
    await db.query(`ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS session_token VARCHAR(255)`);
    
    await db.query(`
      CREATE TABLE IF NOT EXISTS email_verifications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token VARCHAR(255) NOT NULL UNIQUE,
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        verified BOOLEAN DEFAULT false,
        verified_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    await db.query(`CREATE INDEX IF NOT EXISTS idx_email_verifications_token ON email_verifications(token)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_email_verifications_user_id ON email_verifications(user_id)`);
    
    res.json({ 
      success: true, 
      message: 'Migration completed - check logs for details',
      columnExistsAfter: afterCheck.rows.length > 0
    });
  } catch (err) {
    console.error('[MIGRATION] Error:', err);
    res.status(500).json({ error: err.message });
  }
});
// GET /v1/auth/verify-email?token=...
router.get('/verify-email', async (req, res) => {
  const { token } = req.query;
  
  if (!token) {
    return res.status(400).json({ error: 'Verification token required' });
  }
  
  try {
    // Find valid verification token
    const verifyResult = await db.query(
      `SELECT user_id FROM email_verifications 
       WHERE token = $1 
       AND verified = false 
       AND expires_at > NOW()`,
      [token]
    );
    
    if (verifyResult.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired verification token' });
    }
    
    const userId = verifyResult.rows[0].user_id;
    
    // Mark email as verified
    await db.query(
      'UPDATE users SET email_verified = true, email_verified_at = NOW() WHERE id = $1',
      [userId]
    );
    
    // Mark verification as used
    await db.query(
      'UPDATE email_verifications SET verified = true, verified_at = NOW() WHERE token = $1',
      [token]
    );
    
    res.json({ message: 'Email verified successfully!' });
    
  } catch (err) {
    console.error('[AUTH] Email verification error:', err);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// POST /v1/auth/resend-verification
router.post('/resend-verification', async (req, res) => {
  const { email } = req.body;
  
  if (!email) {
    return res.status(400).json({ error: 'Email required' });
  }
  
  try {
    // Find user
    const userResult = await db.query(
      'SELECT id, first_name, last_name, email_verified FROM users WHERE email = $1',
      [email]
    );
    
    if (userResult.rows.length === 0) {
      // Don't reveal if user exists
      return res.json({ message: 'If that email exists and is unverified, we sent a verification link' });
    }
    
    const user = userResult.rows[0];
    
    if (user.email_verified) {
      return res.json({ message: 'Email already verified' });
    }
    
    // Generate new verification token
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    
    // Save new token
    await db.query(
      `INSERT INTO email_verifications (user_id, token, expires_at)
       VALUES ($1, $2, $3)`,
      [user.id, verificationToken, expiresAt]
    );
    
    // Send verification email
    const userName = `${user.first_name} ${user.last_name}`;
    await sendVerificationEmail(email, verificationToken, userName);
    
    res.json({ message: 'Verification email sent' });
    
  } catch (err) {
    console.error('[AUTH] Resend verification error:', err);
    res.status(500).json({ error: 'Failed to send verification email' });
  }
});


module.exports = router;
