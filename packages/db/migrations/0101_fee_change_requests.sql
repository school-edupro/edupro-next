-- 0101: fee changes that wait for approval. The accounts desk asks; the school admin (fees.adjustment.approve)
-- approves or rejects; everything is logged.
--   late_fee     waive or reduce the late fee of one instalment of a pupil
--   transfer     move a receipt to another pupil (a parent paid twice into one child's account)
--   date_change  correct a receipt's date and / or its bank settlement date; many at once from Excel
-- and collections uploaded from Excel, posted as receipts only after approval.
CREATE TABLE fee_change_requests (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id        BIGINT NOT NULL REFERENCES schools(id),
  academic_year_id BIGINT NOT NULL REFERENCES academic_years(id),
  kind             TEXT NOT NULL CHECK (kind IN ('late_fee', 'transfer', 'date_change')),
  student_id       BIGINT NOT NULL REFERENCES students(id),
  payment_id       BIGINT REFERENCES fee_payments(id),          -- transfer, date_change
  period_id        BIGINT REFERENCES fee_periods(id),           -- late_fee: the instalment's month
  ledger           ledger_type,                                 -- late_fee
  amount           NUMERIC(12, 2) CHECK (amount IS NULL OR amount >= 0),   -- late_fee: what is charged instead (0 = waived)
  to_student_id    BIGINT REFERENCES students(id),              -- transfer
  new_received_on  DATE,                                        -- date_change
  new_cleared_on   DATE,                                        -- date_change
  batch_id         UUID,                                        -- rows that came from one Excel file
  reason           TEXT NOT NULL,
  status           workflow_status NOT NULL DEFAULT 'pending',
  requested_by     BIGINT,
  requested_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by       BIGINT,
  decided_at       TIMESTAMPTZ,
  decision_note    TEXT,
  result           JSONB
);
CREATE INDEX fee_change_requests_open ON fee_change_requests (school_id, status, requested_at DESC);
CREATE INDEX fee_change_requests_batch ON fee_change_requests (batch_id) WHERE batch_id IS NOT NULL;
CALL app.apply_tenant_rls('fee_change_requests');
CREATE TRIGGER fee_change_requests_audit AFTER INSERT OR UPDATE OR DELETE ON fee_change_requests FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

CREATE TABLE fee_collection_uploads (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id        BIGINT NOT NULL REFERENCES schools(id),
  academic_year_id BIGINT NOT NULL REFERENCES academic_years(id),
  file_name        TEXT,
  rows             JSONB NOT NULL,              -- [{ row, admissionNo, studentId, name, section, amount, mode, receivedOn, ledger, reference, instrumentNo, instrumentDate, bankName, remarks, error }]
  total_rows       INT NOT NULL,
  good_rows        INT NOT NULL,
  total_amount     NUMERIC(14, 2) NOT NULL,
  status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending', 'posted', 'rejected', 'cancelled')),
  reason           TEXT,
  uploaded_by      BIGINT,
  uploaded_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by       BIGINT,
  decided_at       TIMESTAMPTZ,
  decision_note    TEXT,
  receipts         JSONB                         -- [{ row, receiptNo, paymentId }] once posted
);
CALL app.apply_tenant_rls('fee_collection_uploads');

INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('fees.bulk.upload', 'fees', 'Upload fee collection or settlement dates from Excel, for approval', false)
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'fees.bulk.upload' FROM roles r
 WHERE r.school_id IS NULL AND r.code IN ('group_admin', 'school_admin', 'accountant')
ON CONFLICT DO NOTHING;
