-- Schema: cra
-- Exported: 2026-04-15T16:20:36.707Z
CREATE SCHEMA IF NOT EXISTS cra;

CREATE TABLE IF NOT EXISTS cra.cra_activities_outside_countries (
  bn VARCHAR(15) NOT NULL,
  fpe DATE NOT NULL,
  form_id INTEGER,
  sequence_number INTEGER NOT NULL,
  country CHAR(2),
  PRIMARY KEY (bn, fpe, sequence_number)
);

CREATE TABLE IF NOT EXISTS cra.cra_activities_outside_details (
  bn VARCHAR(15) NOT NULL,
  fpe DATE NOT NULL,
  form_id INTEGER,
  field_200 NUMERIC(18,2),
  field_210 BOOLEAN,
  field_220 BOOLEAN,
  field_230 TEXT,
  field_240 BOOLEAN,
  field_250 BOOLEAN,
  field_260 BOOLEAN,
  PRIMARY KEY (bn, fpe)
);

CREATE TABLE IF NOT EXISTS cra.cra_category_lookup (
  code VARCHAR(10) NOT NULL,
  name_en TEXT NOT NULL,
  name_fr TEXT,
  description_en TEXT,
  description_fr TEXT,
  PRIMARY KEY (code)
);

CREATE TABLE IF NOT EXISTS cra.cra_charitable_programs (
  bn VARCHAR(15) NOT NULL,
  fpe DATE NOT NULL,
  form_id INTEGER,
  program_type VARCHAR(2) NOT NULL,
  description TEXT,
  PRIMARY KEY (bn, fpe, program_type)
);

CREATE TABLE IF NOT EXISTS cra.cra_compensation (
  bn VARCHAR(15) NOT NULL,
  fpe DATE NOT NULL,
  form_id INTEGER,
  field_300 INTEGER,
  field_305 INTEGER,
  field_310 INTEGER,
  field_315 INTEGER,
  field_320 INTEGER,
  field_325 INTEGER,
  field_330 INTEGER,
  field_335 INTEGER,
  field_340 INTEGER,
  field_345 INTEGER,
  field_370 INTEGER,
  field_380 NUMERIC(18,2),
  field_390 NUMERIC(18,2),
  PRIMARY KEY (bn, fpe)
);

CREATE TABLE IF NOT EXISTS cra.cra_country_lookup (
  code CHAR(2) NOT NULL,
  name_en TEXT NOT NULL,
  name_fr TEXT,
  PRIMARY KEY (code)
);

CREATE TABLE IF NOT EXISTS cra.cra_designation_lookup (
  code CHAR(1) NOT NULL,
  name_en TEXT NOT NULL,
  name_fr TEXT,
  description_en TEXT,
  description_fr TEXT,
  PRIMARY KEY (code)
);

CREATE TABLE IF NOT EXISTS cra.cra_directors (
  bn VARCHAR(15) NOT NULL,
  fpe DATE NOT NULL,
  form_id INTEGER,
  sequence_number INTEGER NOT NULL,
  last_name TEXT,
  first_name TEXT,
  initials TEXT,
  position TEXT,
  at_arms_length BOOLEAN,
  start_date DATE,
  end_date DATE,
  PRIMARY KEY (bn, fpe, sequence_number)
);

CREATE TABLE IF NOT EXISTS cra.cra_disbursement_quota (
  bn VARCHAR(15) NOT NULL,
  fpe DATE NOT NULL,
  form_id INTEGER,
  field_805 NUMERIC(18,2),
  field_810 NUMERIC(18,2),
  field_815 NUMERIC(18,2),
  field_820 NUMERIC(18,2),
  field_825 NUMERIC(18,2),
  field_830 NUMERIC(18,2),
  field_835 NUMERIC(18,2),
  field_840 NUMERIC(18,2),
  field_845 NUMERIC(18,2),
  field_850 NUMERIC(18,2),
  field_855 NUMERIC(18,2),
  field_860 NUMERIC(18,2),
  field_865 NUMERIC(18,2),
  field_870 NUMERIC(18,2),
  field_875 NUMERIC(18,2),
  field_880 NUMERIC(18,2),
  field_885 NUMERIC(18,2),
  field_890 NUMERIC(18,2),
  PRIMARY KEY (bn, fpe)
);

