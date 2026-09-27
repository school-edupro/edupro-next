-- 0017_sprint7_daily_academics.sql
-- Sprint 7 (Phase 2): daily work (homework, classwork, assignments) with files, notices and circulars with
-- targeting, holidays and almanac, gallery, document templates, transfer certificates, two-step withdrawal
-- clearance and promotion decisions.

CREATE TYPE daily_work_kind    AS ENUM ('homework', 'classwork', 'assignment');
CREATE TYPE notice_kind        AS ENUM ('notice', 'circular');
CREATE TYPE audience_kind      AS ENUM ('everyone', 'students', 'employees');
CREATE TYPE notice_target_type AS ENUM ('class', 'class_section', 'student', 'employee');
CREATE TYPE holiday_kind       AS ENUM ('holiday', 'vacation', 'working_day');
CREATE TYPE almanac_kind       AS ENUM ('event', 'exam', 'meeting', 'activity', 'deadline');
CREATE TYPE template_kind      AS ENUM ('transfer_certificate', 'bonafide', 'letter');
CREATE TYPE tc_status          AS ENUM ('issued', 'cancelled');
CREATE TYPE withdrawal_status  AS ENUM ('requested', 'cleared', 'completed', 'cancelled');
CREATE TYPE clearance_status   AS ENUM ('pending', 'cleared', 'hold');
CREATE TYPE promotion_decision AS ENUM ('promote', 'retain', 'transfer_out', 'graduate');

-- ---------------------------------------------------------------------------
-- Daily work: one table for homework, classwork and assignments (kind), files through the file service
-- ---------------------------------------------------------------------------
CREATE TABLE daily_work (
  id                     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id              BIGINT NOT NULL REFERENCES schools(id),
  academic_year_id       BIGINT NOT NULL REFERENCES academic_years(id),
  class_section_id       BIGINT NOT NULL REFERENCES class_sections(id),
  subject_id             BIGINT REFERENCES subjects(id),
  kind                   daily_work_kind NOT NULL,
  title                  TEXT NOT NULL,
  body                   TEXT NOT NULL DEFAULT '',
  assigned_on            DATE NOT NULL DEFAULT CURRENT_DATE,
  due_on                 DATE,
  posted_by_employee_id  BIGINT REFERENCES employees(id),
  legacy_ref             TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by             BIGINT,
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by             BIGINT,
  deleted_at             TIMESTAMPTZ,
  CHECK (due_on IS NULL OR due_on >= assigned_on)
);
CREATE INDEX daily_work_by_section ON daily_work (school_id, class_section_id, assigned_on DESC) WHERE deleted_at IS NULL;

CREATE TABLE daily_work_files (
  daily_work_id  BIGINT NOT NULL REFERENCES daily_work(id) ON DELETE CASCADE,
  file_id        BIGINT NOT NULL REFERENCES files(id),
  school_id      BIGINT NOT NULL REFERENCES schools(id),
  PRIMARY KEY (daily_work_id, file_id)
);

-- ---------------------------------------------------------------------------
-- Notices and circulars with audience and optional targets
-- ---------------------------------------------------------------------------
CREATE TABLE notices (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id         BIGINT NOT NULL REFERENCES schools(id),
  academic_year_id  BIGINT NOT NULL REFERENCES academic_years(id),
  kind              notice_kind NOT NULL DEFAULT 'notice',
  title             TEXT NOT NULL,
  body              TEXT NOT NULL,
  audience          audience_kind NOT NULL DEFAULT 'everyone',
  publish_from      DATE NOT NULL DEFAULT CURRENT_DATE,
  publish_until     DATE,
  is_pinned         BOOLEAN NOT NULL DEFAULT false,
  published_at      TIMESTAMPTZ,
  published_by      BIGINT,
  legacy_ref        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by        BIGINT,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by        BIGINT,
  deleted_at        TIMESTAMPTZ,
  CHECK (publish_until IS NULL OR publish_until >= publish_from)
);
CREATE INDEX notices_live ON notices (school_id, publish_from DESC) WHERE deleted_at IS NULL AND published_at IS NOT NULL;

