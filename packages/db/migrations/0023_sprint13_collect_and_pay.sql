-- Sprint 13 (Phase 3): collect and pay.
-- app.post_receipt posts a counter or gateway receipt in one transaction (validate, number, allocate per
-- instalment, post the late fee, keep the advance); late fee postings per instalment; refunds with an
-- approval step and app.apply_fee_refund reversing allocations; gateway settlement files matched against
-- intents; transport requests (workflow) and vehicle logs; audit triggers on the money tables; permissions
-- for the cashier, refunds, settlements, families paying online, transport requests and department dashboards.

-- ---------------------------------------------------------------------------
-- Receipts: collection detail on fee_payments (legacy fees: PaymentMode, ChequeNo, BankName, ChequeDate;
-- fees_transaction: ActualLateFee/AdjustedLateFee become postings)
-- ---------------------------------------------------------------------------
ALTER TABLE fee_payments
  ADD COLUMN late_fee           NUMERIC(12, 2) NOT NULL DEFAULT 0,   -- late fee collected on this receipt
  ADD COLUMN refunded           NUMERIC(12, 2) NOT NULL DEFAULT 0,   -- refunds paid out against this receipt
  ADD COLUMN status             TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted', 'partly_refunded', 'refunded', 'bounced')),
  ADD COLUMN instrument_no      TEXT,                                -- cheque or DD number
  ADD COLUMN instrument_date    DATE,
  ADD COLUMN bank_name          TEXT,
  ADD COLUMN settlement_line_id BIGINT,
  ADD COLUMN request_id         UUID,
  ADD COLUMN updated_at         TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE fee_payments ADD CONSTRAINT fee_payments_mode_check
  CHECK (mode IN ('online', 'cash', 'cheque', 'dd', 'upi', 'bank', 'card'));
