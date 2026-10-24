-- Merge duplicates (docs/design/37-admission-corrections.md, part 3).
-- The same child admitted twice: once the approval levels approve (workflow `student_merge`), every
-- record of the duplicate moves to the record kept in one transaction (fees and receipts, attendance,
-- marks, library, documents, guardians, transport, hostel, requests). Where both hold a record of the
-- same thing (an attendance mark of one day, the marks of one exam) the kept record's stays. The
-- duplicate is closed as "merged into" the kept one; its admission number is retired and still finds
-- the pupil. A merge cannot be undone.

ALTER TABLE students
  ADD COLUMN merged_into_id BIGINT REFERENCES students(id),
  ADD COLUMN merged_at      TIMESTAMPTZ;

CREATE TABLE student_merges (
  id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id             BIGINT NOT NULL REFERENCES schools(id),
  keep_id               BIGINT NOT NULL REFERENCES students(id),
  duplicate_id          BIGINT NOT NULL REFERENCES students(id),
  reason                TEXT NOT NULL,
  -- what the merge would move and settle, as seen when asked
  preview               JSONB NOT NULL,
  -- what it did
  result                JSONB,
  status                TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'rejected', 'withdrawn')),
  workflow_instance_id  BIGINT REFERENCES workflow_instances(id),
  requested_by          BIGINT REFERENCES users(id),
  requested_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by            BIGINT REFERENCES users(id),
  decided_at            TIMESTAMPTZ,
  decision_note         TEXT,
  apply_error           TEXT,
  CHECK (keep_id <> duplicate_id)
);
-- a record is in one open merge at a time, whichever side it is on
CREATE UNIQUE INDEX student_merges_open_keep ON student_merges (keep_id) WHERE status = 'pending';
CREATE UNIQUE INDEX student_merges_open_dup ON student_merges (duplicate_id) WHERE status = 'pending';
CREATE INDEX student_merges_by_dup ON student_merges (duplicate_id);
CALL app.apply_tenant_rls('student_merges');
CREATE TRIGGER student_merges_audit AFTER INSERT OR UPDATE OR DELETE ON student_merges FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('people.student.merge', 'people', 'Ask to merge a duplicate student record into the one kept (decided by the approval levels; cannot be undone)', false)
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'people.student.merge' FROM roles r
 WHERE r.school_id IS NULL AND r.code IN ('group_admin', 'school_admin', 'academic_coordinator')
ON CONFLICT DO NOTHING;