CREATE TABLE notice_targets (
  notice_id    BIGINT NOT NULL REFERENCES notices(id) ON DELETE CASCADE,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  target_type  notice_target_type NOT NULL,
  target_id    BIGINT NOT NULL,
  PRIMARY KEY (notice_id, target_type, target_id)
);

CREATE TABLE notice_files (
  notice_id  BIGINT NOT NULL REFERENCES notices(id) ON DELETE CASCADE,
  file_id    BIGINT NOT NULL REFERENCES files(id),
  school_id  BIGINT NOT NULL REFERENCES schools(id),
  PRIMARY KEY (notice_id, file_id)
);

-- ---------------------------------------------------------------------------
-- Holidays and almanac
-- ---------------------------------------------------------------------------
CREATE TABLE holidays (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id         BIGINT NOT NULL REFERENCES schools(id),
  academic_year_id  BIGINT NOT NULL REFERENCES academic_years(id),
  campus_id         BIGINT REFERENCES campuses(id),
  name              TEXT NOT NULL,
  kind              holiday_kind NOT NULL DEFAULT 'holiday',
  starts_on         DATE NOT NULL,
  ends_on           DATE NOT NULL,
  applies_to        audience_kind NOT NULL DEFAULT 'everyone',
  legacy_ref        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by        BIGINT,
  CHECK (ends_on >= starts_on)
);
CREATE INDEX holidays_by_date ON holidays (school_id, starts_on, ends_on);

CREATE TABLE almanac_events (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id         BIGINT NOT NULL REFERENCES schools(id),
  academic_year_id  BIGINT NOT NULL REFERENCES academic_years(id),
  title             TEXT NOT NULL,
  kind              almanac_kind NOT NULL DEFAULT 'event',
  starts_on         DATE NOT NULL,
  ends_on           DATE NOT NULL,
  starts_at         TIME,
  description       TEXT,
  audience          audience_kind NOT NULL DEFAULT 'everyone',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by        BIGINT,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by        BIGINT,
  deleted_at        TIMESTAMPTZ,
  CHECK (ends_on >= starts_on)
);
CREATE INDEX almanac_by_date ON almanac_events (school_id, starts_on) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- Gallery
-- ---------------------------------------------------------------------------
CREATE TABLE gallery_albums (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id         BIGINT NOT NULL REFERENCES schools(id),
  academic_year_id  BIGINT NOT NULL REFERENCES academic_years(id),
  title             TEXT NOT NULL,
  description       TEXT,
  event_on          DATE,
  audience          audience_kind NOT NULL DEFAULT 'everyone',
  cover_file_id     BIGINT REFERENCES files(id),
  status            row_status NOT NULL DEFAULT 'active',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by        BIGINT,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by        BIGINT,
  deleted_at        TIMESTAMPTZ
);

CREATE TABLE gallery_items (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  album_id    BIGINT NOT NULL REFERENCES gallery_albums(id) ON DELETE CASCADE,
  file_id     BIGINT NOT NULL REFERENCES files(id),
  caption     TEXT,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  BIGINT,
  UNIQUE (album_id, file_id)
);

-- ---------------------------------------------------------------------------
-- Document templates (rendered by the export service through the "document" renderer)
-- ---------------------------------------------------------------------------
CREATE TABLE document_templates (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  code         TEXT NOT NULL,
  name         TEXT NOT NULL,
  kind         template_kind NOT NULL,
  page_width   TEXT NOT NULL DEFAULT '210mm',
  page_height  TEXT NOT NULL DEFAULT '297mm',
  body_html    TEXT NOT NULL,
  styles_css   TEXT NOT NULL DEFAULT '',
  variables    JSONB NOT NULL DEFAULT '[]'::jsonb,
  version      INT NOT NULL DEFAULT 1,
  status       row_status NOT NULL DEFAULT 'active',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by   BIGINT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by   BIGINT,
  deleted_at   TIMESTAMPTZ
);
CREATE UNIQUE INDEX document_templates_code ON document_templates (school_id, code) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- Transfer certificates: numbered per school, snapshot of the student at issue time
-- ---------------------------------------------------------------------------
CREATE TABLE tc_sequences (
  school_id    BIGINT PRIMARY KEY REFERENCES schools(id),
  last_serial  INT NOT NULL DEFAULT 0
);

