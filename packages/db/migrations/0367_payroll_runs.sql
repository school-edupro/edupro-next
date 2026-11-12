-- 0367: payroll, phase B step 3 — the monthly run (docs/design/86; the legacy run read into PAYROLL_RUN_SPEC.md
-- §1–6). A run of a month: REGULAR (the whole roster, one a month), SUPPLEMENTARY (named staff: what is pending, or
-- a full month for someone the regular run did not pay) and BONUS (what is pending, never a second salary); full
-- and final comes in phase E. Stages DRAFT → PROCESSING → REVIEW → APPROVED → LOCKED → PAID, REJECTED with a
-- comment. A record per employee frozen with what was paid and why (identity, bank, attendance, money, the trace),
-- its lines, PF / NPS / LWF / ESI side rows, the month's tax worked out, the loan instalments taken. Arrears owed
-- for earlier months (loss-of-pay reversal, revisions) wait in payroll_arrears until a run pays them. ESI coverage
-- is decided once a contribution period. Fixed from the legacy: a supplementary or bonus run only once the
-- month's regular run is locked (two open runs paid a full salary each), a bonus run never pays the structure, the
-- tax worked out kept per record (one live row was overwritten by every run and dry run), loan balances restored
-- exactly on reopen (the interest was added back), coverage decided by a purged run removed with it.

-- ---- the run --------------------------------------------------------------------------------------------------
CREATE TABLE payroll_runs (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id     BIGINT NOT NULL REFERENCES schools(id),
  month         DATE NOT NULL CHECK (extract(day FROM month) = 1),
  run_type      TEXT NOT NULL CHECK (run_type IN ('REGULAR', 'SUPPLEMENTARY', 'BONUS')),
  seq           INT NOT NULL DEFAULT 1,
  -- named staff (a supplementary run); NULL = the month's roster
  employee_ids  BIGINT[],
  stage         TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK (stage IN ('DRAFT', 'PROCESSING', 'REVIEW', 'REJECTED', 'APPROVED', 'LOCKED', 'PAID')),
  progress      INT NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  emp_count     INT NOT NULL DEFAULT 0,
  failed_count  INT NOT NULL DEFAULT 0,
  gross_total   NUMERIC(14, 2) NOT NULL DEFAULT 0,
  deduction_total NUMERIC(14, 2) NOT NULL DEFAULT 0,
  net_total     NUMERIC(14, 2) NOT NULL DEFAULT 0,
  remark        TEXT CHECK (remark IS NULL OR length(remark) <= 200),
  approved_by   BIGINT REFERENCES users(id),
  approved_at   TIMESTAMPTZ,
  locked_by     BIGINT REFERENCES users(id),
  locked_at     TIMESTAMPTZ,
  paid_at       TIMESTAMPTZ,
  deleted_at    TIMESTAMPTZ,
  created_by    BIGINT REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    BIGINT REFERENCES users(id),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (run_type = 'SUPPLEMENTARY' OR employee_ids IS NULL),
  CHECK (run_type <> 'SUPPLEMENTARY' OR cardinality(employee_ids) > 0),
  UNIQUE (school_id, month, run_type, seq)
);
CREATE UNIQUE INDEX payroll_runs_one_regular ON payroll_runs (school_id, month)
  WHERE run_type = 'REGULAR' AND deleted_at IS NULL;
CREATE UNIQUE INDEX payroll_runs_one_bonus ON payroll_runs (school_id, month)
  WHERE run_type = 'BONUS' AND deleted_at IS NULL;
CREATE INDEX payroll_runs_month ON payroll_runs (school_id, month) WHERE deleted_at IS NULL;

