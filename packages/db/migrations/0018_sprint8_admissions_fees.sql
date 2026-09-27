-- 0018_sprint8_admissions_fees.sql
-- Sprint 8 (Phase 2): admissions open (cycles, configurable forms, criteria, scoring, applicants with OTP,
-- applications with duplicate flags) and the fee engine start (heads, periods, structures, transport slabs,
-- discounts, student fee profiles, demands and app.generate_fee_demand).

CREATE TYPE admission_cycle_status AS ENUM ('draft', 'open', 'closed');
CREATE TYPE application_status     AS ENUM ('draft', 'submitted', 'under_review', 'shortlisted', 'selected', 'waitlisted', 'rejected', 'withdrawn');
CREATE TYPE fee_head_kind          AS ENUM ('regular', 'transport', 'opening_balance', 'late_fee', 'misc');
CREATE TYPE fee_frequency          AS ENUM ('monthly', 'quarterly', 'half_yearly', 'annual', 'one_time');
CREATE TYPE fee_demand_status      AS ENUM ('pending', 'partial', 'paid', 'waived', 'cancelled');

-- ---------------------------------------------------------------------------
-- Admissions
-- ---------------------------------------------------------------------------
CREATE TABLE admission_cycles (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id          BIGINT NOT NULL REFERENCES schools(id),
  academic_year_id   BIGINT NOT NULL REFERENCES academic_years(id),   -- the year admitted students join
  code               TEXT NOT NULL,
  name               TEXT NOT NULL,
  name_hi            TEXT,
  instructions       TEXT,
  instructions_hi    TEXT,
  opens_at           TIMESTAMPTZ NOT NULL,
  closes_at          TIMESTAMPTZ NOT NULL,
  status             admission_cycle_status NOT NULL DEFAULT 'draft',
  form_schema        JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{ key, label, labelHi, type, required, options, section }]
  application_fee    NUMERIC(12, 2) NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by         BIGINT,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by         BIGINT,
  deleted_at         TIMESTAMPTZ,
  CHECK (closes_at > opens_at)
);
CREATE UNIQUE INDEX admission_cycles_code ON admission_cycles (school_id, code) WHERE deleted_at IS NULL;

CREATE TABLE admission_class_criteria (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  cycle_id    BIGINT NOT NULL REFERENCES admission_cycles(id) ON DELETE CASCADE,
  class_id    BIGINT NOT NULL REFERENCES classes(id),
  seats       INT NOT NULL DEFAULT 0 CHECK (seats >= 0),
  dob_from    DATE,                 -- child must be born on or after
  dob_to      DATE,                 -- and on or before (age criteria as of the joining date)
  passcode    TEXT,                 -- when set, the applicant must quote it (legacy _Passcode window)
  UNIQUE (cycle_id, class_id),
  CHECK (dob_from IS NULL OR dob_to IS NULL OR dob_to >= dob_from)
);

CREATE TABLE admission_score_criteria (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  cycle_id    BIGINT NOT NULL REFERENCES admission_cycles(id) ON DELETE CASCADE,
  code        TEXT NOT NULL,
  name        TEXT NOT NULL,
  points      NUMERIC(6, 2) NOT NULL CHECK (points >= 0),
  auto_rule   TEXT,                 -- 'sibling' | 'staff_ward' | 'alumni' | 'distance_within:<km>' | NULL (manual)
  sort_order  INT NOT NULL DEFAULT 0,
  UNIQUE (cycle_id, code)
);

CREATE TABLE applicants (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id      BIGINT NOT NULL REFERENCES schools(id),
  mobile         TEXT NOT NULL,
  name           TEXT,
  email          CITEXT,
  last_login_at  TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, mobile)
);

