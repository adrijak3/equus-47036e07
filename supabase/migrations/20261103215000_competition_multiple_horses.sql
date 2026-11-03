-- Multiple rider interest entries are allowed per event, one per horse.
-- Individual entries can be edited (including horse) or deleted by their owner.
BEGIN;
ALTER TABLE public.competition_entries
  DROP CONSTRAINT IF EXISTS competition_entries_event_id_user_id_key;
ALTER TABLE public.competition_entries
  ADD CONSTRAINT competition_entries_event_user_horse_unique UNIQUE(event_id,user_id,horse_id);
CREATE INDEX IF NOT EXISTS competition_entries_user_event_idx
  ON public.competition_entries(user_id,event_id);

CREATE OR REPLACE FUNCTION public.competition_join(
  _event_id uuid,_horse_id uuid,_height_text text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $join$
DECLARE v_uid uuid:=auth.uid();v_name text;v_horse text;v_id uuid;
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'LOGIN_REQUIRED' USING ERRCODE='42501'; END IF;
 IF length(btrim(coalesce(_height_text,''))) NOT BETWEEN 1 AND 80 THEN
   RAISE EXCEPTION 'INVALID_HEIGHT' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM public.competition_events
  WHERE id=_event_id AND registration_open
    AND event_date >= (now() AT TIME ZONE 'Europe/Vilnius')::date;
 IF NOT FOUND THEN RAISE EXCEPTION 'COMPETITION_CLOSED' USING ERRCODE='22023'; END IF;
 SELECT h.name INTO v_horse FROM public.horses h WHERE h.id=_horse_id AND h.active;
 IF v_horse IS NULL THEN RAISE EXCEPTION 'HORSE_NOT_AVAILABLE' USING ERRCODE='22023'; END IF;
 SELECT left(btrim(p.full_name),160) INTO v_name FROM public.profiles p WHERE p.id=v_uid;
 IF v_name IS NULL OR v_name='' THEN RAISE EXCEPTION 'PROFILE_NAME_REQUIRED' USING ERRCODE='22023'; END IF;

 INSERT INTO public.competition_entries(event_id,user_id,participant_name,horse_id,horse_name,height_text)
 VALUES(_event_id,v_uid,v_name,_horse_id,v_horse,btrim(_height_text))
 ON CONFLICT(event_id,user_id,horse_id) DO UPDATE
  SET participant_name=excluded.participant_name,height_text=excluded.height_text,updated_at=now()
 RETURNING id INTO v_id;
 RETURN jsonb_build_object('ok',true,'id',v_id);
END;
$join$;

CREATE OR REPLACE FUNCTION public.competition_update_entry(
 _entry_id uuid,_horse_id uuid,_height_text text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $update$
DECLARE v_uid uuid:=auth.uid();v_horse text;v_id uuid;
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'LOGIN_REQUIRED' USING ERRCODE='42501'; END IF;
 IF length(btrim(coalesce(_height_text,''))) NOT BETWEEN 1 AND 80 THEN
  RAISE EXCEPTION 'INVALID_HEIGHT' USING ERRCODE='22023'; END IF;
 SELECT h.name INTO v_horse FROM public.horses h WHERE h.id=_horse_id AND h.active;
 IF v_horse IS NULL THEN RAISE EXCEPTION 'HORSE_NOT_AVAILABLE' USING ERRCODE='22023'; END IF;
 UPDATE public.competition_entries ce
 SET horse_id=_horse_id,horse_name=v_horse,height_text=btrim(_height_text),updated_at=now()
 FROM public.competition_events e
 WHERE ce.id=_entry_id AND ce.user_id=v_uid
   AND e.id=ce.event_id AND e.registration_open
   AND e.event_date >= (now() AT TIME ZONE 'Europe/Vilnius')::date
 RETURNING ce.id INTO v_id;
 IF v_id IS NULL THEN RAISE EXCEPTION 'ENTRY_NOT_EDITABLE' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('ok',true,'id',v_id);
END;
$update$;

CREATE OR REPLACE FUNCTION public.competition_remove_my_entry(_entry_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $remove$
DECLARE v_uid uuid:=auth.uid();v_deleted int;
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'LOGIN_REQUIRED' USING ERRCODE='42501'; END IF;
 DELETE FROM public.competition_entries
 WHERE id=_entry_id AND user_id=v_uid;
 GET DIAGNOSTICS v_deleted=ROW_COUNT;
 RETURN jsonb_build_object('ok',v_deleted>0);
END;
$remove$;
REVOKE ALL ON FUNCTION public.competition_update_entry(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.competition_remove_my_entry(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.competition_update_entry(uuid,uuid,text),
 public.competition_remove_my_entry(uuid) TO authenticated,service_role;
COMMIT;
