-- 0365: payroll, phase A — the set-up (docs/design/86, plan PAYROLL_MODULE_PLAN.md). The legacy 2026 PHP
-- payroll's set-up kept as it works: the module settings; the rate registry (generic rates, PF, ESI, PT by
-- state, LWF, OT rates — every row dated, DRAFT → ACTIVE by a checker who did not make it, approval ending the
-- previous ACTIVE row; TDS slabs, config, surcharge and the tax labels by financial year); pay heads (identity)
-- with dated versions (calc type, formula, statutory flags, rounding), slabs and saved formula tests; the pay
-- matrix (level × cell); the employee payroll profile (on the employee master: its PAN, Aadhaar, bank, PF no,
-- UAN, ESI no and NPS no are read from there, not copied), its change history and nominees; salary structures
-- (dated head amounts, DRAFT → ACTIVE) and templates. Rights: payroll maker and payroll checker roles; school
-- and group admins are payroll admin. Money is NUMERIC rupees here; the engine (@edupro/payroll-engine)
-- computes in paise. A school's defaults (the legacy seed: DA / HRA rates, PF, ESI, PT for MH / DL / HR,
-- LWF for MH / HR, TDS FY 2025-26 and 2026-27 in both regimes, the standard pay heads and their tests, the
-- 2016 pay matrix) come from app.payroll_seed, run when its payroll set-up is first opened.

-- ---- rights and roles ------------------------------------------------------------------------------------
INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('payroll.setup.view', 'payroll', 'See payroll: its set-up, rates, pay heads, the pay matrix, profiles and structures', false),
  ('payroll.setup.manage', 'payroll',
   'Prepare payroll set-up: draft rates, pay heads and versions, payroll profiles, salary structures and templates', false),
  ('payroll.setup.approve', 'payroll',
   'Approve payroll set-up drafts made by someone else, and correct the pay matrix', true),
  ('payroll.settings.manage', 'payroll',
   'Payroll admin: the payroll settings and confidential staff; may approve their own set-up drafts', true),
  ('payroll.profile.reveal', 'payroll',
   'See an employee''s full PAN, Aadhaar and bank account in payroll, with a reason (logged)', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO roles (school_id, code, name, kind, is_system, description) VALUES
  (NULL, 'payroll_maker', 'Payroll maker', 'module', true,
   'Prepares payroll: set-up drafts, profiles, structures, the monthly inputs and the run'),
  (NULL, 'payroll_checker', 'Payroll checker', 'module', true,
   'Checks and approves payroll prepared by someone else; reveals PAN and bank with a reason')
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r, (VALUES ('payroll.setup.view'), ('payroll.setup.manage')) AS p(code)
 WHERE r.school_id IS NULL AND r.code IN ('payroll_maker', 'payroll_checker', 'school_admin', 'group_admin')
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r, (VALUES ('payroll.setup.approve'), ('payroll.profile.reveal')) AS p(code)
 WHERE r.school_id IS NULL AND r.code IN ('payroll_checker', 'school_admin', 'group_admin')
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'payroll.settings.manage' FROM roles r WHERE r.school_id IS NULL AND r.code IN ('school_admin', 'group_admin')
ON CONFLICT DO NOTHING;

-- ---- settings ----------------------------------------------------------------------------------------------
CREATE TABLE payroll_settings (
  school_id                 BIGINT PRIMARY KEY REFERENCES schools(id),
  state_code                TEXT CHECK (state_code IS NULL OR state_code ~ '^[A-Z]{2}$'),
  pf_establishment_code     TEXT CHECK (pf_establishment_code IS NULL OR length(pf_establishment_code) <= 40),
  tan                       TEXT CHECK (tan IS NULL OR tan ~ '^[A-Z]{4}[0-9]{5}[A-Z]$'),
  ptrc_no                   TEXT CHECK (ptrc_no IS NULL OR length(ptrc_no) <= 40),
  esi_code                  TEXT CHECK (esi_code IS NULL OR length(esi_code) <= 40),
  lwf_enabled               BOOLEAN NOT NULL DEFAULT false,
  eps_stop_age              INT NOT NULL DEFAULT 58 CHECK (eps_stop_age BETWEEN 50 AND 70),
  -- the PF ceiling prorated by paid days on the CEILING basis (the legacy default)
  pf_ceiling_prorate        BOOLEAN NOT NULL DEFAULT true,
  matrix_code               TEXT NOT NULL DEFAULT 'PM_2016',
  -- a custom pay cycle (from this day of the month to the day before it next month); NULL = calendar month
  pay_cycle_from_day        INT CHECK (pay_cycle_from_day IS NULL OR pay_cycle_from_day BETWEEN 2 AND 28),
  ot_hours_limit            NUMERIC(6, 2) NOT NULL DEFAULT 744 CHECK (ot_hours_limit > 0),
  -- the payslip PDF password: tokens {EMPID} {NAME3} {NAME4} {PAN} {PAN4} {AADHAAR4} {DOB_DDMMYYYY} … (phase B)
  payslip_password          TEXT CHECK (payslip_password IS NULL OR length(payslip_password) <= 80),
  payslip_header            JSONB NOT NULL DEFAULT '{}',
  bank_file_format          TEXT NOT NULL DEFAULT 'GENERIC_CSV'
                            CHECK (bank_file_format IN ('GENERIC_CSV', 'CUSTOM_CSV', 'BANK_LETTER_XLSX')),
  bank_custom_columns       JSONB NOT NULL DEFAULT '[]',
  -- staff hidden from makers in lists and reports (still paid and in statutory files)
  confidential_employee_ids BIGINT[] NOT NULL DEFAULT '{}',
  -- formula attributes: [{ "code": "IS_PERMANENT", "field": "nature_of_appointment", "value": "Permanent" }]
  formula_attributes        JSONB NOT NULL DEFAULT '[]',
  -- the tax regime may be switched by the employee up to this month of the financial year (December = 12)
  regime_cutoff_month       INT NOT NULL DEFAULT 12 CHECK (regime_cutoff_month BETWEEN 1 AND 12),
  updated_by                BIGINT REFERENCES users(id),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---- the rate registry (dated; DRAFT → ACTIVE by a checker who did not make it) ------------------------------
-- As the legacy: a month reads the ACTIVE row whose dates cover it (the latest start wins); approving a new row
-- gives the previous ACTIVE row an end date and leaves it ACTIVE, so past months still read it; a row ended by
-- hand is ENDED and no longer read.
CREATE TABLE payroll_rates (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id       BIGINT NOT NULL REFERENCES schools(id),
  -- DA_RATE, HRA_RATE, MIN_WAGE_<STATE>[_<CATEGORY>], LABOUR_CODE_WAGES (1 = the labour codes' wage rule) …
  rate_code       TEXT NOT NULL CHECK (rate_code ~ '^[A-Z][A-Z0-9_]{1,29}$'),
  rate_value      NUMERIC(14, 6) NOT NULL,
  notified_on     DATE,
  source          TEXT NOT NULL DEFAULT 'school' CHECK (source IN ('govt', 'school')),
  effective_from  DATE NOT NULL,
  effective_to    DATE,
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'ended')),
  approved_by     BIGINT REFERENCES users(id),
  approved_at     TIMESTAMPTZ,
  reference_no    TEXT CHECK (reference_no IS NULL OR length(reference_no) <= 60),
  change_reason   TEXT CHECK (change_reason IS NULL OR length(change_reason) <= 200),
  created_by      BIGINT REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by      BIGINT REFERENCES users(id),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  UNIQUE (school_id, rate_code, effective_from)
);
CREATE INDEX payroll_rates_code ON payroll_rates (school_id, rate_code, status, effective_from);

CREATE TABLE payroll_pf_settings (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id          BIGINT NOT NULL REFERENCES schools(id),
  ee_rate            NUMERIC(6, 4) NOT NULL DEFAULT 0.12,
  er_rate            NUMERIC(6, 4) NOT NULL DEFAULT 0.12,
  eps_rate           NUMERIC(6, 4) NOT NULL DEFAULT 0.0833,
  eps_wage_ceiling   NUMERIC(12, 2) NOT NULL DEFAULT 15000,
  edli_rate          NUMERIC(6, 4) NOT NULL DEFAULT 0.005,
  edli_wage_ceiling  NUMERIC(12, 2) NOT NULL DEFAULT 15000,
  edli_min           NUMERIC(12, 2) NOT NULL DEFAULT 75,
  admin_rate         NUMERIC(6, 4) NOT NULL DEFAULT 0.005,
  admin_min          NUMERIC(12, 2) NOT NULL DEFAULT 500,
  effective_from  DATE NOT NULL,
  effective_to    DATE,
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'ended')),
  approved_by     BIGINT REFERENCES users(id),
  approved_at     TIMESTAMPTZ,
  reference_no    TEXT CHECK (reference_no IS NULL OR length(reference_no) <= 60),
  change_reason   TEXT CHECK (change_reason IS NULL OR length(change_reason) <= 200),
  created_by      BIGINT REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by      BIGINT REFERENCES users(id),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  UNIQUE (school_id, effective_from)
);

