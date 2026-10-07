-- Equus: guest/newcomer bookings are staff-created schedule entries.
-- They intentionally have bookings.user_id = NULL, so the normal rider
-- authentication guard must not reject them as NOT_AUTHENTICATED.
--
-- Keep this bypass tightly scoped:
--   * only is_guest bookings;
--   * only when a guest_rider_id is present;
--   * only when the caller is an authenticated admin or trainer.
-- Normal rider inserts keep the existing eligibility/authentication checks.

CREATE OR REPLACE FUNCTION public.enforce_booking_eligibility_phase2()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $equus_booking_guard_staff_guest$
DECLARE
  v_result jsonb;
BEGIN
  IF current_setting('equus.allow_permanent_materialization', true) = 'true' THEN
    NEW.is_grace_booking := false;
    RETURN NEW;
  END IF;

  IF current_setting('equus.allow_family_booking_insert', true) = 'true' THEN
    RETURN NEW;
  END IF;

  -- Staff-created newcomer/guest booking.
  IF COALESCE(NEW.is_guest, false) THEN
    IF NEW.guest_rider_id IS NULL THEN
      RAISE EXCEPTION 'GUEST_RIDER_REQUIRED';
    END IF;

    IF auth.uid() IS NULL THEN
      RAISE EXCEPTION 'NOT_AUTHENTICATED';
    END IF;

    IF NOT (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'trainer'::public.app_role)
    ) THEN
      RAISE EXCEPTION 'STAFF_ONLY';
    END IF;

    NEW.is_grace_booking := false;
    RETURN NEW;
  END IF;

  IF NEW.user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  v_result := public.check_booking_eligibility(
    NEW.user_id,
    NEW.slot_date,
    NEW.slot_time,
    true
  );

  IF COALESCE((v_result ->> 'ok')::boolean, false) = false THEN
    RAISE EXCEPTION '%', COALESCE(v_result ->> 'message', 'Registracija negalima.');
  END IF;

  NEW.is_grace_booking :=
    COALESCE((v_result ->> 'grace_booking')::boolean, false);

  RETURN NEW;
END;
$equus_booking_guard_staff_guest$;
