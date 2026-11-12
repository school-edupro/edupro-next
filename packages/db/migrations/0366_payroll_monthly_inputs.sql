-- 0366: payroll, phase B step 1 — the monthly inputs (docs/design/86, plan PAYROLL_MODULE_PLAN.md, the legacy
-- run read into PAYROLL_RUN_SPEC.md §7). Kept as the legacy module works: attendance for payroll pulled from the
-- attendance register (a month already over must be locked there first), corrected by hand or marked present,
-- finalised by a checker; salary hold (HOLD: worked out, not paid until released; SKIP: left out of the month);
-- loans and advances (no, flat or reducing interest); one-off earnings and deductions, among them a staff child's
-- fee dues (fee recovery: the receipt is posted in Fees when the run is locked — the legacy only listed them);
-- recurring deductions and their payees (LIC, society …); claims (reimbursements) decided by someone other than
-- who entered them; rate-based overtime; a typed month's income tax. There is no separate leave map: the leave
-- types say loss of pay and the pay %. Fixed from the legacy: one live overtime entry per employee-month (its
-- unique key allowed one replacement only), days before joining and after leaving never counted as unmarked
-- or charged twice, a joiner after the month not paid, the overtime hours limit on rate-based entries too.

-- ---- rights --------------------------------------------------------------------------------------------------
INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('payroll.run.view', 'payroll', 'See payroll runs, their records and the monthly inputs', false),
  ('payroll.run.manage', 'payroll',
   'Prepare payroll each month: pull attendance, loans, one-off items, recurring deductions, claims, overtime; create and process runs', false),
  ('payroll.run.approve', 'payroll',
   'Check payroll each month: finalise attendance, salary hold, decide claims, approve, reject and lock runs made by someone else', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r, (VALUES ('payroll.run.view'), ('payroll.run.manage')) AS p(code)
 WHERE r.school_id IS NULL AND r.code IN ('payroll_maker', 'payroll_checker', 'school_admin', 'group_admin')
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'payroll.run.approve' FROM roles r
 WHERE r.school_id IS NULL AND r.code IN ('payroll_checker', 'school_admin', 'group_admin')
ON CONFLICT DO NOTHING;

-- ---- settings the run reads ------------------------------------------------------------------------------------
ALTER TABLE payroll_settings
  -- a past day the attendance register has nothing for: counted present (the legacy default) or absent
  ADD COLUMN unmarked_as TEXT NOT NULL DEFAULT 'present' CHECK (unmarked_as IN ('present', 'absent')),
  -- the net pay's rounding; the difference is a "Rounding adjustment" line
  ADD COLUMN net_rounding TEXT NOT NULL DEFAULT 'NEAREST_1'
    CHECK (net_rounding IN ('NONE', 'NEAREST_1', 'FLOOR_1', 'CEIL_1', 'NEAREST_10', 'NEAREST_100', 'CEIL_100')),
  -- arrears on the payslip: one line each, or one "Arrears" line
  ADD COLUMN arrear_display TEXT NOT NULL DEFAULT 'split' CHECK (arrear_display IN ('split', 'combined'));

-- ---- attendance for payroll (one row per employee and month) ------------------------------------------------------
CREATE TABLE payroll_attendance (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id        BIGINT NOT NULL REFERENCES schools(id),
  employee_id      BIGINT NOT NULL REFERENCES employees(id),
  -- the pay month (its first day)
  month            DATE NOT NULL CHECK (extract(day FROM month) = 1),
  -- the days read: the calendar month, or the school's pay cycle (from its day of the month before)
  window_from      DATE NOT NULL,
  window_to        DATE NOT NULL,
  month_days       NUMERIC(4, 1) NOT NULL CHECK (month_days > 0 AND month_days <= 31),
  present_days     NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (present_days >= 0),
  paid_leave_days  NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (paid_leave_days >= 0),
  -- loss of pay: absence, half days, loss-of-pay leave, the unpaid share of part-pay leave, salary-hold days
  lop_days         NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (lop_days >= 0),
  -- days of the month before joining and after leaving: not paid, not loss of pay (PF counts them as NCP days)
  pre_join_days    NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (pre_join_days >= 0),
  post_leave_days  NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (post_leave_days >= 0),
  paid_days        NUMERIC(5, 2) NOT NULL CHECK (paid_days >= 0),
  ot_hours         NUMERIC(6, 2) NOT NULL DEFAULT 0 CHECK (ot_hours >= 0),
  -- past days the register had nothing for (counted by the unmarked_as setting)
  unmarked_days    INT NOT NULL DEFAULT 0 CHECK (unmarked_days >= 0),
  source           TEXT NOT NULL CHECK (source IN ('register', 'manual', 'import', 'quick_fill')),
  -- why it was changed by hand
  reason           TEXT CHECK (reason IS NULL OR length(reason) <= 200),
  -- how the figures were worked out (Explain): counts by kind, leave by type, warnings
  detail           JSONB NOT NULL DEFAULT '{}',
  finalised        BOOLEAN NOT NULL DEFAULT false,
  finalised_by     BIGINT REFERENCES users(id),
  finalised_at     TIMESTAMPTZ,
  created_by       BIGINT REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by       BIGINT REFERENCES users(id),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_id, month),
  CHECK (window_to >= window_from),
  CHECK (lop_days + pre_join_days + post_leave_days <= month_days)
);
CREATE INDEX payroll_attendance_month ON payroll_attendance (school_id, month);

