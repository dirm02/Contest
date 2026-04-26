-- Schema: cra
-- Exported: 2026-04-21T19:20:21.015Z
-- This file is pre-data DDL. Apply this, load the JSONL under data/cra/,
-- then apply cra_post.sql for constraints + sequence sync.

-- Extensions (safe to re-apply; needed by function-backed indexes)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;

CREATE SCHEMA IF NOT EXISTS cra;

-- Sequences
CREATE SEQUENCE IF NOT EXISTS cra.johnson_cycles_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 NO CYCLE;
CREATE SEQUENCE IF NOT EXISTS cra.loops_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 NO CYCLE;
CREATE SEQUENCE IF NOT EXISTS cra.partitioned_cycles_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 NO CYCLE;

CREATE TABLE IF NOT EXISTS cra._dnq_canonical (
  bn character varying(15),
  legal_name text,
  nname text
);

CREATE TABLE IF NOT EXISTS cra.cra_activities_outside_countries (
  bn character varying(15) NOT NULL,
  fpe date NOT NULL,
  form_id integer,
  sequence_number integer NOT NULL,
  country character(2),
  PRIMARY KEY (bn, fpe, sequence_number)
);

CREATE TABLE IF NOT EXISTS cra.cra_activities_outside_details (
  bn character varying(15) NOT NULL,
  fpe date NOT NULL,
  form_id integer,
  field_200 numeric(18,2),
  field_210 boolean,
  field_220 boolean,
  field_230 text,
  field_240 boolean,
  field_250 boolean,
  field_260 boolean,
  PRIMARY KEY (bn, fpe)
);

CREATE TABLE IF NOT EXISTS cra.cra_category_lookup (
  code character varying(10) NOT NULL,
  name_en text NOT NULL,
  name_fr text,
  description_en text,
  description_fr text,
  PRIMARY KEY (code)
);

CREATE TABLE IF NOT EXISTS cra.cra_charitable_programs (
  bn character varying(15) NOT NULL,
  fpe date NOT NULL,
  form_id integer,
  program_type character varying(2) NOT NULL,
  description text,
  PRIMARY KEY (bn, fpe, program_type)
);

CREATE TABLE IF NOT EXISTS cra.cra_compensation (
  bn character varying(15) NOT NULL,
  fpe date NOT NULL,
  form_id integer,
  field_300 integer,
  field_305 integer,
  field_310 integer,
  field_315 integer,
  field_320 integer,
  field_325 integer,
  field_330 integer,
  field_335 integer,
  field_340 integer,
  field_345 integer,
  field_370 integer,
  field_380 numeric(18,2),
  field_390 numeric(18,2),
  PRIMARY KEY (bn, fpe)
);

CREATE TABLE IF NOT EXISTS cra.cra_country_lookup (
  code character(2) NOT NULL,
  name_en text NOT NULL,
  name_fr text,
  PRIMARY KEY (code)
);

CREATE TABLE IF NOT EXISTS cra.cra_designation_lookup (
  code character(1) NOT NULL,
  name_en text NOT NULL,
  name_fr text,
  description_en text,
  description_fr text,
  PRIMARY KEY (code)
);

CREATE TABLE IF NOT EXISTS cra.cra_directors (
  bn character varying(15) NOT NULL,
  fpe date NOT NULL,
  form_id integer,
  sequence_number integer NOT NULL,
  last_name text,
  first_name text,
  initials text,
  position text,
  at_arms_length boolean,
  start_date date,
  end_date date,
  PRIMARY KEY (bn, fpe, sequence_number)
);

CREATE TABLE IF NOT EXISTS cra.cra_disbursement_quota (
  bn character varying(15) NOT NULL,
  fpe date NOT NULL,
  form_id integer,
  field_805 numeric(18,2),
  field_810 numeric(18,2),
  field_815 numeric(18,2),
  field_820 numeric(18,2),
  field_825 numeric(18,2),
  field_830 numeric(18,2),
  field_835 numeric(18,2),
  field_840 numeric(18,2),
  field_845 numeric(18,2),
  field_850 numeric(18,2),
  field_855 numeric(18,2),
  field_860 numeric(18,2),
  field_865 numeric(18,2),
  field_870 numeric(18,2),
  field_875 numeric(18,2),
  field_880 numeric(18,2),
  field_885 numeric(18,2),
  field_890 numeric(18,2),
  PRIMARY KEY (bn, fpe)
);

CREATE TABLE IF NOT EXISTS cra.cra_exported_goods (
  bn character varying(15) NOT NULL,
  fpe date NOT NULL,
  form_id integer,
  sequence_number integer NOT NULL,
  item_name text,
  item_value numeric(18,2),
  destination text,
  country character(2),
  PRIMARY KEY (bn, fpe, sequence_number)
);

