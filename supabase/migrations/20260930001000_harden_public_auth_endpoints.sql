-- Harden public password-reset / phone-lookup endpoints without adding a paid service.
-- The rate-limit records live in a private schema and are only reachable through
-- the service-role client used by Edge Functions.

CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS private.equus_rate_limits (
  bucket text NOT NULL,
  key_hash text NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS equus_rate_limits_lookup_idx
  ON private.equus_rate_limits (bucket, key_hash, attempted_at DESC);

CREATE OR REPLACE FUNCTION public.consume_equus_rate_limit(
  _bucket text,
  _key_hash text,
  _limit integer,
  _window_seconds integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _count integer;
BEGIN
  IF _bucket IS NULL OR _key_hash IS NULL
     OR _limit < 1 OR _window_seconds < 1
     OR length(_bucket) > 80 OR length(_key_hash) > 128 THEN
    RETURN false;
  END IF;

  -- Serialize attempts for the same bucket/key so concurrent requests
  -- cannot both pass the count check.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(_bucket || ':' || _key_hash, 0)
  );

  DELETE FROM private.equus_rate_limits
  WHERE attempted_at < now() - interval '1 day';

  SELECT count(*)
    INTO _count
  FROM private.equus_rate_limits
  WHERE bucket = _bucket
    AND key_hash = _key_hash
    AND attempted_at >= now() - make_interval(secs => _window_seconds);

  IF _count >= _limit THEN
    RETURN false;
  END IF;

  INSERT INTO private.equus_rate_limits (bucket, key_hash)
  VALUES (_bucket, _key_hash);

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_equus_rate_limit(text, text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consume_equus_rate_limit(text, text, integer, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_equus_rate_limit(text, text, integer, integer) TO service_role;