CREATE TABLE IF NOT EXISTS cra.cra_exported_goods (
  bn VARCHAR(15) NOT NULL,
  fpe DATE NOT NULL,
  form_id INTEGER,
  sequence_number INTEGER NOT NULL,
  item_name TEXT,
  item_value NUMERIC(18,2),
  destination TEXT,
  country CHAR(2),
  PRIMARY KEY (bn, fpe, sequence_number)
);

CREATE TABLE IF NOT EXISTS cra.cra_financial_details (
  bn VARCHAR(15) NOT NULL,
  fpe DATE NOT NULL,
  form_id INTEGER,
  section_used CHAR(1),
  field_4020 CHAR(1),
  field_4050 BOOLEAN,
  field_4100 NUMERIC(18,2),
  field_4101 NUMERIC(18,2),
  field_4102 NUMERIC(18,2),
  field_4110 NUMERIC(18,2),
  field_4120 NUMERIC(18,2),
  field_4130 NUMERIC(18,2),
  field_4140 NUMERIC(18,2),
  field_4150 NUMERIC(18,2),
  field_4155 NUMERIC(18,2),
  field_4157 NUMERIC(18,2),
  field_4158 NUMERIC(18,2),
  field_4160 NUMERIC(18,2),
  field_4165 NUMERIC(18,2),
  field_4166 NUMERIC(18,2),
  field_4170 NUMERIC(18,2),
  field_4180 NUMERIC(18,2),
  field_4190 NUMERIC(18,2),
  field_4200 NUMERIC(18,2),
  field_4250 NUMERIC(18,2),
  field_4300 NUMERIC(18,2),
  field_4310 NUMERIC(18,2),
  field_4320 NUMERIC(18,2),
  field_4330 NUMERIC(18,2),
  field_4350 NUMERIC(18,2),
  field_4400 BOOLEAN,
  field_4490 BOOLEAN,
  field_4500 NUMERIC(18,2),
  field_4505 NUMERIC(18,2),
  field_4510 NUMERIC(18,2),
  field_4530 NUMERIC(18,2),
  field_4540 NUMERIC(18,2),
  field_4550 NUMERIC(18,2),
  field_4560 NUMERIC(18,2),
  field_4565 BOOLEAN,
  field_4570 NUMERIC(18,2),
  field_4571 NUMERIC(18,2),
  field_4575 NUMERIC(18,2),
  field_4576 NUMERIC(18,2),
  field_4577 NUMERIC(18,2),
  field_4580 NUMERIC(18,2),
  field_4590 NUMERIC(18,2),
  field_4600 NUMERIC(18,2),
  field_4610 NUMERIC(18,2),
  field_4620 NUMERIC(18,2),
  field_4630 NUMERIC(18,2),
  field_4640 NUMERIC(18,2),
  field_4650 NUMERIC(18,2),
  field_4655 NUMERIC(18,2),
  field_4700 NUMERIC(18,2),
  field_4800 NUMERIC(18,2),
  field_4810 NUMERIC(18,2),
  field_4820 NUMERIC(18,2),
  field_4830 NUMERIC(18,2),
  field_4840 NUMERIC(18,2),
  field_4850 NUMERIC(18,2),
  field_4860 NUMERIC(18,2),
  field_4870 NUMERIC(18,2),
  field_4880 NUMERIC(18,2),
  field_4890 NUMERIC(18,2),
  field_4891 NUMERIC(18,2),
  field_4900 NUMERIC(18,2),
  field_4910 NUMERIC(18,2),
  field_4920 NUMERIC(18,2),
  field_4930 NUMERIC(18,2),
  field_4950 NUMERIC(18,2),
  field_5000 NUMERIC(18,2),
  field_5010 NUMERIC(18,2),
  field_5020 NUMERIC(18,2),
  field_5030 NUMERIC(18,2),
  field_5040 NUMERIC(18,2),
  field_5045 NUMERIC(18,2),
  field_5050 NUMERIC(18,2),
  field_5100 NUMERIC(18,2),
  field_5500 NUMERIC(18,2),
  field_5510 NUMERIC(18,2),
  field_5610 NUMERIC(18,2),
  field_5750 NUMERIC(18,2),
  field_5900 NUMERIC(18,2),
  field_5910 NUMERIC(18,2),
  field_5030_indicator TEXT,
  PRIMARY KEY (bn, fpe)
);

