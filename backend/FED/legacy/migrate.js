/**
 * LEGACY - Original migration script from Phase 1 Data Loading
 * Preserved for reference. The new pipeline in /scripts/ supersedes this.
 *
 * NOTE: Legacy used DROP TABLE IF EXISTS (destructive). New pipeline uses
 * CREATE TABLE IF NOT EXISTS (idempotent).
 */
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DB_CONNECTION_STRING,
});

async function createTables() {
  const client = await pool.connect();

  try {
    console.log('Starting database migration...\n');

    console.log('Dropping existing table and indexes...');
    await client.query('DROP TABLE IF EXISTS grants_contributions CASCADE;');
    console.log('Existing table and indexes dropped\n');

    console.log('Creating grants_contributions table...');
    await client.query(`
      CREATE TABLE grants_contributions (
        _id INTEGER PRIMARY KEY,
        ref_number TEXT,
        amendment_number TEXT,
        amendment_date DATE,
        agreement_type TEXT,
        recipient_type TEXT,
        recipient_business_number TEXT,
        recipient_legal_name TEXT,
        recipient_operating_name TEXT,
        research_organization_name TEXT,
        recipient_country TEXT,
        recipient_province TEXT,
        recipient_city TEXT,
        recipient_postal_code TEXT,
        federal_riding_name_en TEXT,
        federal_riding_name_fr TEXT,
        federal_riding_number TEXT,
        prog_name_en TEXT,
        prog_name_fr TEXT,
        prog_purpose_en TEXT,
        prog_purpose_fr TEXT,
        agreement_title_en TEXT,
        agreement_title_fr TEXT,
        agreement_number TEXT,
        agreement_value DECIMAL(15,2),
        foreign_currency_type TEXT,
        foreign_currency_value DECIMAL(15,2),
        agreement_start_date DATE,
        agreement_end_date DATE,
        coverage TEXT,
        description_en TEXT,
        description_fr TEXT,
        naics_identifier TEXT,
        expected_results_en TEXT,
        expected_results_fr TEXT,
        additional_information_en TEXT,
        additional_information_fr TEXT,
        owner_org TEXT,
        owner_org_title TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('Table created\n');

    console.log('Creating indexes...');
    await client.query('CREATE INDEX idx_grants_province ON grants_contributions(recipient_province);');
    await client.query('CREATE INDEX idx_grants_agreement_type ON grants_contributions(agreement_type);');
    await client.query('CREATE INDEX idx_grants_start_date ON grants_contributions(agreement_start_date);');
    await client.query('CREATE INDEX idx_grants_end_date ON grants_contributions(agreement_end_date);');
    await client.query("CREATE INDEX idx_grants_recipient_name ON grants_contributions USING gin(to_tsvector('english', recipient_legal_name));");
    await client.query("CREATE INDEX idx_grants_program_name ON grants_contributions USING gin(to_tsvector('english', prog_name_en));");
    await client.query('CREATE INDEX idx_grants_value ON grants_contributions(agreement_value);');
    console.log('Indexes created\n');

    console.log('Migration completed successfully!');
  } catch (error) {
    console.error('Migration error:', error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

module.exports = { createTables };

if (require.main === module) {
  createTables().catch(err => {
    console.error('Fatal migration error:', err);
    process.exit(1);
  });
}
