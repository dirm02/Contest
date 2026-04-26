-- Schema: ab
-- Exported: 2026-04-21T19:20:27.355Z
-- This file is pre-data DDL. Apply this, load the JSONL under data/ab/,
-- then apply ab_post.sql for constraints + sequence sync.

-- Extensions (safe to re-apply; needed by function-backed indexes)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;

CREATE SCHEMA IF NOT EXISTS ab;

-- Sequences
CREATE SEQUENCE IF NOT EXISTS ab.ab_grants_fiscal_years_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 NO CYCLE;
CREATE SEQUENCE IF NOT EXISTS ab.ab_grants_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 NO CYCLE;
CREATE SEQUENCE IF NOT EXISTS ab.ab_grants_ministries_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 NO CYCLE;
CREATE SEQUENCE IF NOT EXISTS ab.ab_grants_programs_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 NO CYCLE;
CREATE SEQUENCE IF NOT EXISTS ab.ab_grants_recipients_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 NO CYCLE;
CREATE SEQUENCE IF NOT EXISTS ab.ab_non_profit_status_lookup_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 NO CYCLE;

CREATE TABLE IF NOT EXISTS ab.ab_contracts (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  display_fiscal_year text,
  recipient text,
  amount numeric(15,2),
  ministry text,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS ab.ab_grants (
  id integer DEFAULT nextval('ab.ab_grants_id_seq'::regclass) NOT NULL,
  ministry text,
  business_unit_name text,
  recipient text,
  program text,
  amount numeric(15,2),
  lottery text,
  payment_date timestamp without time zone,
  fiscal_year text,
  display_fiscal_year text,
  lottery_fund text,
  version integer,
  created_at timestamp without time zone,
  updated_at timestamp without time zone,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS ab.ab_grants_fiscal_years (
  id integer DEFAULT nextval('ab.ab_grants_fiscal_years_id_seq'::regclass) NOT NULL,
  mongo_id character varying(255),
  display_fiscal_year text,
  count integer,
  total_amount numeric(20,2),
  last_updated timestamp without time zone,
  version integer,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS ab.ab_grants_ministries (
  id integer DEFAULT nextval('ab.ab_grants_ministries_id_seq'::regclass) NOT NULL,
  mongo_id character varying(255),
  ministry text,
  display_fiscal_year text,
  aggregation_type text,
  count integer,
  total_amount numeric(20,2),
  last_updated timestamp without time zone,
  version integer,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS ab.ab_grants_programs (
  id integer DEFAULT nextval('ab.ab_grants_programs_id_seq'::regclass) NOT NULL,
  mongo_id character varying(255),
  program text,
  ministry text,
  display_fiscal_year text,
  aggregation_type text,
  count integer,
  total_amount numeric(20,2),
  last_updated timestamp without time zone,
  version integer,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS ab.ab_grants_recipients (
  id integer DEFAULT nextval('ab.ab_grants_recipients_id_seq'::regclass) NOT NULL,
  mongo_id character varying(255),
  recipient text,
  payments_count integer,
  payments_amount numeric(20,2),
  programs_count integer,
  ministries_count integer,
  last_updated timestamp without time zone,
  version integer,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS ab.ab_non_profit (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  type text,
  legal_name text,
  status text,
  registration_date date,
  city text,
  postal_code text,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS ab.ab_non_profit_status_lookup (
  id integer DEFAULT nextval('ab.ab_non_profit_status_lookup_id_seq'::regclass) NOT NULL,
  status text NOT NULL,
  description text,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS ab.ab_sole_source (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  ministry text,
  department_street text,
  department_street_2 text,
  department_city text,
  department_province text,
  department_postal_code text,
  department_country text,
  vendor text,
  vendor_street text,
  vendor_street_2 text,
  vendor_city text,
  vendor_province text,
  vendor_postal_code text,
  vendor_country text,
  start_date date,
  end_date date,
  amount numeric(15,2),
  contract_number text,
  contract_services text,
  permitted_situations text,
  display_fiscal_year text,
  special text,
  PRIMARY KEY (id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ab_contracts_amount ON ab.ab_contracts USING btree (amount);
CREATE INDEX IF NOT EXISTS idx_ab_contracts_fiscal_year ON ab.ab_contracts USING btree (display_fiscal_year);
CREATE INDEX IF NOT EXISTS idx_ab_contracts_ministry ON ab.ab_contracts USING btree (ministry);
CREATE INDEX IF NOT EXISTS idx_ab_contracts_recipient ON ab.ab_contracts USING btree (recipient);
CREATE INDEX IF NOT EXISTS idx_ab_contracts_recipient_tsvector ON ab.ab_contracts USING gin (to_tsvector('english'::regconfig, COALESCE(recipient, ''::text)));
CREATE INDEX IF NOT EXISTS idx_ab_contracts_upper_trim_recipient ON ab.ab_contracts USING btree (upper(TRIM(BOTH FROM recipient)));
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
CREATE INDEX IF NOT EXISTS idx_ab_grants_upper_trim_recipient ON ab.ab_grants USING btree (upper(TRIM(BOTH FROM recipient)));
CREATE INDEX IF NOT EXISTS idx_ab_non_profit_city ON ab.ab_non_profit USING btree (city);
CREATE INDEX IF NOT EXISTS idx_ab_non_profit_legal_name ON ab.ab_non_profit USING btree (legal_name);
CREATE INDEX IF NOT EXISTS idx_ab_non_profit_name_tsvector ON ab.ab_non_profit USING gin (to_tsvector('english'::regconfig, COALESCE(legal_name, ''::text)));
CREATE INDEX IF NOT EXISTS idx_ab_non_profit_postal_code ON ab.ab_non_profit USING btree (postal_code);
CREATE INDEX IF NOT EXISTS idx_ab_non_profit_reg_date ON ab.ab_non_profit USING btree (registration_date);
CREATE INDEX IF NOT EXISTS idx_ab_non_profit_status ON ab.ab_non_profit USING btree (status);
CREATE INDEX IF NOT EXISTS idx_ab_non_profit_type ON ab.ab_non_profit USING btree (type);
CREATE INDEX IF NOT EXISTS idx_ab_non_profit_upper_trim_name ON ab.ab_non_profit USING btree (upper(TRIM(BOTH FROM legal_name)));
CREATE INDEX IF NOT EXISTS idx_ab_sole_source_amount ON ab.ab_sole_source USING btree (amount);
CREATE INDEX IF NOT EXISTS idx_ab_sole_source_fiscal_year ON ab.ab_sole_source USING btree (display_fiscal_year);
CREATE INDEX IF NOT EXISTS idx_ab_sole_source_ministry ON ab.ab_sole_source USING btree (ministry);
CREATE INDEX IF NOT EXISTS idx_ab_sole_source_start_date ON ab.ab_sole_source USING btree (start_date);
CREATE INDEX IF NOT EXISTS idx_ab_sole_source_upper_trim_vendor ON ab.ab_sole_source USING btree (upper(TRIM(BOTH FROM vendor)));
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
