-- Schema: fed
-- Exported: 2026-04-21T19:20:26.371Z
-- This file is pre-data DDL. Apply this, load the JSONL under data/fed/,
-- then apply fed_post.sql for constraints + sequence sync.

-- Extensions (safe to re-apply; needed by function-backed indexes)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;

CREATE SCHEMA IF NOT EXISTS fed;

CREATE TABLE IF NOT EXISTS fed.agreement_type_lookup (
  code character varying(2) NOT NULL,
  name_en text NOT NULL,
  name_fr text,
  PRIMARY KEY (code)
);

CREATE TABLE IF NOT EXISTS fed.country_lookup (
  code character varying(4) NOT NULL,
  name_en text NOT NULL,
  name_fr text,
  PRIMARY KEY (code)
);

CREATE TABLE IF NOT EXISTS fed.currency_lookup (
  code character varying(4) NOT NULL,
  name_en text NOT NULL,
  name_fr text,
  PRIMARY KEY (code)
);

CREATE TABLE IF NOT EXISTS fed.grants_contributions (
  _id integer NOT NULL,
  ref_number text,
  amendment_number text,
  amendment_date date,
  agreement_type text,
  agreement_number text,
  recipient_type text,
  recipient_business_number text,
  recipient_legal_name text,
  recipient_operating_name text,
  research_organization_name text,
  recipient_country text,
  recipient_province text,
  recipient_city text,
  recipient_postal_code text,
  federal_riding_name_en text,
  federal_riding_name_fr text,
  federal_riding_number text,
  prog_name_en text,
  prog_name_fr text,
  prog_purpose_en text,
  prog_purpose_fr text,
  agreement_title_en text,
  agreement_title_fr text,
  agreement_value numeric(15,2),
  foreign_currency_type text,
  foreign_currency_value numeric(15,2),
  agreement_start_date date,
  agreement_end_date date,
  coverage text,
  description_en text,
  description_fr text,
  expected_results_en text,
  expected_results_fr text,
  additional_information_en text,
  additional_information_fr text,
  naics_identifier text,
  owner_org text,
  owner_org_title text,
  is_amendment boolean DEFAULT false,
  PRIMARY KEY (_id)
);

CREATE TABLE IF NOT EXISTS fed.province_lookup (
  code character varying(4) NOT NULL,
  name_en text NOT NULL,
  name_fr text,
  PRIMARY KEY (code)
);

