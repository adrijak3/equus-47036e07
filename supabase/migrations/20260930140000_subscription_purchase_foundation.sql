-- Subscription purchase/allocation/email foundation.
-- Prices are intentionally NOT seeded yet; the new price list will be provided separately.

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS package_type text,
  ADD COLUMN IF NOT EXISTS horse_type text,
  ADD COLUMN IF NOT EXISTS purchase_method text,
  ADD COLUMN IF NOT EXISTS purchased_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS purchased_at timestamptz;

ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_package_type_chk,
  DROP CONSTRAINT IF EXISTS subscriptions_horse_type_chk,
  DROP CONSTRAINT IF EXISTS subscriptions_purchase_method_chk;

ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_package_type_chk CHECK (package_type IS NULL OR package_type IN ('group','po2')),
  ADD CONSTRAINT subscriptions_horse_type_chk CHECK (horse_type IS NULL OR horse_type IN ('school','private','own')),
  ADD CONSTRAINT subscriptions_purchase_method_chk CHECK (purchase_method IS NULL OR purchase_method IN ('cash','other'));

CREATE INDEX IF NOT EXISTS subscriptions_purchased_by_idx ON public.subscriptions(purchased_by) WHERE purchased_by IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.subscription_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lessons_total smallint NOT NULL CHECK (lessons_total > 0),
  package_type text NOT NULL CHECK (package_type IN ('group','po2')),
  horse_type text NOT NULL CHECK (horse_type IN ('school','private','own')),
  price_eur numeric(10,2) NOT NULL CHECK (price_eur >= 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(lessons_total, package_type, horse_type)
);
ALTER TABLE public.subscription_prices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.subscription_prices FROM anon, authenticated;
GRANT SELECT ON TABLE public.subscription_prices TO authenticated;
CREATE POLICY "Staff view subscription prices" ON public.subscription_prices
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'trainer'));
DROP TRIGGER IF EXISTS update_subscription_prices_updated_at ON public.subscription_prices;
CREATE TRIGGER update_subscription_prices_updated_at BEFORE UPDATE ON public.subscription_prices
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.subscription_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES public.subscriptions(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  amount_eur numeric(10,2) NOT NULL CHECK (amount_eur >= 0),
  payment_method text NOT NULL DEFAULT 'cash' CHECK (payment_method = 'cash'),
  paid_at timestamptz NOT NULL DEFAULT now(),
  recorded_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(subscription_id)
);
ALTER TABLE public.subscription_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.subscription_payments FROM anon, authenticated;
GRANT SELECT ON TABLE public.subscription_payments TO authenticated;
CREATE POLICY "Users and staff view subscription payments" ON public.subscription_payments
  FOR SELECT TO authenticated USING (
    user_id = auth.uid()
    OR public.has_role(auth.uid(),'admin')
    OR public.has_role(auth.uid(),'trainer')
  );
CREATE INDEX IF NOT EXISTS subscription_payments_user_idx ON public.subscription_payments(user_id, paid_at DESC);

CREATE TABLE IF NOT EXISTS public.subscription_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES public.subscriptions(id) ON DELETE CASCADE,
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  allocation_number smallint NOT NULL CHECK (allocation_number > 0),
  status text NOT NULL DEFAULT 'allocated' CHECK (status IN ('allocated','consumed','released','cancelled')),
  allocated_at timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz,
  released_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(subscription_id, booking_id),
  UNIQUE(subscription_id, allocation_number)
);
ALTER TABLE public.subscription_allocations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.subscription_allocations FROM anon, authenticated;
GRANT SELECT ON TABLE public.subscription_allocations TO authenticated;
CREATE POLICY "Users and staff view subscription allocations" ON public.subscription_allocations
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.subscriptions s
      WHERE s.id = subscription_allocations.subscription_id
        AND (s.user_id = auth.uid() OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'trainer'))
    )
  );
CREATE INDEX IF NOT EXISTS subscription_allocations_booking_idx ON public.subscription_allocations(booking_id);
CREATE INDEX IF NOT EXISTS subscription_allocations_status_idx ON public.subscription_allocations(subscription_id, status);

CREATE TABLE IF NOT EXISTS public.email_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key text NOT NULL UNIQUE,
  event_type text NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  email text,
  subscription_id uuid REFERENCES public.subscriptions(id) ON DELETE SET NULL,
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','sent','delivered','bounced','complained','failed')),
  resend_message_id text,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  processing_started_at timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.email_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.email_events FROM anon, authenticated;
