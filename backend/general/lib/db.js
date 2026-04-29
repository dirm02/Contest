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

function encodeConnectionPart(value) {
  return encodeURIComponent(value);
}

function buildDatabaseUrlFromEnv() {
  const user = process.env.DB_USER;
  const password = process.env.DB_PASSWORD;
  const database = process.env.DB_NAME;
  if (!user || !password || !database) return '';

  const encodedUser = encodeConnectionPart(user);
  const encodedPassword = encodeConnectionPart(password);

  if (process.env.CLOUD_SQL_CONNECTION_NAME) {
    return `postgresql://${encodedUser}:${encodedPassword}@/${database}?host=/cloudsql/${process.env.CLOUD_SQL_CONNECTION_NAME}`;
  }

  if (process.env.DB_HOST) {
    const port = process.env.DB_PORT || '5432';
    return `postgresql://${encodedUser}:${encodedPassword}@${process.env.DB_HOST}:${port}/${database}`;
  }

  return '';
}

const connString = process.env.DB_CONNECTION_STRING || buildDatabaseUrlFromEnv();
if (!connString) {
  console.error(
    'No database connection found. Set DB_CONNECTION_STRING, or set DB_USER, DB_PASSWORD, DB_NAME, and either CLOUD_SQL_CONNECTION_NAME or DB_HOST.',
  );
  process.exit(1);
}

const pool = new Pool({
  connectionString: connString,
  max: parseInt(process.env.DB_POOL_MAX || '25', 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 30000,
  ssl: connString.includes('render.com') ? { rejectUnauthorized: false } : undefined,
  options: '-c search_path=general,public',
});

pool.on('error', (err) => {
  console.error('Unexpected database pool error:', err.message);
});

async function query(text, params) {
  return pool.query(text, params);
}

async function getClient() {
  return pool.connect();
}

async function end() {
  return pool.end();
}

module.exports = { pool, query, getClient, end };