-- ---- salary hold: HOLD = worked out, paid only when released; SKIP = left out of the month ----------------------
CREATE TABLE payroll_holds (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  employee_id  BIGINT NOT NULL REFERENCES employees(id),
  month        DATE NOT NULL CHECK (extract(day FROM month) = 1),
  mode         TEXT NOT NULL CHECK (mode IN ('HOLD', 'SKIP')),
  reason       TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 200),
  -- false: lifted, kept as history
  active       BOOLEAN NOT NULL DEFAULT true,
  created_by   BIGINT REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by   BIGINT REFERENCES users(id),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_id, month)
);
CREATE INDEX payroll_holds_month ON payroll_holds (school_id, month);

-- ---- loans and advances (the balance is the principal still owed) ---------------------------------------------------
CREATE TABLE payroll_loans (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id        BIGINT NOT NULL REFERENCES schools(id),
  employee_id      BIGINT NOT NULL REFERENCES employees(id),
  -- ADVANCE, FESTIVAL, LOAN … (the school's words); RECOVERY: a negative net carried as a schedule
  loan_type        TEXT NOT NULL CHECK (loan_type ~ '^[A-Z][A-Z0-9_ ]{0,39}$'),
  principal        NUMERIC(12, 2) NOT NULL CHECK (principal > 0),
  emi              NUMERIC(12, 2) NOT NULL CHECK (emi > 0),
  -- a year's per cent (9.5); none, flat on the principal, or reducing on what is owed
  interest_rate    NUMERIC(6, 3) NOT NULL DEFAULT 0 CHECK (interest_rate >= 0 AND interest_rate <= 60),
  interest_method  TEXT NOT NULL DEFAULT 'NONE' CHECK (interest_method IN ('NONE', 'FLAT', 'REDUCING')),
  balance          NUMERIC(12, 2) NOT NULL CHECK (balance >= 0),
  start_month      DATE NOT NULL CHECK (extract(day FROM start_month) = 1),
  status           TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'HOLD', 'CLOSED')),
  remarks          TEXT CHECK (remarks IS NULL OR length(remarks) <= 1000),
  created_by       BIGINT REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by       BIGINT REFERENCES users(id),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (balance <= principal),
  CHECK (interest_method = 'NONE' OR interest_rate > 0)
);
CREATE INDEX payroll_loans_employee ON payroll_loans (employee_id, status);

-- ---- one-off earnings and deductions for a month ---------------------------------------------------------------------
CREATE TABLE payroll_adhoc (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id          BIGINT NOT NULL REFERENCES schools(id),
  employee_id        BIGINT NOT NULL REFERENCES employees(id),
  month              DATE NOT NULL CHECK (extract(day FROM month) = 1),
  -- the head says earning or deduction
  pay_head_id        BIGINT NOT NULL REFERENCES payroll_pay_heads(id),
  -- positive; only a negative-net recovery's offset is negative
  amount             NUMERIC(12, 2) NOT NULL CHECK (amount <> 0),
  -- where it came from (NULL: typed by hand) and its key, so the same thing is never staged twice
  ref_module         TEXT CHECK (ref_module IS NULL OR ref_module IN ('FEE', 'CLAIM', 'OT', 'FNF', 'BONUS', 'RECOVERY')),
  ref_id             TEXT CHECK (ref_id IS NULL OR length(ref_id) <= 80),
  -- the payroll record that paid it (set by the run; NULL = pending)
  paid_in_record_id  BIGINT,
  detail             JSONB NOT NULL DEFAULT '{}',
  -- fee recovery: the fee receipt is posted when the run is locked
  receipt_pending    BOOLEAN NOT NULL DEFAULT false,
  fee_payment_id     BIGINT REFERENCES fee_payments(id),
  remarks            TEXT CHECK (remarks IS NULL OR length(remarks) <= 200),
  deleted_at         TIMESTAMPTZ,
  deleted_by         BIGINT REFERENCES users(id),
  created_by         BIGINT REFERENCES users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by         BIGINT REFERENCES users(id),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (amount > 0 OR ref_module = 'RECOVERY')
);
CREATE INDEX payroll_adhoc_month ON payroll_adhoc (school_id, month) WHERE deleted_at IS NULL;
CREATE INDEX payroll_adhoc_employee ON payroll_adhoc (employee_id, month) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX payroll_adhoc_ref ON payroll_adhoc (school_id, ref_id) WHERE ref_id IS NOT NULL AND deleted_at IS NULL;

