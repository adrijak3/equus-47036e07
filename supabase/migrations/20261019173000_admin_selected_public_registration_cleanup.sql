-- Allow admins to delete only explicitly selected closed public registration requests.
-- Active, accepted, approved and confirmed requests are protected from cleanup.

CREATE OR REPLACE FUNCTION public.admin_delete_public_registration_requests(
  _request_ids uuid[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_removed integer := 0;
BEGIN
  v_actor := auth.uid();

  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  IF NOT public.has_role(v_actor, 'admin') THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  IF _request_ids IS NULL OR cardinality(array_remove(_request_ids, NULL)) = 0 THEN
    RETURN 0;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.public_registration_requests r
    WHERE r.id = ANY(array_remove(_request_ids, NULL))
      AND r.status NOT IN ('rejected', 'cancelled', 'completed')
  ) THEN
    RAISE EXCEPTION 'ONLY_CLOSED_REGISTRATION_REQUESTS_CAN_BE_DELETED';
  END IF;

  DELETE FROM public.public_registration_requests r
  WHERE r.id = ANY(array_remove(_request_ids, NULL))
    AND r.status IN ('rejected', 'cancelled', 'completed');

  GET DIAGNOSTICS v_removed = ROW_COUNT;
  RETURN v_removed;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_public_registration_requests(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_public_registration_requests(uuid[]) TO authenticated;