CREATE TABLE IF NOT EXISTS cra.cra_financial_general (
  bn VARCHAR(15) NOT NULL,
  fpe DATE NOT NULL,
  form_id INTEGER,
  program_area_1 VARCHAR(10),
  program_area_2 VARCHAR(10),
  program_area_3 VARCHAR(10),
  program_percentage_1 INTEGER,
  program_percentage_2 INTEGER,
  program_percentage_3 INTEGER,
  internal_division_1510_01 INTEGER,
  internal_division_1510_02 INTEGER,
  internal_division_1510_03 INTEGER,
  internal_division_1510_04 INTEGER,
  internal_division_1510_05 INTEGER,
  field_1510_subordinate BOOLEAN,
  field_1510_parent_bn VARCHAR(15),
  field_1510_parent_name TEXT,
  field_1570 BOOLEAN,
  field_1600 BOOLEAN,
  field_1610 BOOLEAN,
  field_1620 BOOLEAN,
  field_1630 BOOLEAN,
  field_1640 BOOLEAN,
  field_1650 BOOLEAN,
  field_1800 BOOLEAN,
  field_2000 BOOLEAN,
  field_2100 BOOLEAN,
  field_2110 BOOLEAN,
  field_2300 BOOLEAN,
  field_2350 BOOLEAN,
  field_2400 BOOLEAN,
  field_2500 BOOLEAN,
  field_2510 BOOLEAN,
  field_2520 BOOLEAN,
  field_2530 BOOLEAN,
  field_2540 BOOLEAN,
  field_2550 BOOLEAN,
  field_2560 BOOLEAN,
  field_2570 BOOLEAN,
  field_2575 BOOLEAN,
  field_2580 BOOLEAN,
  field_2590 BOOLEAN,
  field_2600 BOOLEAN,
  field_2610 BOOLEAN,
  field_2620 BOOLEAN,
  field_2630 BOOLEAN,
  field_2640 BOOLEAN,
  field_2650 BOOLEAN,
  field_2660 BOOLEAN,
  field_2700 BOOLEAN,
  field_2730 BOOLEAN,
  field_2740 BOOLEAN,
  field_2750 BOOLEAN,
  field_2760 BOOLEAN,
  field_2770 BOOLEAN,
  field_2780 BOOLEAN,
  field_2790 BOOLEAN,
  field_2800 BOOLEAN,
  field_3200 BOOLEAN,
  field_3205 BOOLEAN,
  field_3210 BOOLEAN,
  field_3220 BOOLEAN,
  field_3230 BOOLEAN,
  field_3235 BOOLEAN,
  field_3240 BOOLEAN,
  field_3250 BOOLEAN,
  field_3260 BOOLEAN,
  field_3270 BOOLEAN,
  field_3400 BOOLEAN,
  field_3600 BOOLEAN,
  field_3610 BOOLEAN,
  field_3900 BOOLEAN,
  field_4000 BOOLEAN,
  field_4010 BOOLEAN,
  field_5000 BOOLEAN,
  field_5010 BOOLEAN,
  field_5030 BOOLEAN,
  field_5031 BOOLEAN,
  field_5032 BOOLEAN,
  field_5450 BOOLEAN,
  field_5460 BOOLEAN,
  field_5800 BOOLEAN,
  field_5810 BOOLEAN,
  field_5820 BOOLEAN,
  field_5830 BOOLEAN,
  field_5840 BOOLEAN,
  field_5841 BOOLEAN,
  field_5842 BOOLEAN,
  field_5843 BOOLEAN,
  field_5844 BOOLEAN,
  field_5845 BOOLEAN,
  field_5846 BOOLEAN,
  field_5847 BOOLEAN,
  field_5848 BOOLEAN,
  field_5849 BOOLEAN,
  field_5850 BOOLEAN,
  field_5851 BOOLEAN,
  field_5852 BOOLEAN,
  field_5853 BOOLEAN,
  field_5854 BOOLEAN,
  field_5855 BOOLEAN,
  field_5856 BOOLEAN,
  field_5857 BOOLEAN,
  field_5858 BOOLEAN,
  field_5859 BOOLEAN,
  field_5860 BOOLEAN,
  field_5861 BOOLEAN,
  field_5862 BOOLEAN,
  field_5863 BOOLEAN,
  field_5864 BOOLEAN,
  PRIMARY KEY (bn, fpe)
);

