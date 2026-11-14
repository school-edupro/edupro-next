-- 0373: payroll, phase D step 2 — the income-tax data (docs/design/86; PAYROLL_TAX_SPEC.md). Decided 14 Nov 2026:
-- declared amounts count until the year's proof deadline, then only what a checker verified (never the checker's
-- own); declarations in both apps, HRA by month with the city, the landlord, the landlord's PAN and relationship
-- (Form 124 from 2026-27, 12BB before); Form 16 / 130 as one locked PDF released in My tax. Fixed against the legacy:
-- a rejection keeps its reason; the year's settings live in data (window, deadline, the cities HRA counts at 50 %).

-- ---- the tax year's settings ---------------------------------------------------------------------------------------
CREATE TABLE payroll_tax_years (
  school_id      BIGINT NOT NULL REFERENCES schools(id),
  fy             TEXT NOT NULL CHECK (fy ~ '^[0-9]{4}-[0-9]{2}$'),
  -- declarations are taken between these days
  declare_from   DATE NOT NULL,
  declare_to     DATE NOT NULL,
  -- after this day only verified amounts count in the tax
  proof_due      DATE NOT NULL,
  -- HRA is half the salary in these cities (two fifths elsewhere)
  listed_cities  TEXT[] NOT NULL DEFAULT '{}',
  -- the year closed: nothing changes in it any more
  frozen_at      TIMESTAMPTZ,
  frozen_by      BIGINT REFERENCES users(id),
  updated_by     BIGINT REFERENCES users(id),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (school_id, fy),
  CHECK (declare_to >= declare_from)
);

-- sections that share one cap (80C, 80CCC and 80CCD(1) share ₹1.5 lakh): the group's row carries the cap
ALTER TABLE payroll_tax_labels ADD COLUMN cap_group TEXT CHECK (cap_group IS NULL OR cap_group ~ '^[A-Z][A-Z0-9_]{1,29}$');

-- ---- an employee's declarations and proofs ---------------------------------------------------------------------------
CREATE TABLE payroll_declarations (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id        BIGINT NOT NULL REFERENCES schools(id),
  employee_id      BIGINT NOT NULL REFERENCES employees(id),
  fy               TEXT NOT NULL CHECK (fy ~ '^[0-9]{4}-[0-9]{2}$'),
  line_code        TEXT NOT NULL,
  declared         NUMERIC(14, 2) NOT NULL CHECK (declared > 0),
  verified         NUMERIC(14, 2) CHECK (verified IS NULL OR (verified >= 0 AND verified <= declared)),
  status           TEXT NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN ('SUBMITTED', 'VERIFIED', 'REJECTED')),
  reject_reason    TEXT CHECK (reject_reason IS NULL OR length(reject_reason) BETWEEN 3 AND 300),
  -- HRA: { months: [{ month, rent }], city, listedCity, landlord: { name, panEnc, panMasked, address, relation } }
  detail           JSONB NOT NULL DEFAULT '{}',
  proof_file_ids   BIGINT[] NOT NULL DEFAULT '{}',
  -- made by payroll staff for an employee without a sign-in
  entered_for      BOOLEAN NOT NULL DEFAULT false,
  created_by       BIGINT REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by       BIGINT REFERENCES users(id),
  decided_at       TIMESTAMPTZ,
  deleted_at       TIMESTAMPTZ,
  CHECK (status <> 'VERIFIED' OR verified IS NOT NULL),
  CHECK (status <> 'REJECTED' OR reject_reason IS NOT NULL)
);
CREATE UNIQUE INDEX payroll_declarations_live ON payroll_declarations (employee_id, fy, line_code) WHERE deleted_at IS NULL;

