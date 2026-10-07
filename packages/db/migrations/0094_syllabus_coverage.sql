-- 0094: the syllabus behind the lesson planner. The coordinator keeps, for each class and subject of
-- the session, the chapters and the topics of each chapter with the month a chapter is planned for.
-- A teacher's weekly plan points at these topics; after teaching, the teacher marks a topic done for
-- the section. Coverage (done against planned by now) is what the dashboard and the reports show.

CREATE TABLE syllabus_chapters (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id        BIGINT NOT NULL REFERENCES schools(id),
  academic_year_id BIGINT NOT NULL REFERENCES academic_years(id),
  class_id         BIGINT NOT NULL REFERENCES classes(id),
  subject_id       BIGINT NOT NULL REFERENCES subjects(id),
  number           INT NOT NULL CHECK (number BETWEEN 1 AND 200),
  name             TEXT NOT NULL,
  term             TEXT,
  -- the month of the year (1-12) the chapter is planned to be finished in
  planned_month    INT CHECK (planned_month BETWEEN 1 AND 12),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       BIGINT,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by       BIGINT,
  UNIQUE (academic_year_id, class_id, subject_id, number)
);
CALL app.apply_tenant_rls('syllabus_chapters');

CREATE TABLE syllabus_topics (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id       BIGINT NOT NULL REFERENCES schools(id),
  chapter_id      BIGINT NOT NULL REFERENCES syllabus_chapters(id) ON DELETE CASCADE,
  number          INT NOT NULL CHECK (number BETWEEN 1 AND 500),
  name            TEXT NOT NULL,
  planned_periods INT NOT NULL DEFAULT 1 CHECK (planned_periods BETWEEN 1 AND 60),
  UNIQUE (chapter_id, number)
);
CALL app.apply_tenant_rls('syllabus_topics');

CREATE TABLE syllabus_progress (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id        BIGINT NOT NULL REFERENCES schools(id),
  topic_id         BIGINT NOT NULL REFERENCES syllabus_topics(id) ON DELETE CASCADE,
  class_section_id BIGINT NOT NULL REFERENCES class_sections(id),
  status           TEXT NOT NULL CHECK (status IN ('done', 'partial', 'not_done')),
  done_on          DATE,
  reason           TEXT,
  employee_id      BIGINT REFERENCES employees(id),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by       BIGINT,
  UNIQUE (topic_id, class_section_id)
);
CREATE INDEX syllabus_progress_section_idx ON syllabus_progress (class_section_id);
CALL app.apply_tenant_rls('syllabus_progress');

INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('academics.syllabus.manage', 'academics', 'Keep the syllabus: chapters and topics of each class and subject', false),
  ('academics.syllabus.report', 'academics', 'See syllabus coverage of every class and teacher', false)
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r, (VALUES ('academics.syllabus.manage'), ('academics.syllabus.report')) AS p(code)
 WHERE r.school_id IS NULL AND r.code IN ('group_admin', 'school_admin', 'academic_coordinator')
ON CONFLICT DO NOTHING;