GRANT SELECT ON TABLE public.email_events TO authenticated;
CREATE POLICY "Users and staff view email events" ON public.email_events
  FOR SELECT TO authenticated USING (
    user_id = auth.uid()
    OR public.has_role(auth.uid(),'admin')
    OR public.has_role(auth.uid(),'trainer')
  );
CREATE INDEX IF NOT EXISTS email_events_pending_idx ON public.email_events(status, created_at) WHERE status IN ('pending','processing');
CREATE INDEX IF NOT EXISTS email_events_user_idx ON public.email_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS email_events_subscription_idx ON public.email_events(subscription_id, created_at DESC);
CREATE INDEX IF NOT EXISTS email_events_resend_message_idx ON public.email_events(resend_message_id) WHERE resend_message_id IS NOT NULL;
DROP TRIGGER IF EXISTS update_email_events_updated_at ON public.email_events;
CREATE TRIGGER update_email_events_updated_at BEFORE UPDATE ON public.email_events
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.email_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'resend' CHECK (provider = 'resend'),
  provider_event_id text NOT NULL,
  event_type text NOT NULL,
  resend_message_id text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider, provider_event_id)
);
ALTER TABLE public.email_webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.email_webhook_events FROM anon, authenticated;
CREATE INDEX IF NOT EXISTS email_webhook_events_message_idx ON public.email_webhook_events(resend_message_id) WHERE resend_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.subscription_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  target_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  subscription_id uuid REFERENCES public.subscriptions(id) ON DELETE SET NULL,
  payment_id uuid REFERENCES public.subscription_payments(id) ON DELETE SET NULL,
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  action text NOT NULL,
  old_value jsonb,
  new_value jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.subscription_audit_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.subscription_audit_log FROM anon, authenticated;
