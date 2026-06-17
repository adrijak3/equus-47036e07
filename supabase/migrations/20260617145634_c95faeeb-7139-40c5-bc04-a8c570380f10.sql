CREATE OR REPLACE FUNCTION public.enforce_booking_capacity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  cap int;
  taken int;
  caller uuid := auth.uid();
BEGIN
  IF NEW.status <> 'active' THEN
    RETURN NEW;
  END IF;

  -- Admin / trainer can always overbook
  IF caller IS NOT NULL AND (public.has_role(caller, 'admin') OR public.has_role(caller, 'trainer')) THEN
    RETURN NEW;
  END IF;

  -- Resolve capacity: override > time_slot default > 5
  SELECT o.max_capacity INTO cap
    FROM public.slot_overrides o
   WHERE o.slot_date = NEW.slot_date AND o.slot_time = NEW.slot_time
   LIMIT 1;

  IF cap IS NULL THEN
    SELECT ts.max_capacity INTO cap
      FROM public.time_slots ts
     WHERE ts.slot_time = NEW.slot_time
     LIMIT 1;
  END IF;

  IF cap IS NULL THEN cap := 5; END IF;

  SELECT count(*) INTO taken
    FROM public.bookings b
   WHERE b.slot_date = NEW.slot_date
     AND b.slot_time = NEW.slot_time
     AND b.status = 'active'
     AND (TG_OP = 'INSERT' OR b.id <> NEW.id);

  IF taken >= cap THEN
    RAISE EXCEPTION 'SLOT_FULL' USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;