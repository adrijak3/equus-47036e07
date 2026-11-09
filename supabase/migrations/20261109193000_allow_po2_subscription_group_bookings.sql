-- A po2 abonementas also covers group lessons; group abonementai already cover po2.
-- Preserve the existing accounting and surcharge logic.
CREATE OR REPLACE FUNCTION public.booking_subscription_is_usable_for_slot(_user_id uuid, _slot_date date, _slot_time time without time zone)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_capacity integer;
  v_slot_package_type text;
BEGIN
  v_capacity := public.equus_effective_slot_capacity(_slot_date, _slot_time);

  IF v_capacity <= 0 THEN
    RETURN false;
  END IF;

  v_slot_package_type := CASE
    WHEN v_capacity = 1 THEN 'individual'
    WHEN v_capacity = 2 THEN 'po2'
    ELSE 'group'
  END;

  RETURN EXISTS (
    SELECT 1
    FROM public.subscriptions s
    WHERE s.user_id = _user_id
      AND s.paid = true
      AND s.cancelled_at IS NULL
      AND s.start_pending = false
      AND COALESCE(s.lessons_total, 0) > 0
      AND public.subscription_committed_lessons(s.id) < s.lessons_total
      AND COALESCE(s.start_from_date, s.purchase_date) IS NOT NULL
      AND s.expires_at IS NOT NULL
      AND COALESCE(s.start_from_date, s.purchase_date) <= _slot_date
      AND s.expires_at >= _slot_date
      AND (
        -- A group package is the base package and can be upgraded to po2
        -- or individual lessons by paying the applicable surcharge.
        COALESCE(
          s.package_type,
          CASE WHEN s.lesson_type = 'sportine_po2' THEN 'po2' ELSE 'group' END
        ) = 'group'
        OR (
          v_slot_package_type IN ('po2', 'group')
          AND COALESCE(
            s.package_type,
            CASE WHEN s.lesson_type = 'sportine_po2' THEN 'po2' ELSE 'group' END
          ) = 'po2'
        )
        OR (
          v_slot_package_type = 'individual'
          AND COALESCE(
            s.package_type,
            CASE WHEN s.lesson_type = 'sportine_po2' THEN 'po2' ELSE 'group' END
          ) = 'individual'
        )
      )
  );
END;
$function$