CREATE TABLE public_otps (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  mobile       TEXT NOT NULL,
  purpose      TEXT NOT NULL DEFAULT 'admission_login',
  code_hash    TEXT NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  attempts     INT NOT NULL DEFAULT 0,
  consumed_at  TIMESTAMPTZ,
  ip           TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX public_otps_lookup ON public_otps (school_id, mobile, purpose, created_at DESC);

CREATE TABLE application_sequences (
  cycle_id     BIGINT PRIMARY KEY REFERENCES admission_cycles(id) ON DELETE CASCADE,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  last_serial  INT NOT NULL DEFAULT 0
);

CREATE TABLE applications (
  id                     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id              BIGINT NOT NULL REFERENCES schools(id),
  cycle_id               BIGINT NOT NULL REFERENCES admission_cycles(id),
  class_id               BIGINT NOT NULL REFERENCES classes(id),
  applicant_id           BIGINT NOT NULL REFERENCES applicants(id),
  application_no         TEXT,
  serial                 INT,
  status                 application_status NOT NULL DEFAULT 'draft',
  child_first_name       TEXT NOT NULL,
  child_last_name        TEXT,
  child_dob              DATE NOT NULL,
  child_gender           gender NOT NULL DEFAULT 'unspecified',
  data                   JSONB NOT NULL DEFAULT '{}'::jsonb,   -- answers keyed by form_schema.key
  passcode_used          TEXT,
  score                  NUMERIC(8, 2),
  score_breakdown        JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{ code, name, points, source }]
  possible_duplicate_of  BIGINT REFERENCES applications(id),
  submitted_at           TIMESTAMPTZ,
  decided_at             TIMESTAMPTZ,
  decided_by             BIGINT,
  remarks                TEXT,
  student_id             BIGINT REFERENCES students(id),      -- filled at enrolment (Sprint 9)
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by             BIGINT,
  UNIQUE (school_id, application_no)
);
CREATE INDEX applications_by_cycle ON applications (cycle_id, status, class_id);
CREATE INDEX applications_by_applicant ON applications (applicant_id);

