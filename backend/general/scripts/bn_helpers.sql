-- general.is_valid_bn_root — returns true iff a 9-digit BN root is a real
-- identifier (not a sentinel placeholder). Called from entity-creation and
-- candidate-detection paths so placeholders never enter bn_root / bn_variants.
--
-- Rejects:
--   - NULL or length < 9
--   - All-zeros:                 000000000
--   - Leading 3+ zeros:          00012xxxx, 000xxxxxx
--   - Single-digit + 8 zeros:    100000000, 200000000, ..., 900000000
--   - Trailing 8+ zeros:         n00000000 pattern (common sentinels)
--
-- Keep in sync with Splink's bn_root() in general/splink/export_source_data.py.

CREATE OR REPLACE FUNCTION general.is_valid_bn_root(bn_root TEXT) RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE AS $fn$
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
$fn$;


-- Convenience: concatenate + uppercase a text[] array for trigram indexing.
-- Postgres marks array_to_string() STABLE, which is rejected in index
-- expressions; this wrapper is IMMUTABLE so it can back a GIN gin_trgm_ops
-- index on alternate_names (dossier search uses the index to do case-
-- insensitive substring search over every alias in one scan).
CREATE OR REPLACE FUNCTION general.array_upper_join(arr TEXT[]) RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $fn$
  SELECT UPPER(array_to_string(arr, ' '));
$fn$;


-- Convenience: extract a valid bn_root from a raw BN string (handles formatting,
-- trimming, 15-digit CRA BN "XXXXXXXXXRR0001" → 9-digit prefix).
CREATE OR REPLACE FUNCTION general.extract_bn_root(raw_bn TEXT) RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE AS $fn$
DECLARE clean TEXT; root TEXT;
BEGIN
  IF raw_bn IS NULL THEN RETURN NULL; END IF;
  clean := regexp_replace(raw_bn, '[^0-9]', '', 'g');
  IF LENGTH(clean) < 9 THEN RETURN NULL; END IF;
  root := LEFT(clean, 9);
  IF NOT general.is_valid_bn_root(root) THEN RETURN NULL; END IF;
  RETURN root;
END;
$fn$;
