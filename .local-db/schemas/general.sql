-- Schema: general
-- Exported: 2026-04-15T16:29:12.947Z
CREATE SCHEMA IF NOT EXISTS general;

CREATE TABLE IF NOT EXISTS general.ministries (
  id INTEGER NOT NULL,
  short_name VARCHAR(20) NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  minister TEXT,
  deputy_minister TEXT,
  effective_from DATE,
  effective_to DATE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now(),
  PRIMARY KEY (id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_gen_ministries_active ON general.ministries USING btree (is_active);
CREATE INDEX IF NOT EXISTS idx_gen_ministries_name ON general.ministries USING btree (name);
CREATE INDEX IF NOT EXISTS idx_gen_ministries_short_name ON general.ministries USING btree (short_name);
CREATE UNIQUE INDEX IF NOT EXISTS ministries_short_name_key ON general.ministries USING btree (short_name);
