-- Schema: general
-- Exported: 2026-04-21T19:20:28.625Z
-- This file is pre-data DDL. Apply this, load the JSONL under data/general/,
-- then apply general_post.sql for constraints + sequence sync.

-- Extensions (safe to re-apply; needed by function-backed indexes)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;

CREATE SCHEMA IF NOT EXISTS general;

-- Sequences
CREATE SEQUENCE IF NOT EXISTS general.donee_trigram_candidates_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 NO CYCLE;
CREATE SEQUENCE IF NOT EXISTS general.entities_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 NO CYCLE;
CREATE SEQUENCE IF NOT EXISTS general.entity_merge_candidates_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 NO CYCLE;
CREATE SEQUENCE IF NOT EXISTS general.entity_merges_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 NO CYCLE;
CREATE SEQUENCE IF NOT EXISTS general.entity_resolution_log_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 NO CYCLE;
CREATE SEQUENCE IF NOT EXISTS general.entity_source_links_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 NO CYCLE;
CREATE SEQUENCE IF NOT EXISTS general.ministries_crosswalk_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 NO CYCLE;
CREATE SEQUENCE IF NOT EXISTS general.ministries_history_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 NO CYCLE;
CREATE SEQUENCE IF NOT EXISTS general.ministries_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 NO CYCLE;
CREATE SEQUENCE IF NOT EXISTS general.resolution_batches_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 NO CYCLE;
CREATE SEQUENCE IF NOT EXISTS general.splink_aliases_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 NO CYCLE;
CREATE SEQUENCE IF NOT EXISTS general.splink_build_metadata_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 NO CYCLE;
CREATE SEQUENCE IF NOT EXISTS general.splink_predictions_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 NO CYCLE;