CREATE TABLE IF NOT EXISTS cra.cra_foundation_info (
  bn VARCHAR(15) NOT NULL,
  fpe DATE NOT NULL,
  form_id INTEGER,
  field_100 NUMERIC(18,2),
  field_110 NUMERIC(18,2),
  field_111 NUMERIC(18,2),
  field_112 NUMERIC(18,2),
  field_120 NUMERIC(18,2),
  field_130 NUMERIC(18,2),
  PRIMARY KEY (bn, fpe)
);

CREATE TABLE IF NOT EXISTS cra.cra_gifts_in_kind (
  bn VARCHAR(15) NOT NULL,
  fpe DATE NOT NULL,
  form_id INTEGER,
  field_500 INTEGER,
  field_505 INTEGER,
  field_510 INTEGER,
  field_515 INTEGER,
  field_520 INTEGER,
  field_525 INTEGER,
  field_530 INTEGER,
  field_535 INTEGER,
  field_540 INTEGER,
  field_545 INTEGER,
  field_550 BOOLEAN,
  field_555 TEXT,
  field_560 TEXT,
  field_565 TEXT,
  field_580 NUMERIC(18,2),
  PRIMARY KEY (bn, fpe)
);

CREATE TABLE IF NOT EXISTS cra.cra_identification (
  bn VARCHAR(15) NOT NULL,
  fiscal_year INTEGER NOT NULL,
  category VARCHAR(10),
  sub_category VARCHAR(10),
  designation CHAR(1),
  legal_name TEXT,
  account_name TEXT,
  address_line_1 TEXT,
  address_line_2 TEXT,
  city TEXT,
  province VARCHAR(2),
  postal_code VARCHAR(10),
  country CHAR(2),
  registration_date DATE,
  language VARCHAR(2),
  contact_phone TEXT,
  contact_email TEXT,
  PRIMARY KEY (bn, fiscal_year)
);

CREATE TABLE IF NOT EXISTS cra.cra_non_qualified_donees (
  bn VARCHAR(15) NOT NULL,
  fpe DATE NOT NULL,
  form_id INTEGER,
  sequence_number INTEGER NOT NULL,
  recipient_name TEXT,
  purpose TEXT,
  cash_amount NUMERIC(18,2),
  non_cash_amount NUMERIC(18,2),
  country CHAR(2),
  PRIMARY KEY (bn, fpe, sequence_number)
);

CREATE TABLE IF NOT EXISTS cra.cra_political_activity_desc (
  bn VARCHAR(15) NOT NULL,
  fpe DATE NOT NULL,
  form_id INTEGER,
  description TEXT,
  PRIMARY KEY (bn, fpe)
);

CREATE TABLE IF NOT EXISTS cra.cra_political_activity_funding (
  bn VARCHAR(15) NOT NULL,
  fpe DATE NOT NULL,
  form_id INTEGER,
  sequence_number INTEGER NOT NULL,
  activity TEXT,
  amount NUMERIC(18,2),
  country CHAR(2),
  PRIMARY KEY (bn, fpe, sequence_number)
);