CREATE TABLE application_events (
  id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id            BIGINT NOT NULL REFERENCES schools(id),
  application_id       BIGINT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  from_status          application_status,
  to_status            application_status NOT NULL,
  note                 TEXT,
  actor_user_id        BIGINT,
  actor_applicant_id   BIGINT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION app.next_application_no(p_cycle_id BIGINT) RETURNS TABLE (application_no TEXT, serial INT)
LANGUAGE plpgsql AS $$
DECLARE
  v_serial INT;
  v_code TEXT;
BEGIN
  PERFORM app.assert_context();
  SELECT code INTO v_code FROM admission_cycles WHERE id = p_cycle_id;
  IF v_code IS NULL THEN
    RAISE EXCEPTION 'admission.cycle_not_found' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO application_sequences (cycle_id, school_id, last_serial) VALUES (p_cycle_id, app.current_school_id(), 1)
  ON CONFLICT (cycle_id) DO UPDATE SET last_serial = application_sequences.last_serial + 1
  RETURNING last_serial INTO v_serial;
  RETURN QUERY SELECT 'APP/' || v_code || '/' || lpad(v_serial::text, 5, '0'), v_serial;
END
$$;

-- ---------------------------------------------------------------------------
-- Fees: masters
-- ---------------------------------------------------------------------------
CREATE TABLE fee_heads (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  code        TEXT NOT NULL,
  name        TEXT NOT NULL,
  kind        fee_head_kind NOT NULL DEFAULT 'regular',
  ledger      ledger_type NOT NULL DEFAULT 'school',
  is_optional BOOLEAN NOT NULL DEFAULT false,
  refundable  BOOLEAN NOT NULL DEFAULT false,
  sort_order  INT NOT NULL DEFAULT 0,
  status      row_status NOT NULL DEFAULT 'active',
  legacy_ref  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  BIGINT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  BIGINT,
  deleted_at  TIMESTAMPTZ
);
CREATE UNIQUE INDEX fee_heads_code ON fee_heads (school_id, code) WHERE deleted_at IS NULL;

CREATE TABLE fee_periods (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id         BIGINT NOT NULL REFERENCES schools(id),
  academic_year_id  BIGINT NOT NULL REFERENCES academic_years(id),
  sequence          INT NOT NULL CHECK (sequence BETWEEN 1 AND 12),
  name              TEXT NOT NULL,
  month             INT NOT NULL CHECK (month BETWEEN 1 AND 12),
  year              INT NOT NULL,
  instalment        INT NOT NULL CHECK (instalment BETWEEN 1 AND 12),   -- quarter or instalment number the month belongs to
  due_on            DATE NOT NULL,
  legacy_ref        TEXT,
  UNIQUE (academic_year_id, sequence)
);

CREATE TABLE fee_structures (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id         BIGINT NOT NULL REFERENCES schools(id),
  academic_year_id  BIGINT NOT NULL REFERENCES academic_years(id),
  class_id          BIGINT NOT NULL REFERENCES classes(id),
  head_id           BIGINT NOT NULL REFERENCES fee_heads(id),
  fee_group         TEXT NOT NULL DEFAULT 'general',     -- general, staff_ward, ews ... (legacy FeesType)
  student_type      TEXT NOT NULL DEFAULT 'all',         -- all, new, old (legacy StudentType)
  amount            NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
  frequency         fee_frequency NOT NULL DEFAULT 'monthly',
  periods           INT[],                               -- explicit period sequences; NULL = by frequency
  legacy_ref        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by        BIGINT,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by        BIGINT,
  UNIQUE (academic_year_id, class_id, head_id, fee_group, student_type),
  CHECK (student_type IN ('all', 'new', 'old'))
);

CREATE TABLE transport_slabs (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id         BIGINT NOT NULL REFERENCES schools(id),
  academic_year_id  BIGINT NOT NULL REFERENCES academic_years(id),
  code              TEXT NOT NULL,
  name              TEXT NOT NULL,
  distance_from_km  NUMERIC(6, 1),
  distance_to_km    NUMERIC(6, 1),
  monthly_amount    NUMERIC(12, 2) NOT NULL CHECK (monthly_amount >= 0),
  legacy_ref        TEXT,
  UNIQUE (academic_year_id, code)
);

CREATE TABLE fee_discounts (
  id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id             BIGINT NOT NULL REFERENCES schools(id),
  academic_year_id      BIGINT NOT NULL REFERENCES academic_years(id),
  code                  TEXT NOT NULL,
  name                  TEXT NOT NULL,
  head_id               BIGINT REFERENCES fee_heads(id),   -- NULL = every regular head
  percent               NUMERIC(5, 2) CHECK (percent IS NULL OR (percent >= 0 AND percent <= 100)),
  amount                NUMERIC(12, 2) CHECK (amount IS NULL OR amount >= 0),
  applies_to_transport  BOOLEAN NOT NULL DEFAULT false,
  status                row_status NOT NULL DEFAULT 'active',
  legacy_ref            TEXT,
  UNIQUE (academic_year_id, code),
  CHECK ((percent IS NULL) <> (amount IS NULL))
);

CREATE TABLE student_fee_profiles (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id           BIGINT NOT NULL REFERENCES schools(id),
  student_id          BIGINT NOT NULL REFERENCES students(id),
  academic_year_id    BIGINT NOT NULL REFERENCES academic_years(id),
  fee_group           TEXT NOT NULL DEFAULT 'general',
  student_type        TEXT NOT NULL DEFAULT 'old' CHECK (student_type IN ('new', 'old')),
  transport_slab_id   BIGINT REFERENCES transport_slabs(id),
  transport_disabled  BOOLEAN NOT NULL DEFAULT false,
  discount_id         BIGINT REFERENCES fee_discounts(id),
  opening_balance     NUMERIC(12, 2) NOT NULL DEFAULT 0,   -- positive = due carried forward, negative = credit
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by          BIGINT,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by          BIGINT,
  UNIQUE (student_id, academic_year_id)
);

CREATE TABLE fee_demand_runs (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id         BIGINT NOT NULL REFERENCES schools(id),
  academic_year_id  BIGINT NOT NULL REFERENCES academic_years(id),
  student_id        BIGINT NOT NULL REFERENCES students(id),
  rows              INT NOT NULL,
  total             NUMERIC(14, 2) NOT NULL,
  ran_by            BIGINT,
  ran_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  request_id        UUID
);

CREATE TABLE fee_demands (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id         BIGINT NOT NULL REFERENCES schools(id),
  student_id        BIGINT NOT NULL REFERENCES students(id),
  academic_year_id  BIGINT NOT NULL REFERENCES academic_years(id),
  period_id         BIGINT NOT NULL REFERENCES fee_periods(id),
  head_id           BIGINT NOT NULL REFERENCES fee_heads(id),
  gross             NUMERIC(12, 2) NOT NULL DEFAULT 0,
  discount          NUMERIC(12, 2) NOT NULL DEFAULT 0,
  net               NUMERIC(12, 2) NOT NULL DEFAULT 0,
  paid              NUMERIC(12, 2) NOT NULL DEFAULT 0,
  status            fee_demand_status NOT NULL DEFAULT 'pending',
  due_on            DATE NOT NULL,
  source            TEXT NOT NULL DEFAULT 'structure',    -- structure, transport, opening_balance, rounding
  run_id            BIGINT REFERENCES fee_demand_runs(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (student_id, academic_year_id, period_id, head_id)
);
CREATE INDEX fee_demands_by_student ON fee_demands (student_id, academic_year_id);
CREATE INDEX fee_demands_due ON fee_demands (school_id, academic_year_id, due_on) WHERE status IN ('pending', 'partial');

-- ---------------------------------------------------------------------------
-- app.generate_fee_demand: the legacy GenerateFee() rules (blueprint section 5.3)
--   1. refuse withdrawn or unenrolled students, and locked years
--   2. structure rows for the class, fee group and student type, one demand per head per applicable period
--   3. discount per head (percent or amount) from the student's discount
--   4. transport rows from the slab unless disabled, or discounted and the school disables transport for discounted students
--   5. opening balance as its own head in the first period
--   6. rounding reconcile per period (whole rupees; the difference lands on the last row of the period)
-- Re-running replaces unpaid rows and keeps rows with payments.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.generate_fee_demand(p_student_id BIGINT, p_academic_year_id BIGINT)
RETURNS TABLE (o_run_id BIGINT, o_rows INT, o_total NUMERIC)
LANGUAGE plpgsql AS $$
DECLARE
  v_class_id BIGINT;
  v_year academic_years%ROWTYPE;
  v_student students%ROWTYPE;
  v_profile student_fee_profiles%ROWTYPE;
  v_discount fee_discounts%ROWTYPE;
  v_transport_for_discounted BOOLEAN;
  v_transport_head BIGINT;
  v_opb_head BIGINT;
  v_run_id BIGINT;
  v_first_period fee_periods%ROWTYPE;
  v_rows INT := 0;
  v_total NUMERIC := 0;
  r RECORD;
  p RECORD;
  v_gross NUMERIC;
  v_disc NUMERIC;
  v_net NUMERIC;
  v_sum NUMERIC;
  v_delta NUMERIC;
  v_last_id BIGINT;
BEGIN
  PERFORM app.assert_context();
  PERFORM app.assert_year_open(p_academic_year_id, 'fees');
  SELECT * INTO v_year FROM academic_years WHERE id = p_academic_year_id;
  SELECT * INTO v_student FROM students WHERE id = p_student_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'fees.student_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_student.status <> 'active' THEN
    RAISE EXCEPTION 'fees.student_inactive' USING ERRCODE = 'P0001', DETAIL = 'withdrawn or inactive students get no demand';
  END IF;
  SELECT cs.class_id INTO v_class_id
    FROM enrolments e JOIN class_sections cs ON cs.id = e.class_section_id
   WHERE e.student_id = p_student_id AND e.academic_year_id = p_academic_year_id AND e.status = 'active'
   ORDER BY e.id DESC LIMIT 1;
  IF v_class_id IS NULL THEN
    RAISE EXCEPTION 'fees.not_enrolled' USING ERRCODE = 'P0001', DETAIL = 'the student has no active enrolment in this year';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM fee_periods WHERE academic_year_id = p_academic_year_id) THEN
    RAISE EXCEPTION 'fees.no_periods' USING ERRCODE = 'P0001', DETAIL = 'define the fee periods of the year first';
  END IF;

  SELECT * INTO v_profile FROM student_fee_profiles WHERE student_id = p_student_id AND academic_year_id = p_academic_year_id;
  IF NOT FOUND THEN
    v_profile.fee_group := 'general';
    v_profile.student_type := CASE WHEN v_student.admitted_on IS NOT NULL AND v_student.admitted_on >= v_year.start_date THEN 'new' ELSE 'old' END;
    v_profile.transport_slab_id := NULL;
    v_profile.transport_disabled := false;
    v_profile.discount_id := NULL;
    v_profile.opening_balance := 0;
  END IF;
  IF v_profile.discount_id IS NOT NULL THEN
    SELECT * INTO v_discount FROM fee_discounts WHERE id = v_profile.discount_id AND status = 'active';
  END IF;
  v_transport_for_discounted := COALESCE((app.setting('fees.transport_for_discounted'))::text::boolean, false);
  SELECT id INTO v_transport_head FROM fee_heads WHERE kind = 'transport' AND deleted_at IS NULL AND status = 'active' ORDER BY sort_order, id LIMIT 1;
  SELECT id INTO v_opb_head FROM fee_heads WHERE kind = 'opening_balance' AND deleted_at IS NULL ORDER BY sort_order, id LIMIT 1;
  SELECT * INTO v_first_period FROM fee_periods WHERE academic_year_id = p_academic_year_id ORDER BY sequence LIMIT 1;

  INSERT INTO fee_demand_runs (school_id, academic_year_id, student_id, rows, total, ran_by, request_id)
  VALUES (app.current_school_id(), p_academic_year_id, p_student_id, 0, 0, app.current_user_id(), app.current_request_id())
  RETURNING id INTO v_run_id;

  -- 1. drop unpaid rows of the year so the run is repeatable; paid or partly paid rows stay as they are
  DELETE FROM fee_demands WHERE student_id = p_student_id AND academic_year_id = p_academic_year_id AND paid = 0 AND status IN ('pending', 'cancelled');

  -- 2. structure rows
  FOR r IN
    SELECT fs.*, h.kind AS head_kind
      FROM fee_structures fs JOIN fee_heads h ON h.id = fs.head_id AND h.deleted_at IS NULL AND h.status = 'active'
     WHERE fs.academic_year_id = p_academic_year_id AND fs.class_id = v_class_id
       AND fs.fee_group = v_profile.fee_group
       AND fs.student_type IN ('all', v_profile.student_type)
       AND h.kind IN ('regular', 'misc')
  LOOP
    FOR p IN
      SELECT * FROM fee_periods fp
       WHERE fp.academic_year_id = p_academic_year_id
         AND CASE
               WHEN r.periods IS NOT NULL THEN fp.sequence = ANY (r.periods)
               WHEN r.frequency = 'monthly' THEN true
               WHEN r.frequency = 'quarterly' THEN fp.sequence IN (1, 4, 7, 10)
               WHEN r.frequency = 'half_yearly' THEN fp.sequence IN (1, 7)
               ELSE fp.sequence = 1
             END
       ORDER BY fp.sequence
    LOOP
      v_gross := r.amount;
      v_disc := 0;
      IF v_discount.id IS NOT NULL AND (v_discount.head_id IS NULL OR v_discount.head_id = r.head_id) THEN
        v_disc := CASE WHEN v_discount.percent IS NOT NULL THEN round(v_gross * v_discount.percent / 100, 2) ELSE LEAST(v_gross, v_discount.amount) END;
      END IF;
      v_net := GREATEST(v_gross - v_disc, 0);
      INSERT INTO fee_demands (school_id, student_id, academic_year_id, period_id, head_id, gross, discount, net, due_on, source, run_id)
      VALUES (app.current_school_id(), p_student_id, p_academic_year_id, p.id, r.head_id, v_gross, v_disc, v_net, p.due_on, 'structure', v_run_id)
      ON CONFLICT (student_id, academic_year_id, period_id, head_id) DO NOTHING;   -- a paid row keeps its amounts
      IF FOUND THEN v_rows := v_rows + 1; END IF;
    END LOOP;
  END LOOP;

  -- 3. transport rows
  IF v_profile.transport_slab_id IS NOT NULL AND NOT v_profile.transport_disabled AND v_transport_head IS NOT NULL
     AND (v_discount.id IS NULL OR v_transport_for_discounted OR v_discount.applies_to_transport) THEN
    FOR p IN SELECT * FROM fee_periods WHERE academic_year_id = p_academic_year_id ORDER BY sequence LOOP
      SELECT monthly_amount INTO v_gross FROM transport_slabs WHERE id = v_profile.transport_slab_id;
      v_disc := 0;
      IF v_discount.id IS NOT NULL AND v_discount.applies_to_transport THEN
        v_disc := CASE WHEN v_discount.percent IS NOT NULL THEN round(v_gross * v_discount.percent / 100, 2) ELSE LEAST(v_gross, v_discount.amount) END;
      END IF;
      v_net := GREATEST(v_gross - v_disc, 0);
      INSERT INTO fee_demands (school_id, student_id, academic_year_id, period_id, head_id, gross, discount, net, due_on, source, run_id)
      VALUES (app.current_school_id(), p_student_id, p_academic_year_id, p.id, v_transport_head, v_gross, v_disc, v_net, p.due_on, 'transport', v_run_id)
      ON CONFLICT (student_id, academic_year_id, period_id, head_id) DO NOTHING;
      IF FOUND THEN v_rows := v_rows + 1; END IF;
    END LOOP;
  END IF;

  -- 4. opening balance (a credit reduces the first period; a due adds to it)
  IF v_profile.opening_balance <> 0 THEN
    IF v_opb_head IS NULL THEN
      RAISE EXCEPTION 'fees.no_opening_balance_head' USING ERRCODE = 'P0001', DETAIL = 'create a fee head of kind opening_balance';
    END IF;
    INSERT INTO fee_demands (school_id, student_id, academic_year_id, period_id, head_id, gross, discount, net, due_on, source, run_id)
    VALUES (app.current_school_id(), p_student_id, p_academic_year_id, v_first_period.id, v_opb_head, v_profile.opening_balance, 0, v_profile.opening_balance, v_first_period.due_on, 'opening_balance', v_run_id)
    ON CONFLICT (student_id, academic_year_id, period_id, head_id) DO NOTHING;
    IF FOUND THEN v_rows := v_rows + 1; END IF;
  END IF;

  -- 5. rounding reconcile: whole rupees per period, difference on the last row generated in this run
  FOR p IN SELECT fp.id FROM fee_periods fp WHERE fp.academic_year_id = p_academic_year_id ORDER BY fp.sequence LOOP
    SELECT COALESCE(sum(net), 0) INTO v_sum FROM fee_demands WHERE student_id = p_student_id AND academic_year_id = p_academic_year_id AND period_id = p.id AND run_id = v_run_id;
    v_delta := round(v_sum) - v_sum;
    IF v_delta <> 0 THEN
      SELECT id INTO v_last_id FROM fee_demands WHERE student_id = p_student_id AND academic_year_id = p_academic_year_id AND period_id = p.id AND run_id = v_run_id ORDER BY id DESC LIMIT 1;
      UPDATE fee_demands SET net = net + v_delta, discount = discount - v_delta WHERE id = v_last_id;
    END IF;
  END LOOP;

  SELECT COALESCE(sum(net), 0) INTO v_total FROM fee_demands WHERE student_id = p_student_id AND academic_year_id = p_academic_year_id;
  UPDATE fee_demand_runs SET rows = v_rows, total = v_total WHERE id = v_run_id;
  RETURN QUERY SELECT v_run_id, v_rows, v_total;
END
$$;

CALL app.apply_tenant_rls('admission_cycles');
CALL app.apply_tenant_rls('admission_class_criteria');
CALL app.apply_tenant_rls('admission_score_criteria');
CALL app.apply_tenant_rls('applicants');
CALL app.apply_tenant_rls('public_otps');
CALL app.apply_tenant_rls('application_sequences');
CALL app.apply_tenant_rls('applications');
CALL app.apply_tenant_rls('application_events');
CALL app.apply_tenant_rls('fee_heads');
CALL app.apply_tenant_rls('fee_periods');
CALL app.apply_tenant_rls('fee_structures');
CALL app.apply_tenant_rls('transport_slabs');
CALL app.apply_tenant_rls('fee_discounts');
CALL app.apply_tenant_rls('student_fee_profiles');
CALL app.apply_tenant_rls('fee_demand_runs');
CALL app.apply_tenant_rls('fee_demands');

-- Public lookups happen before any tenant context exists (which school, is a cycle open): SECURITY DEFINER
-- with a narrow surface, listed with the other exceptions in ADR-006/009.
CREATE OR REPLACE FUNCTION app.public_admission_schools()
RETURNS TABLE (school_id BIGINT, code TEXT, name TEXT, short_name TEXT, locale TEXT, open_cycles INT)
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT s.id, s.code, s.name, s.short_name, s.locale, open_cycles.n
    FROM schools s
    JOIN LATERAL (SELECT count(*)::int AS n FROM admission_cycles c
                   WHERE c.school_id = s.id AND c.status = 'open' AND c.deleted_at IS NULL AND now() BETWEEN c.opens_at AND c.closes_at) open_cycles ON true
   WHERE s.status = 'active' AND s.deleted_at IS NULL AND open_cycles.n > 0
   ORDER BY s.name
$$;
REVOKE ALL ON FUNCTION app.public_admission_schools() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.public_admission_schools() TO edupro_app;

CREATE OR REPLACE FUNCTION app.public_school_id(p_code TEXT) RETURNS BIGINT
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT id FROM schools WHERE code = upper(p_code) AND status = 'active' AND deleted_at IS NULL
$$;
REVOKE ALL ON FUNCTION app.public_school_id(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.public_school_id(TEXT) TO edupro_app;

-- ---------------------------------------------------------------------------
-- Permissions, templates and a new template role for accounts staff
-- ---------------------------------------------------------------------------
INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('admissions.cycle.view',        'admissions', 'View admission cycles, criteria and scoring masters', false),
  ('admissions.cycle.manage',      'admissions', 'Create and edit admission cycles, forms, criteria and scoring masters', false),
  ('admissions.application.view',  'admissions', 'View applications and the admissions dashboard', false),
  ('admissions.application.review','admissions', 'Change application status, score and remarks', false),
  ('fees.master.view',             'fees',       'View fee heads, periods, structures, slabs and discounts', false),
  ('fees.master.manage',           'fees',       'Edit fee heads, periods, structures, slabs and discounts', false),
  ('fees.profile.manage',          'fees',       'Set a student''s fee group, transport slab, discount and opening balance', false),
  ('fees.demand.view',             'fees',       'View fee demands and dues', false),
  ('fees.demand.generate',         'fees',       'Generate or regenerate fee demands', false)
ON CONFLICT (code) DO NOTHING;

INSERT INTO roles (school_id, code, name, kind, is_system, description) VALUES
  (NULL, 'accountant', 'Accountant', 'module', true, 'Fee masters, student fee profiles and demand generation')
ON CONFLICT (school_id, code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code IN ('group_admin', 'school_admin')
  AND p.code IN ('admissions.cycle.view', 'admissions.cycle.manage', 'admissions.application.view', 'admissions.application.review',
                 'fees.master.view', 'fees.master.manage', 'fees.profile.manage', 'fees.demand.view', 'fees.demand.generate')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code = 'accountant'
  AND p.code IN ('fees.master.view', 'fees.master.manage', 'fees.profile.manage', 'fees.demand.view', 'fees.demand.generate',
                 'people.student.view', 'people.guardian.view', 'people.withdrawal.view', 'people.withdrawal.clear',
                 'academics.class.view', 'academics.class_section.view', 'reports.export.create', 'reports.export.view')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code = 'academic_coordinator'
  AND p.code IN ('admissions.cycle.view', 'admissions.application.view', 'admissions.application.review', 'fees.demand.view')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code = 'auditor'
  AND p.code IN ('admissions.cycle.view', 'admissions.application.view', 'fees.master.view', 'fees.demand.view')
ON CONFLICT DO NOTHING;