CREATE TABLE IF NOT EXISTS cra.cra_financial_details (
  bn character varying(15) NOT NULL,
  fpe date NOT NULL,
  form_id integer,
  section_used character(1),
  field_4020 character(1),
  field_4050 boolean,
  field_4100 numeric(18,2),
  field_4101 numeric(18,2),
  field_4102 numeric(18,2),
  field_4110 numeric(18,2),
  field_4120 numeric(18,2),
  field_4130 numeric(18,2),
  field_4140 numeric(18,2),
  field_4150 numeric(18,2),
  field_4155 numeric(18,2),
  field_4157 numeric(18,2),
  field_4158 numeric(18,2),
  field_4160 numeric(18,2),
  field_4165 numeric(18,2),
  field_4166 numeric(18,2),
  field_4170 numeric(18,2),
  field_4180 numeric(18,2),
  field_4190 numeric(18,2),
  field_4200 numeric(18,2),
  field_4250 numeric(18,2),
  field_4300 numeric(18,2),
  field_4310 numeric(18,2),
  field_4320 numeric(18,2),
  field_4330 numeric(18,2),
  field_4350 numeric(18,2),
  field_4400 boolean,
  field_4490 boolean,
  field_4500 numeric(18,2),
  field_4505 numeric(18,2),
  field_4510 numeric(18,2),
  field_4530 numeric(18,2),
  field_4540 numeric(18,2),
  field_4550 numeric(18,2),
  field_4560 numeric(18,2),
  field_4565 boolean,
  field_4570 numeric(18,2),
  field_4571 numeric(18,2),
  field_4575 numeric(18,2),
  field_4576 numeric(18,2),
  field_4577 numeric(18,2),
  field_4580 numeric(18,2),
  field_4590 numeric(18,2),
  field_4600 numeric(18,2),
  field_4610 numeric(18,2),
  field_4620 numeric(18,2),
  field_4630 numeric(18,2),
  field_4640 numeric(18,2),
  field_4650 numeric(18,2),
  field_4655 text,
  field_4700 numeric(18,2),
  field_4800 numeric(18,2),
  field_4810 numeric(18,2),
  field_4820 numeric(18,2),
  field_4830 numeric(18,2),
  field_4840 numeric(18,2),
  field_4850 numeric(18,2),
  field_4860 numeric(18,2),
  field_4870 numeric(18,2),
  field_4880 numeric(18,2),
  field_4890 numeric(18,2),
  field_4891 numeric(18,2),
  field_4900 numeric(18,2),
  field_4910 numeric(18,2),
  field_4920 numeric(18,2),
  field_4930 text,
  field_4950 numeric(18,2),
  field_5000 numeric(18,2),
  field_5010 numeric(18,2),
  field_5020 numeric(18,2),
  field_5030 numeric(18,2),
  field_5040 numeric(18,2),
  field_5045 numeric(18,2),
  field_5050 numeric(18,2),
  field_5100 numeric(18,2),
  field_5500 numeric(18,2),
  field_5510 numeric(18,2),
  field_5610 numeric(18,2),
  field_5750 numeric(18,2),
  field_5900 numeric(18,2),
  field_5910 numeric(18,2),
  field_5030_indicator text,
  PRIMARY KEY (bn, fpe)
);

CREATE TABLE IF NOT EXISTS cra.cra_financial_general (
  bn character varying(15) NOT NULL,
  fpe date NOT NULL,
  form_id integer,
  program_area_1 character varying(10),
  program_area_2 character varying(10),
  program_area_3 character varying(10),
  program_percentage_1 integer,
  program_percentage_2 integer,
  program_percentage_3 integer,
  program_description_1 text,
  program_description_2 text,
  program_description_3 text,
  internal_division_1510_01 integer,
  internal_division_1510_02 integer,
  internal_division_1510_03 integer,
  internal_division_1510_04 integer,
  internal_division_1510_05 integer,
  field_1510_subordinate boolean,
  field_1510_parent_bn character varying(15),
  field_1510_parent_name text,
  field_1570 boolean,
  field_1600 boolean,
  field_1610 boolean,
  field_1620 boolean,
  field_1630 boolean,
  field_1640 boolean,
  field_1650 boolean,
  field_1800 boolean,
  field_2000 boolean,
  field_2100 boolean,
  field_2110 boolean,
  field_2300 boolean,
  field_2350 boolean,
  field_2400 boolean,
  field_2500 boolean,
  field_2510 boolean,
  field_2520 boolean,
  field_2530 boolean,
  field_2540 boolean,
  field_2550 boolean,
  field_2560 boolean,
  field_2570 boolean,
  field_2575 boolean,
  field_2580 boolean,
  field_2590 boolean,
  field_2600 boolean,
  field_2610 boolean,
  field_2620 boolean,
  field_2630 boolean,
  field_2640 boolean,
  field_2650 boolean,
  field_2660 text,
  field_2700 boolean,
  field_2730 boolean,
  field_2740 boolean,
  field_2750 boolean,
  field_2760 boolean,
  field_2770 boolean,
  field_2780 boolean,
  field_2790 text,
  field_2800 boolean,
  field_3200 boolean,
  field_3205 boolean,
  field_3210 boolean,
  field_3220 boolean,
  field_3230 boolean,
  field_3235 boolean,
  field_3240 boolean,
  field_3250 boolean,
  field_3260 boolean,
  field_3270 boolean,
  field_3400 boolean,
  field_3600 boolean,
  field_3610 boolean,
  field_3900 boolean,
  field_4000 boolean,
  field_4010 boolean,
  field_5000 boolean,
  field_5010 boolean,
  field_5030 numeric(18,2),
  field_5031 numeric(18,2),
  field_5032 numeric(18,2),
  field_5450 numeric(18,2),
  field_5460 numeric(18,2),
  field_5800 boolean,
  field_5810 boolean,
  field_5820 boolean,
  field_5830 boolean,
  field_5840 boolean,
  field_5841 boolean,
  field_5842 integer,
  field_5843 numeric(18,2),
  field_5844 boolean,
  field_5845 boolean,
  field_5846 boolean,
  field_5847 boolean,
  field_5848 boolean,
  field_5849 boolean,
  field_5850 boolean,
  field_5851 boolean,
  field_5852 boolean,
  field_5853 boolean,
  field_5854 boolean,
  field_5855 boolean,
  field_5856 boolean,
  field_5857 boolean,
  field_5858 boolean,
  field_5859 boolean,
  field_5860 boolean,
  field_5861 integer,
  field_5862 numeric(18,2),
  field_5863 numeric(18,2),
  field_5864 numeric(18,2),
  PRIMARY KEY (bn, fpe)
);

