-- A failed waitlist promotion must never roll back the cancelling rider's booking.
-- Keep a waiting-list entry until a replacement booking has actually been inserted.
CREATE OR REPLACE FUNCTION public.promote_from_waiting_list()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  next_user uuid;
  next_id uuid;
  inserted_id uuid;
  slot_date_value date;
  slot_time_value time;
BEGIN
  slot_date_value := CASE WHEN TG_OP = 'DELETE' THEN OLD.slot_date ELSE NEW.slot_date END;
  slot_time_value := CASE WHEN TG_OP = 'DELETE' THEN OLD.slot_time ELSE NEW.slot_time END;

  IF (
    (TG_OP = 'UPDATE'
       AND OLD.status = 'active'
       AND NEW.status <> 'active'
       AND OLD.is_paused_for_subscription IS NOT TRUE)
    OR
    (TG_OP = 'DELETE'
       AND OLD.status = 'active'
       AND OLD.is_paused_for_subscription IS NOT TRUE)
  )
  AND COALESCE(current_setting('equus.skip_waitlist_promotion', true), 'false') <> 'true'
  THEN
    SELECT w.id, w.user_id
    INTO next_id, next_user
    FROM public.waiting_list w
    WHERE w.slot_date = slot_date_value
      AND w.slot_time = slot_time_value
    ORDER BY w.created_at, w.id
    FOR UPDATE SKIP LOCKED
    LIMIT 1;

    IF next_id IS NOT NULL THEN
      IF EXISTS (
        SELECT 1
        FROM public.bookings b
        WHERE b.user_id = next_user
          AND b.slot_date = slot_date_value
          AND b.slot_time = slot_time_value
          AND b.status IN ('active', 'pending_cancel')
      ) THEN
        DELETE FROM public.waiting_list WHERE id = next_id;
      ELSE
        BEGIN
          INSERT INTO public.bookings (user_id, slot_date, slot_time, status)
          VALUES (next_user, slot_date_value, slot_time_value, 'active')
          ON CONFLICT DO NOTHING
          RETURNING id INTO inserted_id;

          IF inserted_id IS NOT NULL THEN
            DELETE FROM public.waiting_list WHERE id = next_id;
          ELSE
            RAISE WARNING 'Equus waitlist promotion skipped (conflict): waitlist %, date %, time %',
              next_id, slot_date_value, slot_time_value;
          END IF;
        EXCEPTION WHEN OTHERS THEN
          RAISE WARNING 'Equus waitlist promotion failed: waitlist %, date %, time %, SQLSTATE %, error %',
            next_id, slot_date_value, slot_time_value, SQLSTATE, SQLERRM;
        END;
      END IF;
    END IF;
  END IF;

  RETURN NULL;
END;
$function$;
