const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

module.exports = {
  server: {
    port: parseInt(process.env.PORT || '3000'),
    host: process.env.HOST || '0.0.0.0',
    env: process.env.NODE_ENV || 'development',
  },
  auth: {
    enabled: process.env.AUTH_ENABLED === 'true',
    jwtSecret: process.env.JWT_SECRET || 'dev-secret-key',
    apiKey: process.env.API_KEY || 'dev-api-key',
  },
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
  },
  websocket: {
    enabled: process.env.WS_ENABLED !== 'false',
    port: parseInt(process.env.WS_PORT || '3001'),
    heartbeatInterval: parseInt(process.env.WS_HEARTBEAT_INTERVAL || '30000'),
  },
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000'),
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'),
  },
  refresh: {
    Daily: parseInt(process.env.REFRESH_DAILY || '15000'),
    Weekly: parseInt(process.env.REFRESH_WEEKLY || '120000'),
    Monthly: parseInt(process.env.REFRESH_MONTHLY || '300000'),
    Quarterly: parseInt(process.env.REFRESH_QUARTERLY || '600000'),
  },
  log: {
    level: process.env.LOG_LEVEL || 'info',
    format: process.env.LOG_FORMAT || 'dev',
  },
};
