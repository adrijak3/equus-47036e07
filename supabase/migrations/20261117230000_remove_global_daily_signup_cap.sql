-- Retire the custom global 10-accounts-per-day limit.
-- Keep Supabase Auth's own abuse protection and existing Equus CAPTCHA/rate limits.
DROP TRIGGER IF EXISTS equus_auth_daily_signup_cap ON auth.users;
DROP FUNCTION IF EXISTS private.equus_cap_daily_auth_signups();
