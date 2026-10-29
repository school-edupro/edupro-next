-- Examinations v2, part 7 (docs/design/65): remark categories, as the old module's A / B / C / D lists
-- and its "any other" text. A category is named by the school, may belong to a subject (its teacher
-- writes it too, e.g. "English remarks" on the I-II card), may be for some classes only and may take
-- free text or only the bank's remarks. A student gets one remark per category in an exam. The class
-- teacher's general remark becomes optional, so that a row may carry only "promoted to".

ALTER TABLE exam_remarks ALTER COLUMN remark DROP NOT NULL;
ALTER TABLE exam_remarks ADD CONSTRAINT exam_remarks_something
  CHECK (remark IS NOT NULL OR participation IS NOT NULL OR promoted_to IS NOT NULL);

CREATE TABLE remark_categories (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  code         TEXT NOT NULL CHECK (code ~ '^[A-Z0-9_-]{1,12}$'),
  name         TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 60),
  -- a subject's remarks: its subject teacher writes them for their sections, and the class teacher
  subject_id   BIGINT REFERENCES subjects(id),
  -- the classes it is for; empty: every class
  class_ids    BIGINT[] NOT NULL DEFAULT '{}',
  -- false: only the bank's remarks of the category
  free_text    BOOLEAN NOT NULL DEFAULT true,
  sort_order   INT NOT NULL DEFAULT 0,
  status       row_status NOT NULL DEFAULT 'active',
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by   BIGINT,
  UNIQUE (school_id, code)
);
CREATE TRIGGER remark_categories_audit AFTER INSERT OR UPDATE OR DELETE ON remark_categories
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CALL app.apply_tenant_rls('remark_categories');

ALTER TABLE remark_bank ADD COLUMN category_id BIGINT REFERENCES remark_categories(id) ON DELETE SET NULL;

CREATE TABLE exam_remark_items (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  exam_id      BIGINT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  student_id   BIGINT NOT NULL REFERENCES students(id),
  category_id  BIGINT NOT NULL REFERENCES remark_categories(id) ON DELETE CASCADE,
  text         TEXT NOT NULL CHECK (length(btrim(text)) BETWEEN 1 AND 600),
  bank_code    TEXT,
  entered_by   BIGINT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (exam_id, student_id, category_id)
);
CREATE INDEX exam_remark_items_by_student ON exam_remark_items (student_id, exam_id);
CREATE TRIGGER exam_remark_items_audit AFTER INSERT OR UPDATE OR DELETE ON exam_remark_items
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CALL app.apply_tenant_rls('exam_remark_items');
