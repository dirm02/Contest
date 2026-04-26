-- Schema: ab (post-data)
-- Exported: 2026-04-21T19:20:28.477Z
-- Apply AFTER loading data/ab/*.csv.
-- Adds UNIQUE/CHECK/FOREIGN KEY constraints and syncs sequences.

-- Unique and check constraints
ALTER TABLE ab.ab_grants_fiscal_years ADD CONSTRAINT ab_grants_fiscal_years_mongo_id_key UNIQUE (mongo_id);
ALTER TABLE ab.ab_grants_ministries ADD CONSTRAINT ab_grants_ministries_mongo_id_key UNIQUE (mongo_id);
ALTER TABLE ab.ab_grants_programs ADD CONSTRAINT ab_grants_programs_mongo_id_key UNIQUE (mongo_id);
ALTER TABLE ab.ab_grants_recipients ADD CONSTRAINT ab_grants_recipients_mongo_id_key UNIQUE (mongo_id);
ALTER TABLE ab.ab_non_profit_status_lookup ADD CONSTRAINT ab_non_profit_status_lookup_status_key UNIQUE (status);

-- Sequence sync (setval to MAX of owning column)
SELECT setval('ab.ab_grants_fiscal_years_id_seq', GREATEST((SELECT COALESCE(MAX(id), 0) FROM ab.ab_grants_fiscal_years), 1), (SELECT COUNT(*) FROM ab.ab_grants_fiscal_years) > 0);
SELECT setval('ab.ab_grants_id_seq', GREATEST((SELECT COALESCE(MAX(id), 0) FROM ab.ab_grants), 1), (SELECT COUNT(*) FROM ab.ab_grants) > 0);
SELECT setval('ab.ab_grants_ministries_id_seq', GREATEST((SELECT COALESCE(MAX(id), 0) FROM ab.ab_grants_ministries), 1), (SELECT COUNT(*) FROM ab.ab_grants_ministries) > 0);
SELECT setval('ab.ab_grants_programs_id_seq', GREATEST((SELECT COALESCE(MAX(id), 0) FROM ab.ab_grants_programs), 1), (SELECT COUNT(*) FROM ab.ab_grants_programs) > 0);
SELECT setval('ab.ab_grants_recipients_id_seq', GREATEST((SELECT COALESCE(MAX(id), 0) FROM ab.ab_grants_recipients), 1), (SELECT COUNT(*) FROM ab.ab_grants_recipients) > 0);
SELECT setval('ab.ab_non_profit_status_lookup_id_seq', GREATEST((SELECT COALESCE(MAX(id), 0) FROM ab.ab_non_profit_status_lookup), 1), (SELECT COUNT(*) FROM ab.ab_non_profit_status_lookup) > 0);
