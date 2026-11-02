-- Admin-managed recurring waitlist for exact weekday/time pairs.
-- Queue entries persist until assigned or explicitly removed by an administrator.

CREATE TABLE IF NOT EXISTS public.permanent_slot_waitlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
  slot_time time NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'assigned', 'removed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  assigned_at timestamptz,
  assigned_permanent_slot_id uuid REFERENCES public.permanent_slots(id) ON DELETE SET NULL,
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS permanent_slot_waitlist_one_pending_per_user_time
  ON public.permanent_slot_waitlist(user_id, day_of_week, slot_time)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS permanent_slot_waitlist_fifo
  ON public.permanent_slot_waitlist(day_of_week, slot_time, created_at, id)
  WHERE status = 'pending';

ALTER TABLE public.permanent_slot_waitlist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins manage recurring waitlist" ON public.permanent_slot_waitlist;
CREATE POLICY "admins manage recurring waitlist"
  ON public.permanent_slot_waitlist
  FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.admin_add_permanent_waitlist(
  _user_id uuid,
  _day_of_week int,
  _slot_time time
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;
  IF _user_id IS NULL OR _day_of_week NOT BETWEEN 1 AND 7 OR _slot_time IS NULL THEN
    RAISE EXCEPTION 'INVALID_WAITLIST_ENTRY';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.time_slots
    WHERE active = true AND one_off_date IS NULL
      AND day_of_week = _day_of_week AND slot_time = _slot_time
  ) THEN
    RAISE EXCEPTION 'RECURRING_TIME_NOT_FOUND';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.permanent_slots
    WHERE user_id = _user_id AND day_of_week = _day_of_week AND slot_time = _slot_time
  ) THEN
    RAISE EXCEPTION 'USER_ALREADY_HAS_THIS_PERMANENT_TIME';
  END IF;

  INSERT INTO public.permanent_slot_waitlist(user_id, day_of_week, slot_time, created_by)
  VALUES (_user_id, _day_of_week, _slot_time, auth.uid())
  ON CONFLICT (user_id, day_of_week, slot_time) WHERE status = 'pending'
  DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Šis žmogus jau laukia šio laiko.');
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_remove_permanent_waitlist_entry(_entry_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;

  UPDATE public.permanent_slot_waitlist
  SET status = 'removed', updated_at = now()
  WHERE id = _entry_id AND status = 'pending';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Laukiančio įrašo nebėra.');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- Remove one recurring place and promote the oldest person waiting for that
-- exact weekday/time in the same transaction. One-date cancellations do not
-- invoke this function and therefore do not affect the recurring queue.
CREATE OR REPLACE FUNCTION public.admin_remove_permanent_slot_and_promote(_permanent_slot_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_slot public.permanent_slots%ROWTYPE;
  v_next public.permanent_slot_waitlist%ROWTYPE;
  v_new_slot_id uuid;
  v_today date := (now() AT TIME ZONE 'Europe/Vilnius')::date;
  v_cancelled integer := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;

  SELECT * INTO v_slot
  FROM public.permanent_slots
  WHERE id = _permanent_slot_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Nuolatinis laikas nerastas.');
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('equus-permanent:' || v_slot.day_of_week::text || ':' || v_slot.slot_time::text, 0)
  );

  UPDATE public.bookings
  SET status = 'cancelled', counts_in_subscription = false, updated_at = now()
  WHERE user_id = v_slot.user_id
    AND slot_time = v_slot.slot_time
    AND slot_date >= v_today
    AND EXTRACT(ISODOW FROM slot_date)::int = v_slot.day_of_week
    AND status IN ('active', 'pending_cancel');

  GET DIAGNOSTICS v_cancelled = ROW_COUNT;

  DELETE FROM public.permanent_slots WHERE id = v_slot.id;

  SELECT * INTO v_next
  FROM public.permanent_slot_waitlist
  WHERE day_of_week = v_slot.day_of_week
    AND slot_time = v_slot.slot_time
    AND status = 'pending'
  ORDER BY created_at, id
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF FOUND THEN
    INSERT INTO public.permanent_slots(user_id, day_of_week, slot_time)
    VALUES (v_next.user_id, v_next.day_of_week, v_next.slot_time)
    ON CONFLICT (user_id, day_of_week, slot_time) DO NOTHING
    RETURNING id INTO v_new_slot_id;

    IF v_new_slot_id IS NOT NULL THEN
      UPDATE public.permanent_slot_waitlist
      SET status = 'assigned',
          assigned_at = now(),
          assigned_permanent_slot_id = v_new_slot_id,
          updated_at = now()
      WHERE id = v_next.id;

      PERFORM public.materialize_permanent_bookings(v_today + 1, v_today + 120);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'cancelled_bookings', v_cancelled,
    'promoted_user_id', CASE WHEN v_new_slot_id IS NOT NULL THEN v_next.user_id ELSE NULL END,
    'promoted_waitlist_id', CASE WHEN v_new_slot_id IS NOT NULL THEN v_next.id ELSE NULL END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_add_permanent_waitlist(uuid, int, time) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_remove_permanent_waitlist_entry(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_remove_permanent_slot_and_promote(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.admin_add_permanent_waitlist(uuid, int, time) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_remove_permanent_waitlist_entry(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_remove_permanent_slot_and_promote(uuid) TO authenticated;
