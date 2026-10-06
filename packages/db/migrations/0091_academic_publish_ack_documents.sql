-- 0091: publish time and acknowledgement on academic items; class documents; the school directory;
--       office orders.
-- (a) Homework, class work and assignments carry the date and time they are published (now by default;
--     a later time keeps them from the family until then) and may ask for an acknowledgement.
-- (b) Class documents: a session plan, the curriculum, a date sheet for a class (a teacher uploads for
--     the classes and subjects they hold), and the school magazine / almanac for everyone (the office).
-- (c) Acknowledgements: a family acknowledges an item for a child; an employee acknowledges an office
--     order. The teacher sees who has and who has not.
-- (d) The school directory the families see: the school's own list.
-- (e) Notices may be written as formatted text, ask for an acknowledgement, be e-mailed too, and a new
--     kind "office order" is for employees.

ALTER TABLE daily_work
  ADD COLUMN publish_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN ack_required BOOLEAN NOT NULL DEFAULT false;
UPDATE daily_work SET publish_at = created_at;

ALTER TYPE notice_kind ADD VALUE IF NOT EXISTS 'office_order';
ALTER TABLE notices
  ADD COLUMN body_format   TEXT NOT NULL DEFAULT 'text' CHECK (body_format IN ('text', 'html')),
  ADD COLUMN ack_required  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN publish_at    TIMESTAMPTZ,
  ADD COLUMN also_email    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN emailed_at    TIMESTAMPTZ,
  ADD COLUMN emailed_count INT;

CREATE TABLE academic_documents (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id         BIGINT NOT NULL REFERENCES schools(id),
  academic_year_id  BIGINT NOT NULL REFERENCES academic_years(id),
  kind              TEXT NOT NULL CHECK (kind IN ('session_plan', 'curriculum', 'date_sheet', 'magazine', 'almanac', 'other')),
  title             TEXT NOT NULL,
  remark            TEXT,
  -- NULL: for the whole school
  class_section_id  BIGINT REFERENCES class_sections(id),
  subject_id        BIGINT REFERENCES subjects(id),
  file_ids          JSONB NOT NULL DEFAULT '[]',
  publish_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  ack_required      BOOLEAN NOT NULL DEFAULT false,
  posted_by_employee_id BIGINT REFERENCES employees(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by        BIGINT,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by        BIGINT,
  deleted_at        TIMESTAMPTZ
);
CREATE INDEX academic_documents_by_section ON academic_documents (school_id, academic_year_id, class_section_id) WHERE deleted_at IS NULL;
CALL app.apply_tenant_rls('academic_documents');

CREATE TABLE academic_acks (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id      BIGINT NOT NULL REFERENCES schools(id),
  item_type      TEXT NOT NULL CHECK (item_type IN ('daily_work', 'document', 'notice')),
  item_id        BIGINT NOT NULL,
  -- a family acknowledges for a child; an employee acknowledges an office order for themself
  student_id     BIGINT REFERENCES students(id),
  staff_user_id  BIGINT REFERENCES users(id),
  acked_by       BIGINT NOT NULL REFERENCES users(id),
  acked_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((student_id IS NULL) <> (staff_user_id IS NULL))
);
CREATE UNIQUE INDEX academic_acks_once ON academic_acks (item_type, item_id, COALESCE(student_id, 0), COALESCE(staff_user_id, 0));
CALL app.apply_tenant_rls('academic_acks');

CREATE TABLE school_directory (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  code         TEXT NOT NULL,
  heading      TEXT NOT NULL,
  name         TEXT NOT NULL,
  designation  TEXT,
  phone        TEXT,
  email        TEXT,
  timings      TEXT,
  note         TEXT,
  sort_order   INT NOT NULL DEFAULT 100,
  status       row_status NOT NULL DEFAULT 'active',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by   BIGINT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by   BIGINT,
  UNIQUE (school_id, code)
);
CALL app.apply_tenant_rls('school_directory');
