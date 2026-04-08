const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.PGHOST || 'dpg-d754cd24d50c73e4qprg-a.oregon-postgres.render.com',
  database: process.env.PGDATABASE || 'deemona_enterprise',
  user: process.env.PGUSER || 'deemona_user',
  password: process.env.PGPASSWORD || 'v7epqo8Zl8l74CcXjJPaeqiw1zdz26yL',
  port: process.env.PGPORT || 5432,
  ssl: {
    rejectUnauthorized: false
  }
});

pool.on('connect', () => {
  console.log('[DB] New connection established to database');
});

pool.on('error', (err) => {
  console.error('[DB] Unexpected error on idle client:', err);
});

module.exports = pool;