-- ---- the year's salary from an earlier employer (Form 122 from 2026-27; 12B before) ----------------------------------
CREATE TABLE payroll_prev_employment (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id        BIGINT NOT NULL REFERENCES schools(id),
  employee_id      BIGINT NOT NULL REFERENCES employees(id),
  fy               TEXT NOT NULL CHECK (fy ~ '^[0-9]{4}-[0-9]{2}$'),
  employer_name    TEXT NOT NULL CHECK (length(employer_name) BETWEEN 2 AND 150),
  employer_tan     TEXT CHECK (employer_tan IS NULL OR employer_tan ~ '^[A-Z]{4}[0-9]{5}[A-Z]$'),
  period_from      DATE,
  period_to        DATE,
  gross            NUMERIC(14, 2) NOT NULL CHECK (gross >= 0),
  exempt           NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (exempt >= 0),
  pf               NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (pf >= 0),
  pt               NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (pt >= 0),
  tds              NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (tds >= 0),
  status           TEXT NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN ('SUBMITTED', 'VERIFIED', 'REJECTED')),
  reject_reason    TEXT CHECK (reject_reason IS NULL OR length(reject_reason) BETWEEN 3 AND 300),
  proof_file_ids   BIGINT[] NOT NULL DEFAULT '{}',
  entered_for      BOOLEAN NOT NULL DEFAULT false,
  created_by       BIGINT REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by       BIGINT REFERENCES users(id),
  decided_at       TIMESTAMPTZ,
  deleted_at       TIMESTAMPTZ,
  CHECK (exempt <= gross AND tds <= gross),
  CHECK (period_to IS NULL OR period_from IS NULL OR period_to >= period_from)
);
CREATE UNIQUE INDEX payroll_prev_employment_live ON payroll_prev_employment (employee_id, fy) WHERE deleted_at IS NULL;

-- ---- perquisites (tax only: never a pay line) -------------------------------------------------------------------------
CREATE TABLE payroll_perquisites (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id      BIGINT NOT NULL REFERENCES schools(id),
  employee_id    BIGINT NOT NULL REFERENCES employees(id),
  fy             TEXT NOT NULL CHECK (fy ~ '^[0-9]{4}-[0-9]{2}$'),
  perq_type      TEXT NOT NULL CHECK (perq_type IN ('EDUCATION', 'ACCOMMODATION', 'VEHICLE', 'LOAN_INTEREST', 'MEDICAL', 'OTHER')),
  amount         NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  description    TEXT CHECK (description IS NULL OR length(description) <= 200),
  verified       BOOLEAN NOT NULL DEFAULT false,
  verified_by    BIGINT REFERENCES users(id),
  verified_at    TIMESTAMPTZ,
  created_by     BIGINT REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- a change is a new row; the old one is kept, superseded
  superseded_at  TIMESTAMPTZ,
  deleted_at     TIMESTAMPTZ
);
CREATE UNIQUE INDEX payroll_perquisites_live ON payroll_perquisites (employee_id, fy, perq_type)
  WHERE superseded_at IS NULL AND deleted_at IS NULL;

-- ---- the school's final figure for an employee's year --------------------------------------------------------------
CREATE TABLE payroll_tax_finals (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id        BIGINT NOT NULL REFERENCES schools(id),
  employee_id      BIGINT NOT NULL REFERENCES employees(id),
  fy               TEXT NOT NULL CHECK (fy ~ '^[0-9]{4}-[0-9]{2}$'),
  annual           NUMERIC(14, 2) NOT NULL CHECK (annual >= 0),
  -- collected over this many months from April (NULL: whatever months remain)
  spread_months    INT CHECK (spread_months IS NULL OR spread_months BETWEEN 1 AND 12),
  reason           TEXT NOT NULL CHECK (length(reason) BETWEEN 3 AND 200),
  computed_annual  NUMERIC(14, 2),
  set_by           BIGINT REFERENCES users(id),
  set_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  cleared_by       BIGINT REFERENCES users(id),
  cleared_at       TIMESTAMPTZ
);
CREATE UNIQUE INDEX payroll_tax_finals_live ON payroll_tax_finals (employee_id, fy) WHERE cleared_at IS NULL;

