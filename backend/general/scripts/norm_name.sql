-- general.norm_name — canonical name normalizer used across the entity resolution
-- pipeline (exact/norm matching, candidate detection, cross-source joining).
--
-- Preprocessing mirrors Splink's approach (strips TRADE NAME OF, O/A, DBA, AKA,
-- FORMERLY, bilingual "|" / "/" tails, ASSUMED NAME) so that name variants of the
-- same legal entity produce the same canonical key. Legal suffixes (INC, LTD,
-- SOCIETY) are kept to preserve distinctions between legally distinct structures.

CREATE OR REPLACE FUNCTION general.norm_name(name TEXT) RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE STRICT AS $fn$
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
$fn$;
