-- 0090: digital file movement (approval notes).
-- A member of staff raises a file: a subject, a formatted note, up to four attachments, and the approvers
-- they choose themselves, level 1 to at most level 5, each an employee by name. It moves level by level.
-- An approver approves, sends it back with a remark (the creator corrects it and it starts again from
-- level 1) or rejects it for good. Every step is kept as the history. An approved file comes as a PDF.

INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('files.movement.raise', 'workflow', 'Raise a file for approval and follow it; approve the files sent to me', false),
  ('files.movement.report', 'workflow', 'See every file of the school: the dashboard and the report', false)
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'files.movement.raise' FROM roles r
 WHERE r.school_id IS NULL AND r.code NOT IN ('parent', 'student', 'support_engineer', 'erp_support')
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'files.movement.report' FROM roles r
 WHERE r.school_id IS NULL AND r.code IN ('group_admin', 'school_admin', 'auditor')
ON CONFLICT DO NOTHING;

CREATE TABLE file_notes (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id     BIGINT NOT NULL REFERENCES schools(id),
  number        TEXT,
  subject       TEXT NOT NULL,
  body_html     TEXT NOT NULL,
  file_ids      JSONB NOT NULL DEFAULT '[]',
  created_by    BIGINT NOT NULL REFERENCES users(id),
  -- pending: with an approver; returned: sent back to the creator; approved / rejected / withdrawn: closed
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'returned', 'approved', 'rejected', 'withdrawn')),
  -- each resubmission after a send-back is a new round, from level 1
  round         INT NOT NULL DEFAULT 1,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at     TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX file_notes_by_creator ON file_notes (school_id, created_by, created_at DESC);
CREATE INDEX file_notes_by_status ON file_notes (school_id, status, created_at DESC);
CALL app.apply_tenant_rls('file_notes');

CREATE TABLE file_note_levels (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id     BIGINT NOT NULL REFERENCES schools(id),
  note_id       BIGINT NOT NULL REFERENCES file_notes(id) ON DELETE CASCADE,
  round         INT NOT NULL,
  level         INT NOT NULL CHECK (level BETWEEN 1 AND 5),
  employee_id   BIGINT NOT NULL REFERENCES employees(id),
  user_id       BIGINT NOT NULL REFERENCES users(id),
  -- waiting: an earlier level has it; pending: here now; void: the round ended before it got here
  status        TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'pending', 'approved', 'returned', 'rejected', 'void')),
  remark        TEXT,
  acted_at      TIMESTAMPTZ,
  UNIQUE (note_id, round, level)
);
CREATE INDEX file_note_levels_inbox ON file_note_levels (school_id, user_id) WHERE status = 'pending';
CALL app.apply_tenant_rls('file_note_levels');

CREATE TABLE file_note_events (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  note_id     BIGINT NOT NULL REFERENCES file_notes(id) ON DELETE CASCADE,
  round       INT NOT NULL,
  action      TEXT NOT NULL CHECK (action IN ('submitted', 'resubmitted', 'approved', 'returned', 'rejected', 'withdrawn')),
  level       INT,
  by_user     BIGINT NOT NULL REFERENCES users(id),
  remark      TEXT,
  at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX file_note_events_by_note ON file_note_events (note_id, id);
CALL app.apply_tenant_rls('file_note_events');