CREATE TABLE payroll_esi_settings (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id       BIGINT NOT NULL REFERENCES schools(id),
  ee_rate         NUMERIC(6, 4) NOT NULL DEFAULT 0.0075,
  er_rate         NUMERIC(6, 4) NOT NULL DEFAULT 0.0325,
  wage_limit      NUMERIC(12, 2) NOT NULL DEFAULT 21000,
  -- the limit for persons with disability (read for staff marked so on their payroll profile)
  wage_limit_pwd  NUMERIC(12, 2) NOT NULL DEFAULT 25000,
  effective_from  DATE NOT NULL,
  effective_to    DATE,
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'ended')),
  approved_by     BIGINT REFERENCES users(id),
  approved_at     TIMESTAMPTZ,
  reference_no    TEXT CHECK (reference_no IS NULL OR length(reference_no) <= 60),
  change_reason   TEXT CHECK (change_reason IS NULL OR length(change_reason) <= 200),
  created_by      BIGINT REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by      BIGINT REFERENCES users(id),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  UNIQUE (school_id, effective_from)
);

CREATE TABLE payroll_pt_slabs (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id        BIGINT NOT NULL REFERENCES schools(id),
  state_code       TEXT NOT NULL CHECK (state_code ~ '^[A-Z]{2}$'),
  gender           TEXT NOT NULL DEFAULT 'ANY' CHECK (gender IN ('M', 'F', 'ANY')),
  wage_from        NUMERIC(12, 2) NOT NULL CHECK (wage_from >= 0),
  wage_to          NUMERIC(12, 2) CHECK (wage_to IS NULL OR wage_to >= wage_from),
  monthly_amount   NUMERIC(8, 2) NOT NULL CHECK (monthly_amount >= 0),
  -- { "2": 300 }: February ₹300 (the MH pattern)
  month_overrides  JSONB,
  effective_from  DATE NOT NULL,
  effective_to    DATE,
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'ended')),
  approved_by     BIGINT REFERENCES users(id),
  approved_at     TIMESTAMPTZ,
  reference_no    TEXT CHECK (reference_no IS NULL OR length(reference_no) <= 60),
  change_reason   TEXT CHECK (change_reason IS NULL OR length(change_reason) <= 200),
  created_by      BIGINT REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by      BIGINT REFERENCES users(id),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  UNIQUE (school_id, state_code, gender, wage_from, effective_from)
);

CREATE TABLE payroll_lwf_settings (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id       BIGINT NOT NULL REFERENCES schools(id),
  state_code      TEXT NOT NULL CHECK (state_code ~ '^[A-Z]{2}$'),
  ee_rate         NUMERIC(6, 4),
  ee_cap          NUMERIC(8, 2),
  ee_flat         NUMERIC(8, 2),
  er_flat         NUMERIC(8, 2),
  er_multiplier   NUMERIC(4, 2),
  frequency       TEXT NOT NULL CHECK (frequency IN ('monthly', 'half_yearly')),
  months          INT[] CHECK (months IS NULL OR months <@ ARRAY[1,2,3,4,5,6,7,8,9,10,11,12]),
  effective_from  DATE NOT NULL,
  effective_to    DATE,
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'ended')),
  approved_by     BIGINT REFERENCES users(id),
  approved_at     TIMESTAMPTZ,
  reference_no    TEXT CHECK (reference_no IS NULL OR length(reference_no) <= 60),
  change_reason   TEXT CHECK (change_reason IS NULL OR length(change_reason) <= 200),
  created_by      BIGINT REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by      BIGINT REFERENCES users(id),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  UNIQUE (school_id, state_code, effective_from)
);

CREATE TABLE payroll_ot_rates (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id       BIGINT NOT NULL REFERENCES schools(id),
  -- the employee type (staff type) as on the employee master
  employee_type   TEXT NOT NULL CHECK (length(btrim(employee_type)) BETWEEN 1 AND 100),
  daily_amount    NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (daily_amount >= 0),
  hourly_amount   NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (hourly_amount >= 0),
  effective_from  DATE NOT NULL,
  effective_to    DATE,
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'ended')),
  approved_by     BIGINT REFERENCES users(id),
  approved_at     TIMESTAMPTZ,
  reference_no    TEXT CHECK (reference_no IS NULL OR length(reference_no) <= 60),
  change_reason   TEXT CHECK (change_reason IS NULL OR length(change_reason) <= 200),
  created_by      BIGINT REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by      BIGINT REFERENCES users(id),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  UNIQUE (school_id, employee_type, effective_from)
);

-- ---- income tax, by financial year ('2026-27') -------------------------------------------------------------
CREATE TABLE payroll_tds_slabs (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  fy          TEXT NOT NULL CHECK (fy ~ '^[0-9]{4}-[0-9]{2}$'),
  regime      TEXT NOT NULL CHECK (regime IN ('NEW', 'OLD')),
  slab_from   NUMERIC(14, 2) NOT NULL CHECK (slab_from >= 0),
  slab_to     NUMERIC(14, 2) CHECK (slab_to IS NULL OR slab_to > slab_from),
  rate        NUMERIC(5, 4) NOT NULL CHECK (rate BETWEEN 0 AND 1),
  created_by      BIGINT REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by      BIGINT REFERENCES users(id),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, fy, regime, slab_from)
);
CREATE TABLE payroll_tds_config (
  id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id            BIGINT NOT NULL REFERENCES schools(id),
  fy                   TEXT NOT NULL CHECK (fy ~ '^[0-9]{4}-[0-9]{2}$'),
  regime               TEXT NOT NULL CHECK (regime IN ('NEW', 'OLD')),
  standard_deduction   NUMERIC(12, 2) NOT NULL,
  rebate_income_limit  NUMERIC(14, 2) NOT NULL,
  rebate_max           NUMERIC(12, 2) NOT NULL,
  cess_rate            NUMERIC(5, 4) NOT NULL DEFAULT 0.04,
  -- no PAN: tax at the higher of the normal tax and this flat rate on the taxable income
  pan_absent_rate      NUMERIC(5, 4) NOT NULL DEFAULT 0.20,
  marginal_relief      BOOLEAN NOT NULL DEFAULT true,
  created_by      BIGINT REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by      BIGINT REFERENCES users(id),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, fy, regime)
);
CREATE TABLE payroll_tds_surcharges (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  fy           TEXT NOT NULL CHECK (fy ~ '^[0-9]{4}-[0-9]{2}$'),
  regime       TEXT NOT NULL CHECK (regime IN ('NEW', 'OLD')),
  income_from  NUMERIC(14, 2) NOT NULL,
  rate         NUMERIC(5, 4) NOT NULL CHECK (rate BETWEEN 0 AND 1),
  created_by      BIGINT REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by      BIGINT REFERENCES users(id),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, fy, regime, income_from)
);
-- the printed names of the tax lines, caps and declarable items per year (the Income-tax Act 2025 renamed them)
CREATE TABLE payroll_tax_labels (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  fy           TEXT NOT NULL CHECK (fy ~ '^[0-9]{4}-[0-9]{2}$'),
  line_code    TEXT NOT NULL CHECK (line_code ~ '^[A-Z][A-Z0-9_]{1,29}$'),
  label        TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 150),
  applies_to   TEXT NOT NULL DEFAULT 'OLD' CHECK (applies_to IN ('OLD', 'NEW', 'BOTH')),
  cap_amount   NUMERIC(12, 2),
  declarable   BOOLEAN NOT NULL DEFAULT false,
  sort_order   INT NOT NULL DEFAULT 100,
  created_by      BIGINT REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by      BIGINT REFERENCES users(id),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, fy, line_code)
);

