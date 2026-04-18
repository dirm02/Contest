-- Schema: ab
-- Exported: 2026-04-15T16:27:37.119Z
CREATE SCHEMA IF NOT EXISTS ab;

CREATE TABLE IF NOT EXISTS ab.ab_contracts (
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  display_fiscal_year TEXT,
  recipient TEXT,
  amount NUMERIC(15,2),
  ministry TEXT,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS ab.ab_grants (
  id INTEGER NOT NULL,
  mongo_id VARCHAR(255),
  ministry TEXT,
  business_unit_name TEXT,
  recipient TEXT,
  program TEXT,
  amount NUMERIC(15,2),
  lottery TEXT,
  payment_date TIMESTAMP,
  fiscal_year TEXT,
  display_fiscal_year TEXT,
  lottery_fund TEXT,
  data_quality BOOLEAN,
  data_quality_issues JSONB,
  version INTEGER,
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS ab.ab_grants_fiscal_years (
  id INTEGER NOT NULL,
  mongo_id VARCHAR(255),
  display_fiscal_year TEXT,
  count INTEGER,
  total_amount NUMERIC(20,2),
  last_updated TIMESTAMP,
  version INTEGER,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS ab.ab_grants_ministries (
  id INTEGER NOT NULL,
  mongo_id VARCHAR(255),
  ministry TEXT,
  display_fiscal_year TEXT,
  aggregation_type TEXT,
  count INTEGER,
  total_amount NUMERIC(20,2),
  last_updated TIMESTAMP,
  version INTEGER,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS ab.ab_grants_programs (
  id INTEGER NOT NULL,
  mongo_id VARCHAR(255),
  program TEXT,
  ministry TEXT,
  display_fiscal_year TEXT,
  aggregation_type TEXT,
  count INTEGER,
  total_amount NUMERIC(20,2),
  last_updated TIMESTAMP,
  version INTEGER,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS ab.ab_grants_recipients (
  id INTEGER NOT NULL,
  mongo_id VARCHAR(255),
  recipient TEXT,
  payments_count INTEGER,
  payments_amount NUMERIC(20,2),
  programs_count INTEGER,
  ministries_count INTEGER,
  last_updated TIMESTAMP,
  version INTEGER,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS ab.ab_non_profit (
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  type TEXT,
  legal_name TEXT,
  status TEXT,
  registration_date DATE,
  city TEXT,
  postal_code TEXT,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS ab.ab_non_profit_status_lookup (
  id INTEGER NOT NULL,
  status TEXT NOT NULL,
  description TEXT,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS ab.ab_sole_source (
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  ministry TEXT,
  department_street TEXT,
  department_street_2 TEXT,
  department_city TEXT,
  department_province TEXT,
  department_postal_code TEXT,
  department_country TEXT,
  vendor TEXT,
  vendor_street TEXT,
  vendor_street_2 TEXT,
  vendor_city TEXT,
  vendor_province TEXT,
  vendor_postal_code TEXT,
  vendor_country TEXT,
  start_date DATE,
  end_date DATE,
  amount NUMERIC(15,2),
  contract_number TEXT,
  contract_services TEXT,
  permitted_situations TEXT,
  display_fiscal_year TEXT,
  special TEXT,
  PRIMARY KEY (id)
);

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS ab_grants_fiscal_years_mongo_id_key ON ab.ab_grants_fiscal_years USING btree (mongo_id);
CREATE UNIQUE INDEX IF NOT EXISTS ab_grants_ministries_mongo_id_key ON ab.ab_grants_ministries USING btree (mongo_id);
CREATE UNIQUE INDEX IF NOT EXISTS ab_grants_mongo_id_key ON ab.ab_grants USING btree (mongo_id);
CREATE UNIQUE INDEX IF NOT EXISTS ab_grants_programs_mongo_id_key ON ab.ab_grants_programs USING btree (mongo_id);
CREATE UNIQUE INDEX IF NOT EXISTS ab_grants_recipients_mongo_id_key ON ab.ab_grants_recipients USING btree (mongo_id);
CREATE UNIQUE INDEX IF NOT EXISTS ab_non_profit_status_lookup_status_key ON ab.ab_non_profit_status_lookup USING btree (status);
CREATE INDEX IF NOT EXISTS idx_ab_contracts_amount ON ab.ab_contracts USING btree (amount);
CREATE INDEX IF NOT EXISTS idx_ab_contracts_fiscal_year ON ab.ab_contracts USING btree (display_fiscal_year);
CREATE INDEX IF NOT EXISTS idx_ab_contracts_ministry ON ab.ab_contracts USING btree (ministry);
CREATE INDEX IF NOT EXISTS idx_ab_contracts_recipient ON ab.ab_contracts USING btree (recipient);
CREATE INDEX IF NOT EXISTS idx_ab_contracts_recipient_tsvector ON ab.ab_contracts USING gin (to_tsvector('english'::regconfig, COALESCE(recipient, ''::text)));
CREATE INDEX IF NOT EXISTS idx_ab_grants_amount ON ab.ab_grants USING btree (amount);
CREATE INDEX IF NOT EXISTS idx_ab_grants_fiscal_year ON ab.ab_grants USING btree (display_fiscal_year);
CREATE INDEX IF NOT EXISTS idx_ab_grants_min_fiscal_year ON ab.ab_grants_ministries USING btree (display_fiscal_year);
CREATE INDEX IF NOT EXISTS idx_ab_grants_min_ministry ON ab.ab_grants_ministries USING btree (ministry);
CREATE INDEX IF NOT EXISTS idx_ab_grants_ministry ON ab.ab_grants USING btree (ministry);
CREATE INDEX IF NOT EXISTS idx_ab_grants_payment_date ON ab.ab_grants USING btree (payment_date);
CREATE INDEX IF NOT EXISTS idx_ab_grants_prog_fiscal_year ON ab.ab_grants_programs USING btree (display_fiscal_year);
CREATE INDEX IF NOT EXISTS idx_ab_grants_prog_ministry ON ab.ab_grants_programs USING btree (ministry);
CREATE INDEX IF NOT EXISTS idx_ab_grants_prog_program ON ab.ab_grants_programs USING btree (program);
CREATE INDEX IF NOT EXISTS idx_ab_grants_program ON ab.ab_grants USING btree (program);
CREATE INDEX IF NOT EXISTS idx_ab_grants_recip_amount ON ab.ab_grants_recipients USING btree (payments_amount);
CREATE INDEX IF NOT EXISTS idx_ab_grants_recip_recipient ON ab.ab_grants_recipients USING btree (recipient);
CREATE INDEX IF NOT EXISTS idx_ab_grants_recipient ON ab.ab_grants USING btree (recipient);
CREATE INDEX IF NOT EXISTS idx_ab_grants_recipient_tsvector ON ab.ab_grants USING gin (to_tsvector('english'::regconfig, COALESCE(recipient, ''::text)));
CREATE INDEX IF NOT EXISTS idx_ab_non_profit_city ON ab.ab_non_profit USING btree (city);
CREATE INDEX IF NOT EXISTS idx_ab_non_profit_legal_name ON ab.ab_non_profit USING btree (legal_name);
CREATE INDEX IF NOT EXISTS idx_ab_non_profit_name_tsvector ON ab.ab_non_profit USING gin (to_tsvector('english'::regconfig, COALESCE(legal_name, ''::text)));
CREATE INDEX IF NOT EXISTS idx_ab_non_profit_postal_code ON ab.ab_non_profit USING btree (postal_code);
CREATE INDEX IF NOT EXISTS idx_ab_non_profit_reg_date ON ab.ab_non_profit USING btree (registration_date);
CREATE INDEX IF NOT EXISTS idx_ab_non_profit_status ON ab.ab_non_profit USING btree (status);
CREATE INDEX IF NOT EXISTS idx_ab_non_profit_type ON ab.ab_non_profit USING btree (type);
CREATE INDEX IF NOT EXISTS idx_ab_sole_source_amount ON ab.ab_sole_source USING btree (amount);
CREATE INDEX IF NOT EXISTS idx_ab_sole_source_fiscal_year ON ab.ab_sole_source USING btree (display_fiscal_year);
CREATE INDEX IF NOT EXISTS idx_ab_sole_source_ministry ON ab.ab_sole_source USING btree (ministry);
CREATE INDEX IF NOT EXISTS idx_ab_sole_source_start_date ON ab.ab_sole_source USING btree (start_date);
CREATE INDEX IF NOT EXISTS idx_ab_sole_source_vendor ON ab.ab_sole_source USING btree (vendor);
CREATE INDEX IF NOT EXISTS idx_ab_sole_source_vendor_tsvector ON ab.ab_sole_source USING gin (to_tsvector('english'::regconfig, COALESCE(vendor, ''::text)));
CREATE INDEX IF NOT EXISTS idx_trgm_ab_contracts_recipient ON ab.ab_contracts USING gin (upper(recipient) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_trgm_ab_grants_recipient ON ab.ab_grants USING gin (upper(recipient) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_trgm_ab_non_profit_legal_name ON ab.ab_non_profit USING gin (upper(legal_name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_trgm_ab_sole_source_vendor ON ab.ab_sole_source USING gin (upper(vendor) gin_trgm_ops);

-- Views
CREATE OR REPLACE VIEW ab.vw_grants_by_ministry AS
SELECT display_fiscal_year,
    ministry,
    count(*) AS payment_count,
    sum(amount) AS total_amount,
    avg(amount) AS avg_amount,
    min(amount) AS min_amount,
    max(amount) AS max_amount
   FROM ab.ab_grants
  GROUP BY display_fiscal_year, ministry
  ORDER BY display_fiscal_year, (sum(amount)) DESC;;

CREATE OR REPLACE VIEW ab.vw_grants_by_recipient AS
SELECT recipient,
    count(*) AS payment_count,
    sum(amount) AS total_amount,
    count(DISTINCT display_fiscal_year) AS fiscal_years_active,
    count(DISTINCT ministry) AS ministries_count,
    count(DISTINCT program) AS programs_count
   FROM ab.ab_grants
  GROUP BY recipient
  ORDER BY (sum(amount)) DESC;;

CREATE OR REPLACE VIEW ab.vw_non_profit_decoded AS
SELECT np.id,
    np.type,
    np.legal_name,
    np.status,
    np.registration_date,
    np.city,
    np.postal_code,
    sl.description AS status_description
   FROM (ab.ab_non_profit np
     LEFT JOIN ab.ab_non_profit_status_lookup sl ON ((lower(np.status) = lower(sl.status))));;
