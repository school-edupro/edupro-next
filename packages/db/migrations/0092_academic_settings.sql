-- 0092: what the school decides for the academics module — the time of day daily work reaches the
-- families, how a teacher's mobile and e-mail show in the parent / student portal, and the largest
-- file that may be attached in each academics section.
CREATE TABLE academic_settings (
  school_id           BIGINT PRIMARY KEY REFERENCES schools(id),
  -- the sheet's "publish on" starts at this time of the day (empty = at once)
  publish_time        TIME,
  teacher_mobile      TEXT NOT NULL DEFAULT 'masked' CHECK (teacher_mobile IN ('full', 'masked', 'hidden')),
  teacher_email       TEXT NOT NULL DEFAULT 'masked' CHECK (teacher_email IN ('full', 'masked', 'hidden')),
  max_mb_daily_work   INT NOT NULL DEFAULT 10 CHECK (max_mb_daily_work BETWEEN 1 AND 25),
  max_mb_assignment   INT NOT NULL DEFAULT 10 CHECK (max_mb_assignment BETWEEN 1 AND 25),
  max_mb_documents    INT NOT NULL DEFAULT 15 CHECK (max_mb_documents BETWEEN 1 AND 25),
  max_mb_notices      INT NOT NULL DEFAULT 10 CHECK (max_mb_notices BETWEEN 1 AND 25),
  max_mb_gallery      INT NOT NULL DEFAULT 10 CHECK (max_mb_gallery BETWEEN 1 AND 25),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by          BIGINT
);
CALL app.apply_tenant_rls('academic_settings');

-- the sheet finds the entry of a class, subject and day at once
CREATE INDEX IF NOT EXISTS daily_work_sheet_idx
  ON daily_work (class_section_id, assigned_on, subject_id, kind) WHERE deleted_at IS NULL;
