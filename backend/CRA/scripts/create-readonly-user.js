/**
 * create-readonly-user.js
 *
 * Creates a read-only PostgreSQL user for hackathon participants.
 * Uses the admin connection from .env to create the account,
 * then writes the read-only connection string to .env.public.
 *
 * The read-only user can SELECT from all tables but cannot
 * INSERT, UPDATE, DELETE, or modify schema.
 *
 * Usage: node scripts/create-readonly-user.js
 *
 * To revoke: node scripts/revoke-readonly-user.js
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('../lib/db');
const log = require('../lib/logger');

const READONLY_USER = 'hackathon_readonly';

async function main() {
  log.section('Create Read-Only User');

  // Generate a secure random password
  const password = crypto.randomBytes(24).toString('base64url');
  log.info(`User: ${READONLY_USER}`);
  log.info(`Password: ${password.slice(0, 4)}...${password.slice(-4)} (${password.length} chars)`);

  const client = await db.getClient();

  try {
    // Get database name from current connection
    const dbNameRes = await client.query('SELECT current_database()');
    const dbName = dbNameRes.rows[0].current_database;
    log.info(`Database: ${dbName}`);

    // Drop existing role if it exists (clean slate)
    const schemasToClean = ['public', 'cra', 'fed', 'ab', 'general'];
    try {
      for (const schema of schemasToClean) {
        try {
          await client.query(`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA ${schema} FROM ${READONLY_USER}`);
          await client.query(`REVOKE ALL PRIVILEGES ON SCHEMA ${schema} FROM ${READONLY_USER}`);
        } catch (e) {
          // Schema may not exist - that's fine
        }
      }
      await client.query(`REVOKE CONNECT ON DATABASE ${dbName} FROM ${READONLY_USER}`);
    } catch (e) {
      // Role may not exist yet - that's fine
    }
    try {
      await client.query(`DROP ROLE IF EXISTS ${READONLY_USER}`);
    } catch (e) {
      // Ignore if doesn't exist
    }

    // Create the role
    await client.query(`CREATE ROLE ${READONLY_USER} WITH LOGIN PASSWORD '${password}'`);
    log.info('Created role');

    // Grant connect
    await client.query(`GRANT CONNECT ON DATABASE ${dbName} TO ${READONLY_USER}`);
    log.info('Granted CONNECT');

    // Grant schema usage and SELECT on all schemas
    const schemas = ['public', 'cra', 'fed', 'ab', 'general'];
    for (const schema of schemas) {
      try {
        await client.query(`GRANT USAGE ON SCHEMA ${schema} TO ${READONLY_USER}`);
        await client.query(`GRANT SELECT ON ALL TABLES IN SCHEMA ${schema} TO ${READONLY_USER}`);
        log.info(`Granted USAGE + SELECT on schema ${schema}`);
      } catch (e) {
        log.warn(`Schema ${schema} not found or grant failed: ${e.message}`);
      }
    }

    // Grant SELECT on future tables in all schemas
    const adminRes = await client.query('SELECT current_user');
    const adminUser = adminRes.rows[0].current_user;
    for (const schema of schemas) {
      try {
        await client.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${adminUser} IN SCHEMA ${schema} GRANT SELECT ON TABLES TO ${READONLY_USER}`);
      } catch (e) {
        // Schema may not exist yet - that's fine
      }
    }
    log.info('Granted SELECT on future tables in all schemas');

    // Build the connection string
    // Parse the admin connection string to extract host/port/database
    const adminConn = process.env.DB_CONNECTION_STRING;
    const match = adminConn.match(/@([^/]+)\/([^?]+)/);
    if (!match) {
      log.error('Could not parse admin connection string');
      process.exit(1);
    }
    const hostPort = match[1];
    const database = match[2];

    const readonlyConn = `postgresql://${READONLY_USER}:${password}@${hostPort}/${database}?sslmode=require`;

    // Write .env.public
    const envPublicPath = path.join(__dirname, '..', '.env.public');
    const envContent = [
      '# Read-only database connection for hackathon participants',
      '# This user can SELECT from all tables but cannot modify data',
      `# Generated: ${new Date().toISOString()}`,
      '#',
      '# To revoke access: node scripts/revoke-readonly-user.js',
      '# To regenerate: node scripts/create-readonly-user.js',
      '',
      `DB_CONNECTION_STRING=${readonlyConn}`,
      '',
    ].join('\n');

    fs.writeFileSync(envPublicPath, envContent);

    log.section('Read-Only User Created');
    log.info(`User: ${READONLY_USER}`);
    log.info(`File: .env.public`);
    log.info('');
    log.info('Hackathon participants can use this connection to query the database.');
    log.info('To use: copy .env.public to .env, or set DB_CONNECTION_STRING from .env.public');
    log.info('');
    log.info('To revoke: node scripts/revoke-readonly-user.js');

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
