-- 0016_sprint6_academics_setup.sql
-- Sprint 6 (Phase 2): subjects, class-subject mapping, teacher assignments that drive RBAC scopes,
-- timetable periods and slots with conflict checks, bulk imports, student status history.

CREATE TYPE subject_kind            AS ENUM ('scholastic', 'co_scholastic', 'language', 'vocational');
CREATE TYPE teacher_assignment_kind AS ENUM ('class_teacher', 'subject_teacher', 'coordinator', 'indicator');
CREATE TYPE period_kind             AS ENUM ('teaching', 'break', 'assembly', 'activity');
CREATE TYPE import_kind             AS ENUM ('students', 'employees');
CREATE TYPE import_status           AS ENUM ('validated', 'committed', 'failed');

CREATE TABLE subjects (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id      BIGINT NOT NULL REFERENCES schools(id),
  code           TEXT NOT NULL,
  name           TEXT NOT NULL,
  kind           subject_kind NOT NULL DEFAULT 'scholastic',
  display_order  INT NOT NULL DEFAULT 0,
  status         row_status NOT NULL DEFAULT 'active',
  legacy_ref     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by     BIGINT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by     BIGINT,
  deleted_at     TIMESTAMPTZ
);
CREATE UNIQUE INDEX subjects_code_per_school ON subjects (school_id, code) WHERE deleted_at IS NULL;

CREATE TABLE class_subjects (
  id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id             BIGINT NOT NULL REFERENCES schools(id),
  academic_year_id      BIGINT NOT NULL REFERENCES academic_years(id),
  class_id              BIGINT NOT NULL REFERENCES classes(id),
  subject_id            BIGINT NOT NULL REFERENCES subjects(id),
  is_elective           BOOLEAN NOT NULL DEFAULT false,
  periods_per_week      INT CHECK (periods_per_week IS NULL OR periods_per_week BETWEEN 0 AND 60),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by            BIGINT,
  UNIQUE (academic_year_id, class_id, subject_id)
);

CREATE TABLE teacher_assignments (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id          BIGINT NOT NULL REFERENCES schools(id),
  academic_year_id   BIGINT NOT NULL REFERENCES academic_years(id),
  employee_id        BIGINT NOT NULL REFERENCES employees(id),
  class_section_id   BIGINT NOT NULL REFERENCES class_sections(id),
  subject_id         BIGINT REFERENCES subjects(id),
  kind               teacher_assignment_kind NOT NULL,
  can_mark_attendance BOOLEAN NOT NULL DEFAULT true,
  can_post_homework   BOOLEAN NOT NULL DEFAULT true,
  can_answer_queries  BOOLEAN NOT NULL DEFAULT true,
  valid_from         DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_to           DATE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by         BIGINT,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by         BIGINT,
  CHECK (kind <> 'subject_teacher' OR subject_id IS NOT NULL),
  CHECK (valid_to IS NULL OR valid_to >= valid_from)
);
-- Ended assignments stay as history; only live ones must be unique.
CREATE UNIQUE INDEX teacher_assignments_unique ON teacher_assignments (academic_year_id, employee_id, class_section_id, kind, COALESCE(subject_id, 0)) WHERE valid_to IS NULL;
CREATE INDEX teacher_assignments_by_section ON teacher_assignments (school_id, class_section_id);
CREATE INDEX teacher_assignments_by_employee ON teacher_assignments (school_id, employee_id, academic_year_id);
-- One class teacher per section per year.
CREATE UNIQUE INDEX teacher_assignments_one_class_teacher ON teacher_assignments (academic_year_id, class_section_id) WHERE kind = 'class_teacher' AND valid_to IS NULL;

CREATE TABLE timetable_periods (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  campus_id   BIGINT REFERENCES campuses(id),
  number      INT NOT NULL CHECK (number BETWEEN 1 AND 20),
  name        TEXT NOT NULL,
  starts_at   TIME NOT NULL,
  ends_at     TIME NOT NULL,
  kind        period_kind NOT NULL DEFAULT 'teaching',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  BIGINT,
  CHECK (ends_at > starts_at)
);
CREATE UNIQUE INDEX timetable_periods_unique ON timetable_periods (school_id, COALESCE(campus_id, 0), number);

