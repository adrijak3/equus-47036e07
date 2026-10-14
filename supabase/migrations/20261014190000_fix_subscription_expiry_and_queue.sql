-- Equus: preserve queued subscriptions and restore the trusted admin expiry-date edit.
-- A second paid package stays undated while the rider still has lessons left
-- in their current package. When the current package reaches its full used
-- count, the queued package starts the following day and expires one calendar
-- month later (e.g. 2026-10-28 through 2026-11-28).

CREATE OR REPLACE FUNCTION public.admin_extend_subscription(
  _subscription_id uuid,
  _new_expires_at date,
  _reason text DEFAULT 'Pratęsė administracija'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $admin_extend_subscription$
DECLARE
  v_actor uuid := auth.uid();
  v_sub public.subscriptions%ROWTYPE;
  v_old_expiry date;
  v_previous_financial_setting text := current_setting(
    'equus.allow_subscription_financial_update',
    true
  );
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;
  IF NOT public.has_role(v_actor, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;
  IF _subscription_id IS NULL OR _new_expires_at IS NULL THEN
    RAISE EXCEPTION 'INVALID_SUBSCRIPTION_EXPIRY';
  END IF;

  SELECT *
    INTO v_sub
  FROM public.subscriptions
  WHERE id = _subscription_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SUBSCRIPTION_NOT_FOUND';
  END IF;
  IF COALESCE(v_sub.start_pending, false) THEN
    RAISE EXCEPTION 'PENDING_SUBSCRIPTION_HAS_NO_EXPIRY';
  END IF;

  v_old_expiry := v_sub.expires_at;
  PERFORM set_config('equus.allow_subscription_financial_update', 'true', true);

  UPDATE public.subscriptions
  SET expires_at = _new_expires_at,
      updated_at = now()
  WHERE id = _subscription_id;

  INSERT INTO public.subscription_audit_log (
    actor_user_id, target_user_id, subscription_id, action,
    old_value, new_value, metadata
  )
  VALUES (
    v_actor, v_sub.user_id, v_sub.id, 'subscription_expiry_adjusted',
    jsonb_build_object('expires_at', v_old_expiry),
    jsonb_build_object('expires_at', _new_expires_at),
    jsonb_build_object(
      'reason', COALESCE(NULLIF(trim(_reason), ''), 'Pratęsė administracija')
    )
  );

  IF v_previous_financial_setting = 'true' THEN
    PERFORM set_config('equus.allow_subscription_financial_update', 'true', true);
  ELSE
    PERFORM set_config('equus.allow_subscription_financial_update', 'false', true);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'subscription_id', v_sub.id,
    'old_expires_at', v_old_expiry,
    'expires_at', _new_expires_at
  );
EXCEPTION
  WHEN OTHERS THEN
    IF v_previous_financial_setting = 'true' THEN
      PERFORM set_config('equus.allow_subscription_financial_update', 'true', true);
    ELSE
      PERFORM set_config('equus.allow_subscription_financial_update', 'false', true);
    END IF;
    RAISE;
END;
$admin_extend_subscription$;

REVOKE ALL ON FUNCTION public.admin_extend_subscription(uuid,date,text)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_extend_subscription(uuid,date,text)
TO authenticated;


-- The currently deployed purchase function calculates dates before INSERT.
-- This narrow BEFORE INSERT guard ensures those dates are not shown/used when
-- the rider already has an unfinished active package.
CREATE OR REPLACE FUNCTION public.queue_subscription_behind_current_package()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $queue_subscription_behind_current$
BEGIN
  IF NEW.paid IS TRUE
     AND NEW.cancelled_at IS NULL
     AND COALESCE(NEW.start_pending, false) IS NOT TRUE
     AND EXISTS (
       SELECT 1
       FROM public.subscriptions current_sub
       WHERE current_sub.user_id = NEW.user_id
         AND current_sub.id IS DISTINCT FROM NEW.id
         AND current_sub.paid IS TRUE
         AND current_sub.cancelled_at IS NULL
         AND COALESCE(current_sub.start_pending, false) IS FALSE
         AND current_sub.start_from_date IS NOT NULL
         AND current_sub.expires_at IS NOT NULL
         AND current_sub.lessons_used < current_sub.lessons_total
     )
  THEN
    NEW.start_pending := true;
    NEW.start_from_date := NULL;
    NEW.expires_at := NULL;
  END IF;
  RETURN NEW;
END;
$queue_subscription_behind_current$;

DROP TRIGGER IF EXISTS trg_queue_subscription_behind_current_package
ON public.subscriptions;
CREATE TRIGGER trg_queue_subscription_behind_current_package
BEFORE INSERT ON public.subscriptions
FOR EACH ROW
EXECUTE FUNCTION public.queue_subscription_behind_current_package();


-- Activate the oldest queued package exactly when the previous package reaches
-- its full used count. Its dates are based on the last completed counted lesson,
-- not on when the next future reservation happens to be booked.
CREATE OR REPLACE FUNCTION public.activate_queued_subscription_after_package_completion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $activate_queued_after_completion$
DECLARE
  v_next_sub_id uuid;
  v_start_date date;
  v_previous_financial_setting text := current_setting(
    'equus.allow_subscription_financial_update',
    true
  );
BEGIN
  IF NEW.paid IS NOT TRUE
     OR NEW.cancelled_at IS NOT NULL
     OR COALESCE(NEW.start_pending, false)
     OR NEW.lessons_used < NEW.lessons_total
     OR (TG_OP = 'UPDATE' AND OLD.lessons_used >= OLD.lessons_total)
  THEN
    RETURN NEW;
  END IF;

  -- Do not start a later package while another active package is unfinished.
  IF EXISTS (
    SELECT 1
    FROM public.subscriptions s
    WHERE s.user_id = NEW.user_id
      AND s.id <> NEW.id
      AND s.paid IS TRUE
      AND s.cancelled_at IS NULL
      AND COALESCE(s.start_pending, false) IS FALSE
      AND s.start_from_date IS NOT NULL
      AND s.expires_at IS NOT NULL
      AND s.lessons_used < s.lessons_total
  ) THEN
    RETURN NEW;
  END IF;

  SELECT s.id
    INTO v_next_sub_id
  FROM public.subscriptions s
  WHERE s.user_id = NEW.user_id
    AND s.id <> NEW.id
    AND s.paid IS TRUE
    AND s.cancelled_at IS NULL
    AND s.start_pending IS TRUE
  ORDER BY s.purchased_at NULLS LAST, s.purchase_date, s.id
  LIMIT 1
  FOR UPDATE;

  IF v_next_sub_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(MAX(b.slot_date) + 1,
                  (now() AT TIME ZONE 'Europe/Vilnius')::date)
    INTO v_start_date
  FROM public.bookings b
  WHERE b.subscription_id = NEW.id
    AND b.status = 'completed'
    AND b.counts_in_subscription IS NOT FALSE;

  PERFORM set_config('equus.allow_subscription_financial_update', 'true', true);

  UPDATE public.subscriptions
  SET start_pending = false,
      start_from_date = v_start_date,
      expires_at = (v_start_date + INTERVAL '1 month')::date,
      updated_at = now()
  WHERE id = v_next_sub_id
    AND start_pending IS TRUE;

  IF v_previous_financial_setting = 'true' THEN
    PERFORM set_config('equus.allow_subscription_financial_update', 'true', true);
  ELSE
    PERFORM set_config('equus.allow_subscription_financial_update', 'false', true);
  END IF;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    IF v_previous_financial_setting = 'true' THEN
      PERFORM set_config('equus.allow_subscription_financial_update', 'true', true);
    ELSE
      PERFORM set_config('equus.allow_subscription_financial_update', 'false', true);
    END IF;
    RAISE WARNING 'Equus queued subscription activation failed for %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$activate_queued_after_completion$;

DROP TRIGGER IF EXISTS trg_activate_queued_subscription_after_package_completion
ON public.subscriptions;
CREATE TRIGGER trg_activate_queued_subscription_after_package_completion
AFTER UPDATE OF lessons_used ON public.subscriptions
FOR EACH ROW
EXECUTE FUNCTION public.activate_queued_subscription_after_package_completion();


-- Catch up packages already queued behind a package that is already fully used.
DO $queued_subscription_catchup$
DECLARE
  v_old record;
  v_next_sub_id uuid;
  v_start_date date;
BEGIN
  FOR v_old IN
    SELECT s.*
    FROM public.subscriptions s
    WHERE s.paid IS TRUE
      AND s.cancelled_at IS NULL
      AND COALESCE(s.start_pending, false) IS FALSE
      AND s.lessons_used >= s.lessons_total
      AND EXISTS (
        SELECT 1 FROM public.subscriptions q
        WHERE q.user_id = s.user_id
          AND q.paid IS TRUE
          AND q.cancelled_at IS NULL
          AND q.start_pending IS TRUE
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.subscriptions active_sub
        WHERE active_sub.user_id = s.user_id
          AND active_sub.id <> s.id
          AND active_sub.paid IS TRUE
          AND active_sub.cancelled_at IS NULL
          AND COALESCE(active_sub.start_pending, false) IS FALSE
          AND active_sub.lessons_used < active_sub.lessons_total
      )
  LOOP
    SELECT q.id INTO v_next_sub_id
    FROM public.subscriptions q
    WHERE q.user_id = v_old.user_id
      AND q.paid IS TRUE
      AND q.cancelled_at IS NULL
      AND q.start_pending IS TRUE
    ORDER BY q.purchased_at NULLS LAST, q.purchase_date, q.id
    LIMIT 1;

    IF v_next_sub_id IS NOT NULL THEN
      SELECT COALESCE(MAX(b.slot_date) + 1,
                      (now() AT TIME ZONE 'Europe/Vilnius')::date)
        INTO v_start_date
      FROM public.bookings b
      WHERE b.subscription_id = v_old.id
        AND b.status = 'completed'
        AND b.counts_in_subscription IS NOT FALSE;

      PERFORM set_config('equus.allow_subscription_financial_update', 'true', true);
      UPDATE public.subscriptions
      SET start_pending = false,
          start_from_date = v_start_date,
          expires_at = (v_start_date + INTERVAL '1 month')::date,
          updated_at = now()
      WHERE id = v_next_sub_id
        AND start_pending IS TRUE;
    END IF;
  END LOOP;
END;
$queued_subscription_catchup$;
