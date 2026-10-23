-- Online admission, part 1 (docs/design/39): admission forms made in the form builder (tabs, fields,
-- rules, mapping to the student master) and the additional student-master fields a form may create
-- ("copy to student master"); document kinds the registration form asks for.

ALTER TYPE document_kind ADD VALUE IF NOT EXISTS 'alumni_proof';
ALTER TYPE document_kind ADD VALUE IF NOT EXISTS 'sibling_proof';
ALTER TYPE document_kind ADD VALUE IF NOT EXISTS 'achievement';

CREATE TABLE admission_forms (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  name         TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 120),
  description  TEXT,
  -- { steps: [{key,title}], fields: [AdmissionField], settings: AdmissionFormSettings } (packages/db admission-engine.ts)
  def          JSONB NOT NULL,
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  template     TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by   BIGINT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by   BIGINT
);
CREATE UNIQUE INDEX admission_forms_name ON admission_forms (school_id, lower(name)) WHERE status = 'active';
CALL app.apply_tenant_rls('admission_forms');
CREATE TRIGGER admission_forms_audit AFTER INSERT OR UPDATE OR DELETE ON admission_forms FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

-- Additional student-master fields (a form answer the catalogue has no field for). Values live in
-- students.profile -> 'extra' -> key; shown on the student page and in the student list fields.
CREATE TABLE student_extra_fields (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  key         TEXT NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  label       TEXT NOT NULL,
  type        TEXT NOT NULL DEFAULT 'text',
  list        TEXT,
  sort_order  INT NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  BIGINT,
  UNIQUE (school_id, key)
);
CALL app.apply_tenant_rls('student_extra_fields');

-- the application keeps the form as it was when it was filled (later edits never break it)
ALTER TABLE admission_class_criteria ADD COLUMN form_id BIGINT REFERENCES admission_forms(id);
ALTER TABLE applications ADD COLUMN form_id BIGINT REFERENCES admission_forms(id);
ALTER TABLE applications ADD COLUMN form_snapshot JSONB;