CREATE TABLE IF NOT EXISTS cra.cra_political_activity_resources (
  bn VARCHAR(15) NOT NULL,
  fpe DATE NOT NULL,
  form_id INTEGER,
  sequence_number INTEGER NOT NULL,
  staff INTEGER,
  volunteers INTEGER,
  financial NUMERIC(18,2),
  property NUMERIC(18,2),
  other_resource TEXT,
  PRIMARY KEY (bn, fpe, sequence_number)
);

CREATE TABLE IF NOT EXISTS cra.cra_program_type_lookup (
  code VARCHAR(2) NOT NULL,
  name_en TEXT NOT NULL,
  name_fr TEXT,
  description_en TEXT,
  description_fr TEXT,
  PRIMARY KEY (code)
);

CREATE TABLE IF NOT EXISTS cra.cra_province_state_lookup (
  code VARCHAR(2) NOT NULL,
  name_en TEXT NOT NULL,
  name_fr TEXT,
  country CHAR(2),
  PRIMARY KEY (code)
);

CREATE TABLE IF NOT EXISTS cra.cra_qualified_donees (
  bn VARCHAR(15) NOT NULL,
  fpe DATE NOT NULL,
  form_id INTEGER,
  sequence_number INTEGER NOT NULL,
  donee_bn VARCHAR(15),
  donee_name TEXT,
  associated BOOLEAN,
  city TEXT,
  province VARCHAR(2),
  total_gifts NUMERIC(18,2),
  gifts_in_kind NUMERIC(18,2),
  number_of_donees INTEGER,
  political_activity_gift BOOLEAN,
  political_activity_amount NUMERIC(18,2),
  PRIMARY KEY (bn, fpe, sequence_number)
);

CREATE TABLE IF NOT EXISTS cra.cra_resources_sent_outside (
  bn VARCHAR(15) NOT NULL,
  fpe DATE NOT NULL,
  form_id INTEGER,
  sequence_number INTEGER NOT NULL,
  individual_org_name TEXT,
  amount NUMERIC(18,2),
  country CHAR(2),
  PRIMARY KEY (bn, fpe, sequence_number)
);

CREATE TABLE IF NOT EXISTS cra.cra_sub_category_lookup (
  category_code VARCHAR(10) NOT NULL,
  sub_category_code VARCHAR(10) NOT NULL,
  name_en TEXT NOT NULL,
  name_fr TEXT,
  description_en TEXT,
  description_fr TEXT,
  PRIMARY KEY (category_code, sub_category_code)
);

CREATE TABLE IF NOT EXISTS cra.cra_web_urls (
  bn VARCHAR(15) NOT NULL,
  fiscal_year INTEGER NOT NULL,
  sequence_number INTEGER NOT NULL,
  contact_url TEXT,
  PRIMARY KEY (bn, fiscal_year, sequence_number)
);

CREATE TABLE IF NOT EXISTS cra.identified_hubs (
  bn VARCHAR(15) NOT NULL,
  legal_name TEXT,
  scc_id INTEGER,
  in_degree INTEGER DEFAULT 0,
  out_degree INTEGER DEFAULT 0,
  total_degree INTEGER DEFAULT 0,
  total_inflow NUMERIC DEFAULT 0,
  total_outflow NUMERIC DEFAULT 0,
  hub_type VARCHAR(50),
  PRIMARY KEY (bn)
);