CREATE TABLE timetable_slots (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id          BIGINT NOT NULL REFERENCES schools(id),
  academic_year_id   BIGINT NOT NULL REFERENCES academic_years(id),
  class_section_id   BIGINT NOT NULL REFERENCES class_sections(id),
  weekday            SMALLINT NOT NULL CHECK (weekday BETWEEN 1 AND 7),  -- 1 = Monday
  period_id          BIGINT NOT NULL REFERENCES timetable_periods(id),
  subject_id         BIGINT REFERENCES subjects(id),
  employee_id        BIGINT REFERENCES employees(id),
  room               TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by         BIGINT,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by         BIGINT,
  UNIQUE (class_section_id, weekday, period_id)
);
-- A teacher cannot be in two sections in the same period (conflict check at the database).
CREATE UNIQUE INDEX timetable_slots_teacher_conflict ON timetable_slots (academic_year_id, employee_id, weekday, period_id) WHERE employee_id IS NOT NULL;

CREATE TABLE imports (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id      BIGINT NOT NULL REFERENCES schools(id),
  kind           import_kind NOT NULL,
  file_name      TEXT,
  status         import_status NOT NULL,
  total_rows     INT NOT NULL DEFAULT 0,
  ok_rows        INT NOT NULL DEFAULT 0,
  rejected_rows  INT NOT NULL DEFAULT 0,
  report         JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{ row, field, message }]
  payload        JSONB NOT NULL DEFAULT '[]'::jsonb,   -- validated rows, replayed by commit
  requested_by   BIGINT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  committed_at   TIMESTAMPTZ,
  request_id     UUID
);

CREATE TABLE student_status_history (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  student_id   BIGINT NOT NULL REFERENCES students(id),
  from_status  TEXT,
  to_status    TEXT NOT NULL,
  reason       TEXT,
  changed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  changed_by   BIGINT
);
CREATE INDEX student_status_history_by_student ON student_status_history (student_id, changed_at DESC);

CALL app.apply_tenant_rls('subjects');
CALL app.apply_tenant_rls('class_subjects');
CALL app.apply_tenant_rls('teacher_assignments');
CALL app.apply_tenant_rls('timetable_periods');
CALL app.apply_tenant_rls('timetable_slots');
CALL app.apply_tenant_rls('imports');
CALL app.apply_tenant_rls('student_status_history');

-- Status history is written by a trigger so every path (API, ETL, break glass) is covered.
CREATE OR REPLACE FUNCTION app.track_student_status() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO student_status_history (school_id, student_id, from_status, to_status, reason, changed_by)
    VALUES (NEW.school_id, NEW.id, NULL, NEW.status::text, 'created', app.current_user_id());
  ELSIF NEW.status IS DISTINCT FROM OLD.status OR (NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL) THEN
    INSERT INTO student_status_history (school_id, student_id, from_status, to_status, reason, changed_by)
    VALUES (NEW.school_id, NEW.id, OLD.status::text, CASE WHEN NEW.deleted_at IS NOT NULL THEN 'removed' ELSE NEW.status::text END,
            NULLIF(current_setting('app.status_reason', true), ''), app.current_user_id());
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER students_status_history AFTER INSERT OR UPDATE OF status, deleted_at ON students
  FOR EACH ROW EXECUTE FUNCTION app.track_student_status();

-- ---------------------------------------------------------------------------
-- Teacher assignments drive RBAC (ADR-004): the employee's user receives the template role of each
-- assignment kind and class_section scopes matching the sections assigned. Roles the sync granted
-- earlier are revoked when no assignment of that kind remains. Manually granted roles are untouched.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.sync_teacher_scopes(p_employee_id BIGINT, p_academic_year_id BIGINT) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
  v_user_id BIGINT;
  v_kind teacher_assignment_kind;
  v_role_code TEXT;
  v_role_id BIGINT;
  v_user_role_id BIGINT;