-- ---- a staff member's children whose fees payroll may recover ---------------------------------------------------------
CREATE TABLE payroll_ward_links (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  employee_id  BIGINT NOT NULL REFERENCES employees(id),
  student_id   BIGINT NOT NULL REFERENCES students(id),
  -- found by the guardian's mobile being the employee's, or added by hand
  source       TEXT NOT NULL CHECK (source IN ('mobile', 'manual')),
  active       BOOLEAN NOT NULL DEFAULT true,
  created_by   BIGINT REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by   BIGINT REFERENCES users(id),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_id, student_id)
);

-- ---- recurring deductions and their payees -------------------------------------------------------------------------
CREATE TABLE payroll_payees (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id      BIGINT NOT NULL REFERENCES schools(id),
  name           TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  party_type     TEXT NOT NULL CHECK (party_type IN ('LIC', 'SOCIETY', 'UNION', 'COURT', 'OTHER')),
  payee_account  TEXT CHECK (payee_account IS NULL OR length(payee_account) <= 80),
  remarks        TEXT CHECK (remarks IS NULL OR length(remarks) <= 200),
  active         BOOLEAN NOT NULL DEFAULT true,
  created_by     BIGINT REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by     BIGINT REFERENCES users(id),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, name)
);
CREATE TABLE payroll_recurring (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id     BIGINT NOT NULL REFERENCES schools(id),
  employee_id   BIGINT NOT NULL REFERENCES employees(id),
  pay_head_id   BIGINT NOT NULL REFERENCES payroll_pay_heads(id),
  payee_id      BIGINT REFERENCES payroll_payees(id),
  amount        NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  -- the policy, membership or order number
  reference_no  TEXT CHECK (reference_no IS NULL OR length(reference_no) <= 60),
  start_month   DATE NOT NULL CHECK (extract(day FROM start_month) = 1),
  -- NULL: until stopped
  end_month     DATE CHECK (end_month IS NULL OR extract(day FROM end_month) = 1),
  status        TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'HOLD', 'ENDED')),
  remarks       TEXT CHECK (remarks IS NULL OR length(remarks) <= 200),
  created_by    BIGINT REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    BIGINT REFERENCES users(id),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_month IS NULL OR end_month >= start_month)
);
CREATE INDEX payroll_recurring_employee ON payroll_recurring (employee_id, status);

-- ---- claims (reimbursements) ------------------------------------------------------------------------------------
CREATE TABLE payroll_claims (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id        BIGINT NOT NULL REFERENCES schools(id),
  employee_id      BIGINT NOT NULL REFERENCES employees(id),
  -- a pay head of the kind "Reimbursement"
  pay_head_id      BIGINT NOT NULL REFERENCES payroll_pay_heads(id),
  amount_claimed   NUMERIC(12, 2) NOT NULL CHECK (amount_claimed > 0),
  amount_approved  NUMERIC(12, 2) CHECK (amount_approved IS NULL OR amount_approved > 0),
  bill_date        DATE,
  description      TEXT NOT NULL CHECK (length(btrim(description)) BETWEEN 3 AND 300),
  proof_file_id    BIGINT REFERENCES files(id),
  status           TEXT NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN ('SUBMITTED', 'APPROVED', 'REJECTED', 'PAID')),
  -- the month it is paid in, and the one-off line that pays it
  pay_month        DATE CHECK (pay_month IS NULL OR extract(day FROM pay_month) = 1),
  adhoc_id         BIGINT REFERENCES payroll_adhoc(id),
  decided_by       BIGINT REFERENCES users(id),
  decided_at       TIMESTAMPTZ,
  decision_remark  TEXT CHECK (decision_remark IS NULL OR length(decision_remark) <= 300),
  created_by       BIGINT REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by       BIGINT REFERENCES users(id),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (amount_approved IS NULL OR amount_approved <= amount_claimed)
);
CREATE INDEX payroll_claims_status ON payroll_claims (school_id, status);