-- ---- TDS deposited ----------------------------------------------------------------------------------------------------
CREATE TABLE payroll_tds_challans (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id      BIGINT NOT NULL REFERENCES schools(id),
  fy             TEXT NOT NULL CHECK (fy ~ '^[0-9]{4}-[0-9]{2}$'),
  quarter        INT NOT NULL CHECK (quarter BETWEEN 1 AND 4),
  bsr_code       TEXT NOT NULL CHECK (bsr_code ~ '^[0-9]{7}$'),
  challan_no     TEXT NOT NULL CHECK (challan_no ~ '^[0-9]{1,5}$'),
  deposited_on   DATE NOT NULL,
  -- income tax and cess deposited (interest and fee apart)
  amount         NUMERIC(14, 2) NOT NULL CHECK (amount >= 0),
  interest       NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (interest >= 0),
  late_fee       NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (late_fee >= 0),
  -- the pay months (1–12) it pays for, all in its quarter
  months         INT[] NOT NULL CHECK (cardinality(months) BETWEEN 1 AND 3),
  created_by     BIGINT REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at     TIMESTAMPTZ,
  deleted_by     BIGINT REFERENCES users(id)
);
CREATE UNIQUE INDEX payroll_tds_challans_live ON payroll_tds_challans (school_id, bsr_code, challan_no, deposited_on)
  WHERE deleted_at IS NULL;

