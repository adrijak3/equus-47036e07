-- Existing active bookings are confirmed seats even if a subscription
-- still needs purchasing. Do not change cancelled records or lesson counts.
-- Future registration rules (grace/permanent subscription checks) remain.
BEGIN;
DO $restore$
DECLARE r record; n integer; cap integer;
BEGIN
  -- Protect against conflicts if any other booking changed since inspection.
  FOR r IN
    SELECT DISTINCT slot_date,slot_time FROM public.bookings
    WHERE status='active' AND is_paused_for_subscription
      AND slot_date >= (now() AT TIME ZONE 'Europe/Vilnius')::date
    ORDER BY slot_date,slot_time
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('equus-slot:'||r.slot_date::text||':'||r.slot_time::text,0));
    cap:=public.equus_effective_slot_capacity(r.slot_date,r.slot_time);
    SELECT count(*) INTO n FROM public.bookings
    WHERE slot_date=r.slot_date AND slot_time=r.slot_time
      AND status='active';
    IF cap<=0 OR n>cap THEN
      RAISE EXCEPTION 'Cannot confirm existing active bookings at % %: % active, capacity %',
        r.slot_date,r.slot_time,n,cap;
    END IF;
  END LOOP;

  PERFORM set_config('equus.allow_subscription_pause_update','true',true);
  UPDATE public.bookings
  SET is_paused_for_subscription=false
  WHERE status='active' AND is_paused_for_subscription=true
    AND slot_date >= (now() AT TIME ZONE 'Europe/Vilnius')::date;
END;
$restore$;
COMMIT;