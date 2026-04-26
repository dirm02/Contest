-- Schema: general (post-data)
-- Exported: 2026-04-21T19:20:30.269Z
-- Apply AFTER loading data/general/*.csv.
-- Adds UNIQUE/CHECK/FOREIGN KEY constraints and syncs sequences.

-- Unique and check constraints
ALTER TABLE general.donee_trigram_candidates ADD CONSTRAINT donee_trigram_candidates_donee_name_norm_key UNIQUE (donee_name_norm);
ALTER TABLE general.ministries ADD CONSTRAINT ministries_short_name_key UNIQUE (short_name);
ALTER TABLE general.ministries_crosswalk ADD CONSTRAINT ministries_crosswalk_confidence_check CHECK (confidence = ANY (ARRAY['exact'::text, 'alias'::text, 'rename'::text, 'merge'::text, 'split-ancestor'::text, 'officer'::text, 'crown'::text, 'unknown'::text]));
ALTER TABLE general.ministries_crosswalk ADD CONSTRAINT ministries_crosswalk_raw_ministry_canonical_short_name_key UNIQUE (raw_ministry, canonical_short_name);
ALTER TABLE general.ministries_history ADD CONSTRAINT ministries_history_short_name_key UNIQUE (short_name);
ALTER TABLE general.splink_aliases ADD CONSTRAINT splink_aliases_cluster_id_alias_source_dataset_source_id_key UNIQUE (cluster_id, alias, source_dataset, source_id);

-- Foreign keys
ALTER TABLE general.donee_trigram_candidates ADD CONSTRAINT donee_trigram_candidates_candidate_entity_id_fkey FOREIGN KEY (candidate_entity_id) REFERENCES general.entities(id);
ALTER TABLE general.entities ADD CONSTRAINT entities_merged_into_fkey FOREIGN KEY (merged_into) REFERENCES general.entities(id);
ALTER TABLE general.entity_merge_candidates ADD CONSTRAINT entity_merge_candidates_entity_id_a_fkey FOREIGN KEY (entity_id_a) REFERENCES general.entities(id);
ALTER TABLE general.entity_merge_candidates ADD CONSTRAINT entity_merge_candidates_entity_id_b_fkey FOREIGN KEY (entity_id_b) REFERENCES general.entities(id);
ALTER TABLE general.entity_merges ADD CONSTRAINT entity_merges_absorbed_id_fkey FOREIGN KEY (absorbed_id) REFERENCES general.entities(id);
ALTER TABLE general.entity_merges ADD CONSTRAINT entity_merges_survivor_id_fkey FOREIGN KEY (survivor_id) REFERENCES general.entities(id);
ALTER TABLE general.entity_resolution_log ADD CONSTRAINT entity_resolution_log_entity_id_fkey FOREIGN KEY (entity_id) REFERENCES general.entities(id);
ALTER TABLE general.entity_source_links ADD CONSTRAINT entity_source_links_entity_id_fkey FOREIGN KEY (entity_id) REFERENCES general.entities(id) ON DELETE CASCADE;

-- Sequence sync (setval to MAX of owning column)
SELECT setval('general.donee_trigram_candidates_id_seq', GREATEST((SELECT COALESCE(MAX(id), 0) FROM general.donee_trigram_candidates), 1), (SELECT COUNT(*) FROM general.donee_trigram_candidates) > 0);
SELECT setval('general.entities_id_seq', GREATEST((SELECT COALESCE(MAX(id), 0) FROM general.entities), 1), (SELECT COUNT(*) FROM general.entities) > 0);
SELECT setval('general.entity_merge_candidates_id_seq', GREATEST((SELECT COALESCE(MAX(id), 0) FROM general.entity_merge_candidates), 1), (SELECT COUNT(*) FROM general.entity_merge_candidates) > 0);
SELECT setval('general.entity_merges_id_seq', GREATEST((SELECT COALESCE(MAX(id), 0) FROM general.entity_merges), 1), (SELECT COUNT(*) FROM general.entity_merges) > 0);
SELECT setval('general.entity_resolution_log_id_seq', GREATEST((SELECT COALESCE(MAX(id), 0) FROM general.entity_resolution_log), 1), (SELECT COUNT(*) FROM general.entity_resolution_log) > 0);
SELECT setval('general.entity_source_links_id_seq', GREATEST((SELECT COALESCE(MAX(id), 0) FROM general.entity_source_links), 1), (SELECT COUNT(*) FROM general.entity_source_links) > 0);
SELECT setval('general.ministries_crosswalk_id_seq', GREATEST((SELECT COALESCE(MAX(id), 0) FROM general.ministries_crosswalk), 1), (SELECT COUNT(*) FROM general.ministries_crosswalk) > 0);
SELECT setval('general.ministries_history_id_seq', GREATEST((SELECT COALESCE(MAX(id), 0) FROM general.ministries_history), 1), (SELECT COUNT(*) FROM general.ministries_history) > 0);
SELECT setval('general.ministries_id_seq', GREATEST((SELECT COALESCE(MAX(id), 0) FROM general.ministries), 1), (SELECT COUNT(*) FROM general.ministries) > 0);
SELECT setval('general.resolution_batches_id_seq', GREATEST((SELECT COALESCE(MAX(id), 0) FROM general.resolution_batches), 1), (SELECT COUNT(*) FROM general.resolution_batches) > 0);
SELECT setval('general.splink_aliases_id_seq', GREATEST((SELECT COALESCE(MAX(id), 0) FROM general.splink_aliases), 1), (SELECT COUNT(*) FROM general.splink_aliases) > 0);
SELECT setval('general.splink_build_metadata_id_seq', GREATEST((SELECT COALESCE(MAX(id), 0) FROM general.splink_build_metadata), 1), (SELECT COUNT(*) FROM general.splink_build_metadata) > 0);
SELECT setval('general.splink_predictions_id_seq', GREATEST((SELECT COALESCE(MAX(id), 0) FROM general.splink_predictions), 1), (SELECT COUNT(*) FROM general.splink_predictions) > 0);