CREATE TABLE transfer_certificates (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id         BIGINT NOT NULL REFERENCES schools(id),
  student_id        BIGINT NOT NULL REFERENCES students(id),
  academic_year_id  BIGINT NOT NULL REFERENCES academic_years(id),
  tc_no             TEXT NOT NULL,
  serial            INT NOT NULL,
  issued_on         DATE NOT NULL DEFAULT CURRENT_DATE,
  reason            TEXT NOT NULL,
  last_class        TEXT,
  conduct           TEXT NOT NULL DEFAULT 'Good',
  promotion_status  TEXT,
  dues_cleared      BOOLEAN NOT NULL DEFAULT true,
  remarks           TEXT,
  snapshot          JSONB NOT NULL DEFAULT '{}'::jsonb,
  template_id       BIGINT REFERENCES document_templates(id),
  export_id         BIGINT REFERENCES exports(id),
  status            tc_status NOT NULL DEFAULT 'issued',
  issued_by         BIGINT,
  cancelled_at      TIMESTAMPTZ,
  cancelled_by      BIGINT,
  cancel_reason     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, tc_no)
);
CREATE INDEX transfer_certificates_by_student ON transfer_certificates (student_id);

CREATE OR REPLACE FUNCTION app.next_tc_no(p_year_code TEXT) RETURNS TABLE (tc_no TEXT, serial INT)
LANGUAGE plpgsql AS $$
DECLARE
  v_serial INT;
BEGIN
  PERFORM app.assert_context();
  INSERT INTO tc_sequences (school_id, last_serial) VALUES (app.current_school_id(), 1)
  ON CONFLICT (school_id) DO UPDATE SET last_serial = tc_sequences.last_serial + 1
  RETURNING last_serial INTO v_serial;
  RETURN QUERY SELECT 'TC/' || p_year_code || '/' || lpad(v_serial::text, 4, '0'), v_serial;
END
$$;

-- ---------------------------------------------------------------------------
-- Withdrawal (two steps): request with department clearances, then completion
-- ---------------------------------------------------------------------------
CREATE TABLE student_withdrawals (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id         BIGINT NOT NULL REFERENCES schools(id),
  student_id        BIGINT NOT NULL REFERENCES students(id),
  academic_year_id  BIGINT NOT NULL REFERENCES academic_years(id),
  requested_on      DATE NOT NULL DEFAULT CURRENT_DATE,
  leaving_on        DATE NOT NULL,
  reason            TEXT NOT NULL,
  status            withdrawal_status NOT NULL DEFAULT 'requested',
  requested_by      BIGINT,
  completed_at      TIMESTAMPTZ,
  completed_by      BIGINT,
  cancelled_at      TIMESTAMPTZ,
  cancel_reason     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by        BIGINT
);
CREATE UNIQUE INDEX student_withdrawals_open ON student_withdrawals (student_id) WHERE status IN ('requested', 'cleared');

CREATE TABLE withdrawal_clearances (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id      BIGINT NOT NULL REFERENCES schools(id),
  withdrawal_id  BIGINT NOT NULL REFERENCES student_withdrawals(id) ON DELETE CASCADE,
  department     TEXT NOT NULL,
  status         clearance_status NOT NULL DEFAULT 'pending',
  dues           NUMERIC(12, 2) NOT NULL DEFAULT 0,
  remarks        TEXT,
  acted_by       BIGINT,
  acted_at       TIMESTAMPTZ,
  UNIQUE (withdrawal_id, department)
);

CREATE OR REPLACE FUNCTION app.complete_withdrawal(p_withdrawal_id BIGINT) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
  v_w student_withdrawals%ROWTYPE;
  v_user_id BIGINT;
