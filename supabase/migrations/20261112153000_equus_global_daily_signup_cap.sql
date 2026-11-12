-- Maximum ten new accounts across the whole Equus project each
-- Europe/Vilnius calendar day (email, Google OAuth, and admin-created).
-- No IP addresses, emails or other personal data stored in quota counters.
-- Accounts created before install today count toward the first day.
CREATE TABLE IF NOT EXISTS private.equus_signup_daily_quota (
  local_date date PRIMARY KEY,
  accounts_created integer NOT NULL DEFAULT 0
    CHECK (accounts_created >= 0 AND accounts_created <= 10),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE private.equus_signup_daily_quota ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.equus_signup_daily_quota FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.equus_cap_daily_auth_signups()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
  v_day date := (statement_timestamp() AT TIME ZONE 'Europe/Vilnius')::date;
  v_count integer;
BEGIN
  INSERT INTO private.equus_signup_daily_quota(local_date, accounts_created, updated_at)
  VALUES (
    v_day,
    1 + (
      SELECT count(*)::integer FROM auth.users u
      WHERE (u.created_at AT TIME ZONE 'Europe/Vilnius')::date = v_day
    ),
    now()
  )
  ON CONFLICT (local_date) DO UPDATE
    SET accounts_created = private.equus_signup_daily_quota.accounts_created + 1,
        updated_at = now()
    WHERE private.equus_signup_daily_quota.accounts_created < 10
  RETURNING accounts_created INTO v_count;

  IF v_count IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'Šiandien naujų paskyrų limitas pasiektas (10). Bandykite rytoj.',
      HINT = 'Dienos limitas atsinaujina 00:00 Lietuvos laiku.';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION private.equus_cap_daily_auth_signups()
  FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS equus_auth_daily_signup_cap ON auth.users;
CREATE TRIGGER equus_auth_daily_signup_cap
  BEFORE INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION private.equus_cap_daily_auth_signups();
COMMENT ON FUNCTION private.equus_cap_daily_auth_signups() IS
  'Transactional global cap of ten auth.users inserts per Europe/Vilnius day; applies to email, OAuth and admin-created accounts.';