-- what happened to a run and why (comments, reasons)
CREATE TABLE payroll_run_events (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  run_id      BIGINT NOT NULL REFERENCES payroll_runs(id),
  action      TEXT NOT NULL CHECK (action ~ '^[a-z_]{2,30}$'),
  stage_from  TEXT,
  stage_to    TEXT,
  comment     TEXT CHECK (comment IS NULL OR length(comment) <= 500),
  detail      JSONB NOT NULL DEFAULT '{}',
  created_by  BIGINT REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX payroll_run_events_run ON payroll_run_events (run_id, created_at);

-- ---- a record per employee: what was paid and why, frozen -------------------------------------------------------
CREATE TABLE payroll_records (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id           BIGINT NOT NULL REFERENCES schools(id),
  run_id              BIGINT NOT NULL REFERENCES payroll_runs(id),
  employee_id         BIGINT NOT NULL REFERENCES employees(id),
  month               DATE NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('COMPUTED', 'FAILED', 'HELD', 'RELEASED', 'PAID')),
  failure_code        TEXT,
  failure_reason      TEXT CHECK (failure_reason IS NULL OR length(failure_reason) <= 300),
  -- only what was pending (the month already paid by a locked run)
  is_top_up           BOOLEAN NOT NULL DEFAULT false,
  -- the employee as paid
  employee_code       TEXT NOT NULL,
  employee_name       TEXT NOT NULL,
  designation         TEXT,
  department          TEXT,
  pan_masked          TEXT,
  uan                 TEXT,
  pf_number           TEXT,
  esi_number          TEXT,
  pay_level           TEXT,
  pay_mode            TEXT CHECK (pay_mode IS NULL OR pay_mode IN ('BANK', 'CASH', 'CHEQUE')),
  bank_name           TEXT,
  bank_ifsc           TEXT,
  bank_account_masked TEXT,
  -- the account as paid (encrypted, as on the employee record)
  bank_account_enc    TEXT,
  tax_regime          TEXT,
  -- days
  month_days          NUMERIC(4, 1) NOT NULL DEFAULT 0,
  paid_days           NUMERIC(5, 2) NOT NULL DEFAULT 0,
  lop_days            NUMERIC(5, 2) NOT NULL DEFAULT 0,
  ncp_days            NUMERIC(5, 2) NOT NULL DEFAULT 0,
  -- money (rupees)
  gross_fixed         NUMERIC(12, 2) NOT NULL DEFAULT 0,
  gross_earned        NUMERIC(12, 2) NOT NULL DEFAULT 0,
  lop_amount          NUMERIC(12, 2) NOT NULL DEFAULT 0,
  pf_wage             NUMERIC(12, 2) NOT NULL DEFAULT 0,
  esi_wage            NUMERIC(12, 2) NOT NULL DEFAULT 0,
  pt_wage             NUMERIC(12, 2) NOT NULL DEFAULT 0,
  pt_amount           NUMERIC(12, 2) NOT NULL DEFAULT 0,
  it_amount           NUMERIC(12, 2) NOT NULL DEFAULT 0,
  cess_amount         NUMERIC(12, 2) NOT NULL DEFAULT 0,
  total_deductions    NUMERIC(12, 2) NOT NULL DEFAULT 0,
  net_pay             NUMERIC(12, 2) NOT NULL DEFAULT 0,
  net_in_words        TEXT,
  engine_version      TEXT NOT NULL DEFAULT '1',
  -- which rows produced each amount (structure, versions, rates, settings), what was skipped and why
  trace               JSONB NOT NULL DEFAULT '{}',
  warnings            TEXT[] NOT NULL DEFAULT '{}',
  -- what the payslip prints, frozen when the run is locked (a reprint is identical)
  payslip             JSONB,
  held_reason         TEXT CHECK (held_reason IS NULL OR length(held_reason) <= 200),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by          BIGINT REFERENCES users(id),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, employee_id),
  CHECK (status <> 'FAILED' OR failure_reason IS NOT NULL)
);
CREATE INDEX payroll_records_employee ON payroll_records (employee_id, month);
CREATE INDEX payroll_records_month ON payroll_records (school_id, month);

