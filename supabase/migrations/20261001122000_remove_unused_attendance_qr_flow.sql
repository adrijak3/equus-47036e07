-- Equus: QR is a client/subscription lookup tool, not an attendance system.
-- Remove the temporary attendance fields/RPC that were added during scanner testing.

DROP FUNCTION IF EXISTS public.confirm_client_qr_attendance(text, uuid);

DROP INDEX IF EXISTS public.bookings_checked_in_by_idx;

ALTER TABLE public.bookings
  DROP COLUMN IF EXISTS checked_in_by,
  DROP COLUMN IF EXISTS checked_in_at;