GRANT SELECT ON TABLE public.subscription_audit_log TO authenticated;
CREATE POLICY "Staff view subscription audit log" ON public.subscription_audit_log
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'trainer'));
CREATE INDEX IF NOT EXISTS subscription_audit_target_idx ON public.subscription_audit_log(target_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS subscription_audit_subscription_idx ON public.subscription_audit_log(subscription_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.admin_purchase_subscription(
  _user_id uuid,
  _lessons_total smallint,
  _package_type text,
  _horse_type text,
  _allocation_mode text DEFAULT 'none'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_email text;
  v_price numeric(10,2);
  v_subscription_id uuid;
  v_payment_id uuid;
  v_booking_id uuid;
  v_allocation_id uuid;
  v_event_id uuid;
  v_purchase_at timestamptz := now();
  v_purchase_date date := current_date;
  v_expires_at date := current_date + 30;
  v_allocation_number smallint;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF NOT (public.has_role(v_actor,'admin') OR public.has_role(v_actor,'trainer')) THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;

  IF _user_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = _user_id) THEN
    RAISE EXCEPTION 'CLIENT_NOT_FOUND';
  END IF;
  IF _lessons_total NOT IN (4,8,12) THEN RAISE EXCEPTION 'INVALID_LESSON_COUNT'; END IF;
  IF _package_type NOT IN ('group','po2') THEN RAISE EXCEPTION 'INVALID_PACKAGE_TYPE'; END IF;
  IF _horse_type NOT IN ('school','private','own') THEN RAISE EXCEPTION 'INVALID_HORSE_TYPE'; END IF;
  IF _allocation_mode NOT IN ('none','today','next') THEN RAISE EXCEPTION 'INVALID_ALLOCATION_MODE'; END IF;

  -- One rider cannot be purchased/allocated concurrently by two staff members.
  PERFORM pg_advisory_xact_lock(hashtextextended(_user_id::text, 0));

  SELECT sp.price_eur INTO v_price
  FROM public.subscription_prices sp
  WHERE sp.lessons_total = _lessons_total
    AND sp.package_type = _package_type
    AND sp.horse_type = _horse_type
    AND sp.active = true;

  IF v_price IS NULL THEN RAISE EXCEPTION 'PRICE_NOT_CONFIGURED'; END IF;

  SELECT u.email INTO v_email FROM auth.users u WHERE u.id = _user_id;

  INSERT INTO public.subscriptions (
    user_id, lessons_total, lessons_used, price, purchase_date, expires_at, paid,
    lesson_type, package_type, horse_type, purchase_method, purchased_by, purchased_at, start_from_date
  ) VALUES (
    _user_id, _lessons_total, 0, v_price, v_purchase_date, v_expires_at, true,
    CASE WHEN _package_type = 'po2' THEN 'sportine_po2' ELSE 'sportine' END,
    _package_type, _horse_type, 'cash', v_actor, v_purchase_at, current_date
  )
  RETURNING id INTO v_subscription_id;

  INSERT INTO public.subscription_payments (
    subscription_id, user_id, amount_eur, payment_method, paid_at, recorded_by
  ) VALUES (
    v_subscription_id, _user_id, v_price, 'cash', v_purchase_at, v_actor
  )
  RETURNING id INTO v_payment_id;

  IF _allocation_mode IN ('today','next') THEN
    SELECT b.id INTO v_booking_id
    FROM public.bookings b
    CROSS JOIN LATERAL (
      SELECT COALESCE(
        (
          SELECT so.max_capacity FROM public.slot_overrides so
          WHERE so.slot_date = b.slot_date AND so.slot_time = b.slot_time
          LIMIT 1
        ),
        (
          SELECT ts.max_capacity FROM public.time_slots ts
          WHERE ts.active = true
            AND ts.slot_time = b.slot_time
            AND (ts.one_off_date = b.slot_date OR (
              ts.one_off_date IS NULL
              AND ts.day_of_week = CASE WHEN extract(dow FROM b.slot_date)::int = 0 THEN 7 ELSE extract(dow FROM b.slot_date)::int END
            ))
            AND (b.trainer_name IS NULL OR ts.trainer_name IS NOT DISTINCT FROM b.trainer_name)
          ORDER BY ts.max_capacity DESC
          LIMIT 1
        ),
        5
      ) AS effective_capacity
    ) cap
    WHERE b.user_id = _user_id
      AND b.status = 'active'
      AND b.subscription_id IS NULL
      AND b.counts_in_subscription = true
      AND b.slot_date BETWEEN CASE WHEN _allocation_mode = 'today' THEN current_date ELSE current_date + 1 END AND v_expires_at
      AND (_allocation_mode = 'next' OR b.slot_date = current_date)
      AND ((_package_type = 'po2' AND cap.effective_capacity = 2) OR (_package_type = 'group' AND cap.effective_capacity >= 3))
    ORDER BY b.slot_date, b.slot_time
    FOR UPDATE OF b SKIP LOCKED
    LIMIT 1;

    IF v_booking_id IS NOT NULL THEN
      UPDATE public.bookings
      SET subscription_id = v_subscription_id, counts_in_subscription = true
      WHERE id = v_booking_id;

      SELECT COALESCE(max(sa.allocation_number),0) + 1 INTO v_allocation_number
      FROM public.subscription_allocations sa WHERE sa.subscription_id = v_subscription_id;

      INSERT INTO public.subscription_allocations(subscription_id, booking_id, allocation_number, status)
      VALUES(v_subscription_id, v_booking_id, v_allocation_number, 'allocated')
      RETURNING id INTO v_allocation_id;

      UPDATE public.subscriptions s
      SET lessons_used = (
        SELECT count(*)::smallint FROM public.bookings b2
        WHERE b2.subscription_id = s.id
          AND b2.status <> 'cancelled'
          AND b2.counts_in_subscription IS NOT FALSE
      )
      WHERE s.id = v_subscription_id;
    END IF;
  END IF;

  INSERT INTO public.email_events(event_key,event_type,user_id,email,subscription_id,booking_id,status)
  VALUES(
    'subscription_purchase:' || v_subscription_id::text,
    'subscription_purchase',
    _user_id,
    v_email,
    v_subscription_id,
    v_booking_id,
    'pending'
  )
  ON CONFLICT(event_key) DO NOTHING
  RETURNING id INTO v_event_id;

  INSERT INTO public.subscription_audit_log(
    actor_user_id,target_user_id,subscription_id,payment_id,booking_id,action,new_value,metadata
  ) VALUES(
    v_actor,_user_id,v_subscription_id,v_payment_id,v_booking_id,'subscription_cash_purchase',
    jsonb_build_object(
      'lessons_total',_lessons_total,
      'package_type',_package_type,
      'horse_type',_horse_type,
      'price_eur',v_price,
      'payment_method','cash',
      'allocation_mode',_allocation_mode
    ),
    jsonb_build_object('email_event_id',v_event_id)
  );

  RETURN jsonb_build_object(
    'ok',true,
    'subscription_id',v_subscription_id,
    'payment_id',v_payment_id,
    'booking_id',v_booking_id,
    'allocation_id',v_allocation_id,
    'email_event_id',v_event_id,
    'email_status','pending',
    'price_eur',v_price,
    'lessons_total',_lessons_total,
    'lessons_used',CASE WHEN v_booking_id IS NULL THEN 0 ELSE 1 END,
    'remaining',_lessons_total - CASE WHEN v_booking_id IS NULL THEN 0 ELSE 1 END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_purchase_subscription(uuid,smallint,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_purchase_subscription(uuid,smallint,text,text,text) TO authenticated;