CREATE TABLE payroll_record_lines (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id     BIGINT NOT NULL REFERENCES schools(id),
  record_id     BIGINT NOT NULL REFERENCES payroll_records(id) ON DELETE CASCADE,
  -- NULL for the rounding adjustment
  pay_head_id   BIGINT REFERENCES payroll_pay_heads(id),
  code          TEXT NOT NULL,
  name          TEXT NOT NULL,
  head_type     TEXT NOT NULL CHECK (head_type IN ('EARNING', 'DEDUCTION')),
  -- the month's entitlement (a structure line) or the one-off amount
  rate          NUMERIC(12, 2) NOT NULL DEFAULT 0,
  amount        NUMERIC(12, 2) NOT NULL DEFAULT 0,
  is_arrear     BOOLEAN NOT NULL DEFAULT false,
  is_structure  BOOLEAN NOT NULL DEFAULT false,
  is_taxable    BOOLEAN NOT NULL DEFAULT false,
  calc_order    INT NOT NULL,
  print_order   INT NOT NULL DEFAULT 100,
  show_if_zero  BOOLEAN NOT NULL DEFAULT false,
  source_kind   TEXT NOT NULL CHECK (source_kind IN ('structure', 'arrear', 'adhoc', 'recurring', 'loan', 'engine', 'rounding')),
  source_id     TEXT
);
CREATE INDEX payroll_record_lines_record ON payroll_record_lines (record_id);