CREATE TABLE IF NOT EXISTS general.donee_trigram_candidates (
  id integer DEFAULT nextval('general.donee_trigram_candidates_id_seq'::regclass) NOT NULL,
  donee_name text NOT NULL,
  donee_name_norm text NOT NULL,
  candidate_entity_id integer NOT NULL,
  candidate_canonical_name text NOT NULL,
  candidate_bn_root character varying(9),
  similarity numeric(4,3) NOT NULL,
  citations integer DEFAULT 0 NOT NULL,
  total_gifts numeric(18,2),
  status text DEFAULT 'pending'::text NOT NULL,
  llm_verdict text,
  llm_confidence numeric(3,2),
  llm_reasoning text,
  reviewed_at timestamp without time zone,
  applied_at timestamp without time zone,
  created_at timestamp without time zone DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS general.entities (
  id integer DEFAULT nextval('general.entities_id_seq'::regclass) NOT NULL,
  canonical_name text NOT NULL,
  alternate_names text[] DEFAULT '{}'::text[],
  entity_type text DEFAULT 'unknown'::text,
  bn_root character varying(9),
  bn_variants text[] DEFAULT '{}'::text[],
  metadata jsonb DEFAULT '{}'::jsonb,
  source_count integer DEFAULT 0,
  dataset_sources text[] DEFAULT '{}'::text[],
  confidence numeric(4,3) DEFAULT 0,
  status text DEFAULT 'draft'::text,
  reviewed_by text,
  llm_review jsonb,
  created_at timestamp without time zone DEFAULT now(),
  updated_at timestamp without time zone DEFAULT now(),
  merged_into integer,
  norm_canonical text,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS general.entity_golden_records (
  id integer NOT NULL,
  canonical_name text NOT NULL,
  norm_name text,
  entity_type text,
  bn_root character varying(9),
  bn_variants text[] DEFAULT '{}'::text[],
  aliases jsonb DEFAULT '[]'::jsonb,
  dataset_sources text[] DEFAULT '{}'::text[],
  source_summary jsonb DEFAULT '{}'::jsonb,
  source_link_count integer DEFAULT 0,
  addresses jsonb DEFAULT '[]'::jsonb,
  cra_profile jsonb,
  fed_profile jsonb,
  ab_profile jsonb,
  related_entities jsonb DEFAULT '[]'::jsonb,
  merge_history jsonb DEFAULT '[]'::jsonb,
  llm_authored jsonb,
  confidence numeric(4,3) DEFAULT 0,
  status text DEFAULT 'active'::text,
  created_at timestamp without time zone DEFAULT now(),
  updated_at timestamp without time zone DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS general.entity_merge_candidates (
  id integer DEFAULT nextval('general.entity_merge_candidates_id_seq'::regclass) NOT NULL,
  entity_id_a integer NOT NULL,
  entity_id_b integer NOT NULL,
  candidate_method text NOT NULL,
  similarity_score numeric(4,3),
  status text DEFAULT 'pending'::text,
  llm_verdict text,
  llm_confidence numeric(4,3),
  llm_reasoning text,
  llm_response jsonb,
  llm_provider text,
  llm_tokens_in integer,
  llm_tokens_out integer,
  batch_id integer,
  reviewed_at timestamp without time zone,
  created_at timestamp without time zone DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS general.entity_merges (
  id integer DEFAULT nextval('general.entity_merges_id_seq'::regclass) NOT NULL,
  survivor_id integer NOT NULL,
  absorbed_id integer NOT NULL,
  candidate_id integer,
  merge_method text NOT NULL,
  names_added text[],
  bns_added text[],
  metadata_merged jsonb,
  links_redirected integer DEFAULT 0,
  merged_at timestamp without time zone DEFAULT now(),
  merged_by text DEFAULT 'pipeline'::text,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS general.entity_resolution_log (
  id integer DEFAULT nextval('general.entity_resolution_log_id_seq'::regclass) NOT NULL,
  source_schema text NOT NULL,
  source_table text NOT NULL,
  source_name text NOT NULL,
  original_names text[],
  bn text,
  record_count integer DEFAULT 1,
  status text DEFAULT 'pending'::text,
  entity_id integer,
  match_confidence numeric(4,3),
  match_method text,
  candidates jsonb,
  llm_response jsonb,
  error_message text,
  batch_id integer,
  created_at timestamp without time zone DEFAULT now(),
  updated_at timestamp without time zone DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS general.entity_source_links (
  id integer DEFAULT nextval('general.entity_source_links_id_seq'::regclass) NOT NULL,
  entity_id integer NOT NULL,
  source_schema text NOT NULL,
  source_table text NOT NULL,
  source_pk jsonb NOT NULL,
  source_name text,
  match_confidence numeric(4,3),
  match_method text,
  link_status text DEFAULT 'confirmed'::text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp without time zone DEFAULT now(),
  updated_at timestamp without time zone DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS general.ministries (
  id integer DEFAULT nextval('general.ministries_id_seq'::regclass) NOT NULL,
  short_name character varying(20) NOT NULL,
  name text NOT NULL,
  description text,
  minister text,
  deputy_minister text,
  effective_from date,
  effective_to date,
  is_active boolean DEFAULT true,
  created_at timestamp without time zone DEFAULT now(),
  updated_at timestamp without time zone DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS general.ministries_crosswalk (
  id integer DEFAULT nextval('general.ministries_crosswalk_id_seq'::regclass) NOT NULL,
  raw_ministry text NOT NULL,
  normalized_ministry text NOT NULL,
  canonical_short_name character varying(60) NOT NULL,
  historical_short_name character varying(60),
  confidence text NOT NULL,
  transform_note text,
  created_at timestamp without time zone DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS general.ministries_history (
  id integer DEFAULT nextval('general.ministries_history_id_seq'::regclass) NOT NULL,
  short_name character varying(60) NOT NULL,
  canonical_name text NOT NULL,
  effective_from date,
  effective_to date,
  predecessors text[],
  successors text[],
  mandate_summary text,
  aliases text[],
  is_active boolean DEFAULT false,
  source_citation text,
  created_at timestamp without time zone DEFAULT now(),
  updated_at timestamp without time zone DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS general.resolution_batches (
  id integer DEFAULT nextval('general.resolution_batches_id_seq'::regclass) NOT NULL,
  started_at timestamp without time zone DEFAULT now(),
  completed_at timestamp without time zone,
  source_description text,
  status text DEFAULT 'running'::text,
  total_records integer DEFAULT 0,
  processed_records integer DEFAULT 0,
  matched_records integer DEFAULT 0,
  created_records integer DEFAULT 0,
  llm_reviewed integer DEFAULT 0,
  error_records integer DEFAULT 0,
  config jsonb DEFAULT '{}'::jsonb,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS general.splink_aliases (
  id integer DEFAULT nextval('general.splink_aliases_id_seq'::regclass) NOT NULL,
  cluster_id text NOT NULL,
  alias text NOT NULL,
  source_dataset text,
  source_id text,
  match_probability numeric(6,5),
  build_id integer,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS general.splink_build_metadata (
  id integer DEFAULT nextval('general.splink_build_metadata_id_seq'::regclass) NOT NULL,
  started_at timestamp without time zone DEFAULT now(),
  completed_at timestamp without time zone,
  splink_version text,
  backend text DEFAULT 'duckdb'::text,
  threshold numeric(3,2),
  total_records integer,
  total_predictions integer,
  total_clusters integer,
  config jsonb DEFAULT '{}'::jsonb,
  status text DEFAULT 'running'::text,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS general.splink_predictions (
  id integer DEFAULT nextval('general.splink_predictions_id_seq'::regclass) NOT NULL,
  source_l text NOT NULL,
  record_l text NOT NULL,
  source_r text NOT NULL,
  record_r text NOT NULL,
  match_probability numeric(6,5) NOT NULL,
  match_weight numeric(10,6),
  features jsonb DEFAULT '{}'::jsonb,
  cluster_id text,
  build_id integer,
  created_at timestamp without time zone DEFAULT now(),
  PRIMARY KEY (id)
);

-- User-defined functions
CREATE OR REPLACE FUNCTION general.array_upper_join(arr text[])
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$
  SELECT UPPER(array_to_string(arr, ' '));
$function$;

CREATE OR REPLACE FUNCTION general.extract_bn_root(raw_bn text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE clean TEXT; root TEXT;
BEGIN
  IF raw_bn IS NULL THEN RETURN NULL; END IF;
  clean := regexp_replace(raw_bn, '[^0-9]', '', 'g');
  IF LENGTH(clean) < 9 THEN RETURN NULL; END IF;
  root := LEFT(clean, 9);
  IF NOT general.is_valid_bn_root(root) THEN RETURN NULL; END IF;
  RETURN root;
END;
$function$;

CREATE OR REPLACE FUNCTION general.is_valid_bn_root(bn_root text)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
BEGIN
  IF bn_root IS NULL THEN RETURN FALSE; END IF;
  -- MUST be exactly 9 digits — no spaces, no letters, no punctuation.
  -- Source data routinely contains malformed BNs like "88933 204", "12975471R",
  -- "R10698752", "0841-0189". These must be rejected, not truncated.
  IF bn_root !~ '^[0-9]{9}$' THEN RETURN FALSE; END IF;
  -- Pattern X00000000: any leading digit followed by 8 zeros.
  IF bn_root ~ '^[0-9]0{8}$' THEN RETURN FALSE; END IF;
  -- Leading 3+ zeros (000xxxxxx, 0000xxxxx, etc.)
  IF bn_root ~ '^0{3,}' THEN RETURN FALSE; END IF;
  RETURN TRUE;
END;
$function$;

CREATE OR REPLACE FUNCTION general.norm_name(name text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE STRICT
AS $function$
DECLARE n TEXT;
BEGIN
  n := COALESCE(name, '');

  -- 1. Strip bilingual / duplicate-separator tails: "X | Y", "X │ Y", "X / Y".
  --    Canadian gov data typically puts English first, so keep left side.
  --    Require at least one space around the separator (avoid mangling paths,
  --    slash-containing names like "A/B Testing").
  n := regexp_replace(n, E'\\s+[│|]\\s+.*$',  '');
  n := regexp_replace(n, E'\\s+/\\s+.*$',      '');
  n := regexp_replace(n, E'\\s*[│|].*$',       '');   -- fallback: no-space pipe

  -- 2. Uppercase and trim — downstream processing is case-insensitive.
  n := UPPER(TRIM(n));

  -- 3. Strip operational / trade-name tails. These phrases introduce an alternate
  --    name that the entity does business under; the legal name before the tag is
  --    the canonical identifier.
  --    Covers: TRADE NAME OF, O/A, D/B/A, DBA, DOING BUSINESS AS, OPERATING AS,
  --    TRADING AS, ASSUMED NAME (AKA ...), AKA, FORMERLY, F/K/A, T/A.
  n := regexp_replace(n,
    E'\\s+(TRADE\\s+NAME\\s+OF|O\\s*/\\s*A|D\\s*/\\s*B\\s*/\\s*A|DBA|' ||
    E'DOING\\s+BUSINESS\\s+AS|OPERATING\\s+AS|TRADING\\s+AS|T\\s*/\\s*A|' ||
    E'ASSUMED\\s+NAME|AKA|A\\.K\\.A\\.|FORMERLY|F\\s*/\\s*K\\s*/\\s*A)\\M.*$',
    '');

  -- 4. Strip trailing "(THE)" and leading "THE " — purely grammatical, not identifying.
  n := regexp_replace(n, E'\\(THE\\)\\s*$', '');
  n := regexp_replace(n, E'^THE\\s+', '');

  -- 5. Strip trailing punctuation artifacts like ", ." or ",."
  n := regexp_replace(n, E'[,\\s]+\\.\\s*$', '');

  -- 6. Replace punctuation with spaces so "ST. ANDREW'S" and "ST ANDREWS" match.
  n := regexp_replace(n, E'[.,;:\x27"()\\-/\\\\#&!@\x60]+', ' ', 'g');

  -- 7. Collapse any run of whitespace into a single space.
  n := regexp_replace(n, E'\\s{2,}', ' ', 'g');

  n := TRIM(n);
  RETURN n;
END;
$function$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_donee_trigram_entity ON general.donee_trigram_candidates USING btree (candidate_entity_id);
CREATE INDEX IF NOT EXISTS idx_donee_trigram_status ON general.donee_trigram_candidates USING btree (status);
CREATE INDEX IF NOT EXISTS idx_entities_active_name_trgm ON general.entities USING gin (upper(canonical_name) gin_trgm_ops) WHERE (merged_into IS NULL);
CREATE INDEX IF NOT EXISTS idx_entities_alt_names ON general.entities USING gin (alternate_names);
CREATE INDEX IF NOT EXISTS idx_entities_alt_names_trgm ON general.entities USING gin (general.array_upper_join(alternate_names) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_entities_bn_root ON general.entities USING btree (bn_root);
CREATE INDEX IF NOT EXISTS idx_entities_bn_root_trgm ON general.entities USING gin (bn_root gin_trgm_ops) WHERE (bn_root IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_entities_bn_variants ON general.entities USING gin (bn_variants);
CREATE INDEX IF NOT EXISTS idx_entities_canonical_name ON general.entities USING btree (canonical_name);
CREATE INDEX IF NOT EXISTS idx_entities_confidence ON general.entities USING btree (confidence);
CREATE INDEX IF NOT EXISTS idx_entities_dataset_sources ON general.entities USING gin (dataset_sources);
CREATE INDEX IF NOT EXISTS idx_entities_merged_into ON general.entities USING btree (merged_into);
CREATE INDEX IF NOT EXISTS idx_entities_metadata ON general.entities USING gin (metadata jsonb_path_ops);
CREATE INDEX IF NOT EXISTS idx_entities_norm_canonical ON general.entities USING btree (norm_canonical);
CREATE INDEX IF NOT EXISTS idx_entities_norm_canonical_trgm ON general.entities USING gin (norm_canonical gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_entities_norm_name ON general.entities USING btree (general.norm_name(canonical_name));
CREATE INDEX IF NOT EXISTS idx_entities_status ON general.entities USING btree (status);
CREATE INDEX IF NOT EXISTS idx_entities_trgm_name ON general.entities USING gin (upper(canonical_name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_entities_type ON general.entities USING btree (entity_type);
CREATE INDEX IF NOT EXISTS idx_entities_upper_canonical ON general.entities USING btree (upper(canonical_name));
CREATE INDEX IF NOT EXISTS idx_gen_ministries_active ON general.ministries USING btree (is_active);
CREATE INDEX IF NOT EXISTS idx_gen_ministries_name ON general.ministries USING btree (name);
CREATE INDEX IF NOT EXISTS idx_gen_ministries_short_name ON general.ministries USING btree (short_name);
CREATE INDEX IF NOT EXISTS idx_gr_bn ON general.entity_golden_records USING btree (bn_root);
CREATE INDEX IF NOT EXISTS idx_gr_canonical ON general.entity_golden_records USING btree (canonical_name);
CREATE INDEX IF NOT EXISTS idx_gr_ds ON general.entity_golden_records USING gin (dataset_sources);
CREATE INDEX IF NOT EXISTS idx_gr_norm ON general.entity_golden_records USING btree (norm_name);
CREATE INDEX IF NOT EXISTS idx_gr_status ON general.entity_golden_records USING btree (status);
CREATE INDEX IF NOT EXISTS idx_gr_trgm ON general.entity_golden_records USING gin (upper(canonical_name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_gr_type ON general.entity_golden_records USING btree (entity_type);
CREATE INDEX IF NOT EXISTS idx_mcw_canonical ON general.ministries_crosswalk USING btree (canonical_short_name);
CREATE INDEX IF NOT EXISTS idx_mcw_raw ON general.ministries_crosswalk USING btree (raw_ministry);
CREATE INDEX IF NOT EXISTS idx_merge_cand_a ON general.entity_merge_candidates USING btree (entity_id_a);
CREATE INDEX IF NOT EXISTS idx_merge_cand_b ON general.entity_merge_candidates USING btree (entity_id_b);
CREATE INDEX IF NOT EXISTS idx_merge_cand_batch ON general.entity_merge_candidates USING btree (batch_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_merge_cand_pair ON general.entity_merge_candidates USING btree (LEAST(entity_id_a, entity_id_b), GREATEST(entity_id_a, entity_id_b));
CREATE INDEX IF NOT EXISTS idx_merge_cand_status ON general.entity_merge_candidates USING btree (status);
CREATE INDEX IF NOT EXISTS idx_merges_absorbed ON general.entity_merges USING btree (absorbed_id);
CREATE INDEX IF NOT EXISTS idx_merges_survivor ON general.entity_merges USING btree (survivor_id);
CREATE INDEX IF NOT EXISTS idx_mh_active ON general.ministries_history USING btree (is_active);
CREATE INDEX IF NOT EXISTS idx_mh_short_name ON general.ministries_history USING btree (short_name);
CREATE INDEX IF NOT EXISTS idx_resolution_log_batch ON general.entity_resolution_log USING btree (batch_id);
CREATE INDEX IF NOT EXISTS idx_resolution_log_entity ON general.entity_resolution_log USING btree (entity_id);
CREATE INDEX IF NOT EXISTS idx_resolution_log_status ON general.entity_resolution_log USING btree (status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_resolution_log_unique ON general.entity_resolution_log USING btree (source_schema, source_table, source_name);
CREATE INDEX IF NOT EXISTS idx_source_links_entity ON general.entity_source_links USING btree (entity_id);
CREATE INDEX IF NOT EXISTS idx_source_links_pk ON general.entity_source_links USING gin (source_pk jsonb_path_ops);
CREATE INDEX IF NOT EXISTS idx_source_links_source ON general.entity_source_links USING btree (source_schema, source_table);
CREATE INDEX IF NOT EXISTS idx_source_links_status ON general.entity_source_links USING btree (link_status);
CREATE INDEX IF NOT EXISTS idx_splink_alias_cluster ON general.splink_aliases USING btree (cluster_id);
CREATE INDEX IF NOT EXISTS idx_splink_pred_cluster ON general.splink_predictions USING btree (cluster_id);
CREATE INDEX IF NOT EXISTS idx_splink_pred_l ON general.splink_predictions USING btree (source_l, record_l);
CREATE INDEX IF NOT EXISTS idx_splink_pred_prob ON general.splink_predictions USING btree (match_probability);
CREATE INDEX IF NOT EXISTS idx_splink_pred_r ON general.splink_predictions USING btree (source_r, record_r);

-- Views
CREATE OR REPLACE VIEW general.vw_entity_funding AS
WITH cra_funds AS (
         SELECT e_1.id AS entity_id,
            sum(fd.field_4700) AS total_revenue,
            sum(fd.field_5100) AS total_expenditures,
            sum(fd.field_5050) AS gifts_to_donees,
            sum(fd.field_5000) AS program_spending,
            count(DISTINCT fd.fpe) AS filing_count,
            (min(EXTRACT(year FROM fd.fpe)))::integer AS earliest_year,
            (max(EXTRACT(year FROM fd.fpe)))::integer AS latest_year
           FROM (general.entities e_1
             JOIN cra.cra_financial_details fd ON (("left"((fd.bn)::text, 9) = (e_1.bn_root)::text)))
          WHERE (e_1.bn_root IS NOT NULL)
          GROUP BY e_1.id
        ), fed_funds AS (
         SELECT esl.entity_id,
            sum(gc.agreement_value) AS total_grants,
            count(*) AS grant_count,
            min(gc.agreement_start_date) AS earliest_grant,
            max(gc.agreement_start_date) AS latest_grant
           FROM (general.entity_source_links esl
             JOIN fed.grants_contributions gc ON ((gc._id = ((esl.source_pk ->> '_id'::text))::integer)))
          WHERE ((esl.source_schema = 'fed'::text) AND (esl.source_table = 'grants_contributions'::text))
          GROUP BY esl.entity_id
        ), ab_grants_funds AS (
         SELECT esl.entity_id,
            sum(g.amount) AS total_grants,
            count(*) AS payment_count
           FROM (general.entity_source_links esl
             JOIN ab.ab_grants g ON ((g.id = ((esl.source_pk ->> 'id'::text))::integer)))
          WHERE ((esl.source_schema = 'ab'::text) AND (esl.source_table = 'ab_grants'::text))
          GROUP BY esl.entity_id
        ), ab_contracts_funds AS (
         SELECT esl.entity_id,
            sum(c.amount) AS total_contracts,
            count(*) AS contract_count
           FROM (general.entity_source_links esl
             JOIN ab.ab_contracts c ON ((c.id = ((esl.source_pk ->> 'id'::text))::uuid)))
          WHERE ((esl.source_schema = 'ab'::text) AND (esl.source_table = 'ab_contracts'::text))
          GROUP BY esl.entity_id
        ), ab_sole_source_funds AS (
         SELECT esl.entity_id,
            sum(ss.amount) AS total_sole_source,
            count(*) AS sole_source_count
           FROM (general.entity_source_links esl
             JOIN ab.ab_sole_source ss ON ((ss.id = ((esl.source_pk ->> 'id'::text))::uuid)))
          WHERE ((esl.source_schema = 'ab'::text) AND (esl.source_table = 'ab_sole_source'::text))
          GROUP BY esl.entity_id
        )
 SELECT e.id AS entity_id,
    e.canonical_name,
    e.bn_root,
    e.entity_type,
    e.dataset_sources,
    e.source_count,
    e.confidence,
    e.status,
    COALESCE(cf.total_revenue, (0)::numeric) AS cra_total_revenue,
    COALESCE(cf.total_expenditures, (0)::numeric) AS cra_total_expenditures,
    COALESCE(cf.gifts_to_donees, (0)::numeric) AS cra_gifts_to_donees,
    COALESCE(cf.program_spending, (0)::numeric) AS cra_program_spending,
    cf.filing_count AS cra_filing_count,
    cf.earliest_year AS cra_earliest_year,
    cf.latest_year AS cra_latest_year,
    COALESCE(ff.total_grants, (0)::numeric) AS fed_total_grants,
    ff.grant_count AS fed_grant_count,
    ff.earliest_grant AS fed_earliest_grant,
    ff.latest_grant AS fed_latest_grant,
    COALESCE(agf.total_grants, (0)::numeric) AS ab_total_grants,
    agf.payment_count AS ab_grant_payment_count,
    COALESCE(acf.total_contracts, (0)::numeric) AS ab_total_contracts,
    acf.contract_count AS ab_contract_count,
    COALESCE(assf.total_sole_source, (0)::numeric) AS ab_total_sole_source,
    assf.sole_source_count AS ab_sole_source_count,
    ((((COALESCE(cf.total_revenue, (0)::numeric) + COALESCE(ff.total_grants, (0)::numeric)) + COALESCE(agf.total_grants, (0)::numeric)) + COALESCE(acf.total_contracts, (0)::numeric)) + COALESCE(assf.total_sole_source, (0)::numeric)) AS total_all_funding
   FROM (((((general.entities e
     LEFT JOIN cra_funds cf ON ((cf.entity_id = e.id)))
     LEFT JOIN fed_funds ff ON ((ff.entity_id = e.id)))
     LEFT JOIN ab_grants_funds agf ON ((agf.entity_id = e.id)))
     LEFT JOIN ab_contracts_funds acf ON ((acf.entity_id = e.id)))
     LEFT JOIN ab_sole_source_funds assf ON ((assf.entity_id = e.id)))
  WHERE (e.merged_into IS NULL);;

CREATE OR REPLACE VIEW general.vw_entity_search AS
SELECT id,
    canonical_name,
    alternate_names,
    entity_type,
    bn_root,
    bn_variants,
    metadata,
    source_count,
    dataset_sources,
    confidence,
    status
   FROM general.entities e;;
