const path = require('path');
const fs = require('fs');

// Load .env.public first (shared defaults for hackathon participants),
// then .env (personal overrides, e.g. admin credentials) which wins.
const publicEnv = path.join(__dirname, '..', '.env.public');
if (fs.existsSync(publicEnv)) {
  require('dotenv').config({ path: publicEnv });
}
const adminEnv = path.join(__dirname, '..', '.env');
if (fs.existsSync(adminEnv)) {
  require('dotenv').config({ path: adminEnv, override: true });
}

const { Pool } = require('pg');

const connString = process.env.DB_CONNECTION_STRING || '';
if (!connString) {
  console.error('No DB_CONNECTION_STRING found. Copy .env.example to .env or use .env.public');
  process.exit(1);
}

const pool = new Pool({
  connectionString: connString,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 30000,
  ssl: connString.includes('render.com') ? { rejectUnauthorized: false } : undefined,
  // Include 'fed' schema in search path so fed.* tables are found
  // without schema prefix. Also include 'public' for system tables.
  options: '-c search_path=fed,public',
});

pool.on('error', (err) => {
  console.error('Unexpected database pool error:', err.message);
});

async function getClient() {
  return pool.connect();
}

async function query(text, params) {
  return pool.query(text, params);
}

async function end() {
  return pool.end();
}

module.exports = { pool, getClient, query, end };
