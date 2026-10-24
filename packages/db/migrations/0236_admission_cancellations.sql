-- Admitted by mistake (docs/design/37-admission-corrections.md, part 4).
-- "Cancel admission": a reason and how the money is settled (refund what was paid, or the school keeps
-- it), a preview, then the school's approval levels (workflow `admission_cancellation`). On approval
-- the unpaid fee is cancelled, refunds go to the refund approvers, the enrolment ends as "cancelled"
-- (left out of strength, attendance and result reports, which count active enrolments; the marks and
-- attendance stay on the record), the pupil's and (unless another child studies here) the parents'
-- logins stop, and the record shows "Admission cancelled". Its admission number is never given again.
-- It is kept as a completed withdrawal of its own kind, so the fee settlement and the lists are shared.

ALTER TYPE enrolment_status ADD VALUE IF NOT EXISTS 'cancelled';

ALTER TABLE student_withdrawals
  ADD COLUMN kind TEXT NOT NULL DEFAULT 'withdrawal' CHECK (kind IN ('withdrawal', 'admission_cancelled'));

CREATE TABLE admission_cancellations (
  id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id             BIGINT NOT NULL REFERENCES schools(id),
  student_id            BIGINT NOT NULL REFERENCES students(id),
  academic_year_id      BIGINT NOT NULL REFERENCES academic_years(id),
  reason                TEXT NOT NULL,
  -- refund: what was paid goes back (through the refund approvals); retain: the school keeps it
  settlement            TEXT NOT NULL CHECK (settlement IN ('refund', 'retain')),
  preview               JSONB NOT NULL,
  result                JSONB,
  status                TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'rejected', 'withdrawn')),
  withdrawal_id         BIGINT REFERENCES student_withdrawals(id),
  workflow_instance_id  BIGINT REFERENCES workflow_instances(id),
  requested_by          BIGINT REFERENCES users(id),
  requested_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by            BIGINT REFERENCES users(id),
  decided_at            TIMESTAMPTZ,
  decision_note         TEXT,
  apply_error           TEXT
);
CREATE UNIQUE INDEX admission_cancellations_one_open ON admission_cancellations (student_id) WHERE status = 'pending';
CREATE INDEX admission_cancellations_by_student ON admission_cancellations (student_id, requested_at DESC);
CALL app.apply_tenant_rls('admission_cancellations');
CREATE TRIGGER admission_cancellations_audit AFTER INSERT OR UPDATE OR DELETE ON admission_cancellations FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('people.admission.cancel', 'people', 'Ask to cancel a student''s admission with the fee settlement (decided by the approval levels)', false)
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'people.admission.cancel' FROM roles r
 WHERE r.school_id IS NULL AND r.code IN ('group_admin', 'school_admin', 'academic_coordinator')
ON CONFLICT DO NOTHING;