CREATE TABLE IF NOT EXISTS fed.recipient_type_lookup (
  code character varying(2) NOT NULL,
  name_en text NOT NULL,
  name_fr text,
  PRIMARY KEY (code)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_fed_gc_agreement_type ON fed.grants_contributions USING btree (agreement_type);
CREATE INDEX IF NOT EXISTS idx_fed_gc_country ON fed.grants_contributions USING btree (recipient_country);
CREATE INDEX IF NOT EXISTS idx_fed_gc_end_date ON fed.grants_contributions USING btree (agreement_end_date);
CREATE INDEX IF NOT EXISTS idx_fed_gc_is_amendment ON fed.grants_contributions USING btree (is_amendment);
CREATE INDEX IF NOT EXISTS idx_fed_gc_naics ON fed.grants_contributions USING btree (naics_identifier);
CREATE INDEX IF NOT EXISTS idx_fed_gc_owner_org ON fed.grants_contributions USING btree (owner_org);
CREATE INDEX IF NOT EXISTS idx_fed_gc_program_name ON fed.grants_contributions USING gin (to_tsvector('english'::regconfig, COALESCE(prog_name_en, ''::text)));
CREATE INDEX IF NOT EXISTS idx_fed_gc_province ON fed.grants_contributions USING btree (recipient_province);
CREATE INDEX IF NOT EXISTS idx_fed_gc_recipient_name ON fed.grants_contributions USING gin (to_tsvector('english'::regconfig, COALESCE(recipient_legal_name, ''::text)));
CREATE INDEX IF NOT EXISTS idx_fed_gc_recipient_type ON fed.grants_contributions USING btree (recipient_type);
CREATE INDEX IF NOT EXISTS idx_fed_gc_riding ON fed.grants_contributions USING btree (federal_riding_number);
CREATE INDEX IF NOT EXISTS idx_fed_gc_start_date ON fed.grants_contributions USING btree (agreement_start_date);
CREATE INDEX IF NOT EXISTS idx_fed_gc_upper_trim_name ON fed.grants_contributions USING btree (upper(TRIM(BOTH FROM recipient_legal_name)));
CREATE INDEX IF NOT EXISTS idx_fed_gc_value ON fed.grants_contributions USING btree (agreement_value);
CREATE INDEX IF NOT EXISTS idx_trgm_fed_gc_recipient ON fed.grants_contributions USING gin (upper(recipient_legal_name) gin_trgm_ops);

-- Views
CREATE OR REPLACE VIEW fed.vw_grants_by_department AS
SELECT owner_org,
    owner_org_title,
    agreement_type,
    count(*) AS grant_count,
    sum(agreement_value) AS total_value,
    avg(agreement_value) AS avg_value,
    min(agreement_start_date) AS earliest_start,
    max(agreement_start_date) AS latest_start
   FROM fed.grants_contributions
  GROUP BY owner_org, owner_org_title, agreement_type
  ORDER BY (sum(agreement_value)) DESC NULLS LAST;;

CREATE OR REPLACE VIEW fed.vw_grants_by_province AS
SELECT gc.recipient_province,
    pl.name_en AS province_name,
    count(*) AS grant_count,
    sum(gc.agreement_value) AS total_value,
    avg(gc.agreement_value) AS avg_value,
    count(DISTINCT gc.owner_org) AS department_count
   FROM (fed.grants_contributions gc
     LEFT JOIN fed.province_lookup pl ON ((gc.recipient_province = (pl.code)::text)))
  WHERE (gc.recipient_province IS NOT NULL)
  GROUP BY gc.recipient_province, pl.name_en
  ORDER BY (sum(gc.agreement_value)) DESC NULLS LAST;;

CREATE OR REPLACE VIEW fed.vw_grants_decoded AS
SELECT gc._id,
    gc.ref_number,
    gc.amendment_number,
    gc.amendment_date,
    gc.agreement_type,
    atl.name_en AS agreement_type_name,
    gc.agreement_number,
    gc.recipient_type,
    rtl.name_en AS recipient_type_name,
    gc.recipient_business_number,
    gc.recipient_legal_name,
    gc.recipient_operating_name,
    gc.research_organization_name,
    gc.recipient_country,
    cl.name_en AS country_name,
    gc.recipient_province,
    pl.name_en AS province_name,
    gc.recipient_city,
    gc.recipient_postal_code,
    gc.federal_riding_name_en,
    gc.federal_riding_number,
    gc.prog_name_en,
    gc.prog_purpose_en,
    gc.agreement_title_en,
    gc.agreement_value,
    gc.foreign_currency_type,
    gc.foreign_currency_value,
    gc.agreement_start_date,
    gc.agreement_end_date,
    gc.coverage,
    gc.description_en,
    gc.expected_results_en,
    gc.additional_information_en,
    gc.naics_identifier,
    gc.owner_org,
    gc.owner_org_title
   FROM ((((fed.grants_contributions gc
     LEFT JOIN fed.agreement_type_lookup atl ON ((gc.agreement_type = (atl.code)::text)))
     LEFT JOIN fed.recipient_type_lookup rtl ON ((gc.recipient_type = (rtl.code)::text)))
     LEFT JOIN fed.country_lookup cl ON ((gc.recipient_country = (cl.code)::text)))
     LEFT JOIN fed.province_lookup pl ON ((gc.recipient_province = (pl.code)::text)));;
