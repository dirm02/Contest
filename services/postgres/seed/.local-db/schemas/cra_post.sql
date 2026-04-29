-- Schema: cra (post-data)
-- Exported: 2026-04-21T19:20:26.225Z
-- Apply AFTER loading data/cra/*.csv.
-- Adds UNIQUE/CHECK/FOREIGN KEY constraints and syncs sequences.

-- Unique and check constraints
ALTER TABLE cra.johnson_cycles ADD CONSTRAINT johnson_cycles_path_display_key UNIQUE (path_display);
ALTER TABLE cra.loops ADD CONSTRAINT loops_path_display_key UNIQUE (path_display);
ALTER TABLE cra.partitioned_cycles ADD CONSTRAINT partitioned_cycles_path_display_key UNIQUE (path_display);

-- Foreign keys
ALTER TABLE cra.loop_edge_year_flows ADD CONSTRAINT loop_edge_year_flows_loop_id_fkey FOREIGN KEY (loop_id) REFERENCES cra.loops(id) ON DELETE CASCADE;
ALTER TABLE cra.loop_financials ADD CONSTRAINT loop_financials_loop_id_fkey FOREIGN KEY (loop_id) REFERENCES cra.loops(id) ON DELETE CASCADE;
ALTER TABLE cra.loop_participants ADD CONSTRAINT loop_participants_loop_id_fkey FOREIGN KEY (loop_id) REFERENCES cra.loops(id) ON DELETE CASCADE;

-- Sequence sync (setval to MAX of owning column)
SELECT setval('cra.johnson_cycles_id_seq', GREATEST((SELECT COALESCE(MAX(id), 0) FROM cra.johnson_cycles), 1), (SELECT COUNT(*) FROM cra.johnson_cycles) > 0);
SELECT setval('cra.loops_id_seq', GREATEST((SELECT COALESCE(MAX(id), 0) FROM cra.loops), 1), (SELECT COUNT(*) FROM cra.loops) > 0);
SELECT setval('cra.partitioned_cycles_id_seq', GREATEST((SELECT COALESCE(MAX(id), 0) FROM cra.partitioned_cycles), 1), (SELECT COUNT(*) FROM cra.partitioned_cycles) > 0);
