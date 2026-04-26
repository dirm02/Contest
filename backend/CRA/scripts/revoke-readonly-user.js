/**
 * revoke-readonly-user.js
 *
 * Revokes and drops the read-only hackathon user.
 * Requires the admin connection from .env.
 *
 * Usage: node scripts/revoke-readonly-user.js
 */
const fs = require('fs');
const path = require('path');
const db = require('../lib/db');
const log = require('../lib/logger');

const READONLY_USER = 'hackathon_readonly';

async function main() {
  log.section('Revoke Read-Only User');

  const client = await db.getClient();

  try {
    const dbNameRes = await client.query('SELECT current_database()');
    const dbName = dbNameRes.rows[0].current_database;

    // Terminate any active sessions
    await client.query(`
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE usename = '${READONLY_USER}' AND pid <> pg_backend_pid()
    `);
    log.info('Terminated active sessions');

    // Revoke all privileges from all schemas
    const schemas = ['public', 'cra', 'fed', 'ab', 'general'];
    for (const schema of schemas) {
      try {
        await client.query(`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA ${schema} FROM ${READONLY_USER}`);
        await client.query(`REVOKE USAGE ON SCHEMA ${schema} FROM ${READONLY_USER}`);
      } catch (e) {
        // Schema may not exist - that's fine
      }
    }
    await client.query(`REVOKE CONNECT ON DATABASE ${dbName} FROM ${READONLY_USER}`);
    log.info('Revoked all privileges');

    // Remove default privileges from all schemas
    const adminRes = await client.query('SELECT current_user');
    const adminUser = adminRes.rows[0].current_user;
    for (const schema of schemas) {
      try {
        await client.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${adminUser} IN SCHEMA ${schema} REVOKE SELECT ON TABLES FROM ${READONLY_USER}`);
      } catch (e) {
        // Schema may not exist - that's fine
      }
    }
    log.info('Revoked default privileges');

    // Drop the role
    await client.query(`DROP ROLE IF EXISTS ${READONLY_USER}`);
    log.info('Dropped role');

    // Remove .env.public
    const envPublicPath = path.join(__dirname, '..', '.env.public');
    if (fs.existsSync(envPublicPath)) {
      fs.unlinkSync(envPublicPath);
      log.info('Deleted .env.public');
    }

    log.section('Read-Only User Revoked');
    log.info(`User ${READONLY_USER} has been removed.`);
    log.info('All active sessions terminated, all privileges revoked.');

  } catch (err) {
    log.error(`Failed: ${err.message}`);
    throw err;
  } finally {
    client.release();
    await db.end();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