BEGIN
  PERFORM app.assert_context();
  SELECT * INTO v_w FROM student_withdrawals WHERE id = p_withdrawal_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'withdrawal.not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_w.status NOT IN ('requested', 'cleared') THEN
    RAISE EXCEPTION 'withdrawal.not_open' USING ERRCODE = 'P0001', DETAIL = 'the withdrawal is already completed or cancelled';
  END IF;
  IF EXISTS (SELECT 1 FROM withdrawal_clearances WHERE withdrawal_id = p_withdrawal_id AND status <> 'cleared') THEN
    RAISE EXCEPTION 'withdrawal.clearance_pending' USING ERRCODE = 'P0001', DETAIL = 'every department must clear the student first';
  END IF;
  UPDATE enrolments SET status = 'withdrawn', ended_on = v_w.leaving_on, updated_at = now(), updated_by = app.current_user_id()
   WHERE student_id = v_w.student_id AND status = 'active';
  PERFORM set_config('app.status_reason', 'withdrawal: ' || v_w.reason, true);
  UPDATE students SET status = 'inactive', left_on = v_w.leaving_on, updated_at = now(), updated_by = app.current_user_id()
   WHERE id = v_w.student_id
   RETURNING user_id INTO v_user_id;
  IF v_user_id IS NOT NULL THEN
    UPDATE user_school_memberships SET status = 'inactive', updated_at = now(), updated_by = app.current_user_id()
     WHERE user_id = v_user_id AND school_id = app.current_school_id() AND person_type = 'student';
  END IF;
  UPDATE student_withdrawals SET status = 'completed', completed_at = now(), completed_by = app.current_user_id(), updated_at = now(), updated_by = app.current_user_id()
   WHERE id = p_withdrawal_id;
END
$$;

-- ---------------------------------------------------------------------------
-- Promotion decisions (applied into enrolments of the next year through app.enrol_student)
-- ---------------------------------------------------------------------------
CREATE TABLE promotion_decisions (
  id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id            BIGINT NOT NULL REFERENCES schools(id),
  from_year_id         BIGINT NOT NULL REFERENCES academic_years(id),
  to_year_id           BIGINT NOT NULL REFERENCES academic_years(id),
  student_id           BIGINT NOT NULL REFERENCES students(id),
  from_enrolment_id    BIGINT REFERENCES enrolments(id),
  decision             promotion_decision NOT NULL,
  to_class_section_id  BIGINT REFERENCES class_sections(id),
  remarks              TEXT,
  decided_by           BIGINT,
  decided_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_at           TIMESTAMPTZ,
  to_enrolment_id      BIGINT REFERENCES enrolments(id),
  UNIQUE (from_year_id, student_id),
  CHECK (decision NOT IN ('promote', 'retain') OR to_class_section_id IS NOT NULL)
);

CREATE OR REPLACE FUNCTION app.apply_promotion(p_decision_id BIGINT) RETURNS BIGINT
LANGUAGE plpgsql AS $$
DECLARE
  v_d promotion_decisions%ROWTYPE;
  v_to_start DATE;
  v_from_end DATE;
  v_enrolment_id BIGINT;
BEGIN
  PERFORM app.assert_context();
  SELECT * INTO v_d FROM promotion_decisions WHERE id = p_decision_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'promotion.not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_d.applied_at IS NOT NULL THEN
    RETURN v_d.to_enrolment_id;
  END IF;
  SELECT start_date INTO v_to_start FROM academic_years WHERE id = v_d.to_year_id;
  SELECT end_date INTO v_from_end FROM academic_years WHERE id = v_d.from_year_id;
  IF v_d.decision IN ('promote', 'retain') THEN
    v_enrolment_id := app.enrol_student(v_d.student_id, v_d.to_year_id, v_d.to_class_section_id, NULL, v_to_start);
    UPDATE enrolments SET status = 'promoted', ended_on = v_from_end, updated_at = now(), updated_by = app.current_user_id()
     WHERE student_id = v_d.student_id AND academic_year_id = v_d.from_year_id AND status = 'active';
  ELSE
    UPDATE enrolments SET status = 'left', ended_on = v_from_end, updated_at = now(), updated_by = app.current_user_id()
     WHERE student_id = v_d.student_id AND academic_year_id = v_d.from_year_id AND status = 'active';
  END IF;
  UPDATE promotion_decisions SET applied_at = now(), to_enrolment_id = v_enrolment_id WHERE id = p_decision_id;
  RETURN v_enrolment_id;
END
$$;