-- ---- pay heads: identity, dated versions, slabs, saved formula tests --------------------------------------------
CREATE TABLE payroll_pay_heads (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id     BIGINT NOT NULL REFERENCES schools(id),
  code          TEXT NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{0,19}$'),
  name          TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
  head_type     TEXT NOT NULL CHECK (head_type IN ('EARNING', 'DEDUCTION')),
  category      TEXT NOT NULL DEFAULT 'ALLOWANCE'
                CHECK (category IN ('BASIC', 'DA', 'HRA', 'ALLOWANCE', 'ARREAR', 'BONUS', 'REIMB', 'LOAN',
                                    'STATUTORY', 'MISC')),
  print_order   INT NOT NULL DEFAULT 100,
  -- set when the head is made: shown on the payslip even at zero
  show_if_zero  BOOLEAN NOT NULL DEFAULT false,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by      BIGINT REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by      BIGINT REFERENCES users(id),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, code)
);
CREATE TABLE payroll_pay_head_versions (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id       BIGINT NOT NULL REFERENCES schools(id),
  pay_head_id     BIGINT NOT NULL REFERENCES payroll_pay_heads(id),
  calc_type       TEXT NOT NULL DEFAULT 'FIXED' CHECK (calc_type IN ('FIXED', 'FORMULA', 'SLAB', 'MANUAL', 'SYSTEM')),
  formula         TEXT CHECK (formula IS NULL OR length(formula) <= 255),
  -- comma-separated head codes: the calculation order (else the formula's references)
  depends_on      TEXT CHECK (depends_on IS NULL OR length(depends_on) <= 255),
  is_taxable      BOOLEAN NOT NULL DEFAULT true,
  pf_wage         BOOLEAN NOT NULL DEFAULT false,
  esi_wage        BOOLEAN NOT NULL DEFAULT true,
  pt_wage         BOOLEAN NOT NULL DEFAULT true,
  prorate_on_lop  BOOLEAN NOT NULL DEFAULT true,
  rounding        TEXT NOT NULL DEFAULT 'NEAREST_1'
                  CHECK (rounding IN ('NONE', 'NEAREST_1', 'FLOOR_1', 'CEIL_1', 'NEAREST_10', 'NEAREST_100', 'CEIL_100')),
  effective_from  DATE NOT NULL,
  effective_to    DATE,
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'ended')),
  approved_by     BIGINT REFERENCES users(id),
  approved_at     TIMESTAMPTZ,
  reference_no    TEXT CHECK (reference_no IS NULL OR length(reference_no) <= 60),
  change_reason   TEXT CHECK (change_reason IS NULL OR length(change_reason) <= 200),
  created_by      BIGINT REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by      BIGINT REFERENCES users(id),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CHECK (calc_type <> 'FORMULA' OR (formula IS NOT NULL AND length(btrim(formula)) > 0)),
  UNIQUE (pay_head_id, effective_from)
);
CREATE INDEX payroll_pay_head_versions_asof ON payroll_pay_head_versions (pay_head_id, status, effective_from);
CREATE TABLE payroll_pay_head_slabs (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  version_id   BIGINT NOT NULL REFERENCES payroll_pay_head_versions(id) ON DELETE CASCADE,
  basis        TEXT NOT NULL DEFAULT 'BASIC' CHECK (basis IN ('BASIC', 'BASIC_DA', 'GROSS', 'PAY_LEVEL')),
  range_from   NUMERIC(12, 2) NOT NULL,
  range_to     NUMERIC(12, 2) CHECK (range_to IS NULL OR range_to >= range_from),
  flat_amount  NUMERIC(12, 2),
  percent      NUMERIC(7, 4),
  seq          INT NOT NULL DEFAULT 1,
  CHECK ((flat_amount IS NULL) <> (percent IS NULL))
);
CREATE INDEX payroll_pay_head_slabs_version ON payroll_pay_head_slabs (version_id, seq);
CREATE TABLE payroll_formula_tests (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  pay_head_id  BIGINT NOT NULL REFERENCES payroll_pay_heads(id),
  name         TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  -- { "BASIC": "52000", "DA_RATE": "0.58" }
  inputs       JSONB NOT NULL,
  expected     NUMERIC(12, 2) NOT NULL,
  last_result  NUMERIC(12, 2),
  last_status  TEXT CHECK (last_status IS NULL OR last_status IN ('pass', 'fail')),
  created_by      BIGINT REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by      BIGINT REFERENCES users(id),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (pay_head_id, name)
);

-- ---- the pay matrix (level × cell of basic pay) ----------------------------------------------------------------
CREATE TABLE payroll_pay_matrix (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id       BIGINT NOT NULL REFERENCES schools(id),
  matrix_code     TEXT NOT NULL CHECK (matrix_code ~ '^[A-Z][A-Z0-9_]{1,29}$'),
  pay_level       TEXT NOT NULL CHECK (length(btrim(pay_level)) BETWEEN 1 AND 20),
  level_order     INT NOT NULL DEFAULT 0,
  cell_no         INT NOT NULL CHECK (cell_no BETWEEN 1 AND 60),
  basic           NUMERIC(12, 2) NOT NULL CHECK (basic > 0),
  effective_from  DATE NOT NULL,
  created_by      BIGINT REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by      BIGINT REFERENCES users(id),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, matrix_code, pay_level, cell_no)
);

-- ---- the employee's payroll profile (on the employee master) ---------------------------------------------------
CREATE TABLE payroll_profiles (
  employee_id        BIGINT PRIMARY KEY REFERENCES employees(id),
  school_id          BIGINT NOT NULL REFERENCES schools(id),
  pf_applicable      BOOLEAN NOT NULL DEFAULT true,
  pf_wage_basis      TEXT NOT NULL DEFAULT 'ACTUAL' CHECK (pf_wage_basis IN ('ACTUAL', 'CEILING')),
  eps_applicable     BOOLEAN NOT NULL DEFAULT true,
  vpf_type           TEXT NOT NULL DEFAULT 'NONE' CHECK (vpf_type IN ('NONE', 'FLAT', 'PERCENT')),
  vpf_value          NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (vpf_value >= 0),
  nps_applicable     BOOLEAN NOT NULL DEFAULT false,
  nps_ee_rate        NUMERIC(5, 4) NOT NULL DEFAULT 0.10,
  nps_er_rate        NUMERIC(5, 4) NOT NULL DEFAULT 0.14,
  esi_applicable     BOOLEAN NOT NULL DEFAULT true,
  -- a person with disability: the ESI wage limit for them applies
  pwd                BOOLEAN NOT NULL DEFAULT false,
  pt_applicable      BOOLEAN NOT NULL DEFAULT true,
  pt_exempt_reason   TEXT CHECK (pt_exempt_reason IS NULL OR length(pt_exempt_reason) <= 60),
  tax_regime         TEXT NOT NULL DEFAULT 'NEW' CHECK (tax_regime IN ('NEW', 'OLD')),
  tds_mode           TEXT NOT NULL DEFAULT 'PROJECTION' CHECK (tds_mode IN ('PROJECTION', 'MANUAL')),
  category           TEXT CHECK (category IS NULL OR length(category) <= 50),
  pay_level          TEXT CHECK (pay_level IS NULL OR length(pay_level) <= 20),
  pay_cell           INT CHECK (pay_cell IS NULL OR pay_cell BETWEEN 1 AND 60),
  contract_start     DATE,
  contract_end       DATE CHECK (contract_end IS NULL OR contract_start IS NULL OR contract_end >= contract_start),
  increment_month    INT CHECK (increment_month IS NULL OR increment_month BETWEEN 1 AND 12),
  payroll_status     TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (payroll_status IN ('ACTIVE', 'HOLD', 'LEFT')),
  pay_mode           TEXT NOT NULL DEFAULT 'BANK' CHECK (pay_mode IN ('BANK', 'CASH', 'CHEQUE')),
  created_by      BIGINT REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by      BIGINT REFERENCES users(id),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX payroll_profiles_school ON payroll_profiles (school_id, payroll_status);
-- each change of a statutory switch, the regime, the level / cell or the status: who, when, from when
CREATE TABLE payroll_profile_changes (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id       BIGINT NOT NULL REFERENCES schools(id),
  employee_id     BIGINT NOT NULL REFERENCES employees(id),
  field           TEXT NOT NULL,
  old_value       TEXT,
  new_value       TEXT,
  effective_from  DATE NOT NULL,
  changed_by      BIGINT REFERENCES users(id),
  changed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX payroll_profile_changes_employee ON payroll_profile_changes (employee_id, changed_at DESC);
CREATE TABLE payroll_nominees (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id       BIGINT NOT NULL REFERENCES schools(id),
  employee_id     BIGINT NOT NULL REFERENCES employees(id),
  name            TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 150),
  relation        TEXT NOT NULL CHECK (length(btrim(relation)) BETWEEN 1 AND 40),
  dob             DATE,
  share_percent   NUMERIC(5, 2) NOT NULL DEFAULT 100 CHECK (share_percent > 0 AND share_percent <= 100),
  purpose         TEXT NOT NULL DEFAULT 'GENERAL' CHECK (purpose IN ('GRATUITY', 'EDLI', 'GENERAL')),
  guardian_name   TEXT CHECK (guardian_name IS NULL OR length(guardian_name) <= 150),
  address         TEXT CHECK (address IS NULL OR length(address) <= 255),
  created_by      BIGINT REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by      BIGINT REFERENCES users(id),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX payroll_nominees_employee ON payroll_nominees (employee_id, purpose);

-- ---- salary structures (dated head amounts per employee) and templates ------------------------------------------
CREATE TABLE payroll_structures (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id       BIGINT NOT NULL REFERENCES schools(id),
  employee_id     BIGINT NOT NULL REFERENCES employees(id),
  pay_head_id     BIGINT NOT NULL REFERENCES payroll_pay_heads(id),
  -- a FIXED amount, or a FORMULA head's own parameter ([TA_BASE])
  amount          NUMERIC(12, 2) NOT NULL DEFAULT 0,
  -- the pay revision that made it (phase E)
  revision_id     BIGINT,
  effective_from  DATE NOT NULL,
  effective_to    DATE,
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'ended')),
  approved_by     BIGINT REFERENCES users(id),
  approved_at     TIMESTAMPTZ,
  reference_no    TEXT CHECK (reference_no IS NULL OR length(reference_no) <= 60),
  change_reason   TEXT CHECK (change_reason IS NULL OR length(change_reason) <= 200),
  created_by      BIGINT REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by      BIGINT REFERENCES users(id),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE INDEX payroll_structures_employee ON payroll_structures (employee_id, pay_head_id, effective_from);
CREATE INDEX payroll_structures_status ON payroll_structures (school_id, status);
CREATE TABLE payroll_structure_templates (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id     BIGINT NOT NULL REFERENCES schools(id),
  name          TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  description   TEXT CHECK (description IS NULL OR length(description) <= 255),
  -- the staff types it is for ('Teaching' …); empty = any
  staff_types   TEXT[] NOT NULL DEFAULT '{}',
  -- { "BASIC": "52000", "TA": "3600" }
  lines         JSONB NOT NULL DEFAULT '{}',
  created_by      BIGINT REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by      BIGINT REFERENCES users(id),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, name)
);

