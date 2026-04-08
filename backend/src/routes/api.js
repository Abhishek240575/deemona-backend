// ================================================================
// COMPATIBILITY SHIM — routes old require('./routes/api') to new index.js
// This ensures the existing server.js picks up all 72 new route files
// ================================================================
module.exports = require('./index');