-- ---- rate-based overtime (a day or an hour at the dated rate of the employee's type) ---------------------------------------
CREATE TABLE payroll_ot_entries (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id       BIGINT NOT NULL REFERENCES schools(id),
  employee_id     BIGINT NOT NULL REFERENCES employees(id),
  month           DATE NOT NULL CHECK (extract(day FROM month) = 1),
  basis           TEXT NOT NULL CHECK (basis IN ('DAY', 'HOUR')),
  qty             NUMERIC(6, 2) NOT NULL CHECK (qty > 0),
  employee_type   TEXT,
  rate            NUMERIC(10, 2) NOT NULL CHECK (rate > 0),
  derived_amount  NUMERIC(12, 2) NOT NULL CHECK (derived_amount > 0),
  -- what is paid (an amount other than the derived one needs a reason)
  amount          NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  reason          TEXT CHECK (reason IS NULL OR length(reason) <= 200),
  adhoc_id        BIGINT REFERENCES payroll_adhoc(id),
  deleted_at      TIMESTAMPTZ,
  deleted_by      BIGINT REFERENCES users(id),
  created_by      BIGINT REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by      BIGINT REFERENCES users(id),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX payroll_ot_entries_live ON payroll_ot_entries (employee_id, month) WHERE deleted_at IS NULL;

-- ---- a month's income tax typed by hand (it wins over the projection) ------------------------------------------------------
CREATE TABLE payroll_tds_manual (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  employee_id  BIGINT NOT NULL REFERENCES employees(id),
  month        DATE NOT NULL CHECK (extract(day FROM month) = 1),
  it_amount    NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (it_amount >= 0),
  cess_amount  NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (cess_amount >= 0),
  reason       TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 200),
  created_by   BIGINT REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by   BIGINT REFERENCES users(id),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_id, month)
);

-- ---- row-level security and the audit trail -----------------------------------------------------------------------
CALL app.apply_tenant_rls('payroll_attendance');
CALL app.apply_tenant_rls('payroll_holds');
CALL app.apply_tenant_rls('payroll_loans');
CALL app.apply_tenant_rls('payroll_adhoc');
CALL app.apply_tenant_rls('payroll_ward_links');
CALL app.apply_tenant_rls('payroll_payees');
CALL app.apply_tenant_rls('payroll_recurring');
CALL app.apply_tenant_rls('payroll_claims');
CALL app.apply_tenant_rls('payroll_ot_entries');
CALL app.apply_tenant_rls('payroll_tds_manual');
CREATE TRIGGER payroll_attendance_audit AFTER INSERT OR UPDATE OR DELETE ON payroll_attendance
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE TRIGGER payroll_holds_audit AFTER INSERT OR UPDATE OR DELETE ON payroll_holds
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE TRIGGER payroll_loans_audit AFTER INSERT OR UPDATE OR DELETE ON payroll_loans
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE TRIGGER payroll_adhoc_audit AFTER INSERT OR UPDATE OR DELETE ON payroll_adhoc
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE TRIGGER payroll_ward_links_audit AFTER INSERT OR UPDATE OR DELETE ON payroll_ward_links
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE TRIGGER payroll_payees_audit AFTER INSERT OR UPDATE OR DELETE ON payroll_payees
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE TRIGGER payroll_recurring_audit AFTER INSERT OR UPDATE OR DELETE ON payroll_recurring
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE TRIGGER payroll_claims_audit AFTER INSERT OR UPDATE OR DELETE ON payroll_claims
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE TRIGGER payroll_ot_entries_audit AFTER INSERT OR UPDATE OR DELETE ON payroll_ot_entries
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE TRIGGER payroll_tds_manual_audit AFTER INSERT OR UPDATE OR DELETE ON payroll_tds_manual
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

-- ---- a month locked in the attendance register stays locked while payroll has finalised it --------------------------------
CREATE OR REPLACE FUNCTION app.payroll_guard_month_unlock() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.locked AND NOT NEW.locked AND EXISTS (
       SELECT 1 FROM payroll_attendance a
        WHERE a.school_id = NEW.school_id AND a.finalised
          AND a.window_from <= (NEW.month + interval '1 month - 1 day')::date AND a.window_to >= NEW.month) THEN
    RAISE EXCEPTION 'payroll.month_finalised' USING ERRCODE = 'P0001',
      DETAIL = 'Payroll has finalised this month''s attendance: a payroll admin un-finalises it in Payroll first';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER staff_month_locks_payroll_guard BEFORE UPDATE ON staff_month_locks
  FOR EACH ROW EXECUTE FUNCTION app.payroll_guard_month_unlock();