CREATE TRIGGER fee_payments_set_updated_at BEFORE UPDATE ON fee_payments
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- The late fee collected on a receipt for one instalment (rows sharing a due date). app.late_fee computes,
-- postings record what was actually charged; the ledger shows computed, posted and outstanding.
CREATE TABLE fee_late_fee_postings (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id        BIGINT NOT NULL REFERENCES schools(id),
  payment_id       BIGINT NOT NULL REFERENCES fee_payments(id) ON DELETE CASCADE,
  student_id       BIGINT NOT NULL REFERENCES students(id),
  academic_year_id BIGINT NOT NULL REFERENCES academic_years(id),
  due_on           DATE NOT NULL,
  period_id        BIGINT REFERENCES fee_periods(id),
  amount           NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  mode             TEXT NOT NULL,                                   -- daywise, slab, override
  days             INT NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX fee_late_fee_postings_by_instalment ON fee_late_fee_postings (student_id, academic_year_id, due_on);
CREATE INDEX fee_late_fee_postings_by_payment ON fee_late_fee_postings (payment_id);

-- ---------------------------------------------------------------------------
-- Refunds: requested by the accounts desk, approved by an administrator, paid out by cash, bank, cheque or
-- through the gateway that collected the money.
-- ---------------------------------------------------------------------------
CREATE TYPE refund_status AS ENUM ('requested', 'approved', 'rejected', 'paid', 'failed');
CREATE TABLE fee_refunds (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id     BIGINT NOT NULL REFERENCES schools(id),
  payment_id    BIGINT NOT NULL REFERENCES fee_payments(id),
  amount        NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  reason        TEXT NOT NULL,
  mode          TEXT NOT NULL CHECK (mode IN ('cash', 'bank', 'cheque', 'gateway')),
  reference     TEXT,
  status        refund_status NOT NULL DEFAULT 'requested',
  requested_by  BIGINT,
  requested_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by    BIGINT,
  decided_at    TIMESTAMPTZ,
  decision_note TEXT,
  provider      TEXT,
  provider_ref  TEXT,
  paid_on       DATE,
  request_id    UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX fee_refunds_by_payment ON fee_refunds (payment_id);
CREATE UNIQUE INDEX fee_refunds_open ON fee_refunds (payment_id) WHERE status IN ('requested', 'approved');
CREATE TRIGGER fee_refunds_set_updated_at BEFORE UPDATE ON fee_refunds
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- ---------------------------------------------------------------------------
-- Gateway settlements: the provider's payout file, one line per transaction, matched to intents
-- ---------------------------------------------------------------------------
CREATE TABLE payment_settlements (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id      BIGINT NOT NULL REFERENCES schools(id),
  provider       TEXT NOT NULL,
  settlement_ref TEXT NOT NULL,
  settled_on     DATE NOT NULL,
  utr            TEXT,
  gross          NUMERIC(14, 2) NOT NULL DEFAULT 0,
  charges        NUMERIC(14, 2) NOT NULL DEFAULT 0,
  tax            NUMERIC(14, 2) NOT NULL DEFAULT 0,
  net            NUMERIC(14, 2) NOT NULL DEFAULT 0,
  rows           INT NOT NULL DEFAULT 0,
  matched        INT NOT NULL DEFAULT 0,
  unmatched      INT NOT NULL DEFAULT 0,
  mismatched     INT NOT NULL DEFAULT 0,
  file_name      TEXT,
  uploaded_by    BIGINT,
  request_id     UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, provider, settlement_ref)
);
CREATE TABLE payment_settlement_lines (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id     BIGINT NOT NULL REFERENCES schools(id),
  settlement_id BIGINT NOT NULL REFERENCES payment_settlements(id) ON DELETE CASCADE,
  line_no       INT NOT NULL,
  provider_ref  TEXT,
  txn_id        TEXT,
  amount        NUMERIC(12, 2) NOT NULL,
  charges       NUMERIC(12, 2) NOT NULL DEFAULT 0,
  tax           NUMERIC(12, 2) NOT NULL DEFAULT 0,
  net           NUMERIC(12, 2),
  status        TEXT NOT NULL CHECK (status IN ('matched', 'unmatched', 'amount_mismatch', 'duplicate', 'refund')),
  intent_id     BIGINT REFERENCES payment_intents(id),
  payment_id    BIGINT REFERENCES fee_payments(id),
  note          TEXT
);
CREATE INDEX payment_settlement_lines_by_settlement ON payment_settlement_lines (settlement_id, line_no);
ALTER TABLE fee_payments ADD CONSTRAINT fee_payments_settlement_line_fk
  FOREIGN KEY (settlement_line_id) REFERENCES payment_settlement_lines(id);

-- Gateway adapters: the provider's order id (Razorpay order, CCAvenue tracking) and refunds on the intent
ALTER TABLE payment_intents
  ADD COLUMN provider_order_id TEXT,
  ADD COLUMN refunded          NUMERIC(12, 2) NOT NULL DEFAULT 0;
CREATE INDEX payment_intents_provider_order ON payment_intents (provider, provider_order_id) WHERE provider_order_id IS NOT NULL;

-- Cross-tenant lookup by the provider's order id, for gateways whose notifications do not carry our
-- transaction id (SECURITY DEFINER, ids only; the caller then works inside the tenant transaction, ADR-009).
CREATE OR REPLACE FUNCTION app.payment_intent_lookup_by_order(p_provider TEXT, p_order_id TEXT)
RETURNS TABLE (school_id BIGINT, intent_id BIGINT, txn_id TEXT)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT school_id, id, txn_id FROM payment_intents WHERE provider = p_provider AND provider_order_id = p_order_id
$$;
REVOKE ALL ON FUNCTION app.payment_intent_lookup_by_order(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.payment_intent_lookup_by_order(TEXT, TEXT) TO edupro_app;

-- Same for a provider's refund reference (refund.processed webhooks name the refund, not the order).
CREATE OR REPLACE FUNCTION app.refund_lookup(p_provider TEXT, p_provider_ref TEXT)
RETURNS TABLE (school_id BIGINT, refund_id BIGINT)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT school_id, id FROM fee_refunds WHERE provider = p_provider AND provider_ref = p_provider_ref
$$;
REVOKE ALL ON FUNCTION app.refund_lookup(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.refund_lookup(TEXT, TEXT) TO edupro_app;

-- ---------------------------------------------------------------------------
-- Transport: student requests (join, change stop or route, leave) and vehicle logs
-- ---------------------------------------------------------------------------
CREATE TYPE transport_request_kind AS ENUM ('join', 'change', 'leave');
CREATE TABLE transport_requests (
  id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id            BIGINT NOT NULL REFERENCES schools(id),
  student_id           BIGINT NOT NULL REFERENCES students(id),
  academic_year_id     BIGINT NOT NULL REFERENCES academic_years(id),
  kind                 transport_request_kind NOT NULL,
  route_id             BIGINT REFERENCES transport_routes(id),
  stop_id              BIGINT REFERENCES transport_stops(id),
  effective_from       DATE,
  note                 TEXT,
  status               workflow_status NOT NULL DEFAULT 'pending',
  requested_by         BIGINT,
  requested_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  workflow_instance_id BIGINT REFERENCES workflow_instances(id),
  decided_by           BIGINT,
  decided_at           TIMESTAMPTZ,
  decision_note        TEXT,
  request_id           UUID,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (kind = 'leave' OR route_id IS NOT NULL)
);
CREATE UNIQUE INDEX transport_requests_open ON transport_requests (student_id, academic_year_id) WHERE status = 'pending';
CREATE INDEX transport_requests_by_school ON transport_requests (school_id, academic_year_id, status);
CREATE TRIGGER transport_requests_set_updated_at BEFORE UPDATE ON transport_requests
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE TABLE transport_vehicle_logs (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id      BIGINT NOT NULL REFERENCES schools(id),
  vehicle_id     BIGINT NOT NULL REFERENCES transport_vehicles(id),
  route_id       BIGINT REFERENCES transport_routes(id),
  driver_id      BIGINT REFERENCES transport_drivers(id),
  log_date       DATE NOT NULL,
  odometer_start INT CHECK (odometer_start IS NULL OR odometer_start >= 0),
  odometer_end   INT CHECK (odometer_end IS NULL OR odometer_start IS NULL OR odometer_end >= odometer_start),
  fuel_litres    NUMERIC(8, 2) CHECK (fuel_litres IS NULL OR fuel_litres >= 0),
  fuel_cost      NUMERIC(10, 2) CHECK (fuel_cost IS NULL OR fuel_cost >= 0),
  trips          INT CHECK (trips IS NULL OR trips >= 0),
  incident       TEXT,
  remarks        TEXT,
  created_by     BIGINT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (vehicle_id, log_date)
);
CREATE INDEX transport_vehicle_logs_by_date ON transport_vehicle_logs (school_id, log_date DESC);

-- ---------------------------------------------------------------------------
-- Row-level security and audit triggers (money tables keep a row-change trail besides the API audit)
-- ---------------------------------------------------------------------------
CALL app.apply_tenant_rls('fee_late_fee_postings');
CALL app.apply_tenant_rls('fee_refunds');
CALL app.apply_tenant_rls('payment_settlements');
CALL app.apply_tenant_rls('payment_settlement_lines');
CALL app.apply_tenant_rls('transport_requests');
CALL app.apply_tenant_rls('transport_vehicle_logs');

CREATE TRIGGER fee_payments_audit AFTER INSERT OR UPDATE OR DELETE ON fee_payments
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE TRIGGER fee_payment_allocations_audit AFTER INSERT OR UPDATE OR DELETE ON fee_payment_allocations
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE TRIGGER fee_late_fee_postings_audit AFTER INSERT OR UPDATE OR DELETE ON fee_late_fee_postings
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE TRIGGER fee_refunds_audit AFTER INSERT OR UPDATE OR DELETE ON fee_refunds
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

-- ---------------------------------------------------------------------------
-- app.allocate_to_instalment: allocates up to p_amount of a payment to one instalment (the rows sharing a
-- due date), oldest row first, and settles the credit rows when the instalment is covered. Returns the
-- amount taken. Both app.allocate_fee_payment and app.post_receipt use it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.allocate_to_instalment(p_payment_id BIGINT, p_student_id BIGINT, p_academic_year_id BIGINT, p_due_on DATE, p_amount NUMERIC)
RETURNS NUMERIC
LANGUAGE plpgsql AS $$
DECLARE
  v_left  NUMERIC := p_amount;
  v_take  NUMERIC;
  d RECORD;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN RETURN 0; END IF;
  FOR d IN
    SELECT id, net, paid FROM fee_demands
     WHERE student_id = p_student_id AND academic_year_id = p_academic_year_id AND due_on = p_due_on
       AND status IN ('pending', 'partial') AND net > paid
     ORDER BY id FOR UPDATE
  LOOP
    EXIT WHEN v_left <= 0;
    v_take := LEAST(v_left, d.net - d.paid);
    INSERT INTO fee_payment_allocations (school_id, payment_id, demand_id, amount) VALUES (app.current_school_id(), p_payment_id, d.id, v_take);
    UPDATE fee_demands SET paid = paid + v_take, status = CASE WHEN paid + v_take >= net THEN 'paid' ELSE 'partial' END::fee_demand_status, updated_at = now() WHERE id = d.id;
    v_left := v_left - v_take;
  END LOOP;
  -- instalment settled: apply the credit rows against whatever the cash left short
  IF (SELECT COALESCE(sum(net - paid), 0) FROM fee_demands
       WHERE student_id = p_student_id AND academic_year_id = p_academic_year_id AND due_on = p_due_on AND status IN ('pending', 'partial', 'paid')) <= 0 THEN
    UPDATE fee_demands SET paid = net, status = 'paid', updated_at = now()
     WHERE student_id = p_student_id AND academic_year_id = p_academic_year_id AND due_on = p_due_on AND status IN ('pending', 'partial');
  END IF;
  RETURN p_amount - v_left;
END
$$;

-- Same behaviour as Sprint 12 (oldest instalment first, never more than an instalment's balance), now on top
-- of app.allocate_to_instalment. Returns the unallocated remainder (advance).
CREATE OR REPLACE FUNCTION app.allocate_fee_payment(p_payment_id BIGINT) RETURNS NUMERIC
LANGUAGE plpgsql AS $$
DECLARE
  v_p     fee_payments%ROWTYPE;
  v_left  NUMERIC;
  g RECORD;
BEGIN
  PERFORM app.assert_context();
  SELECT * INTO v_p FROM fee_payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'fees.payment_not_found' USING ERRCODE = 'P0002'; END IF;
  v_left := v_p.amount - v_p.late_fee;
  FOR g IN
    SELECT due_on, sum(net - paid) AS balance FROM fee_demands
     WHERE student_id = v_p.student_id AND academic_year_id = v_p.academic_year_id AND status IN ('pending', 'partial')
     GROUP BY due_on HAVING sum(net - paid) > 0 ORDER BY due_on
  LOOP
    EXIT WHEN v_left <= 0;
    v_left := v_left - app.allocate_to_instalment(p_payment_id, v_p.student_id, v_p.academic_year_id, g.due_on, LEAST(v_left, g.balance));
  END LOOP;
  RETURN v_left;
END
$$;

-- Late fee already posted for an instalment of a student
CREATE OR REPLACE FUNCTION app.late_fee_posted(p_student_id BIGINT, p_academic_year_id BIGINT, p_due_on DATE) RETURNS NUMERIC
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(sum(amount), 0) FROM fee_late_fee_postings
   WHERE student_id = p_student_id AND academic_year_id = p_academic_year_id AND due_on = p_due_on
$$;

-- ---------------------------------------------------------------------------
-- app.post_receipt: the collection procedure (legacy fee_submit + fees + fees_transaction in one place).
--   1. validate the student, the amount, the mode and that the year is open for fees
--   2. insert the payment and number it from the row-locked sequence of its ledger and financial year
--   3. walk the instalments oldest first: settle the principal, then post the late fee due on the
--      settlement date (less anything already posted); a receipt that cannot cover an instalment and its
--      late fee pays the principal first, then as much late fee as remains
--   4. whatever is left is an advance on the receipt (credited to the next demand by allocation later)
-- Cash at the counter and a gateway success both post through this procedure.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.post_receipt(
  p_student_id       BIGINT,
  p_academic_year_id BIGINT,
  p_amount           NUMERIC,
  p_received_on      DATE,
  p_mode             TEXT,
  p_reference        TEXT DEFAULT NULL,
  p_remarks          TEXT DEFAULT NULL,
  p_instrument_no    TEXT DEFAULT NULL,
  p_instrument_date  DATE DEFAULT NULL,
  p_bank_name        TEXT DEFAULT NULL,
  p_intent_id        BIGINT DEFAULT NULL,
  p_ledger           ledger_type DEFAULT 'school',
  p_collect_late_fee BOOLEAN DEFAULT true,
  p_strict_year      BOOLEAN DEFAULT true
) RETURNS TABLE (o_payment_id BIGINT, o_receipt_no TEXT, o_principal NUMERIC, o_late_fee NUMERIC, o_advance NUMERIC, o_instalments INT)
LANGUAGE plpgsql AS $$
DECLARE
  v_payment_id BIGINT;
  v_fy         BIGINT;
  v_left       NUMERIC := p_amount;
  v_lf         NUMERIC;
  v_take       NUMERIC;
  v_principal  NUMERIC := 0;
  v_late       NUMERIC := 0;
  v_n          INT := 0;
  g  RECORD;
  lf RECORD;
BEGIN
  PERFORM app.assert_context();
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'fees.amount_invalid' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('amount', p_amount)::TEXT;
  END IF;
  IF p_mode IS NULL OR p_mode NOT IN ('online', 'cash', 'cheque', 'dd', 'upi', 'bank', 'card') THEN
    RAISE EXCEPTION 'fees.mode_invalid' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('mode', p_mode)::TEXT;
  END IF;
  IF p_mode IN ('cheque', 'dd') AND NULLIF(btrim(COALESCE(p_instrument_no, '')), '') IS NULL THEN
    RAISE EXCEPTION 'fees.instrument_required' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('mode', p_mode)::TEXT;
  END IF;
  PERFORM 1 FROM students WHERE id = p_student_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'fees.student_not_found' USING ERRCODE = 'P0002', DETAIL = jsonb_build_object('student_id', p_student_id)::TEXT;
  END IF;
  PERFORM app.assert_year_open(p_academic_year_id, 'fees');

  v_fy := app.financial_year_for(p_received_on);
  IF v_fy IS NULL AND NOT p_strict_year THEN v_fy := app.financial_year_for(CURRENT_DATE); END IF;
  IF v_fy IS NULL THEN
    RAISE EXCEPTION 'fees.no_financial_year' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('received_on', p_received_on)::TEXT;
  END IF;

  INSERT INTO fee_payments (school_id, student_id, academic_year_id, intent_id, amount, received_on, mode, reference, remarks, received_by,
                            ledger, financial_year_id, instrument_no, instrument_date, bank_name, request_id)
  VALUES (app.current_school_id(), p_student_id, p_academic_year_id, p_intent_id, p_amount, p_received_on, p_mode, p_reference, p_remarks, app.current_user_id(),
          p_ledger, v_fy, NULLIF(btrim(COALESCE(p_instrument_no, '')), ''), p_instrument_date, NULLIF(btrim(COALESCE(p_bank_name, '')), ''), app.current_request_id())
  RETURNING id INTO v_payment_id;
  UPDATE fee_payments SET receipt_no = app.next_receipt_no(p_ledger, v_fy) WHERE id = v_payment_id;

  FOR g IN
    SELECT due_on, sum(net - paid) AS balance FROM fee_demands
     WHERE student_id = p_student_id AND academic_year_id = p_academic_year_id AND status IN ('pending', 'partial', 'paid')
     GROUP BY due_on ORDER BY due_on
  LOOP
    EXIT WHEN v_left <= 0;
    v_lf := 0;
    IF p_collect_late_fee THEN
      SELECT * INTO lf FROM app.late_fee(p_student_id, p_academic_year_id, g.due_on, p_received_on);
      v_lf := GREATEST(COALESCE(lf.o_amount, 0) - app.late_fee_posted(p_student_id, p_academic_year_id, g.due_on), 0);
    END IF;
    CONTINUE WHEN g.balance <= 0 AND v_lf <= 0;

    IF g.balance > 0 THEN
      v_take := app.allocate_to_instalment(v_payment_id, p_student_id, p_academic_year_id, g.due_on, LEAST(v_left, g.balance));
      v_left := v_left - v_take;
      v_principal := v_principal + v_take;
      IF v_take > 0 THEN v_n := v_n + 1; END IF;
      IF v_take < g.balance THEN EXIT; END IF;   -- partial principal: the late fee waits for the settling receipt
    END IF;

    IF v_lf > 0 AND v_left > 0 THEN
      v_take := LEAST(v_left, v_lf);
      INSERT INTO fee_late_fee_postings (school_id, payment_id, student_id, academic_year_id, due_on, period_id, amount, mode, days)
      VALUES (app.current_school_id(), v_payment_id, p_student_id, p_academic_year_id, g.due_on, lf.o_period_id, v_take, COALESCE(lf.o_mode, 'daywise'), COALESCE(lf.o_days, 0));
      v_left := v_left - v_take;
      v_late := v_late + v_take;
      IF g.balance <= 0 THEN v_n := v_n + 1; END IF;
    END IF;
  END LOOP;

  UPDATE fee_payments SET late_fee = v_late WHERE id = v_payment_id;
  RETURN QUERY SELECT v_payment_id, (SELECT receipt_no FROM fee_payments WHERE id = v_payment_id), v_principal, v_late, v_left, v_n;
END
$$;

-- ---------------------------------------------------------------------------
-- app.apply_fee_refund: an approved refund leaves the receipt. The money comes first from the receipt's
-- advance, then from its allocations newest instalment first (demands reopen), then from its late fee
-- postings. Marks the refund paid when p_paid, and the receipt refunded or partly refunded.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.apply_fee_refund(p_refund_id BIGINT, p_paid BOOLEAN DEFAULT true) RETURNS NUMERIC
LANGUAGE plpgsql AS $$
DECLARE
  v_r       fee_refunds%ROWTYPE;
  v_p       fee_payments%ROWTYPE;
  v_left    NUMERIC;
  v_advance NUMERIC;
  v_take    NUMERIC;
  a RECORD;
BEGIN
  PERFORM app.assert_context();
  SELECT * INTO v_r FROM fee_refunds WHERE id = p_refund_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'fees.refund_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_r.status <> 'approved' THEN
    RAISE EXCEPTION 'fees.refund_not_approved' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('status', v_r.status)::TEXT;
  END IF;
  SELECT * INTO v_p FROM fee_payments WHERE id = v_r.payment_id FOR UPDATE;
  IF v_p.amount - v_p.refunded < v_r.amount THEN
    RAISE EXCEPTION 'fees.refund_exceeds_receipt' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('available', v_p.amount - v_p.refunded, 'requested', v_r.amount)::TEXT;
  END IF;
  PERFORM app.assert_year_open(v_p.academic_year_id, 'fees');
  v_left := v_r.amount;

  -- 1. the advance on the receipt
  v_advance := v_p.amount - v_p.refunded - v_p.late_fee
               - COALESCE((SELECT sum(amount) FROM fee_payment_allocations WHERE payment_id = v_p.id), 0);
  IF v_advance > 0 THEN v_left := v_left - LEAST(v_left, v_advance); END IF;

  -- 2. allocations, newest instalment first: the demand rows reopen
  FOR a IN
    SELECT al.id, al.amount, al.demand_id FROM fee_payment_allocations al JOIN fee_demands d ON d.id = al.demand_id
     WHERE al.payment_id = v_p.id ORDER BY d.due_on DESC, al.id DESC FOR UPDATE OF al
  LOOP
    EXIT WHEN v_left <= 0;
    v_take := LEAST(v_left, a.amount);
    IF v_take >= a.amount THEN DELETE FROM fee_payment_allocations WHERE id = a.id;
    ELSE UPDATE fee_payment_allocations SET amount = amount - v_take WHERE id = a.id;
    END IF;
    UPDATE fee_demands SET paid = paid - v_take,
           status = CASE WHEN paid - v_take <= 0 THEN 'pending' WHEN paid - v_take < net THEN 'partial' ELSE 'paid' END::fee_demand_status,
           updated_at = now()
     WHERE id = a.demand_id;
    v_left := v_left - v_take;
  END LOOP;

  -- 3. late fee postings of the receipt
  FOR a IN SELECT id, amount FROM fee_late_fee_postings WHERE payment_id = v_p.id ORDER BY due_on DESC, id DESC FOR UPDATE
  LOOP
    EXIT WHEN v_left <= 0;
    v_take := LEAST(v_left, a.amount);
    IF v_take >= a.amount THEN DELETE FROM fee_late_fee_postings WHERE id = a.id;
    ELSE UPDATE fee_late_fee_postings SET amount = amount - v_take WHERE id = a.id;
    END IF;
    UPDATE fee_payments SET late_fee = late_fee - v_take WHERE id = v_p.id;
    v_left := v_left - v_take;
  END LOOP;

  UPDATE fee_payments SET refunded = refunded + v_r.amount,
         status = CASE WHEN refunded + v_r.amount >= amount THEN 'refunded' ELSE 'partly_refunded' END
   WHERE id = v_p.id;
  IF p_paid THEN
    UPDATE fee_refunds SET status = 'paid', paid_on = COALESCE(paid_on, CURRENT_DATE) WHERE id = p_refund_id;
  END IF;
  RETURN v_r.amount - v_left;   -- the part taken from allocations, advance and late fee (always the full amount)
END
$$;

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------
INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('fees.receipt.post',          'fees',      'Post a fee receipt at the counter (cash, cheque, DD, UPI, bank, card)', false),
  ('fees.refund.request',        'fees',      'Request a refund against a receipt', false),
  ('fees.refund.approve',        'fees',      'Approve, reject and pay out refunds', false),
  ('fees.family.view',           'fees',      'View the fee ledger and receipts of one''s own children', false),
  ('payments.family.pay',        'payments',  'Pay fees online for one''s own children', false),
  ('payments.settlement.view',   'payments',  'View gateway settlement files and their matching', false),
  ('payments.settlement.manage', 'payments',  'Upload and match gateway settlement files', false),
  ('transport.request.create',   'transport', 'Request a bus seat, a stop change or leaving the bus for one''s own children', false),
  ('transport.request.view',     'transport', 'View transport requests', false),
  ('transport.request.decide',   'transport', 'Approve or reject transport requests', false),
  ('transport.log.view',         'transport', 'View vehicle logs (odometer, fuel, incidents)', false),
  ('transport.log.manage',       'transport', 'Record vehicle logs', false),
  ('insights.department.view',   'insights',  'Open the department dashboards and report centres one''s module permissions allow', false)
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code IN ('group_admin', 'school_admin')
  AND p.code IN ('fees.receipt.post', 'fees.refund.request', 'fees.refund.approve', 'payments.settlement.view', 'payments.settlement.manage',
                 'transport.request.view', 'transport.request.decide', 'transport.log.view', 'transport.log.manage', 'insights.department.view')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code = 'accountant'
  AND p.code IN ('fees.receipt.post', 'fees.refund.request', 'payments.settlement.view', 'payments.settlement.manage', 'insights.department.view')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code = 'auditor'
  AND p.code IN ('payments.settlement.view', 'transport.request.view', 'transport.log.view', 'insights.department.view')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code = 'academic_coordinator'
  AND p.code IN ('insights.department.view')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code IN ('parent', 'student')
  AND p.code IN ('fees.family.view', 'transport.request.create', 'transport.request.view')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'payments.family.pay' FROM roles r WHERE r.school_id IS NULL AND r.code = 'parent'
ON CONFLICT DO NOTHING;

-- whoever manages routes decides requests and keeps vehicle logs; whoever views routes sees both
INSERT INTO role_permissions (role_id, permission_code)
SELECT rp.role_id, x.code FROM role_permissions rp JOIN roles r ON r.id = rp.role_id
  CROSS JOIN (VALUES ('transport.request.decide'), ('transport.log.manage')) AS x(code)
WHERE r.school_id IS NULL AND rp.permission_code = 'transport.route.manage'
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT rp.role_id, x.code FROM role_permissions rp JOIN roles r ON r.id = rp.role_id
  CROSS JOIN (VALUES ('transport.request.view'), ('transport.log.view')) AS x(code)
WHERE r.school_id IS NULL AND rp.permission_code = 'transport.route.view'
ON CONFLICT DO NOTHING;
