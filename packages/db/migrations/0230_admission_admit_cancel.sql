-- Online admission, part 6 (docs/design/39): the admission fee (portal or desk) with the admission number
-- given on payment, Admit into the student master with a class-section, and cancellation with the
-- admission fee refunded less the session's deduction, decided by the fee module's refund approvers.

ALTER TABLE applications
  -- given when the admission fee is paid (decision 11); kept when cancelled so it is never given again
  ADD COLUMN admission_no          TEXT,
  ADD COLUMN admission_receipt_id  BIGINT REFERENCES misc_receipts(id),
  ADD COLUMN admission_form_file_id BIGINT REFERENCES files(id),
  ADD COLUMN admitted_at           TIMESTAMPTZ,
  ADD COLUMN cancelled_at          TIMESTAMPTZ,
  ADD COLUMN cancel_reason         TEXT;
CREATE UNIQUE INDEX applications_admission_no ON applications (school_id, admission_no) WHERE admission_no IS NOT NULL;

-- the refund of an admission fee on cancellation
CREATE TABLE admission_refunds (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id        BIGINT NOT NULL REFERENCES schools(id),
  application_id   BIGINT NOT NULL REFERENCES applications(id),
  receipt_id       BIGINT NOT NULL REFERENCES misc_receipts(id),
  paid_amount      NUMERIC(12, 2) NOT NULL CHECK (paid_amount > 0),
  deduction_pct    NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (deduction_pct BETWEEN 0 AND 100),
  deduction        NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (deduction >= 0),
  amount           NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
  reason           TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'approved', 'rejected', 'paid')),
  requested_by     BIGINT REFERENCES users(id),
  requested_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by       BIGINT REFERENCES users(id),
  decided_at       TIMESTAMPTZ,
  decision_note    TEXT,
  mode             TEXT CHECK (mode IN ('cash', 'bank', 'cheque', 'gateway')),
  reference        TEXT,
  paid_on          DATE,
  paid_by          BIGINT REFERENCES users(id),
  CHECK (amount <= paid_amount)
);
CREATE UNIQUE INDEX admission_refunds_open ON admission_refunds (application_id) WHERE status IN ('requested', 'approved');
CALL app.apply_tenant_rls('admission_refunds');
CREATE TRIGGER admission_refunds_audit AFTER INSERT OR UPDATE OR DELETE ON admission_refunds FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('admissions.application.admit', 'admissions', 'Admit candidates who paid the admission fee into the student master with a class-section', false),
  ('admissions.application.cancel', 'admissions', 'Cancel a registration or an admission (the admission fee refund goes to the refund approvers)', false)
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r
  CROSS JOIN (VALUES ('admissions.application.admit'), ('admissions.application.cancel')) AS p(code)
 WHERE r.school_id IS NULL AND r.code IN ('group_admin', 'school_admin')
ON CONFLICT DO NOTHING;
