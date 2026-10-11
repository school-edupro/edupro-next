-- 0121: opening balances of many pupils from one Excel file (go-live from the old software, or a
-- correction). The file is checked and kept as a draft, sent for approval through Fee setup ->
-- Approval levels, and only then written to the pupils' fee profiles and their bills.
CREATE TABLE fee_opening_uploads (
  id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id            BIGINT NOT NULL REFERENCES schools(id),
  academic_year_id     BIGINT NOT NULL REFERENCES academic_years(id),
  file_name            TEXT,
  rows                 JSONB NOT NULL,   -- [{ row, admissionNo, studentId, name, section, before, opening, error }]
  total_rows           INT NOT NULL,
  good_rows            INT NOT NULL,
  total_dr             NUMERIC(14, 2) NOT NULL DEFAULT 0,
  total_cr             NUMERIC(14, 2) NOT NULL DEFAULT 0,
  status               TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending', 'applied', 'rejected', 'cancelled')),
  reason               TEXT,
  uploaded_by          BIGINT,
  uploaded_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by           BIGINT,
  decided_at           TIMESTAMPTZ,
  decision_note        TEXT,
  workflow_instance_id BIGINT REFERENCES workflow_instances(id),
  result               JSONB             -- { applied, billsRebuilt, notRebuilt: [{ admissionNo, why }] } once applied
);
CALL app.apply_tenant_rls('fee_opening_uploads');
CREATE TRIGGER fee_opening_uploads_audit AFTER INSERT OR UPDATE OR DELETE ON fee_opening_uploads FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
