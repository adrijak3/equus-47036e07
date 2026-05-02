-- 1) Fix permanent slot materialization: skip if ANY booking exists (any status)
CREATE OR REPLACE FUNCTION public.materialize_permanent_bookings(_start date, _end date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  inserted_count integer := 0;
  ps RECORD;
  d date;
  exists_already boolean;
BEGIN
  FOR ps IN SELECT user_id, day_of_week, slot_time FROM public.permanent_slots LOOP
    d := _start;
    WHILE d <= _end LOOP
      IF (CASE WHEN EXTRACT(DOW FROM d)::int = 0 THEN 7 ELSE EXTRACT(DOW FROM d)::int END) = ps.day_of_week THEN
        SELECT EXISTS (
          SELECT 1 FROM public.bookings
          WHERE user_id = ps.user_id
            AND slot_date = d
            AND slot_time = ps.slot_time
        ) INTO exists_already;
        IF NOT exists_already THEN
          BEGIN
            INSERT INTO public.bookings (user_id, slot_date, slot_time, status)
            VALUES (ps.user_id, d, ps.slot_time, 'active');
            inserted_count := inserted_count + 1;
          EXCEPTION WHEN unique_violation THEN
            NULL;
          END;
        END IF;
      END IF;
      d := d + 1;
    END LOOP;
  END LOOP;
  RETURN inserted_count;
END;
$function$;

-- 2) Function to delete old conversations (3+ days since last message)
CREATE OR REPLACE FUNCTION public.cleanup_old_conversations()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  removed integer := 0;
BEGIN
  WITH stale_users AS (
    SELECT user_id
    FROM public.messages
    GROUP BY user_id
    HAVING max(created_at) < (now() - INTERVAL '3 days')
  ),
  del AS (
    DELETE FROM public.messages
    WHERE user_id IN (SELECT user_id FROM stale_users)
    RETURNING 1
  )
  SELECT count(*) INTO removed FROM del;
  RETURN removed;
END;
$function$;