BEGIN
  PERFORM app.assert_context();
  SELECT user_id INTO v_user_id FROM employees WHERE id = p_employee_id AND deleted_at IS NULL;
  IF v_user_id IS NULL THEN RETURN; END IF;   -- no login yet: scopes apply once the person is provisioned

  FOREACH v_kind IN ARRAY ARRAY['class_teacher', 'subject_teacher', 'coordinator']::teacher_assignment_kind[] LOOP
    v_role_code := CASE v_kind WHEN 'class_teacher' THEN 'class_teacher' WHEN 'subject_teacher' THEN 'subject_teacher' ELSE 'academic_coordinator' END;
    SELECT id INTO v_role_id FROM roles WHERE school_id IS NULL AND code = v_role_code;

    IF EXISTS (SELECT 1 FROM teacher_assignments ta WHERE ta.employee_id = p_employee_id AND ta.academic_year_id = p_academic_year_id AND ta.kind = v_kind AND ta.valid_to IS NULL) THEN
      SELECT id INTO v_user_role_id FROM user_roles WHERE user_id = v_user_id AND role_id = v_role_id AND revoked_at IS NULL AND school_id = app.current_school_id() LIMIT 1;
      IF v_user_role_id IS NULL THEN
        INSERT INTO user_roles (school_id, user_id, role_id, granted_by, reason, created_by, updated_by)
        VALUES (app.current_school_id(), v_user_id, v_role_id, app.current_user_id(), 'teacher assignment sync', app.current_user_id(), app.current_user_id())
        RETURNING id INTO v_user_role_id;
      END IF;
      -- coordinators see the whole school; class and subject teachers are scoped to their sections
      IF v_kind <> 'coordinator' THEN
        DELETE FROM user_role_scopes WHERE user_role_id = v_user_role_id AND scope_type = 'class_section';
        INSERT INTO user_role_scopes (school_id, user_role_id, scope_type, scope_id, created_by)
        SELECT DISTINCT app.current_school_id(), v_user_role_id, 'class_section'::scope_type, ta.class_section_id, app.current_user_id()
          FROM teacher_assignments ta
         WHERE ta.employee_id = p_employee_id AND ta.academic_year_id = p_academic_year_id AND ta.valid_to IS NULL
           AND ta.kind IN ('class_teacher', 'subject_teacher');
      END IF;
    ELSE
      UPDATE user_roles SET revoked_at = now(), updated_at = now(), updated_by = app.current_user_id()
       WHERE user_id = v_user_id AND role_id = v_role_id AND revoked_at IS NULL AND reason = 'teacher assignment sync' AND school_id = app.current_school_id();
    END IF;
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- Permissions and templates
-- ---------------------------------------------------------------------------
INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('academics.subject.view',            'academics', 'View subjects and class-subject mapping', false),
  ('academics.subject.manage',          'academics', 'Create and edit subjects and class-subject mapping', false),
  ('academics.teacher_assignment.view', 'academics', 'View teacher assignments', false),
  ('academics.teacher_assignment.manage','academics', 'Assign class teachers, subject teachers and coordinators', false),
  ('academics.timetable.view',          'academics', 'View timetables', false),
  ('academics.timetable.manage',        'academics', 'Edit periods and timetable slots', false),
  ('people.import.run',                 'people',    'Validate and commit bulk imports of students and employees', false)
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code IN ('group_admin', 'school_admin')
  AND p.code IN ('academics.subject.view', 'academics.subject.manage', 'academics.teacher_assignment.view', 'academics.teacher_assignment.manage',
                 'academics.timetable.view', 'academics.timetable.manage', 'people.import.run')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code = 'academic_coordinator'
  AND p.code IN ('academics.subject.view', 'academics.subject.manage', 'academics.teacher_assignment.view', 'academics.teacher_assignment.manage',
                 'academics.timetable.view', 'academics.timetable.manage', 'people.import.run')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code IN ('class_teacher', 'subject_teacher')
  AND p.code IN ('academics.subject.view', 'academics.teacher_assignment.view', 'academics.timetable.view')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code = 'auditor'
  AND p.code IN ('academics.subject.view', 'academics.teacher_assignment.view', 'academics.timetable.view')
ON CONFLICT DO NOTHING;
