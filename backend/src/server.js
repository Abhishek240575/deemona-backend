// ╔══════════════════════════════════════════════════════════════╗
// ║  DEEMONA FINANCE SOLUTION — API Server                     ║
// ║  Real-Time Financial Intelligence Platform                 ║
// ║                                                            ║
// ║  Start:  npm start     (production)                        ║
// ║          npm run dev   (development with auto-reload)      ║
// ╚══════════════════════════════════════════════════════════════╝

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const http = require('http');
const path = require('path');

// Load environment config
const config = require('../config');

// Create Express app
const app = express();

// Trust proxy - Required for Render/cloud deployment
app.set('trust proxy', 1);

// ═══════════════════════════════════════════════════════════
// MIDDLEWARE
// ═══════════════════════════════════════════════════════════

// Security headers
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

// CORS
app.use(cors({
  origin: config.cors.origin,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
  credentials: true,
}));

// Compression
app.use(compression());

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Setup database
require('./setup-db')(app);

// Request logging
app.use(morgan(config.log.format));

// Rate limiting
const limiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  message: { error: 'Too many requests', message: `Rate limit: ${config.rateLimit.max} requests per ${config.rateLimit.windowMs / 1000}s` },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/v1', limiter);

// ═══════════════════════════════════════════════════════════
// ROUTES - CORRECT ORDER
// ═══════════════════════════════════════════════════════════
const { authMiddleware } = require('./middleware/auth');

// 1. Auth routes (PUBLIC)
app.use('/v1/auth', require('./routes/auth'));

// 2. Admin routes (BEFORE authMiddleware - has its own auth)
const adminRoutes = require('./routes/admin');
app.use('/v1/admin', adminRoutes);

// 2b. Integration routes (PUBLIC - has API key check inside)
app.use('/v1/integrations', require('./routes/integrations/finance-erp'));

// 3. Apply authMiddleware to remaining /v1 routes
app.use('/v1', authMiddleware);

// 4. Protected API routes
app.use('/v1', require('./routes/api'));

// ═══════════════════════════════════════════════════════════
// HEALTH CHECK
// ═══════════════════════════════════════════════════════════
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: config.server.env,
    database: 'connected',
    websocket: config.websocket.enabled ? 'enabled' : 'disabled',
  });
});

// ═══════════════════════════════════════════════════════════
// SERVE FRONTEND (the dashboard HTML file)
// ═══════════════════════════════════════════════════════════
app.use(express.static(path.join(__dirname, '../public')));

// Fallback: serve dashboard for any non-API route
app.get('*', (req, res) => {
  if (req.path.startsWith('/v1')) {
    return res.status(404).json({ error: 'Endpoint not found' });
  }
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ═══════════════════════════════════════════════════════════
// ERROR HANDLING
// ═══════════════════════════════════════════════════════════
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.stack);
  res.status(err.status || 500).json({
    error: config.server.env === 'production' ? 'Internal server error' : err.message,
    ...(config.server.env !== 'production' && { stack: err.stack }),
  });
});

// ═══════════════════════════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════════════════════════
const server = http.createServer(app);

// Attach WebSocket
const { startWebSocket } = require('./services/websocket');
startWebSocket(server);

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[SERVER] SIGTERM received. Shutting down gracefully...');
  server.close(() => { console.log('[SERVER] Closed.'); process.exit(0); });
});

// Start listening
server.listen(config.server.port, config.server.host, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║                                                              ║');
  console.log('║   🏦  DEEMONA FINANCE SOLUTION                              ║');
  console.log('║       Real-Time Intelligence Platform                        ║');
  console.log('║                                                              ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║   REST API:    http://${config.server.host}:${config.server.port}/v1              `);
  console.log(`║   Dashboard:   http://${config.server.host}:${config.server.port}                 `);
  console.log(`║   WebSocket:   ws://${config.server.host}:${config.server.port}/v1/stream         `);
  console.log(`║   Health:      http://${config.server.host}:${config.server.port}/v1/health       `);
  console.log('║                                                              ║');
  console.log(`║   Environment: ${config.server.env.toUpperCase().padEnd(43)}║`);
  console.log(`║   Auth:        ${(config.auth.enabled ? 'ENABLED' : 'DISABLED').padEnd(43)}║`);
  console.log(`║   WebSocket:   ${(config.websocket.enabled ? 'ENABLED' : 'DISABLED').padEnd(43)}║`);
  console.log(`║   Dashboards:  32                                            ║`);
  console.log('║                                                              ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');
}).on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ ERROR: Port ${config.server.port} is already in use!`);
    console.error(`   Kill the process using this port or change the port in config.\n`);
  } else {
    console.error(`\n❌ Server error:`, err.message);
  }
  process.exit(1);
});

module.exports = app;