-- ---- regime changes ----------------------------------------------------------------------------------------------
CREATE TABLE payroll_regime_events (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id     BIGINT NOT NULL REFERENCES schools(id),
  employee_id   BIGINT NOT NULL REFERENCES employees(id),
  fy            TEXT NOT NULL CHECK (fy ~ '^[0-9]{4}-[0-9]{2}$'),
  regime        TEXT NOT NULL CHECK (regime IN ('NEW', 'OLD')),
  -- in the employee's window, or the payroll admin's (a reason after the cut-off)
  how           TEXT NOT NULL CHECK (how IN ('IN_WINDOW', 'ADMIN')),
  reason        TEXT CHECK (reason IS NULL OR length(reason) BETWEEN 3 AND 200),
  created_by    BIGINT REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---- the annual certificate (Form 16 / 130) ------------------------------------------------------------------------
CREATE TABLE payroll_certificates (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id       BIGINT NOT NULL REFERENCES schools(id),
  employee_id     BIGINT NOT NULL REFERENCES employees(id),
  fy              TEXT NOT NULL CHECK (fy ~ '^[0-9]{4}-[0-9]{2}$'),
  -- Part A from TRACES (uploaded), and the certificate made (Part A + Part B, locked with the payslip password)
  part_a_file_id  BIGINT REFERENCES files(id),
  file_id         BIGINT REFERENCES files(id),
  made_at         TIMESTAMPTZ,
  made_by         BIGINT REFERENCES users(id),
  released_at     TIMESTAMPTZ,
  released_by     BIGINT REFERENCES users(id),
  emailed_at      TIMESTAMPTZ,
  message_id      BIGINT REFERENCES comms_messages(id),
  UNIQUE (employee_id, fy)
);

-- ---- row-level security and the audit trail --------------------------------------------------------------------
CALL app.apply_tenant_rls('payroll_tax_years');
CALL app.apply_tenant_rls('payroll_declarations');
CALL app.apply_tenant_rls('payroll_prev_employment');
CALL app.apply_tenant_rls('payroll_perquisites');
CALL app.apply_tenant_rls('payroll_tax_finals');
CALL app.apply_tenant_rls('payroll_tds_challans');
CALL app.apply_tenant_rls('payroll_regime_events');
CALL app.apply_tenant_rls('payroll_certificates');
CREATE TRIGGER payroll_tax_years_audit AFTER INSERT OR UPDATE OR DELETE ON payroll_tax_years
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE TRIGGER payroll_declarations_audit AFTER INSERT OR UPDATE OR DELETE ON payroll_declarations
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE TRIGGER payroll_prev_employment_audit AFTER INSERT OR UPDATE OR DELETE ON payroll_prev_employment
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE TRIGGER payroll_perquisites_audit AFTER INSERT OR UPDATE OR DELETE ON payroll_perquisites
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE TRIGGER payroll_tax_finals_audit AFTER INSERT OR UPDATE OR DELETE ON payroll_tax_finals
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE TRIGGER payroll_tds_challans_audit AFTER INSERT OR UPDATE OR DELETE ON payroll_tds_challans
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE TRIGGER payroll_certificates_audit AFTER INSERT OR UPDATE OR DELETE ON payroll_certificates
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

-- ---- the declarable sections each year (data the school can change; caps as in force) --------------------------------
-- 80C, 80CCC and 80CCD(1) share one cap; more Chapter VI-A sections; the new Act's numbers where they are certain.
CREATE OR REPLACE FUNCTION app.payroll_tax_sections_seed(p_school BIGINT) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE payroll_tax_labels SET cap_group = 'G80C' WHERE school_id = p_school AND line_code = 'CHAPVIA_80C';
  INSERT INTO payroll_tax_labels (school_id, fy, line_code, label, applies_to, cap_amount, declarable, sort_order, cap_group)
  SELECT p_school, y.fy, v.code, CASE WHEN y.fy = '2025-26' THEN v.old_label ELSE v.new_label END, v.applies, v.cap, v.decl, v.sort, v.grp
    FROM (VALUES ('2025-26'), ('2026-27')) y(fy)
    CROSS JOIN (VALUES
      ('G80C', 'Limit of 80C, 80CCC and 80CCD(1) together', 'Limit of sections 123 and the pension sections together [erstwhile 80C, 80CCC, 80CCD(1)]', 'OLD', 150000::numeric, false, 39, NULL),
      ('CHAPVIA_80CCC', 'Pension fund u/s 80CCC', 'Pension fund [erstwhile 80CCC]', 'OLD', 150000::numeric, true, 41, 'G80C'),
      ('CHAPVIA_80CCD1', 'NPS (self) u/s 80CCD(1)', 'NPS (self) [erstwhile 80CCD(1)]', 'OLD', 150000::numeric, true, 42, 'G80C'),
      ('CHAPVIA_80D_PARENTS', 'Medical insurance of parents u/s 80D', 'Medical insurance of parents u/s 126 [erstwhile 80D]', 'OLD', 25000::numeric, true, 61, NULL),
      ('CHAPVIA_80DD', 'Maintenance of a dependant with disability u/s 80DD', 'Dependant with disability [erstwhile 80DD]', 'OLD', 125000::numeric, true, 62, NULL),
      ('CHAPVIA_80E', 'Interest on education loan u/s 80E', 'Interest on education loan [erstwhile 80E]', 'OLD', NULL::numeric, true, 63, NULL),
      ('CHAPVIA_80G', 'Donations u/s 80G (the deductible amount)', 'Donations, the deductible amount [erstwhile 80G]', 'OLD', NULL::numeric, true, 64, NULL),
      ('CHAPVIA_80TTA', 'Savings bank interest u/s 80TTA', 'Savings bank interest [erstwhile 80TTA]', 'OLD', 10000::numeric, true, 65, NULL),
      ('CHAPVIA_80U', 'Person with disability u/s 80U', 'Person with disability [erstwhile 80U]', 'OLD', 125000::numeric, true, 66, NULL),
      ('OTHER_INCOME', 'Income from other sources (declared)', 'Income from other sources (declared)', 'BOTH', NULL::numeric, true, 90, NULL),
      ('DECL_FORM', 'Form 12BB', 'Form 124 [erstwhile 12BB]', 'BOTH', NULL::numeric, false, 130, NULL),
      ('PREV_FORM', 'Form 12B', 'Form 122 [erstwhile 12B]', 'BOTH', NULL::numeric, false, 131, NULL)
    ) v(code, old_label, new_label, applies, cap, decl, sort, grp)
  ON CONFLICT (school_id, fy, line_code) DO NOTHING;
END $$;
DO $$
DECLARE s BIGINT;
BEGIN
  FOR s IN SELECT DISTINCT school_id FROM payroll_tax_labels LOOP
    PERFORM set_config('app.school_id', s::text, true);
    PERFORM app.payroll_tax_sections_seed(s);
  END LOOP;
END $$;
