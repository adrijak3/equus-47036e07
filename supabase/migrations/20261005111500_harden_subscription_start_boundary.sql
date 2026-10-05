-- Equus: make 2026-10-18 a hard data boundary for subscription pauses.
--
-- The subscription system has several layers (eligibility, deadline scan,
-- recurring materialization, restore, and a protected pause-state trigger).
-- Do not simplify those layers here. This migration only enforces one invariant:
--
--   A booking dated before 2026-10-18 can never be marked
--   is_paused_for_subscription = true by the subscription system.
--
-- It also repairs any active/pending rows that were already left paused before
-- the enforcement date. Cancellation status/history is intentionally untouched.

-- Allow the subscription-system cleanup below to clear its own pause/grace
-- flags through the existing protection trigger.
SELECT set_config(
  'equus.allow_subscription_pause_update',
  'true',
  true
);

-- 1. Repair legacy subscription flags before enforcing the invariant.
--    These flags are subscription-system state, not cancellation state.
UPDATE public.bookings
SET
  is_paused_for_subscription = false,
  is_grace_booking = false
WHERE slot_date < DATE '2026-10-18'
  AND (
    is_paused_for_subscription = true
    OR is_grace_booking = true
  );

-- 2. Harden the existing BEFORE UPDATE protection.
--    BEFORE row triggers are allowed to modify NEW; the resulting row is what
--    PostgreSQL applies. This lets the database normalize an impossible
--    pre-enforcement pause back to false rather than creating a hidden booking
--    state. PostgreSQL documents this BEFORE-trigger behavior.
CREATE OR REPLACE FUNCTION public.protect_subscription_pause_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $equus_pause_guard$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.is_paused_for_subscription IS DISTINCT FROM OLD.is_paused_for_subscription
  THEN
    -- Subscription pausing did not exist before the enforcement start.
    IF NEW.is_paused_for_subscription = true
       AND NEW.slot_date < DATE '2026-10-18'
    THEN
      NEW.is_paused_for_subscription := false;
      NEW.is_grace_booking := false;
      RETURN NEW;
    END IF;

    IF current_setting('equus.allow_subscription_pause_update', true) = 'true' THEN
      RETURN NEW;
    END IF;

    IF auth.uid() IS NOT NULL
       AND public.has_role(auth.uid(), 'admin')
    THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'Subscription pause state can only be changed by the Equus subscription system or admin';
  END IF;

  RETURN NEW;
END;
$equus_pause_guard$;

DROP TRIGGER IF EXISTS trg_protect_subscription_pause_state
ON public.bookings;

CREATE TRIGGER trg_protect_subscription_pause_state
BEFORE UPDATE OF is_paused_for_subscription
ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.protect_subscription_pause_state();

-- 3. Database-level invariant. This prevents any other future code path from
--    writing an invalid pre-enforcement pause state, even if it does not go
--    through pause_uncovered_future_bookings().
ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_subscription_pause_starts_2026_10_18;

ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_subscription_pause_starts_2026_10_18
  CHECK (
    is_paused_for_subscription IS NOT TRUE
    OR slot_date >= DATE '2026-10-18'
  );