-- ---- row-level security and the audit trail ------------------------------------------------------------------
CALL app.apply_tenant_rls('payroll_settings');
CALL app.apply_tenant_rls('payroll_rates');
CALL app.apply_tenant_rls('payroll_pf_settings');
CALL app.apply_tenant_rls('payroll_esi_settings');
CALL app.apply_tenant_rls('payroll_pt_slabs');
CALL app.apply_tenant_rls('payroll_lwf_settings');
CALL app.apply_tenant_rls('payroll_ot_rates');
CALL app.apply_tenant_rls('payroll_tds_slabs');
CALL app.apply_tenant_rls('payroll_tds_config');
CALL app.apply_tenant_rls('payroll_tds_surcharges');
CALL app.apply_tenant_rls('payroll_tax_labels');
CALL app.apply_tenant_rls('payroll_pay_heads');
CALL app.apply_tenant_rls('payroll_pay_head_versions');
CALL app.apply_tenant_rls('payroll_pay_head_slabs');
CALL app.apply_tenant_rls('payroll_formula_tests');
CALL app.apply_tenant_rls('payroll_pay_matrix');
CALL app.apply_tenant_rls('payroll_profiles');
CALL app.apply_tenant_rls('payroll_profile_changes');
CALL app.apply_tenant_rls('payroll_nominees');
CALL app.apply_tenant_rls('payroll_structures');
CALL app.apply_tenant_rls('payroll_structure_templates');
CREATE TRIGGER payroll_settings_audit AFTER INSERT OR UPDATE OR DELETE ON payroll_settings
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE TRIGGER payroll_rates_audit AFTER INSERT OR UPDATE OR DELETE ON payroll_rates
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE TRIGGER payroll_pf_settings_audit AFTER INSERT OR UPDATE OR DELETE ON payroll_pf_settings
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE TRIGGER payroll_esi_settings_audit AFTER INSERT OR UPDATE OR DELETE ON payroll_esi_settings
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE TRIGGER payroll_pt_slabs_audit AFTER INSERT OR UPDATE OR DELETE ON payroll_pt_slabs
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE TRIGGER payroll_lwf_settings_audit AFTER INSERT OR UPDATE OR DELETE ON payroll_lwf_settings
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE TRIGGER payroll_ot_rates_audit AFTER INSERT OR UPDATE OR DELETE ON payroll_ot_rates
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE TRIGGER payroll_tds_slabs_audit AFTER INSERT OR UPDATE OR DELETE ON payroll_tds_slabs
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE TRIGGER payroll_tds_config_audit AFTER INSERT OR UPDATE OR DELETE ON payroll_tds_config
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE TRIGGER payroll_tds_surcharges_audit AFTER INSERT OR UPDATE OR DELETE ON payroll_tds_surcharges
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE TRIGGER payroll_tax_labels_audit AFTER INSERT OR UPDATE OR DELETE ON payroll_tax_labels
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE TRIGGER payroll_pay_heads_audit AFTER INSERT OR UPDATE OR DELETE ON payroll_pay_heads
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE TRIGGER payroll_pay_head_versions_audit AFTER INSERT OR UPDATE OR DELETE ON payroll_pay_head_versions
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE TRIGGER payroll_pay_head_slabs_audit AFTER INSERT OR UPDATE OR DELETE ON payroll_pay_head_slabs
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE TRIGGER payroll_formula_tests_audit AFTER INSERT OR UPDATE OR DELETE ON payroll_formula_tests
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE TRIGGER payroll_pay_matrix_audit AFTER INSERT OR UPDATE OR DELETE ON payroll_pay_matrix
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE TRIGGER payroll_profiles_audit AFTER INSERT OR UPDATE OR DELETE ON payroll_profiles
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE TRIGGER payroll_nominees_audit AFTER INSERT OR UPDATE OR DELETE ON payroll_nominees
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE TRIGGER payroll_structures_audit AFTER INSERT OR UPDATE OR DELETE ON payroll_structures
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE TRIGGER payroll_structure_templates_audit AFTER INSERT OR UPDATE OR DELETE ON payroll_structure_templates
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

