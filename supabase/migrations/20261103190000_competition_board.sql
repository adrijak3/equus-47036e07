-- Public competition board. Participation is a deliberate opt-in: rider names
-- become visible to everyone only after the rider explicitly joins.
-- Competition participation has no impact on lesson booking or horse limits.
BEGIN;

CREATE TABLE IF NOT EXISTS public.competition_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 3 AND 120),
  event_date date NOT NULL,
  location text NOT NULL DEFAULT '' CHECK (char_length(location) <= 160),
  program_url text NOT NULL CHECK (program_url ~* '^https://[^[:space:]]+$' AND char_length(program_url) <= 1000),
  details text NOT NULL DEFAULT '' CHECK (char_length(details) <= 1000),
  registration_open boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS competition_events_date_idx ON public.competition_events(event_date, id);

CREATE TABLE IF NOT EXISTS public.competition_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.competition_events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  participant_name text NOT NULL CHECK (char_length(btrim(participant_name)) BETWEEN 1 AND 160),
  horse_id uuid NOT NULL REFERENCES public.horses(id),
  horse_name text NOT NULL,
  height_text text NOT NULL CHECK (char_length(btrim(height_text)) BETWEEN 1 AND 80),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, user_id)
);
CREATE INDEX IF NOT EXISTS competition_entries_horse_idx ON public.competition_entries(event_id, horse_name, created_at);

ALTER TABLE public.competition_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competition_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Competition events visible to everyone" ON public.competition_events;
CREATE POLICY "Competition events visible to everyone" ON public.competition_events
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Only admins manage competition events" ON public.competition_events;
CREATE POLICY "Only admins manage competition events" ON public.competition_events
  FOR ALL TO authenticated
  USING (public.has_role((select auth.uid()), 'admin'))
  WITH CHECK (public.has_role((select auth.uid()), 'admin'));

DROP POLICY IF EXISTS "Competition entries visible to everyone" ON public.competition_entries;
CREATE POLICY "Competition entries visible to everyone" ON public.competition_entries
  FOR SELECT TO anon, authenticated USING (true);

-- Events can be written by admins; participants can only write via the
-- validated authenticated RPC below. This prevents forged names/user IDs.
REVOKE INSERT, UPDATE, DELETE ON public.competition_entries FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.competition_events, public.competition_entries TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.competition_events TO authenticated;

CREATE OR REPLACE FUNCTION public.competition_join(
  _event_id uuid, _horse_id uuid, _height_text text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_name text;
  v_horse_name text;
  v_row_id uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'LOGIN_REQUIRED' USING ERRCODE = '42501'; END IF;
  IF char_length(btrim(coalesce(_height_text,''))) NOT BETWEEN 1 AND 80 THEN
    RAISE EXCEPTION 'INVALID_HEIGHT' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.competition_events
    WHERE id = _event_id AND registration_open AND event_date >= (now() AT TIME ZONE 'Europe/Vilnius')::date;
  IF NOT FOUND THEN RAISE EXCEPTION 'COMPETITION_CLOSED' USING ERRCODE = '22023'; END IF;

  SELECT h.name INTO v_horse_name FROM public.horses h WHERE h.id = _horse_id AND h.active;
  IF v_horse_name IS NULL THEN RAISE EXCEPTION 'HORSE_NOT_AVAILABLE' USING ERRCODE = '22023'; END IF;

  SELECT left(btrim(p.full_name),160) INTO v_name FROM public.profiles p WHERE p.id = v_user;
  IF v_name IS NULL OR v_name = '' THEN RAISE EXCEPTION 'PROFILE_NAME_REQUIRED' USING ERRCODE = '22023'; END IF;

  INSERT INTO public.competition_entries(event_id,user_id,participant_name,horse_id,horse_name,height_text)
  VALUES (_event_id,v_user,v_name,_horse_id,v_horse_name,btrim(_height_text))
  ON CONFLICT (event_id,user_id) DO UPDATE SET
    participant_name = excluded.participant_name,
    horse_id = excluded.horse_id,
    horse_name = excluded.horse_name,
    height_text = excluded.height_text,
    updated_at = now()
  RETURNING id INTO v_row_id;
  RETURN jsonb_build_object('ok', true, 'id',v_row_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.competition_leave(_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'LOGIN_REQUIRED' USING ERRCODE = '42501'; END IF;
  DELETE FROM public.competition_entries WHERE event_id = _event_id AND user_id = v_user;
  RETURN jsonb_build_object('ok',true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.competition_admin_remove_entry(_entry_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.competition_entries WHERE id = _entry_id;
  RETURN jsonb_build_object('ok',true);
END;
$function$;

REVOKE ALL ON FUNCTION public.competition_join(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.competition_leave(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.competition_admin_remove_entry(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.competition_join(uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.competition_leave(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.competition_admin_remove_entry(uuid) TO authenticated;
COMMIT;