CALL app.apply_tenant_rls('daily_work');
CALL app.apply_tenant_rls('daily_work_files');
CALL app.apply_tenant_rls('notices');
CALL app.apply_tenant_rls('notice_targets');
CALL app.apply_tenant_rls('notice_files');
CALL app.apply_tenant_rls('holidays');
CALL app.apply_tenant_rls('almanac_events');
CALL app.apply_tenant_rls('gallery_albums');
CALL app.apply_tenant_rls('gallery_items');
CALL app.apply_tenant_rls('document_templates');
CALL app.apply_tenant_rls('tc_sequences');
CALL app.apply_tenant_rls('transfer_certificates');
CALL app.apply_tenant_rls('student_withdrawals');
CALL app.apply_tenant_rls('withdrawal_clearances');
CALL app.apply_tenant_rls('promotion_decisions');

-- ---------------------------------------------------------------------------
-- Permissions and template grants
-- ---------------------------------------------------------------------------
INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('academics.daily_work.view',   'academics', 'View homework, classwork and assignments', false),
  ('academics.daily_work.post',   'academics', 'Post and edit homework, classwork and assignments (scope: class_section)', false),
  ('academics.notice.view',       'academics', 'Read notices and circulars', false),
  ('academics.notice.manage',     'academics', 'Create, target and publish notices and circulars', false),
  ('academics.calendar.view',     'academics', 'View holidays and the almanac', false),
  ('academics.calendar.manage',   'academics', 'Maintain holidays and the almanac', false),
  ('academics.gallery.view',      'academics', 'View the gallery', false),
  ('academics.gallery.manage',    'academics', 'Create albums and add photos', false),
  ('people.tc.view',              'people',    'View transfer certificates', false),
  ('people.tc.issue',             'people',    'Issue and cancel transfer certificates', false),
  ('people.withdrawal.view',      'people',    'View withdrawal requests and clearances', false),
  ('people.withdrawal.manage',    'people',    'Request, complete and cancel withdrawals', false),
  ('people.withdrawal.clear',     'people',    'Record a department clearance on a withdrawal', false),
  ('people.promotion.view',       'people',    'View promotion decisions', false),
  ('people.promotion.manage',     'people',    'Record and apply promotion decisions', false),
  ('platform.template.view',      'platform',  'View document templates', false),
  ('platform.template.manage',    'platform',  'Edit document templates', false)
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code IN ('group_admin', 'school_admin')
  AND p.code IN ('academics.daily_work.view', 'academics.daily_work.post', 'academics.notice.view', 'academics.notice.manage',
                 'academics.calendar.view', 'academics.calendar.manage', 'academics.gallery.view', 'academics.gallery.manage',
                 'people.tc.view', 'people.tc.issue', 'people.withdrawal.view', 'people.withdrawal.manage', 'people.withdrawal.clear',
                 'people.promotion.view', 'people.promotion.manage', 'platform.template.view', 'platform.template.manage')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code = 'academic_coordinator'
  AND p.code IN ('academics.daily_work.view', 'academics.daily_work.post', 'academics.notice.view', 'academics.notice.manage',
                 'academics.calendar.view', 'academics.calendar.manage', 'academics.gallery.view', 'academics.gallery.manage',
                 'people.tc.view', 'people.withdrawal.view', 'people.promotion.view', 'people.promotion.manage', 'platform.template.view')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code IN ('class_teacher', 'subject_teacher')
  AND p.code IN ('academics.daily_work.view', 'academics.daily_work.post', 'academics.notice.view', 'academics.calendar.view', 'academics.gallery.view')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code = 'auditor'
  AND p.code IN ('academics.daily_work.view', 'academics.notice.view', 'academics.calendar.view', 'academics.gallery.view',
                 'people.tc.view', 'people.withdrawal.view', 'people.promotion.view', 'platform.template.view')
ON CONFLICT DO NOTHING;

-- Parents and students read what concerns their own children or themselves (the API restricts the rows).
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code IN ('parent', 'student')
  AND p.code IN ('academics.daily_work.view', 'academics.notice.view', 'academics.calendar.view', 'academics.gallery.view', 'academics.timetable.view')
ON CONFLICT DO NOTHING;
