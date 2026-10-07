-- 0093: attendance from an Excel list of admission numbers, and how many files a notice may carry.
-- The coordinator uploads the admission numbers, picks the date and Present or Absent, checks the list
-- on screen and then marks; parents of the absent may be told by SMS or e-mail. Every upload is kept.

ALTER TABLE academic_settings
  ADD COLUMN max_notice_files INT NOT NULL DEFAULT 5 CHECK (max_notice_files BETWEEN 1 AND 10);

ALTER TYPE attendance_source ADD VALUE IF NOT EXISTS 'upload';

INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('attendance.bulk.upload', 'attendance', 'Mark attendance from an Excel list of admission numbers', false)
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'attendance.bulk.upload' FROM roles r
 WHERE r.school_id IS NULL AND r.code IN ('group_admin', 'school_admin', 'academic_coordinator')
ON CONFLICT DO NOTHING;

CREATE TABLE attendance_uploads (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id        BIGINT NOT NULL REFERENCES schools(id),
  academic_year_id BIGINT NOT NULL REFERENCES academic_years(id),
  on_date          DATE NOT NULL,
  code             attendance_code NOT NULL,
  file_name        TEXT,
  state            TEXT NOT NULL DEFAULT 'verified' CHECK (state IN ('verified', 'committed', 'cancelled')),
  -- the list as checked: one entry per row of the file
  rows             JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_rows       INT NOT NULL DEFAULT 0,
  ok_rows          INT NOT NULL DEFAULT 0,
  problem_rows     INT NOT NULL DEFAULT 0,
  -- what the confirmation did
  replace_existing BOOLEAN NOT NULL DEFAULT false,
  rest_present     BOOLEAN NOT NULL DEFAULT false,
  marked           INT NOT NULL DEFAULT 0,
  replaced         INT NOT NULL DEFAULT 0,
  kept             INT NOT NULL DEFAULT 0,
  rest_marked      INT NOT NULL DEFAULT 0,
  notify_sms       BOOLEAN NOT NULL DEFAULT false,
  notify_email     BOOLEAN NOT NULL DEFAULT false,
  sms_sent         INT NOT NULL DEFAULT 0,
  email_sent       INT NOT NULL DEFAULT 0,
  notify_note      TEXT,
  created_by       BIGINT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  committed_by     BIGINT,
  committed_at     TIMESTAMPTZ
);
CREATE INDEX attendance_uploads_school_idx ON attendance_uploads (school_id, created_at DESC);
CALL app.apply_tenant_rls('attendance_uploads');