CREATE TABLE IF NOT EXISTS cra.cra_foundation_info (
  bn character varying(15) NOT NULL,
  fpe date NOT NULL,
  form_id integer,
  field_100 boolean,
  field_110 boolean,
  field_111 numeric(18,2),
  field_112 numeric(18,2),
  field_120 boolean,
  field_130 boolean,
  PRIMARY KEY (bn, fpe)
);

CREATE TABLE IF NOT EXISTS cra.cra_gifts_in_kind (
  bn character varying(15) NOT NULL,
  fpe date NOT NULL,
  form_id integer,
  field_500 boolean,
  field_505 boolean,
  field_510 boolean,
  field_515 boolean,
  field_520 boolean,
  field_525 boolean,
  field_530 boolean,
  field_535 boolean,
  field_540 boolean,
  field_545 boolean,
  field_550 boolean,
  field_555 boolean,
  field_560 boolean,
  field_565 text,
  field_580 numeric(18,2),
  PRIMARY KEY (bn, fpe)
);

CREATE TABLE IF NOT EXISTS cra.cra_identification (
  bn character varying(15) NOT NULL,
  fiscal_year integer NOT NULL,
  category character varying(10),
  sub_category character varying(10),
  designation character(1),
  legal_name text,
  account_name text,
  address_line_1 text,
  address_line_2 text,
  city text,
  province character varying(2),
  postal_code character varying(10),
  country character(2),
  registration_date date,
  language character varying(2),
  contact_phone text,
  contact_email text,
  PRIMARY KEY (bn, fiscal_year)
);

CREATE TABLE IF NOT EXISTS cra.cra_non_qualified_donees (
  bn character varying(15) NOT NULL,
  fpe date NOT NULL,
  form_id integer,
  sequence_number integer NOT NULL,
  recipient_name text,
  purpose text,
  cash_amount numeric(18,2),
  non_cash_amount numeric(18,2),
  country text,
  PRIMARY KEY (bn, fpe, sequence_number)
);

CREATE TABLE IF NOT EXISTS cra.cra_political_activity_desc (
  bn character varying(15) NOT NULL,
  fpe date NOT NULL,
  form_id integer,
  description text,
  PRIMARY KEY (bn, fpe)
);

CREATE TABLE IF NOT EXISTS cra.cra_political_activity_funding (
  bn character varying(15) NOT NULL,
  fpe date NOT NULL,
  form_id integer,
  sequence_number integer NOT NULL,
  activity text,
  amount numeric(18,2),
  country character(2),
  PRIMARY KEY (bn, fpe, sequence_number)
);

CREATE TABLE IF NOT EXISTS cra.cra_political_activity_resources (
  bn character varying(15) NOT NULL,
  fpe date NOT NULL,
  form_id integer,
  sequence_number integer NOT NULL,
  staff boolean,
  volunteers boolean,
  financial boolean,
  property boolean,
  other_resource text,
  PRIMARY KEY (bn, fpe, sequence_number)
);

CREATE TABLE IF NOT EXISTS cra.cra_program_type_lookup (
  code character varying(2) NOT NULL,
  name_en text NOT NULL,
  name_fr text,
  description_en text,
  description_fr text,
  PRIMARY KEY (code)
);

CREATE TABLE IF NOT EXISTS cra.cra_province_state_lookup (
  code character varying(2) NOT NULL,
  name_en text NOT NULL,
  name_fr text,
  country character(2),
  PRIMARY KEY (code)
);

CREATE TABLE IF NOT EXISTS cra.cra_qualified_donees (
  bn character varying(15) NOT NULL,
  fpe date NOT NULL,
  form_id integer,
  sequence_number integer NOT NULL,
  donee_bn character varying(15),
  donee_name text,
  associated boolean,
  city text,
  province character varying(2),
  total_gifts numeric(18,2),
  gifts_in_kind numeric(18,2),
  number_of_donees integer,
  political_activity_gift boolean,
  political_activity_amount numeric(18,2),
  PRIMARY KEY (bn, fpe, sequence_number)
);

CREATE TABLE IF NOT EXISTS cra.cra_resources_sent_outside (
  bn character varying(15) NOT NULL,
  fpe date NOT NULL,
  form_id integer,
  sequence_number integer NOT NULL,
  individual_org_name text,
  amount numeric(18,2),
  country character(2),
  PRIMARY KEY (bn, fpe, sequence_number)
);

