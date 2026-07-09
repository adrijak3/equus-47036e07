
-- 1) Preserve subscription-attached and recent bookings so admin history stays intact.
CREATE OR REPLACE FUNCTION public.cleanup_old_bookings()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  vilnius_today date := (now() AT TIME ZONE 'Europe/Vilnius')::date;
  cutoff date;
  removed integer := 0;
BEGIN
  -- Only delete bookings older than 6 months AND not tied to any subscription record.
  cutoff := (vilnius_today - INTERVAL '6 months')::date;
  WITH del AS (
    DELETE FROM public.bookings
     WHERE slot_date < cutoff
       AND subscription_id IS NULL
    RETURNING 1
  )
  SELECT count(*) INTO removed FROM del;
  RETURN removed;
END;
$$;

-- 2) Atomic vacation: record range + cancel active bookings + refund attributed subs.
CREATE OR REPLACE FUNCTION public.add_vacation_and_cancel(
  _user_id uuid,
  _starts_on date,
  _ends_on date,
  _note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  vac_id uuid;
  cancelled_count int := 0;
  refund_rec RECORD;
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF _ends_on < _starts_on THEN RAISE EXCEPTION 'INVALID_RANGE'; END IF;

  IF caller <> _user_id
     AND NOT public.has_role(caller, 'admin')
     AND NOT public.has_role(caller, 'trainer')
     AND NOT public.owns_profile(caller, _user_id) THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;

  INSERT INTO public.vacations (user_id, starts_on, ends_on, note)
  VALUES (_user_id, _starts_on, _ends_on, NULLIF(btrim(_note), ''))
  RETURNING id INTO vac_id;

  -- Refund subscription counters for each attributed booking being cancelled.
  FOR refund_rec IN
    SELECT subscription_id, count(*) AS n
      FROM public.bookings
     WHERE user_id = _user_id
       AND status = 'active'
       AND slot_date BETWEEN _starts_on AND _ends_on
       AND subscription_id IS NOT NULL
       AND counts_in_subscription IS NOT FALSE
     GROUP BY subscription_id
  LOOP
    UPDATE public.subscriptions
       SET lessons_used = GREATEST(0, lessons_used - refund_rec.n)
     WHERE id = refund_rec.subscription_id;
  END LOOP;

  WITH u AS (
    UPDATE public.bookings
       SET status = 'cancelled',
           counts_in_subscription = false
     WHERE user_id = _user_id
       AND status = 'active'
       AND slot_date BETWEEN _starts_on AND _ends_on
    RETURNING 1
  )
  SELECT count(*) INTO cancelled_count FROM u;

  RETURN jsonb_build_object('vacation_id', vac_id, 'cancelled_bookings', cancelled_count);
END;
$$;