-- the statutory figures of a record (the employer's shares never print on a payslip)
CREATE TABLE payroll_record_statutory (
  record_id      BIGINT PRIMARY KEY REFERENCES payroll_records(id) ON DELETE CASCADE,
  school_id      BIGINT NOT NULL REFERENCES schools(id),
  pf_wage        NUMERIC(12, 2) NOT NULL DEFAULT 0,
  eps_wage       NUMERIC(12, 2) NOT NULL DEFAULT 0,
  edli_wage      NUMERIC(12, 2) NOT NULL DEFAULT 0,
  ee_pf          NUMERIC(12, 2) NOT NULL DEFAULT 0,
  vpf            NUMERIC(12, 2) NOT NULL DEFAULT 0,
  er_eps         NUMERIC(12, 2) NOT NULL DEFAULT 0,
  er_epf         NUMERIC(12, 2) NOT NULL DEFAULT 0,
  edli           NUMERIC(12, 2) NOT NULL DEFAULT 0,
  pf_admin       NUMERIC(12, 2) NOT NULL DEFAULT 0,
  ncp_days       NUMERIC(5, 2) NOT NULL DEFAULT 0,
  nps_wage       NUMERIC(12, 2),
  nps_ee         NUMERIC(12, 2),
  nps_er         NUMERIC(12, 2),
  esi_covered    BOOLEAN,
  esi_wage       NUMERIC(12, 2),
  esi_ee         NUMERIC(12, 2),
  esi_er         NUMERIC(12, 2),
  lwf_state      TEXT,
  lwf_ee         NUMERIC(12, 2),
  lwf_er         NUMERIC(12, 2)
);

-- the month's income tax as worked out for the record (My tax reads the latest locked one)
CREATE TABLE payroll_record_tax (
  record_id          BIGINT PRIMARY KEY REFERENCES payroll_records(id) ON DELETE CASCADE,
  school_id          BIGINT NOT NULL REFERENCES schools(id),
  fy                 TEXT NOT NULL,
  mode               TEXT NOT NULL CHECK (mode IN ('PROJECTION', 'TYPED', 'NONE')),
  regime             TEXT,
  gross_projection   NUMERIC(14, 2),
  standard_deduction NUMERIC(12, 2),
  pt_deduction       NUMERIC(12, 2),
  other_deductions   NUMERIC(12, 2),
  taxable_income     NUMERIC(14, 2),
  slab_tax           NUMERIC(14, 2),
  rebate             NUMERIC(14, 2),
  surcharge          NUMERIC(14, 2),
  cess               NUMERIC(14, 2),
  annual_tax         NUMERIC(14, 2),
  ytd_tds            NUMERIC(14, 2),
  months_left        INT,
  monthly_tds        NUMERIC(12, 2) NOT NULL DEFAULT 0,
  pan_absent         BOOLEAN NOT NULL DEFAULT false
);

-- the loan instalments a record took (restored exactly when its run is purged)
CREATE TABLE payroll_record_loans (
  record_id   BIGINT NOT NULL REFERENCES payroll_records(id) ON DELETE CASCADE,
  loan_id     BIGINT NOT NULL REFERENCES payroll_loans(id),
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  opening     NUMERIC(12, 2) NOT NULL,
  interest    NUMERIC(12, 2) NOT NULL,
  emi         NUMERIC(12, 2) NOT NULL,
  principal   NUMERIC(12, 2) NOT NULL,
  closing     NUMERIC(12, 2) NOT NULL,
  PRIMARY KEY (record_id, loan_id)
);

-- ---- arrears owed for earlier months, paid by the next run that processes the employee ------------------------------
CREATE TABLE payroll_arrears (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id          BIGINT NOT NULL REFERENCES schools(id),
  employee_id        BIGINT NOT NULL REFERENCES employees(id),
  pay_head_id        BIGINT NOT NULL REFERENCES payroll_pay_heads(id),
  -- the month it is owed for
  period_month       DATE NOT NULL CHECK (extract(day FROM period_month) = 1),
  -- negative: a recovery
  amount             NUMERIC(12, 2) NOT NULL CHECK (amount <> 0),
  pf_applicable      BOOLEAN NOT NULL DEFAULT false,
  taxable            BOOLEAN NOT NULL DEFAULT true,
  source             TEXT NOT NULL CHECK (source IN ('LOP_REVERSAL', 'REVISION', 'MANUAL')),
  source_id          BIGINT,
  paid_in_record_id  BIGINT REFERENCES payroll_records(id),
  cancelled_at       TIMESTAMPTZ,
  created_by         BIGINT REFERENCES users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX payroll_arrears_pending ON payroll_arrears (employee_id) WHERE paid_in_record_id IS NULL AND cancelled_at IS NULL;

-- ---- ESI coverage, decided once a contribution period ----------------------------------------------------------------
CREATE TABLE payroll_esi_coverage (
  school_id      BIGINT NOT NULL REFERENCES schools(id),
  employee_id    BIGINT NOT NULL REFERENCES employees(id),
  period_start   DATE NOT NULL,
  covered        BOOLEAN NOT NULL,
  wage_at_start  NUMERIC(12, 2) NOT NULL,
  -- the record that decided it (purged with it)
  record_id      BIGINT REFERENCES payroll_records(id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (employee_id, period_start)
);

-- the record that paid a one-off item
ALTER TABLE payroll_adhoc
  ADD CONSTRAINT payroll_adhoc_paid_record FOREIGN KEY (paid_in_record_id) REFERENCES payroll_records(id);
ALTER TABLE payroll_claims ADD COLUMN paid_in_record_id BIGINT REFERENCES payroll_records(id);

-- ---- row-level security and the audit trail --------------------------------------------------------------------
CALL app.apply_tenant_rls('payroll_runs');
CALL app.apply_tenant_rls('payroll_run_events');
CALL app.apply_tenant_rls('payroll_records');
CALL app.apply_tenant_rls('payroll_record_lines');
CALL app.apply_tenant_rls('payroll_record_statutory');
CALL app.apply_tenant_rls('payroll_record_tax');
CALL app.apply_tenant_rls('payroll_record_loans');
CALL app.apply_tenant_rls('payroll_arrears');
CALL app.apply_tenant_rls('payroll_esi_coverage');
CREATE TRIGGER payroll_runs_audit AFTER INSERT OR UPDATE OR DELETE ON payroll_runs
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE TRIGGER payroll_arrears_audit AFTER INSERT OR UPDATE OR DELETE ON payroll_arrears
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
-- a record's status (held, released, paid) is audited; its computed rows are written once per process
CREATE TRIGGER payroll_records_audit AFTER UPDATE OF status, held_reason ON payroll_records
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