-- ---- a school's defaults (the legacy seed), inserted when absent: what the school changed stays -------------------
CREATE OR REPLACE FUNCTION app.payroll_seed(p_school BIGINT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO payroll_settings (school_id) VALUES (p_school) ON CONFLICT DO NOTHING;
  IF NOT EXISTS (SELECT 1 FROM payroll_rates WHERE school_id = p_school) THEN
    INSERT INTO payroll_rates (school_id, rate_code, rate_value, notified_on, source, effective_from, effective_to,
                               status, change_reason)
    VALUES
      (p_school, 'DA_RATE', 0.55, NULL, 'govt', '2025-01-01', '2025-06-30', 'active', 'Default: central DA 55 %'),
      (p_school, 'DA_RATE', 0.58, '2025-10-01', 'govt', '2025-07-01', '2025-12-31', 'active', 'Default: central DA 58 % from July 2025'),
      (p_school, 'DA_RATE', 0.60, '2026-04-01', 'govt', '2026-01-01', NULL, 'active', 'Default: central DA 60 % from January 2026'),
      (p_school, 'HRA_RATE', 0.30, NULL, 'govt', '2025-01-01', NULL, 'active', 'Default: HRA 30 % of basic');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM payroll_pf_settings WHERE school_id = p_school) THEN
    INSERT INTO payroll_pf_settings (school_id, effective_from, status, change_reason)
    VALUES (p_school, '2025-04-01', 'active', 'Default: EPFO statutory rates');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM payroll_esi_settings WHERE school_id = p_school) THEN
    INSERT INTO payroll_esi_settings (school_id, effective_from, status, change_reason)
    VALUES (p_school, '2025-04-01', 'active', 'Default: ESI statutory rates');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM payroll_pt_slabs WHERE school_id = p_school) THEN
    INSERT INTO payroll_pt_slabs (school_id, state_code, gender, wage_from, wage_to, monthly_amount, month_overrides,
                                  effective_from, status, change_reason)
    VALUES
      (p_school, 'MH', 'M', 0, 7500, 0, NULL, '2025-04-01', 'active', 'Default: Maharashtra, men, nil'),
      (p_school, 'MH', 'M', 7500.01, 10000, 175, NULL, '2025-04-01', 'active', 'Default: Maharashtra, men, ₹175'),
      (p_school, 'MH', 'M', 10000.01, NULL, 200, '{"2": 300}', '2025-04-01', 'active', 'Default: Maharashtra, men, ₹200 (February ₹300)'),
      (p_school, 'MH', 'F', 0, 25000, 0, NULL, '2025-04-01', 'active', 'Default: Maharashtra, women, nil up to ₹25,000'),
      (p_school, 'MH', 'F', 25000.01, NULL, 200, NULL, '2025-04-01', 'active', 'Default: Maharashtra, women, ₹200 (verify the current notification)'),
      (p_school, 'DL', 'ANY', 0, NULL, 0, NULL, '2025-04-01', 'active', 'Default: Delhi has no PT'),
      (p_school, 'HR', 'ANY', 0, NULL, 0, NULL, '2025-04-01', 'active', 'Default: Haryana has no PT');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM payroll_lwf_settings WHERE school_id = p_school) THEN
    INSERT INTO payroll_lwf_settings (school_id, state_code, ee_rate, ee_cap, ee_flat, er_flat, er_multiplier, frequency,
                                      months, effective_from, status, change_reason)
    VALUES
      (p_school, 'MH', NULL, NULL, 25, 75, NULL, 'half_yearly', ARRAY[6, 12], '2025-04-01', 'active',
       'Default: Maharashtra LWF ₹25 / ₹75 in June and December'),
      (p_school, 'HR', 0.002, 35, NULL, NULL, 2, 'monthly', NULL, '2025-04-01', 'active',
       'Default: Haryana LWF 0.2 % capped at ₹35, employer twice');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM payroll_tds_slabs WHERE school_id = p_school) THEN
    INSERT INTO payroll_tds_slabs (school_id, fy, regime, slab_from, slab_to, rate)
    SELECT p_school, fy, r.regime, r.f, r.t, r.rate
      FROM (VALUES ('2025-26'), ('2026-27')) y(fy),
           (VALUES ('NEW', 0, 400000, 0), ('NEW', 400000, 800000, 0.05), ('NEW', 800000, 1200000, 0.10),
                   ('NEW', 1200000, 1600000, 0.15), ('NEW', 1600000, 2000000, 0.20),
                   ('NEW', 2000000, 2400000, 0.25), ('NEW', 2400000, NULL, 0.30),
                   ('OLD', 0, 250000, 0), ('OLD', 250000, 500000, 0.05), ('OLD', 500000, 1000000, 0.20),
                   ('OLD', 1000000, NULL, 0.30)) r(regime, f, t, rate);
    INSERT INTO payroll_tds_surcharges (school_id, fy, regime, income_from, rate)
    SELECT p_school, fy, r.regime, r.f, r.rate
      FROM (VALUES ('2025-26'), ('2026-27')) y(fy),
           (VALUES ('NEW', 5000000, 0.10), ('NEW', 10000000, 0.15), ('NEW', 20000000, 0.25),
                   ('OLD', 5000000, 0.10), ('OLD', 10000000, 0.15), ('OLD', 20000000, 0.25),
                   ('OLD', 50000000, 0.37)) r(regime, f, rate);
    INSERT INTO payroll_tds_config (school_id, fy, regime, standard_deduction, rebate_income_limit, rebate_max)
    SELECT p_school, fy, r.regime, r.sd, r.lim, r.mx
      FROM (VALUES ('2025-26'), ('2026-27')) y(fy),
           (VALUES ('NEW', 75000, 1200000, 60000), ('OLD', 50000, 500000, 12500)) r(regime, sd, lim, mx);
    INSERT INTO payroll_tax_labels (school_id, fy, line_code, label, applies_to, cap_amount, declarable, sort_order)
    VALUES
      (p_school, '2025-26', 'STD_DED', 'Standard deduction u/s 16(ia)', 'BOTH', NULL, false, 10),
      (p_school, '2025-26', 'PT_16III', 'Tax on employment u/s 16(iii)', 'OLD', NULL, false, 20),
      (p_school, '2025-26', 'HRA_RENT', 'HRA exemption u/s 10(13A)', 'OLD', NULL, true, 30),
      (p_school, '2025-26', 'CHAPVIA_80C', 'Deduction u/s 80C', 'OLD', 150000, true, 40),
      (p_school, '2025-26', 'CHAPVIA_80CCD1B', 'NPS (self) u/s 80CCD(1B)', 'OLD', 50000, true, 50),
      (p_school, '2025-26', 'CHAPVIA_80D', 'Medical insurance u/s 80D', 'OLD', 25000, true, 60),
      (p_school, '2025-26', 'HOME_LOAN_INT', 'Interest on housing loan u/s 24(b)', 'OLD', 200000, true, 70),
      (p_school, '2025-26', 'NPS_ER', 'Employer NPS u/s 80CCD(2)', 'BOTH', NULL, true, 80),
      (p_school, '2025-26', 'REBATE', 'Rebate u/s 87A', 'BOTH', NULL, false, 90),
      (p_school, '2025-26', 'RELIEF_89', 'Relief u/s 89 (Form 10E)', 'BOTH', NULL, false, 100),
      (p_school, '2025-26', 'CERT_FORM_TITLE', 'FORM NO. 16', 'BOTH', NULL, false, 105),
      (p_school, '2025-26', 'RETURN_FORM_NAME', '24Q', 'BOTH', NULL, false, 106),
      (p_school, '2025-26', 'YEAR_LABEL', 'Assessment Year 2026-27', 'BOTH', NULL, false, 107),
      (p_school, '2025-26', 'TDS_SECTION', '192', 'BOTH', NULL, false, 110),
      (p_school, '2025-26', 'TDS_SECTION_DISPLAY', 'u/s 192 (Salary)', 'BOTH', NULL, false, 111),
      (p_school, '2025-26', 'REGIME_NEW', 'New Regime (115BAC)', 'BOTH', NULL, false, 121),
      (p_school, '2025-26', 'REGIME_OLD', 'Old Regime', 'BOTH', NULL, false, 122),
      (p_school, '2026-27', 'STD_DED', 'Standard deduction [ITA-2025 — erstwhile 16(ia)]', 'BOTH', NULL, false, 10),
      (p_school, '2026-27', 'PT_16III', 'Tax on employment [ITA-2025 — erstwhile 16(iii)]', 'OLD', NULL, false, 20),
      (p_school, '2026-27', 'HRA_RENT', 'HRA exemption — Schedule II, ITA-2025 [erstwhile 10(13A)]', 'OLD', NULL, true, 30),
      (p_school, '2026-27', 'CHAPVIA_80C', 'u/s 123 [erstwhile 80C]', 'OLD', 150000, true, 40),
      (p_school, '2026-27', 'CHAPVIA_80CCD1B', 'u/s 124 [erstwhile 80CCD(1B)]', 'OLD', 50000, true, 50),
      (p_school, '2026-27', 'CHAPVIA_80D', 'u/s 126 [erstwhile 80D]', 'OLD', 25000, true, 60),
      (p_school, '2026-27', 'HOME_LOAN_INT', 'Housing loan interest [ITA-2025 — erstwhile 24(b)]', 'OLD', 200000, true, 70),
      (p_school, '2026-27', 'NPS_ER', 'Employer NPS [ITA-2025 — erstwhile 80CCD(2)]', 'BOTH', NULL, true, 80),
      (p_school, '2026-27', 'REBATE', 'u/s 157 [erstwhile 87A]', 'BOTH', NULL, false, 90),
      (p_school, '2026-27', 'RELIEF_89', 'Relief for arrears [ITA-2025 — erstwhile 89 / Form 10E]', 'BOTH', NULL, false, 100),
      (p_school, '2026-27', 'CERT_FORM_TITLE', 'FORM NO. 130', 'BOTH', NULL, false, 105),
      (p_school, '2026-27', 'RETURN_FORM_NAME', '138', 'BOTH', NULL, false, 106),
      (p_school, '2026-27', 'YEAR_LABEL', 'Tax Year 2026-27', 'BOTH', NULL, false, 107),
      (p_school, '2026-27', 'TDS_SECTION', '1002', 'BOTH', NULL, false, 110),
      (p_school, '2026-27', 'TDS_SECTION_DISPLAY', 'u/s 392 · Code 1002 (Salary — other than Government employees)', 'BOTH', NULL, false, 111),
      (p_school, '2026-27', 'REGIME_NEW', 'New Regime (§202, ITA-2025)', 'BOTH', NULL, false, 121),
      (p_school, '2026-27', 'REGIME_OLD', 'Old Regime', 'BOTH', NULL, false, 122);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM payroll_pay_heads WHERE school_id = p_school) THEN
    INSERT INTO payroll_pay_heads (school_id, code, name, head_type, category, print_order)
    VALUES
      (p_school, 'BASIC', 'Basic Pay', 'EARNING', 'BASIC', 10),
      (p_school, 'DA', 'Dearness Allowance', 'EARNING', 'DA', 20),
      (p_school, 'HRA', 'House Rent Allowance', 'EARNING', 'HRA', 30),
      (p_school, 'TA', 'Transport Allowance', 'EARNING', 'ALLOWANCE', 40),
      (p_school, 'SPL_ALW', 'Special Allowance', 'EARNING', 'ALLOWANCE', 50),
      (p_school, 'OT', 'Overtime', 'EARNING', 'ALLOWANCE', 60),
      (p_school, 'BONUS', 'Bonus / Ex-Gratia', 'EARNING', 'BONUS', 70),
      (p_school, 'DA_ARR', 'DA Arrears', 'EARNING', 'ARREAR', 80),
      (p_school, 'OTH_ARR', 'Other Arrears', 'EARNING', 'ARREAR', 90),
      (p_school, 'LOP_REV', 'LOP Reversal (Basic & DA)', 'EARNING', 'ARREAR', 92),
      (p_school, 'LOP_REVO', 'LOP Reversal (Other Heads)', 'EARNING', 'ARREAR', 94),
      (p_school, 'PF', 'Provident Fund', 'DEDUCTION', 'STATUTORY', 110),
      (p_school, 'VPF', 'Voluntary PF', 'DEDUCTION', 'STATUTORY', 120),
      (p_school, 'NPS', 'National Pension System', 'DEDUCTION', 'STATUTORY', 125),
      (p_school, 'ESI', 'ESI', 'DEDUCTION', 'STATUTORY', 130),
      (p_school, 'PT', 'Profession Tax', 'DEDUCTION', 'STATUTORY', 140),
      (p_school, 'TDS', 'Income Tax (TDS)', 'DEDUCTION', 'STATUTORY', 150),
      (p_school, 'LWF', 'Labour Welfare Fund', 'DEDUCTION', 'STATUTORY', 160),
      (p_school, 'ADV', 'Advance Recovery', 'DEDUCTION', 'LOAN', 170),
      (p_school, 'WARDFEE', 'Ward Fee Recovery', 'DEDUCTION', 'MISC', 180),
      (p_school, 'LIC', 'LIC Premium', 'DEDUCTION', 'MISC', 190),
      (p_school, 'MISC_DED', 'Misc Deduction', 'DEDUCTION', 'MISC', 200);
    INSERT INTO payroll_pay_head_versions (school_id, pay_head_id, calc_type, formula, depends_on, is_taxable, pf_wage,
                                           esi_wage, pt_wage, prorate_on_lop, rounding, effective_from, status,
                                           change_reason)
    SELECT p_school, h.id, v.ct, v.f, v.dep, v.tax, v.pf, v.esi, v.pt, v.pro, v.rnd, '2025-04-01', 'active',
           'Default: ' || v.why
      FROM (VALUES
        ('BASIC', 'FIXED', NULL, NULL, true, true, true, true, true, 'NEAREST_1', 'basic pay, PF wage'),
        ('DA', 'FORMULA', 'ROUND([BASIC]*DA_RATE)', 'BASIC', true, true, true, true, true, 'NEAREST_1', 'DA = basic × DA_RATE'),
        ('HRA', 'FORMULA', 'ROUND([BASIC]*HRA_RATE)', 'BASIC', true, false, true, true, true, 'NEAREST_1', 'HRA = basic × HRA_RATE'),
        ('TA', 'FORMULA', 'ROUND([TA_BASE]+[TA_BASE]*DA_RATE)', NULL, true, false, true, true, true, 'NEAREST_1', 'TA = base + DA % on the base'),
        ('SPL_ALW', 'FIXED', NULL, NULL, true, false, true, true, true, 'NEAREST_1', 'a fixed special allowance'),
        ('OT', 'FORMULA', 'ROUND(OT_HOURS*([BASIC]+[DA])/26/8*2)', 'BASIC,DA', true, false, true, true, false, 'NEAREST_1', 'overtime at double rate on basic + DA ÷ 26 ÷ 8'),
        ('BONUS', 'MANUAL', NULL, NULL, true, false, true, true, false, 'NEAREST_1', 'bonus / ex-gratia, entered'),
        ('DA_ARR', 'SYSTEM', NULL, NULL, true, true, false, false, false, 'NEAREST_1', 'DA arrears from a revision; PF applies'),
        ('OTH_ARR', 'SYSTEM', NULL, NULL, true, false, false, false, false, 'NEAREST_1', 'other arrears (no PF)'),
        ('LOP_REV', 'SYSTEM', NULL, NULL, true, true, false, false, false, 'NEAREST_1', 'LOP reversal, basic + DA; PF applies'),
        ('LOP_REVO', 'SYSTEM', NULL, NULL, true, false, false, false, false, 'NEAREST_1', 'LOP reversal, other heads'),
        ('PF', 'SYSTEM', NULL, NULL, false, false, false, false, false, 'NEAREST_1', 'statutory PF'),
        ('VPF', 'SYSTEM', NULL, NULL, false, false, false, false, false, 'NEAREST_1', 'voluntary PF from the profile'),
        ('NPS', 'SYSTEM', NULL, NULL, false, false, false, false, false, 'NEAREST_1', 'NPS employee share from the profile'),
        ('ESI', 'SYSTEM', NULL, NULL, false, false, false, false, false, 'CEIL_1', 'statutory ESI, rounded up'),
        ('PT', 'SYSTEM', NULL, NULL, false, false, false, false, false, 'NEAREST_1', 'profession tax by slab'),
        ('TDS', 'SYSTEM', NULL, NULL, false, false, false, false, false, 'NEAREST_1', 'income tax deducted at source'),
        ('LWF', 'SYSTEM', NULL, NULL, false, false, false, false, false, 'NEAREST_1', 'labour welfare fund by state (off by default)'),
        ('ADV', 'SYSTEM', NULL, NULL, false, false, false, false, false, 'NEAREST_1', 'loan instalment (up to the balance)'),
        ('WARDFEE', 'MANUAL', NULL, NULL, false, false, false, false, false, 'NEAREST_1', 'a staff child''s fee dues'),
        ('LIC', 'MANUAL', NULL, NULL, false, false, false, false, false, 'NEAREST_1', 'a third-party recurring deduction'),
        ('MISC_DED', 'MANUAL', NULL, NULL, false, false, false, false, false, 'NEAREST_1', 'any other deduction')
      ) v(code, ct, f, dep, tax, pf, esi, pt, pro, rnd, why)
      JOIN payroll_pay_heads h ON h.school_id = p_school AND h.code = v.code;
    INSERT INTO payroll_formula_tests (school_id, pay_head_id, name, inputs, expected)
    SELECT p_school, h.id, t.name, t.inputs::jsonb, t.expected
      FROM (VALUES
        ('DA', 'DA 58 % of 52,000', '{"BASIC": "52000", "DA_RATE": "0.58"}', 30160),
        ('DA', 'DA 60 % of 53,600', '{"BASIC": "53600", "DA_RATE": "0.60"}', 32160),
        ('DA', 'DA 60 % of 1,11,100', '{"BASIC": "111100", "DA_RATE": "0.60"}', 66660),
        ('HRA', 'HRA 30 % of 1,11,100', '{"BASIC": "111100", "HRA_RATE": "0.30"}', 33330),
        ('TA', 'TA base 3,600 at DA 60 %', '{"TA_BASE": "3600", "DA_RATE": "0.60"}', 5760),
        ('TA', 'TA base 7,200 at DA 60 %', '{"TA_BASE": "7200", "DA_RATE": "0.60"}', 11520)
      ) t(code, name, inputs, expected)
      JOIN payroll_pay_heads h ON h.school_id = p_school AND h.code = t.code;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM payroll_pay_matrix WHERE school_id = p_school) THEN
    INSERT INTO payroll_pay_matrix (school_id, matrix_code, pay_level, level_order, cell_no, basic, effective_from)
    SELECT p_school, 'PM_2016', m.lv, m.lo, m.cell, m.basic, '2016-01-01'
      FROM (VALUES
      ('1', 1, 1, 18000.00),
      ('1', 1, 2, 18500.00),
      ('1', 1, 3, 19100.00),
      ('1', 1, 4, 19700.00),
      ('1', 1, 5, 20300.00),
      ('1', 1, 6, 20900.00),
      ('1', 1, 7, 21500.00),
      ('1', 1, 8, 22100.00),
      ('1', 1, 9, 22800.00),
      ('1', 1, 10, 23500.00),
      ('1', 1, 11, 24200.00),
      ('1', 1, 12, 24900.00),
      ('1', 1, 13, 25600.00),
      ('1', 1, 14, 26400.00),
      ('1', 1, 15, 27200.00),
      ('1', 1, 16, 28000.00),
      ('1', 1, 17, 28800.00),
      ('1', 1, 18, 29700.00),
      ('1', 1, 19, 30600.00),
      ('1', 1, 20, 31500.00),
      ('1', 1, 21, 32400.00),
      ('1', 1, 22, 33400.00),
      ('1', 1, 23, 34400.00),
      ('1', 1, 24, 35400.00),
      ('1', 1, 25, 36500.00),
      ('1', 1, 26, 37600.00),
      ('1', 1, 27, 38700.00),
      ('1', 1, 28, 39900.00),
      ('1', 1, 29, 41100.00),
      ('1', 1, 30, 42300.00),
      ('1', 1, 31, 43600.00),
      ('1', 1, 32, 44900.00),
      ('1', 1, 33, 46200.00),
      ('1', 1, 34, 47600.00),
      ('1', 1, 35, 49000.00),
      ('1', 1, 36, 50500.00),
      ('1', 1, 37, 52000.00),
      ('1', 1, 38, 53600.00),
      ('1', 1, 39, 55200.00),
      ('1', 1, 40, 56900.00),
      ('2', 2, 1, 19900.00),
      ('2', 2, 2, 20500.00),
      ('2', 2, 3, 21100.00),
      ('2', 2, 4, 21700.00),
      ('2', 2, 5, 22400.00),
      ('2', 2, 6, 23100.00),
      ('2', 2, 7, 23300.00),
      ('2', 2, 8, 24500.00),
      ('2', 2, 9, 25200.00),
      ('2', 2, 10, 26000.00),
      ('2', 2, 11, 26800.00),
      ('2', 2, 12, 27600.00),
      ('2', 2, 13, 28400.00),
      ('2', 2, 14, 29300.00),
      ('2', 2, 15, 30200.00),
      ('2', 2, 16, 31100.00),
      ('2', 2, 17, 32000.00),
      ('2', 2, 18, 33000.00),
      ('2', 2, 19, 34000.00),
      ('2', 2, 20, 35000.00),
      ('2', 2, 21, 36100.00),
      ('2', 2, 22, 37200.00),
      ('2', 2, 23, 38300.00),
      ('2', 2, 24, 39400.00),
      ('2', 2, 25, 40600.00),
      ('2', 2, 26, 41800.00),
      ('2', 2, 27, 43100.00),
      ('2', 2, 28, 44400.00),
      ('2', 2, 29, 45700.00),
      ('2', 2, 30, 47100.00),
      ('2', 2, 31, 48500.00),
      ('2', 2, 32, 50000.00),
      ('2', 2, 33, 51500.00),
      ('2', 2, 34, 53000.00),
      ('2', 2, 35, 54600.00),
      ('2', 2, 36, 56200.00),
      ('2', 2, 37, 57900.00),
      ('2', 2, 38, 59600.00),
      ('2', 2, 39, 61400.00),
      ('2', 2, 40, 63200.00),
      ('3', 3, 1, 21700.00),
      ('3', 3, 2, 22400.00),
      ('3', 3, 3, 23100.00),
      ('3', 3, 4, 23800.00),
      ('3', 3, 5, 24500.00),
      ('3', 3, 6, 25200.00),
      ('3', 3, 7, 26000.00),
      ('3', 3, 8, 26800.00),
      ('3', 3, 9, 27600.00),
      ('3', 3, 10, 28400.00),
      ('3', 3, 11, 29300.00),
      ('3', 3, 12, 30200.00),
      ('3', 3, 13, 31100.00),
      ('3', 3, 14, 32000.00),
      ('3', 3, 15, 33000.00),
      ('3', 3, 16, 34000.00),
      ('3', 3, 17, 35000.00),
      ('3', 3, 18, 36100.00),
      ('3', 3, 19, 37200.00),
      ('3', 3, 20, 38300.00),
      ('3', 3, 21, 39400.00),
      ('3', 3, 22, 40600.00),
      ('3', 3, 23, 41800.00),
      ('3', 3, 24, 43100.00),
      ('3', 3, 25, 44400.00),
      ('3', 3, 26, 45700.00),
      ('3', 3, 27, 47100.00),
      ('3', 3, 28, 48500.00),
      ('3', 3, 29, 50000.00),
      ('3', 3, 30, 51500.00),
      ('3', 3, 31, 53000.00),
      ('3', 3, 32, 54600.00),
      ('3', 3, 33, 56200.00),
      ('3', 3, 34, 57900.00),
      ('3', 3, 35, 59600.00),
      ('3', 3, 36, 61400.00),
      ('3', 3, 37, 63200.00),
      ('3', 3, 38, 65100.00),
      ('3', 3, 39, 67100.00),
      ('3', 3, 40, 69100.00),
      ('4', 4, 1, 25500.00),
      ('4', 4, 2, 26300.00),
      ('4', 4, 3, 27100.00),
      ('4', 4, 4, 27900.00),
      ('4', 4, 5, 28700.00),
      ('4', 4, 6, 29600.00),
      ('4', 4, 7, 30500.00),
      ('4', 4, 8, 31400.00),
      ('4', 4, 9, 32300.00),
      ('4', 4, 10, 33300.00),
      ('4', 4, 11, 34300.00),
      ('4', 4, 12, 35300.00),
      ('4', 4, 13, 36400.00),
      ('4', 4, 14, 37500.00),
      ('4', 4, 15, 38600.00),
      ('4', 4, 16, 39800.00),
      ('4', 4, 17, 41000.00),
      ('4', 4, 18, 42200.00),
      ('4', 4, 19, 43500.00),
      ('4', 4, 20, 44800.00),
      ('4', 4, 21, 46100.00),
      ('4', 4, 22, 47500.00),
      ('4', 4, 23, 48900.00),
      ('4', 4, 24, 50400.00),
      ('4', 4, 25, 51900.00),
      ('4', 4, 26, 53500.00),
      ('4', 4, 27, 55100.00),
      ('4', 4, 28, 56800.00),
      ('4', 4, 29, 58500.00),
      ('4', 4, 30, 60300.00),
      ('4', 4, 31, 62100.00),
      ('4', 4, 32, 64000.00),
      ('4', 4, 33, 65900.00),
      ('4', 4, 34, 67900.00),
      ('4', 4, 35, 69900.00),
      ('4', 4, 36, 72000.00),
      ('4', 4, 37, 74200.00),
      ('4', 4, 38, 76400.00),
      ('4', 4, 39, 78700.00),
      ('4', 4, 40, 81100.00),
      ('5', 5, 1, 29200.00),
      ('5', 5, 2, 30100.00),
      ('5', 5, 3, 31000.00),
      ('5', 5, 4, 31900.00),
      ('5', 5, 5, 32900.00),
      ('5', 5, 6, 33900.00),
      ('5', 5, 7, 34900.00),
      ('5', 5, 8, 35900.00),
      ('5', 5, 9, 37000.00),
      ('5', 5, 10, 38100.00),
      ('5', 5, 11, 39200.00),
      ('5', 5, 12, 40400.00),
      ('5', 5, 13, 41600.00),
      ('5', 5, 14, 42800.00),
      ('5', 5, 15, 44100.00),
      ('5', 5, 16, 45400.00),
      ('5', 5, 17, 46800.00),
      ('5', 5, 18, 48200.00),
      ('5', 5, 19, 49600.00),
      ('5', 5, 20, 51100.00),
      ('5', 5, 21, 52600.00),
      ('5', 5, 22, 54200.00),
      ('5', 5, 23, 55800.00),
      ('5', 5, 24, 57500.00),
      ('5', 5, 25, 59200.00),
      ('5', 5, 26, 61000.00),
      ('5', 5, 27, 62800.00),
      ('5', 5, 28, 64700.00),
      ('5', 5, 29, 66600.00),
      ('5', 5, 30, 68600.00),
      ('5', 5, 31, 70700.00),
      ('5', 5, 32, 72800.00),
      ('5', 5, 33, 75000.00),
      ('5', 5, 34, 77300.00),
      ('5', 5, 35, 79600.00),
      ('5', 5, 36, 82000.00),
      ('5', 5, 37, 84500.00),
      ('5', 5, 38, 87000.00),
      ('5', 5, 39, 89600.00),
      ('5', 5, 40, 92300.00),
      ('6', 6, 1, 35400.00),
      ('6', 6, 2, 36500.00),
      ('6', 6, 3, 37600.00),
      ('6', 6, 4, 38700.00),
      ('6', 6, 5, 39900.00),
      ('6', 6, 6, 41100.00),
      ('6', 6, 7, 42300.00),
      ('6', 6, 8, 43600.00),
      ('6', 6, 9, 44900.00),
      ('6', 6, 10, 46200.00),
      ('6', 6, 11, 47600.00),
      ('6', 6, 12, 49000.00),
      ('6', 6, 13, 50500.00),
      ('6', 6, 14, 52000.00),
      ('6', 6, 15, 53600.00),
      ('6', 6, 16, 55200.00),
      ('6', 6, 17, 56900.00),
      ('6', 6, 18, 58600.00),
      ('6', 6, 19, 60400.00),
      ('6', 6, 20, 62200.00),
      ('6', 6, 21, 64100.00),
      ('6', 6, 22, 66000.00),
      ('6', 6, 23, 68000.00),
      ('6', 6, 24, 70000.00),
      ('6', 6, 25, 72100.00),
      ('6', 6, 26, 74300.00),
      ('6', 6, 27, 76500.00),
      ('6', 6, 28, 78800.00),
      ('6', 6, 29, 81200.00),
      ('6', 6, 30, 83600.00),
      ('6', 6, 31, 86100.00),
      ('6', 6, 32, 88700.00),
      ('6', 6, 33, 91400.00),
      ('6', 6, 34, 94100.00),
      ('6', 6, 35, 96900.00),
      ('6', 6, 36, 99800.00),
      ('6', 6, 37, 102800.00),
      ('6', 6, 38, 105900.00),
      ('6', 6, 39, 109100.00),
      ('6', 6, 40, 112400.00),
      ('7', 7, 1, 44900.00),
      ('7', 7, 2, 46200.00),
      ('7', 7, 3, 47600.00),
      ('7', 7, 4, 49000.00),
      ('7', 7, 5, 50500.00),
      ('7', 7, 6, 52000.00),
      ('7', 7, 7, 53600.00),
      ('7', 7, 8, 55200.00),
      ('7', 7, 9, 56900.00),
      ('7', 7, 10, 58600.00),
      ('7', 7, 11, 60400.00),
      ('7', 7, 12, 62200.00),
      ('7', 7, 13, 64100.00),
      ('7', 7, 14, 66000.00),
      ('7', 7, 15, 68000.00),
      ('7', 7, 16, 70000.00),
      ('7', 7, 17, 72100.00),
      ('7', 7, 18, 74300.00),
      ('7', 7, 19, 76500.00),
      ('7', 7, 20, 78800.00),
      ('7', 7, 21, 81200.00),
      ('7', 7, 22, 83600.00),
      ('7', 7, 23, 86100.00),
      ('7', 7, 24, 88700.00),
      ('7', 7, 25, 91400.00),
      ('7', 7, 26, 94100.00),
      ('7', 7, 27, 96900.00),
      ('7', 7, 28, 99800.00),
      ('7', 7, 29, 102800.00),
      ('7', 7, 30, 105900.00),
      ('7', 7, 31, 109100.00),
      ('7', 7, 32, 112400.00),
      ('7', 7, 33, 115800.00),
      ('7', 7, 34, 119300.00),
      ('7', 7, 35, 122900.00),
      ('7', 7, 36, 126600.00),
      ('7', 7, 37, 130400.00),
      ('7', 7, 38, 134300.00),
      ('7', 7, 39, 138300.00),
      ('7', 7, 40, 142400.00),
      ('8', 8, 1, 47600.00),
      ('8', 8, 2, 49000.00),
      ('8', 8, 3, 50500.00),
      ('8', 8, 4, 52000.00),
      ('8', 8, 5, 53600.00),
      ('8', 8, 6, 55200.00),
      ('8', 8, 7, 56900.00),
      ('8', 8, 8, 58600.00),
      ('8', 8, 9, 60400.00),
      ('8', 8, 10, 62200.00),
      ('8', 8, 11, 64100.00),
      ('8', 8, 12, 66000.00),
      ('8', 8, 13, 68000.00),
      ('8', 8, 14, 70000.00),
      ('8', 8, 15, 72100.00),
      ('8', 8, 16, 74300.00),
      ('8', 8, 17, 76500.00),
      ('8', 8, 18, 78800.00),
      ('8', 8, 19, 81200.00),
      ('8', 8, 20, 83600.00),
      ('8', 8, 21, 86100.00),
      ('8', 8, 22, 88700.00),
      ('8', 8, 23, 91400.00),
      ('8', 8, 24, 94100.00),
      ('8', 8, 25, 96900.00),
      ('8', 8, 26, 99800.00),
      ('8', 8, 27, 102800.00),
      ('8', 8, 28, 105900.00),
      ('8', 8, 29, 109100.00),
      ('8', 8, 30, 112400.00),
      ('8', 8, 31, 115800.00),
      ('8', 8, 32, 119300.00),
      ('8', 8, 33, 122900.00),
      ('8', 8, 34, 126600.00),
      ('8', 8, 35, 130400.00),
      ('8', 8, 36, 134300.00),
      ('8', 8, 37, 138300.00),
      ('8', 8, 38, 142400.00),
      ('8', 8, 39, 146700.00),
      ('8', 8, 40, 151100.00),
      ('9', 9, 1, 53100.00),
      ('9', 9, 2, 54700.00),
      ('9', 9, 3, 56300.00),
      ('9', 9, 4, 58000.00),
      ('9', 9, 5, 59700.00),
      ('9', 9, 6, 61500.00),
      ('9', 9, 7, 63300.00),
      ('9', 9, 8, 65200.00),
      ('9', 9, 9, 67200.00),
      ('9', 9, 10, 69200.00),
      ('9', 9, 11, 71300.00),
      ('9', 9, 12, 73400.00),
      ('9', 9, 13, 75600.00),
      ('9', 9, 14, 77900.00),
      ('9', 9, 15, 80200.00),
      ('9', 9, 16, 82600.00),
      ('9', 9, 17, 85100.00),
      ('9', 9, 18, 87700.00),
      ('9', 9, 19, 90300.00),
      ('9', 9, 20, 93000.00),
      ('9', 9, 21, 95800.00),
      ('9', 9, 22, 98700.00),
      ('9', 9, 23, 101700.00),
      ('9', 9, 24, 104800.00),
      ('9', 9, 25, 107900.00),
      ('9', 9, 26, 111100.00),
      ('9', 9, 27, 114400.00),
      ('9', 9, 28, 117800.00),
      ('9', 9, 29, 121300.00),
      ('9', 9, 30, 124900.00),
      ('9', 9, 31, 128600.00),
      ('9', 9, 32, 132500.00),
      ('9', 9, 33, 136500.00),
      ('9', 9, 34, 140600.00),
      ('9', 9, 35, 144800.00),
      ('9', 9, 36, 149100.00),
      ('9', 9, 37, 153600.00),
      ('9', 9, 38, 158200.00),
      ('9', 9, 39, 162900.00),
      ('9', 9, 40, 167800.00),
      ('10', 10, 1, 56100.00),
      ('10', 10, 2, 57800.00),
      ('10', 10, 3, 59500.00),
      ('10', 10, 4, 61300.00),
      ('10', 10, 5, 63100.00),
      ('10', 10, 6, 65000.00),
      ('10', 10, 7, 67000.00),
      ('10', 10, 8, 69000.00),
      ('10', 10, 9, 71100.00),
      ('10', 10, 10, 73200.00),
      ('10', 10, 11, 75400.00),
      ('10', 10, 12, 77700.00),
      ('10', 10, 13, 80000.00),
      ('10', 10, 14, 82400.00),
      ('10', 10, 15, 84900.00),
      ('10', 10, 16, 87400.00),
      ('10', 10, 17, 90000.00),
      ('10', 10, 18, 92700.00),
      ('10', 10, 19, 95500.00),
      ('10', 10, 20, 98400.00),
      ('10', 10, 21, 101400.00),
      ('10', 10, 22, 104400.00),
      ('10', 10, 23, 107500.00),
      ('10', 10, 24, 110700.00),
      ('10', 10, 25, 114000.00),
      ('10', 10, 26, 117400.00),
      ('10', 10, 27, 120900.00),
      ('10', 10, 28, 124500.00),
      ('10', 10, 29, 128200.00),
      ('10', 10, 30, 132000.00),
      ('10', 10, 31, 136000.00),
      ('10', 10, 32, 140100.00),
      ('10', 10, 33, 144300.00),
      ('10', 10, 34, 148600.00),
      ('10', 10, 35, 153100.00),
      ('10', 10, 36, 157700.00),
      ('10', 10, 37, 162400.00),
      ('10', 10, 38, 167300.00),
      ('10', 10, 39, 172300.00),
      ('10', 10, 40, 177500.00),
      ('11', 11, 1, 67700.00),
      ('11', 11, 2, 69700.00),
      ('11', 11, 3, 71800.00),
      ('11', 11, 4, 74000.00),
      ('11', 11, 5, 76200.00),
      ('11', 11, 6, 78500.00),
      ('11', 11, 7, 80900.00),
      ('11', 11, 8, 83300.00),
      ('11', 11, 9, 85800.00),
      ('11', 11, 10, 88400.00),
      ('11', 11, 11, 91100.00),
      ('11', 11, 12, 93800.00),
      ('11', 11, 13, 96600.00),
      ('11', 11, 14, 99500.00),
      ('11', 11, 15, 102500.00),
      ('11', 11, 16, 105600.00),
      ('11', 11, 17, 108800.00),
      ('11', 11, 18, 112100.00),
      ('11', 11, 19, 115500.00),
      ('11', 11, 20, 119000.00),
      ('11', 11, 21, 122600.00),
      ('11', 11, 22, 126300.00),
      ('11', 11, 23, 130100.00),
      ('11', 11, 24, 134000.00),
      ('11', 11, 25, 138000.00),
      ('11', 11, 26, 142100.00),
      ('11', 11, 27, 146400.00),
      ('11', 11, 28, 150800.00),
      ('11', 11, 29, 155300.00),
      ('11', 11, 30, 160000.00),
      ('11', 11, 31, 164800.00),
      ('11', 11, 32, 169700.00),
      ('11', 11, 33, 174800.00),
      ('11', 11, 34, 180000.00),
      ('11', 11, 35, 185400.00),
      ('11', 11, 36, 191000.00),
      ('11', 11, 37, 196700.00),
      ('11', 11, 38, 202600.00),
      ('11', 11, 39, 208700.00),
      ('12', 12, 1, 78800.00),
      ('12', 12, 2, 81200.00),
      ('12', 12, 3, 83600.00),
      ('12', 12, 4, 86100.00),
      ('12', 12, 5, 88700.00),
      ('12', 12, 6, 91400.00),
      ('12', 12, 7, 94100.00),
      ('12', 12, 8, 96900.00),
      ('12', 12, 9, 99800.00),
      ('12', 12, 10, 102800.00),
      ('12', 12, 11, 105900.00),
      ('12', 12, 12, 109100.00),
      ('12', 12, 13, 112400.00),
      ('12', 12, 14, 115800.00),
      ('12', 12, 15, 119300.00),
      ('12', 12, 16, 122900.00),
      ('12', 12, 17, 126600.00),
      ('12', 12, 18, 130400.00),
      ('12', 12, 19, 134300.00),
      ('12', 12, 20, 138300.00),
      ('12', 12, 21, 142400.00),
      ('12', 12, 22, 146700.00),
      ('12', 12, 23, 151100.00),
      ('12', 12, 24, 155600.00),
      ('12', 12, 25, 160300.00),
      ('12', 12, 26, 165100.00),
      ('12', 12, 27, 170100.00),
      ('12', 12, 28, 175200.00),
      ('12', 12, 29, 180500.00),
      ('12', 12, 30, 185900.00),
      ('12', 12, 31, 191500.00),
      ('12', 12, 32, 197200.00),
      ('12', 12, 33, 203100.00),
      ('12', 12, 34, 209200.00),
      ('13', 13, 1, 118500.00),
      ('13', 13, 2, 122100.00),
      ('13', 13, 3, 125800.00),
      ('13', 13, 4, 129600.00),
      ('13', 13, 5, 133500.00),
      ('13', 13, 6, 137500.00),
      ('13', 13, 7, 141600.00),
      ('13', 13, 8, 145800.00),
      ('13', 13, 9, 150200.00),
      ('13', 13, 10, 154700.00),
      ('13', 13, 11, 159300.00),
      ('13', 13, 12, 164100.00),
      ('13', 13, 13, 169000.00),
      ('13', 13, 14, 174100.00),
      ('13', 13, 15, 179300.00),
      ('13', 13, 16, 184700.00),
      ('13', 13, 17, 190200.00),
      ('13', 13, 18, 195900.00),
      ('13', 13, 19, 201800.00),
      ('13', 13, 20, 207900.00),
      ('13', 13, 21, 214100.00),
      ('13A', 14, 1, 131100.00),
      ('13A', 14, 2, 135000.00),
      ('13A', 14, 3, 139100.00),
      ('13A', 14, 4, 143300.00),
      ('13A', 14, 5, 147600.00),
      ('13A', 14, 6, 152000.00),
      ('13A', 14, 7, 156600.00),
      ('13A', 14, 8, 161300.00),
      ('13A', 14, 9, 166100.00),
      ('13A', 14, 10, 171100.00),
      ('13A', 14, 11, 176200.00),
      ('13A', 14, 12, 181500.00),
      ('13A', 14, 13, 186900.00),
      ('13A', 14, 14, 192500.00),
      ('13A', 14, 15, 198300.00),
      ('13A', 14, 16, 204200.00),
      ('13A', 14, 17, 210300.00),
      ('13A', 14, 18, 216600.00),
      ('14', 15, 1, 144200.00),
      ('14', 15, 2, 148500.00),
      ('14', 15, 3, 153000.00),
      ('14', 15, 4, 157600.00),
      ('14', 15, 5, 162300.00),
      ('14', 15, 6, 167200.00),
      ('14', 15, 7, 172200.00),
      ('14', 15, 8, 177400.00),
      ('14', 15, 9, 182700.00),
      ('14', 15, 10, 188200.00),
      ('14', 15, 11, 193800.00),
      ('14', 15, 12, 199600.00),
      ('14', 15, 13, 205600.00),
      ('14', 15, 14, 211800.00),
      ('14', 15, 15, 218200.00),
      ('15', 16, 1, 172200.00),
      ('15', 16, 2, 177400.00),
      ('15', 16, 3, 182700.00),
      ('15', 16, 4, 188200.00),
      ('15', 16, 5, 193800.00),
      ('15', 16, 6, 199600.00),
      ('15', 16, 7, 205600.00),
      ('15', 16, 8, 211800.00),
      ('15', 16, 9, 218200.00),
      ('15', 16, 10, 224700.00),
      ('16', 17, 1, 231400.00)
      ) m(lv, lo, cell, basic);
  END IF;
END $$;