CREATE TABLE IF NOT EXISTS cra.cra_sub_category_lookup (
  category_code character varying(10) NOT NULL,
  sub_category_code character varying(10) NOT NULL,
  name_en text NOT NULL,
  name_fr text,
  description_en text,
  description_fr text,
  PRIMARY KEY (category_code, sub_category_code)
);

CREATE TABLE IF NOT EXISTS cra.cra_web_urls (
  bn character varying(15) NOT NULL,
  fiscal_year integer NOT NULL,
  sequence_number integer NOT NULL,
  contact_url text,
  PRIMARY KEY (bn, fiscal_year, sequence_number)
);

CREATE TABLE IF NOT EXISTS cra.donee_name_quality (
  donee_bn character varying(32) NOT NULL,
  donee_name text NOT NULL,
  canonical_name text,
  mismatch_category text NOT NULL,
  bn_defect text,
  trigram_sim numeric,
  citations integer,
  total_gifts numeric,
  PRIMARY KEY (donee_bn, donee_name)
);

CREATE TABLE IF NOT EXISTS cra.govt_funding_by_charity (
  bn character varying(15) NOT NULL,
  fiscal_year integer NOT NULL,
  legal_name text,
  designation character(1),
  category character varying(10),
  federal numeric,
  provincial numeric,
  municipal numeric,
  combined_sectiond numeric,
  total_govt numeric,
  revenue numeric,
  govt_share_of_rev numeric,
  PRIMARY KEY (bn, fiscal_year)
);

CREATE TABLE IF NOT EXISTS cra.govt_funding_by_year (
  fiscal_year integer NOT NULL,
  charities_filed integer,
  charities_any_govt integer,
  federal numeric,
  provincial numeric,
  municipal numeric,
  combined_sectiond numeric,
  total_govt numeric,
  total_revenue numeric,
  federal_pct numeric,
  provincial_pct numeric,
  municipal_pct numeric,
  total_govt_pct numeric,
  PRIMARY KEY (fiscal_year)
);

CREATE TABLE IF NOT EXISTS cra.identification_name_history (
  bn character varying(15),
  legal_name text,
  account_name text,
  first_year integer,
  last_year integer,
  years_present integer
);

CREATE TABLE IF NOT EXISTS cra.identified_hubs (
  bn character varying(15) NOT NULL,
  legal_name text,
  scc_id integer,
  in_degree integer DEFAULT 0,
  out_degree integer DEFAULT 0,
  total_degree integer DEFAULT 0,
  total_inflow numeric DEFAULT 0,
  total_outflow numeric DEFAULT 0,
  hub_type character varying(50),
  PRIMARY KEY (bn)
);

