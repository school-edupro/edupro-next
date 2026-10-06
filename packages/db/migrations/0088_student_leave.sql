-- 0088: student leave with its own approval levels.
-- A family applies for leave from the portal (type, dates, reason, a certificate). A short leave goes to the
-- class teacher; a long one (more days than the school's limit) goes on to the coordinator and the
-- principal. The school sets the limit and who approves at each level. A long medical leave needs the
-- certificate. An approved leave marks the pupil LV in class and bus attendance (0083 reads it).
-- Leave asked through the old "leave request" query keeps working: both are read.

INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('attendance.leave.apply', 'attendance', 'Apply for leave for my child and see its approval', false),
  ('attendance.leave.decide', 'attendance', 'Approve or reject a student leave that waits at my level', false)
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'attendance.leave.apply' FROM roles r WHERE r.school_id IS NULL AND r.code IN ('parent', 'student')
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'attendance.leave.decide' FROM roles r
 WHERE r.school_id IS NULL AND r.code IN ('group_admin', 'school_admin', 'academic_coordinator', 'class_teacher')
ON CONFLICT DO NOTHING;

CREATE TABLE leave_settings (
  school_id   BIGINT PRIMARY KEY REFERENCES schools(id),
  -- a leave of more days than this is a long leave
  long_days   INT NOT NULL DEFAULT 2 CHECK (long_days BETWEEN 1 AND 30),
  -- a family may apply for days already gone, this many days back
  back_days   INT NOT NULL DEFAULT 3 CHECK (back_days BETWEEN 0 AND 30),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  BIGINT
);
CALL app.apply_tenant_rls('leave_settings');

CREATE TABLE leave_approval_levels (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  chain        TEXT NOT NULL CHECK (chain IN ('short', 'long')),
  seq          INT NOT NULL,
  label        TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('class_teacher', 'role', 'employee')),
  role_code    TEXT,
  employee_id  BIGINT REFERENCES employees(id),
  active       BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (school_id, chain, seq)
);
CALL app.apply_tenant_rls('leave_approval_levels');

CREATE TABLE student_leaves (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id         BIGINT NOT NULL REFERENCES schools(id),
  academic_year_id  BIGINT NOT NULL REFERENCES academic_years(id),
  number            TEXT,
  student_id        BIGINT NOT NULL REFERENCES students(id),
  leave_type        TEXT NOT NULL CHECK (leave_type IN ('medical', 'family', 'travel', 'other')),
  from_date         DATE NOT NULL,
  to_date           DATE NOT NULL,
  days              INT NOT NULL CHECK (days >= 1),
  reason            TEXT NOT NULL,
  file_ids          JSONB NOT NULL DEFAULT '[]',
  chain             TEXT NOT NULL CHECK (chain IN ('short', 'long')),
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  applied_by        BIGINT,
  applied_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at        TIMESTAMPTZ,
  decision_note     TEXT,
  -- the family gave up the rest of an approved leave: the first day the child is back
  ended_on          DATE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (to_date >= from_date)
);
CREATE INDEX student_leaves_by_student ON student_leaves (student_id, from_date);
CREATE INDEX student_leaves_open ON student_leaves (school_id, status) WHERE status = 'pending';
CALL app.apply_tenant_rls('student_leaves');

CREATE TABLE student_leave_approvals (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id          BIGINT NOT NULL REFERENCES schools(id),
  leave_id           BIGINT NOT NULL REFERENCES student_leaves(id) ON DELETE CASCADE,
  seq                INT NOT NULL,
  label              TEXT NOT NULL,
  approver_user_ids  BIGINT[] NOT NULL DEFAULT '{}',
  status             TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'pending', 'approved', 'rejected', 'skipped')),
  acted_by           BIGINT,
  acted_at           TIMESTAMPTZ,
  note               TEXT,
  UNIQUE (leave_id, seq)
);
CREATE INDEX student_leave_approvals_inbox ON student_leave_approvals USING gin (approver_user_ids) WHERE status = 'pending';
CALL app.apply_tenant_rls('student_leave_approvals');
