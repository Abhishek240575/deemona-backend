// ═══════════════════════════════════════════════════════════
// DEEMONA FINANCE SOLUTION — Authentication Middleware
// Supports: Bearer Token (JWT) | API Key | No Auth
// ═══════════════════════════════════════════════════════════

const jwt = require('jsonwebtoken');
const config = require('../../config');

function authMiddleware(req, res, next) {
  // Skip authentication for auth routes (login, register, etc.)
  if (req.path.startsWith('/auth')) {
    return next();
  }
  
  if (!config.auth.enabled) return next();
  
  // Check API Key first
  const apiKey = req.headers['x-api-key'];
  if (apiKey && apiKey === config.auth.apiKey) return next();
  
  // Check Bearer token
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    try {
      const decoded = jwt.verify(token, config.auth.jwtSecret);
      req.user = decoded;
      return next();
    } catch (err) {
      return res.status(401).json({ error: 'Invalid token', message: err.message });
    }
  }
  
  return res.status(401).json({
    error: 'Authentication required',
    message: 'Provide a valid API key (X-API-Key header) or Bearer token (Authorization header)',
  });
}

// Generate a JWT token (for login endpoint)
function generateToken(payload, expiresIn = '24h') {
  return jwt.sign(payload, config.auth.jwtSecret, { expiresIn });
}

// Role-based access control
function requireRole(...roles) {
  return (req, res, next) => {
    if (!config.auth.enabled) return next();
    // API key auth bypasses role check
    if (req.headers['x-api-key']) return next();
    if (!req.user || !req.user.role) {
      return res.status(403).json({ error: 'Forbidden', message: 'No role assigned' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden', message: `Requires role: ${roles.join(' or ')}` });
    }
    next();
  };
}

module.exports = { authMiddleware, generateToken, requireRole };