CREATE TABLE IF NOT EXISTS cra.johnson_cycles (
  id integer DEFAULT nextval('cra.johnson_cycles_id_seq'::regclass) NOT NULL,
  hops integer NOT NULL,
  path_bns character varying(15)[] NOT NULL,
  path_display text NOT NULL,
  bottleneck_amt numeric,
  total_flow numeric,
  min_year integer,
  max_year integer,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS cra.loop_charity_financials (
  bn character varying(15) NOT NULL,
  legal_name text,
  designation character(1),
  category character varying(10),
  circular_outflow numeric DEFAULT 0,
  circular_inflow numeric DEFAULT 0,
  loops_count integer DEFAULT 0,
  revenue numeric DEFAULT 0,
  gifts_received_charities numeric DEFAULT 0,
  gifts_given_donees numeric DEFAULT 0,
  total_expenditures numeric DEFAULT 0,
  program_spending numeric DEFAULT 0,
  admin_spending numeric DEFAULT 0,
  fundraising_spending numeric DEFAULT 0,
  compensation_spending numeric DEFAULT 0,
  PRIMARY KEY (bn)
);

CREATE TABLE IF NOT EXISTS cra.loop_edge_year_flows (
  loop_id integer NOT NULL,
  hop_idx integer NOT NULL,
  src character varying(15) NOT NULL,
  dst character varying(15) NOT NULL,
  year_flow numeric DEFAULT 0 NOT NULL,
  gift_count integer DEFAULT 0 NOT NULL,
  PRIMARY KEY (loop_id, hop_idx)
);

CREATE TABLE IF NOT EXISTS cra.loop_edges (
  src character varying(15) NOT NULL,
  dst character varying(15) NOT NULL,
  total_amt numeric DEFAULT 0 NOT NULL,
  edge_count integer DEFAULT 0 NOT NULL,
  min_year integer,
  max_year integer,
  years integer[],
  PRIMARY KEY (src, dst)
);

CREATE TABLE IF NOT EXISTS cra.loop_financials (
  loop_id integer NOT NULL,
  hops integer NOT NULL,
  same_year boolean NOT NULL,
  min_year integer,
  max_year integer,
  bottleneck_window numeric,
  total_flow_window numeric,
  bottleneck_allyears numeric,
  total_flow_allyears numeric,
  PRIMARY KEY (loop_id)
);

CREATE TABLE IF NOT EXISTS cra.loop_participants (
  bn character varying(15) NOT NULL,
  loop_id integer NOT NULL,
  position_in_loop integer NOT NULL,
  sends_to character varying(15),
  receives_from character varying(15),
  PRIMARY KEY (loop_id, position_in_loop)
);

CREATE TABLE IF NOT EXISTS cra.loop_universe (
  bn character varying(15) NOT NULL,
  legal_name text,
  total_loops integer DEFAULT 0,
  loops_2hop integer DEFAULT 0,
  loops_3hop integer DEFAULT 0,
  loops_4hop integer DEFAULT 0,
  loops_5hop integer DEFAULT 0,
  loops_6hop integer DEFAULT 0,
  loops_7plus integer DEFAULT 0,
  max_bottleneck numeric DEFAULT 0,
  total_circular_amt numeric DEFAULT 0,
  score integer,
  scored_at timestamp with time zone,
  PRIMARY KEY (bn)
);

CREATE TABLE IF NOT EXISTS cra.loops (
  id integer DEFAULT nextval('cra.loops_id_seq'::regclass) NOT NULL,
  hops integer NOT NULL,
  path_bns character varying(15)[] NOT NULL,
  path_display text NOT NULL,
  bottleneck_amt numeric,
  total_flow numeric,
  min_year integer,
  max_year integer,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS cra.matrix_census (
  bn character varying(15) NOT NULL,
  legal_name text,
  walks_2 numeric DEFAULT 0,
  walks_3 numeric DEFAULT 0,
  walks_4 numeric DEFAULT 0,
  walks_5 numeric DEFAULT 0,
  walks_6 numeric DEFAULT 0,
  walks_7 numeric DEFAULT 0,
  walks_8 numeric DEFAULT 0,
  max_walk_length integer DEFAULT 0,
  total_walk_count numeric DEFAULT 0,
  in_johnson_cycle boolean DEFAULT false,
  in_selfjoin_cycle boolean DEFAULT false,
  scc_id integer,
  scc_size integer,
  PRIMARY KEY (bn)
);

CREATE TABLE IF NOT EXISTS cra.overhead_by_charity (
  bn character varying(15) NOT NULL,
  fiscal_year integer NOT NULL,
  legal_name text,
  designation character(1),
  category character varying(10),
  revenue numeric,
  total_expenditures numeric,
  compensation numeric,
  administration numeric,
  fundraising numeric,
  programs numeric,
  strict_overhead numeric,
  broad_overhead numeric,
  strict_overhead_pct numeric,
  broad_overhead_pct numeric,
  outlier_flag boolean DEFAULT false,
  PRIMARY KEY (bn, fiscal_year)
);

CREATE TABLE IF NOT EXISTS cra.overhead_by_year (
  fiscal_year integer NOT NULL,
  charities_filed integer,
  outliers_excluded integer,
  revenue numeric,
  total_expenditures numeric,
  compensation numeric,
  administration numeric,
  fundraising numeric,
  programs numeric,
  strict_overhead numeric,
  broad_overhead numeric,
  comp_pct_rev numeric,
  admin_pct_rev numeric,
  fundraising_pct_rev numeric,
  strict_overhead_pct_rev numeric,
  broad_overhead_pct_rev numeric,
  comp_pct_exp numeric,
  admin_pct_exp numeric,
  fundraising_pct_exp numeric,
  strict_overhead_pct_exp numeric,
  broad_overhead_pct_exp numeric,
  PRIMARY KEY (fiscal_year)
);

CREATE TABLE IF NOT EXISTS cra.overhead_by_year_designation (
  fiscal_year integer NOT NULL,
  designation character(1) NOT NULL,
  charities integer,
  revenue numeric,
  total_expenditures numeric,
  compensation numeric,
  administration numeric,
  fundraising numeric,
  programs numeric,
  strict_overhead numeric,
  broad_overhead numeric,
  strict_overhead_pct_rev numeric,
  broad_overhead_pct_rev numeric,
  strict_overhead_pct_exp numeric,
  broad_overhead_pct_exp numeric,
  PRIMARY KEY (fiscal_year, designation)
);

CREATE TABLE IF NOT EXISTS cra.partitioned_cycles (
  id integer DEFAULT nextval('cra.partitioned_cycles_id_seq'::regclass) NOT NULL,
  hops integer NOT NULL,
  path_bns character varying(15)[] NOT NULL,
  path_display text NOT NULL,
  bottleneck_amt numeric,
  total_flow numeric,
  min_year integer,
  max_year integer,
  tier character varying(20) NOT NULL,
  source_scc_id integer,
  source_scc_size integer,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS cra.scc_components (
  bn character varying(15) NOT NULL,
  scc_id integer NOT NULL,
  scc_root character varying(15) NOT NULL,
  scc_size integer NOT NULL,
  legal_name text,
  PRIMARY KEY (bn)
);

CREATE TABLE IF NOT EXISTS cra.scc_summary (
  scc_id integer NOT NULL,
  scc_root character varying(15) NOT NULL,
  node_count integer NOT NULL,
  edge_count integer DEFAULT 0 NOT NULL,
  total_internal_flow numeric DEFAULT 0,
  cycle_count_from_loops integer DEFAULT 0,
  cycle_count_from_johnson integer DEFAULT 0,
  top_charity_names text[],
  PRIMARY KEY (scc_id)
);

CREATE TABLE IF NOT EXISTS cra.t3010_completeness_issues (
  bn character varying(15) NOT NULL,
  fpe date NOT NULL,
  fiscal_year integer NOT NULL,
  legal_name text,
  rule_code text NOT NULL,
  missing_field text NOT NULL,
  context_rule text NOT NULL,
  details text,
  PRIMARY KEY (bn, fpe, rule_code, missing_field)
);

CREATE TABLE IF NOT EXISTS cra.t3010_impossibilities (
  bn character varying(15) NOT NULL,
  fpe date NOT NULL,
  fiscal_year integer NOT NULL,
  legal_name text,
  rule_code text NOT NULL,
  rule_family text NOT NULL,
  details text,
  severity numeric,
  PRIMARY KEY (bn, fpe, rule_code)
);

CREATE TABLE IF NOT EXISTS cra.t3010_plausibility_flags (
  bn character varying(15) NOT NULL,
  fpe date NOT NULL,
  fiscal_year integer NOT NULL,
  legal_name text,
  rule_code text NOT NULL,
  offending_field text NOT NULL,
  details text,
  severity numeric,
  PRIMARY KEY (bn, fpe, rule_code, offending_field)
);

-- User-defined functions
CREATE OR REPLACE FUNCTION cra.norm_name(n text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
      SELECT TRIM(REGEXP_REPLACE(
        REGEXP_REPLACE(
          REGEXP_REPLACE(
            UPPER(COALESCE(n, '')),
            '&', ' AND ', 'g'),
          '[^A-Z0-9 ]', ' ', 'g'),
        '\s+(THE|LA|LE|LES|DU|DE|DES|OF|AND|ET|FOR|POUR|A|AU|AUX|CANADA|INC|INCORPORATED|LTD|LIMITED|LIMITEE|CORP|CORPORATION|CO|COMPANY|FOUNDATION|FONDATION|SOCIETY|SOCIETE|ASSOCIATION|SOCIETYOF|CENTRE|CENTER|CHURCH|EGLISE|MINISTRY|MINISTERE)\s+',
        ' ', 'g'))
    $function$;

-- Indexes
CREATE INDEX IF NOT EXISTS _dnq_canonical_nname_idx ON cra._dnq_canonical USING gin (nname gin_trgm_ops);
CREATE INDEX IF NOT EXISTS identification_name_history_bn_idx ON cra.identification_name_history USING btree (bn);
CREATE INDEX IF NOT EXISTS idx_activities_countries_bn_fpe ON cra.cra_activities_outside_countries USING btree (bn, fpe);
CREATE INDEX IF NOT EXISTS idx_activities_countries_country ON cra.cra_activities_outside_countries USING btree (country);
CREATE INDEX IF NOT EXISTS idx_activities_details_bn_fpe ON cra.cra_activities_outside_details USING btree (bn, fpe);
CREATE INDEX IF NOT EXISTS idx_comp_field ON cra.t3010_completeness_issues USING btree (missing_field);
CREATE INDEX IF NOT EXISTS idx_comp_rule ON cra.t3010_completeness_issues USING btree (rule_code);
CREATE INDEX IF NOT EXISTS idx_comp_year ON cra.t3010_completeness_issues USING btree (fiscal_year);
CREATE INDEX IF NOT EXISTS idx_compensation_bn_fpe ON cra.cra_compensation USING btree (bn, fpe);
CREATE INDEX IF NOT EXISTS idx_directors_bn_fpe ON cra.cra_directors USING btree (bn, fpe);
CREATE INDEX IF NOT EXISTS idx_directors_name ON cra.cra_directors USING btree (last_name, first_name);
CREATE INDEX IF NOT EXISTS idx_disbursement_bn_fpe ON cra.cra_disbursement_quota USING btree (bn, fpe);
CREATE INDEX IF NOT EXISTS idx_dnq_category ON cra.donee_name_quality USING btree (mismatch_category);
CREATE INDEX IF NOT EXISTS idx_dnq_defect ON cra.donee_name_quality USING btree (bn_defect);
CREATE INDEX IF NOT EXISTS idx_dnq_total_gifts ON cra.donee_name_quality USING btree (total_gifts DESC);
CREATE INDEX IF NOT EXISTS idx_exported_goods_bn_fpe ON cra.cra_exported_goods USING btree (bn, fpe);
CREATE INDEX IF NOT EXISTS idx_financial_details_bn_fpe ON cra.cra_financial_details USING btree (bn, fpe);
CREATE INDEX IF NOT EXISTS idx_financial_general_bn_fpe ON cra.cra_financial_general USING btree (bn, fpe);
CREATE INDEX IF NOT EXISTS idx_foundation_bn_fpe ON cra.cra_foundation_info USING btree (bn, fpe);
CREATE INDEX IF NOT EXISTS idx_gfbc_designation ON cra.govt_funding_by_charity USING btree (designation);
CREATE INDEX IF NOT EXISTS idx_gfbc_total_govt ON cra.govt_funding_by_charity USING btree (total_govt DESC);
CREATE INDEX IF NOT EXISTS idx_gfbc_year ON cra.govt_funding_by_charity USING btree (fiscal_year);
CREATE INDEX IF NOT EXISTS idx_gifts_in_kind_bn_fpe ON cra.cra_gifts_in_kind USING btree (bn, fpe);
CREATE INDEX IF NOT EXISTS idx_identification_account ON cra.cra_identification USING gin (to_tsvector('english'::regconfig, account_name));
CREATE INDEX IF NOT EXISTS idx_identification_category ON cra.cra_identification USING btree (category);
CREATE INDEX IF NOT EXISTS idx_identification_designation ON cra.cra_identification USING btree (designation);
CREATE INDEX IF NOT EXISTS idx_identification_name ON cra.cra_identification USING gin (to_tsvector('english'::regconfig, legal_name));
CREATE INDEX IF NOT EXISTS idx_identification_province ON cra.cra_identification USING btree (province);
CREATE INDEX IF NOT EXISTS idx_identification_year ON cra.cra_identification USING btree (fiscal_year);
CREATE INDEX IF NOT EXISTS idx_imp_family ON cra.t3010_impossibilities USING btree (rule_family);
CREATE INDEX IF NOT EXISTS idx_imp_rule ON cra.t3010_impossibilities USING btree (rule_code);
CREATE INDEX IF NOT EXISTS idx_imp_severity ON cra.t3010_impossibilities USING btree (severity DESC);
CREATE INDEX IF NOT EXISTS idx_imp_year ON cra.t3010_impossibilities USING btree (fiscal_year);
CREATE INDEX IF NOT EXISTS idx_johnson_cycles_display ON cra.johnson_cycles USING btree (path_display);
CREATE INDEX IF NOT EXISTS idx_johnson_cycles_hops ON cra.johnson_cycles USING btree (hops);
CREATE INDEX IF NOT EXISTS idx_lcf_designation ON cra.loop_charity_financials USING btree (designation);
CREATE INDEX IF NOT EXISTS idx_leyf_dst ON cra.loop_edge_year_flows USING btree (dst);
CREATE INDEX IF NOT EXISTS idx_leyf_src ON cra.loop_edge_year_flows USING btree (src);
CREATE INDEX IF NOT EXISTS idx_lf_same_year ON cra.loop_financials USING btree (same_year);
CREATE INDEX IF NOT EXISTS idx_loop_edges_dst ON cra.loop_edges USING btree (dst);
CREATE INDEX IF NOT EXISTS idx_loop_edges_dst_src ON cra.loop_edges USING btree (dst, src);
CREATE INDEX IF NOT EXISTS idx_loop_edges_src ON cra.loop_edges USING btree (src);
CREATE INDEX IF NOT EXISTS idx_loop_part_bn ON cra.loop_participants USING btree (bn);
CREATE INDEX IF NOT EXISTS idx_loop_part_receives ON cra.loop_participants USING btree (receives_from);
CREATE INDEX IF NOT EXISTS idx_loop_part_sends ON cra.loop_participants USING btree (sends_to);
CREATE INDEX IF NOT EXISTS idx_loop_uni_loops ON cra.loop_universe USING btree (total_loops DESC);
CREATE INDEX IF NOT EXISTS idx_loop_uni_score ON cra.loop_universe USING btree (score DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_loops_bottleneck ON cra.loops USING btree (bottleneck_amt DESC);
CREATE INDEX IF NOT EXISTS idx_loops_hops ON cra.loops USING btree (hops);
CREATE INDEX IF NOT EXISTS idx_loops_path_bns ON cra.loops USING gin (path_bns);
CREATE INDEX IF NOT EXISTS idx_matrix_census_scc ON cra.matrix_census USING btree (scc_id);
CREATE INDEX IF NOT EXISTS idx_matrix_census_total ON cra.matrix_census USING btree (total_walk_count DESC);
CREATE INDEX IF NOT EXISTS idx_non_qualified_donees_bn_fpe ON cra.cra_non_qualified_donees USING btree (bn, fpe);
CREATE INDEX IF NOT EXISTS idx_obc_designation ON cra.overhead_by_charity USING btree (designation);
CREATE INDEX IF NOT EXISTS idx_obc_strict_pct ON cra.overhead_by_charity USING btree (strict_overhead_pct DESC);
CREATE INDEX IF NOT EXISTS idx_obc_year ON cra.overhead_by_charity USING btree (fiscal_year);
CREATE INDEX IF NOT EXISTS idx_part_cycles_display ON cra.partitioned_cycles USING btree (path_display);
CREATE INDEX IF NOT EXISTS idx_part_cycles_hops ON cra.partitioned_cycles USING btree (hops);
CREATE INDEX IF NOT EXISTS idx_part_cycles_tier ON cra.partitioned_cycles USING btree (tier);
CREATE INDEX IF NOT EXISTS idx_plaus_field ON cra.t3010_plausibility_flags USING btree (offending_field);
CREATE INDEX IF NOT EXISTS idx_plaus_rule ON cra.t3010_plausibility_flags USING btree (rule_code);
CREATE INDEX IF NOT EXISTS idx_plaus_year ON cra.t3010_plausibility_flags USING btree (fiscal_year);
CREATE INDEX IF NOT EXISTS idx_political_desc_bn_fpe ON cra.cra_political_activity_desc USING btree (bn, fpe);
CREATE INDEX IF NOT EXISTS idx_political_desc_text ON cra.cra_political_activity_desc USING gin (to_tsvector('english'::regconfig, description));
CREATE INDEX IF NOT EXISTS idx_political_funding_bn_fpe ON cra.cra_political_activity_funding USING btree (bn, fpe);
CREATE INDEX IF NOT EXISTS idx_political_resources_bn_fpe ON cra.cra_political_activity_resources USING btree (bn, fpe);
CREATE INDEX IF NOT EXISTS idx_programs_bn_fpe ON cra.cra_charitable_programs USING btree (bn, fpe);
CREATE INDEX IF NOT EXISTS idx_programs_description ON cra.cra_charitable_programs USING gin (to_tsvector('english'::regconfig, description));
CREATE INDEX IF NOT EXISTS idx_qualified_donees_bn_fpe ON cra.cra_qualified_donees USING btree (bn, fpe);
CREATE INDEX IF NOT EXISTS idx_qualified_donees_donee_bn ON cra.cra_qualified_donees USING btree (donee_bn);
CREATE INDEX IF NOT EXISTS idx_resources_sent_bn_fpe ON cra.cra_resources_sent_outside USING btree (bn, fpe);
CREATE INDEX IF NOT EXISTS idx_scc_comp_id ON cra.scc_components USING btree (scc_id);
CREATE INDEX IF NOT EXISTS idx_scc_comp_scc_id ON cra.scc_components USING btree (scc_id);
CREATE INDEX IF NOT EXISTS idx_scc_comp_size ON cra.scc_components USING btree (scc_size DESC);
CREATE INDEX IF NOT EXISTS idx_scc_summary_size ON cra.scc_summary USING btree (node_count DESC);

-- Views
CREATE OR REPLACE VIEW cra.vw_charity_financials_by_year AS
SELECT fd.bn,
    ci.legal_name,
    ci.account_name,
    fd.fpe AS fiscal_period_end,
    EXTRACT(year FROM fd.fpe) AS fiscal_year,
    fd.field_4700 AS total_revenue,
    fd.field_4500 AS tax_receipted_gifts,
    fd.field_4540 AS federal_government_revenue,
    fd.field_4550 AS provincial_government_revenue,
    fd.field_4560 AS municipal_government_revenue,
    fd.field_4950 AS total_expenditures_before_disbursements,
    fd.field_5000 AS charitable_programs_expenditure,
    fd.field_5010 AS management_and_admin_expenditure,
    fd.field_5020 AS fundraising_expenditure,
    fd.field_5050 AS gifts_to_qualified_donees,
    fd.field_5100 AS total_expenditures,
    fd.field_4200 AS total_assets,
    fd.field_4350 AS total_liabilities,
    (fd.field_4200 - fd.field_4350) AS net_assets
   FROM (cra.cra_financial_details fd
     LEFT JOIN cra.cra_identification ci ON ((((fd.bn)::text = (ci.bn)::text) AND (ci.fiscal_year = ( SELECT max(cra_identification.fiscal_year) AS max
           FROM cra.cra_identification
          WHERE ((cra_identification.bn)::text = (fd.bn)::text))))))
  ORDER BY fd.bn, fd.fpe DESC;;

CREATE OR REPLACE VIEW cra.vw_charity_profiles AS
SELECT DISTINCT ON (ci.bn) ci.bn,
    ci.fiscal_year,
    ci.legal_name,
    ci.account_name,
    ci.address_line_1,
    ci.address_line_2,
    ci.city,
    ci.province,
    psl.name_en AS province_name,
    ci.postal_code,
    ci.country,
    cl.name_en AS country_name,
    ci.category,
    cat.name_en AS category_name,
    ci.sub_category,
    subcat.name_en AS sub_category_name,
    ci.designation,
    dl.name_en AS designation_name,
    dl.description_en AS designation_description
   FROM (((((cra.cra_identification ci
     LEFT JOIN cra.cra_category_lookup cat ON (((ci.category)::text = (cat.code)::text)))
     LEFT JOIN cra.cra_sub_category_lookup subcat ON ((((ci.category)::text = (subcat.category_code)::text) AND ((ci.sub_category)::text = (subcat.sub_category_code)::text))))
     LEFT JOIN cra.cra_designation_lookup dl ON ((ci.designation = dl.code)))
     LEFT JOIN cra.cra_country_lookup cl ON ((ci.country = cl.code)))
     LEFT JOIN cra.cra_province_state_lookup psl ON (((ci.province)::text = (psl.code)::text)))
  ORDER BY ci.bn, ci.fiscal_year DESC;;

CREATE OR REPLACE VIEW cra.vw_charity_programs AS
SELECT cp.bn,
    ci.legal_name,
    ci.account_name,
    cp.fpe AS fiscal_period_end,
    EXTRACT(year FROM cp.fpe) AS fiscal_year,
    cp.program_type,
    ptl.name_en AS program_type_name,
    cp.description
   FROM ((cra.cra_charitable_programs cp
     LEFT JOIN cra.cra_identification ci ON ((((cp.bn)::text = (ci.bn)::text) AND (ci.fiscal_year = ( SELECT max(cra_identification.fiscal_year) AS max
           FROM cra.cra_identification
          WHERE ((cra_identification.bn)::text = (cp.bn)::text))))))
     LEFT JOIN cra.cra_program_type_lookup ptl ON (((cp.program_type)::text = (ptl.code)::text)))
  ORDER BY cp.bn, cp.fpe DESC;;