CREATE TABLE IF NOT EXISTS cra.johnson_cycles (
  id INTEGER NOT NULL,
  hops INTEGER NOT NULL,
  path_bns ARRAY NOT NULL,
  path_display TEXT NOT NULL,
  bottleneck_amt NUMERIC,
  total_flow NUMERIC,
  min_year INTEGER,
  max_year INTEGER,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS cra.loop_edges (
  src VARCHAR(15) NOT NULL,
  dst VARCHAR(15) NOT NULL,
  total_amt NUMERIC DEFAULT 0 NOT NULL,
  edge_count INTEGER DEFAULT 0 NOT NULL,
  min_year INTEGER,
  max_year INTEGER,
  years INTEGER[],
  PRIMARY KEY (src, dst)
);

CREATE TABLE IF NOT EXISTS cra.loop_participants (
  bn VARCHAR(15) NOT NULL,
  loop_id INTEGER NOT NULL,
  position_in_loop INTEGER NOT NULL,
  sends_to VARCHAR(15),
  receives_from VARCHAR(15),
  PRIMARY KEY (loop_id, position_in_loop)
);

CREATE TABLE IF NOT EXISTS cra.loop_universe (
  bn VARCHAR(15) NOT NULL,
  legal_name TEXT,
  total_loops INTEGER DEFAULT 0,
  loops_2hop INTEGER DEFAULT 0,
  loops_3hop INTEGER DEFAULT 0,
  loops_4hop INTEGER DEFAULT 0,
  loops_5hop INTEGER DEFAULT 0,
  loops_6hop INTEGER DEFAULT 0,
  loops_7plus INTEGER DEFAULT 0,
  max_bottleneck NUMERIC DEFAULT 0,
  total_circular_amt NUMERIC DEFAULT 0,
  scored_at TIMESTAMP,
  score INTEGER,
  PRIMARY KEY (bn)
);

CREATE TABLE IF NOT EXISTS cra.loops (
  id INTEGER NOT NULL,
  hops INTEGER NOT NULL,
  path_bns ARRAY NOT NULL,
  path_display TEXT NOT NULL,
  bottleneck_amt NUMERIC,
  total_flow NUMERIC,
  min_year INTEGER,
  max_year INTEGER,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS cra.matrix_census (
  bn VARCHAR(15) NOT NULL,
  legal_name TEXT,
  walks_2 NUMERIC DEFAULT 0,
  walks_3 NUMERIC DEFAULT 0,
  walks_4 NUMERIC DEFAULT 0,
  walks_5 NUMERIC DEFAULT 0,
  walks_6 NUMERIC DEFAULT 0,
  walks_7 NUMERIC DEFAULT 0,
  walks_8 NUMERIC DEFAULT 0,
  max_walk_length INTEGER DEFAULT 0,
  total_walk_count NUMERIC DEFAULT 0,
  in_johnson_cycle BOOLEAN DEFAULT false,
  in_selfjoin_cycle BOOLEAN DEFAULT false,
  scc_id INTEGER,
  scc_size INTEGER,
  PRIMARY KEY (bn)
);

CREATE TABLE IF NOT EXISTS cra.partitioned_cycles (
  id INTEGER NOT NULL,
  hops INTEGER NOT NULL,
  path_bns ARRAY NOT NULL,
  path_display TEXT NOT NULL,
  bottleneck_amt NUMERIC,
  total_flow NUMERIC,
  min_year INTEGER,
  max_year INTEGER,
  tier VARCHAR(20) NOT NULL,
  source_scc_id INTEGER,
  source_scc_size INTEGER,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS cra.scc_components (
  bn VARCHAR(15) NOT NULL,
  scc_id INTEGER NOT NULL,
  scc_root VARCHAR(15) NOT NULL,
  scc_size INTEGER NOT NULL,
  legal_name TEXT,
  PRIMARY KEY (bn)
);

CREATE TABLE IF NOT EXISTS cra.scc_summary (
  scc_id INTEGER NOT NULL,
  scc_root VARCHAR(15) NOT NULL,
  node_count INTEGER NOT NULL,
  edge_count INTEGER DEFAULT 0 NOT NULL,
  total_internal_flow NUMERIC DEFAULT 0,
  cycle_count_from_loops INTEGER DEFAULT 0,
  cycle_count_from_johnson INTEGER DEFAULT 0,
  top_charity_names TEXT[],
  PRIMARY KEY (scc_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_activities_countries_bn_fpe ON cra.cra_activities_outside_countries USING btree (bn, fpe);
CREATE INDEX IF NOT EXISTS idx_activities_countries_country ON cra.cra_activities_outside_countries USING btree (country);
CREATE INDEX IF NOT EXISTS idx_activities_details_bn_fpe ON cra.cra_activities_outside_details USING btree (bn, fpe);
CREATE INDEX IF NOT EXISTS idx_compensation_bn_fpe ON cra.cra_compensation USING btree (bn, fpe);
CREATE INDEX IF NOT EXISTS idx_directors_bn_fpe ON cra.cra_directors USING btree (bn, fpe);
CREATE INDEX IF NOT EXISTS idx_directors_name ON cra.cra_directors USING btree (last_name, first_name);
CREATE INDEX IF NOT EXISTS idx_disbursement_bn_fpe ON cra.cra_disbursement_quota USING btree (bn, fpe);
CREATE INDEX IF NOT EXISTS idx_exported_goods_bn_fpe ON cra.cra_exported_goods USING btree (bn, fpe);
CREATE INDEX IF NOT EXISTS idx_financial_details_bn_fpe ON cra.cra_financial_details USING btree (bn, fpe);
CREATE INDEX IF NOT EXISTS idx_financial_general_bn_fpe ON cra.cra_financial_general USING btree (bn, fpe);
CREATE INDEX IF NOT EXISTS idx_foundation_bn_fpe ON cra.cra_foundation_info USING btree (bn, fpe);
CREATE INDEX IF NOT EXISTS idx_gifts_in_kind_bn_fpe ON cra.cra_gifts_in_kind USING btree (bn, fpe);
CREATE INDEX IF NOT EXISTS idx_identification_account ON cra.cra_identification USING gin (to_tsvector('english'::regconfig, account_name));
CREATE INDEX IF NOT EXISTS idx_identification_category ON cra.cra_identification USING btree (category);
CREATE INDEX IF NOT EXISTS idx_identification_designation ON cra.cra_identification USING btree (designation);
CREATE INDEX IF NOT EXISTS idx_identification_name ON cra.cra_identification USING gin (to_tsvector('english'::regconfig, legal_name));
CREATE INDEX IF NOT EXISTS idx_identification_province ON cra.cra_identification USING btree (province);
CREATE INDEX IF NOT EXISTS idx_identification_year ON cra.cra_identification USING btree (fiscal_year);
CREATE INDEX IF NOT EXISTS idx_johnson_hops ON cra.johnson_cycles USING btree (hops);
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
CREATE INDEX IF NOT EXISTS idx_matrix_census_total ON cra.matrix_census USING btree (total_walk_count DESC);
CREATE INDEX IF NOT EXISTS idx_non_qualified_donees_bn_fpe ON cra.cra_non_qualified_donees USING btree (bn, fpe);
CREATE INDEX IF NOT EXISTS idx_part_cycles_display ON cra.partitioned_cycles USING btree (path_display);
CREATE INDEX IF NOT EXISTS idx_part_cycles_hops ON cra.partitioned_cycles USING btree (hops);
CREATE INDEX IF NOT EXISTS idx_part_cycles_tier ON cra.partitioned_cycles USING btree (tier);
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
CREATE INDEX IF NOT EXISTS idx_scc_comp_size ON cra.scc_components USING btree (scc_size DESC);
CREATE INDEX IF NOT EXISTS idx_scc_summary_size ON cra.scc_summary USING btree (node_count DESC);
CREATE UNIQUE INDEX IF NOT EXISTS johnson_cycles_path_display_key ON cra.johnson_cycles USING btree (path_display);
CREATE UNIQUE INDEX IF NOT EXISTS loops_path_display_key ON cra.loops USING btree (path_display);
CREATE UNIQUE INDEX IF NOT EXISTS partitioned_cycles_path_display_key ON cra.partitioned_cycles USING btree (path_display);

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
