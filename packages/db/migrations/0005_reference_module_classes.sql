-- 0005_reference_module_classes.sql
-- Reference module (docs/design/01-reference-module.md): classes (master) and class_sections (year-scoped).

CREATE TABLE classes (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id      BIGINT NOT NULL REFERENCES schools(id),
  code           TEXT NOT NULL,                 -- 'VI'
  name           TEXT NOT NULL,                 -- 'Class VI'
  display_order  INT NOT NULL DEFAULT 0,
  status         row_status NOT NULL DEFAULT 'active',
  legacy_ref     TEXT,                          -- legacy class_master.MasterClass
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by     BIGINT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by     BIGINT,
  deleted_at     TIMESTAMPTZ
);
CREATE UNIQUE INDEX classes_code_per_school ON classes (school_id, code) WHERE deleted_at IS NULL;
CREATE INDEX classes_order ON classes (school_id, display_order) WHERE deleted_at IS NULL;

CREATE TABLE class_sections (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id         BIGINT NOT NULL REFERENCES schools(id),
  academic_year_id  BIGINT NOT NULL REFERENCES academic_years(id),
  class_id          BIGINT NOT NULL REFERENCES classes(id),
  campus_id         BIGINT REFERENCES campuses(id),
  name              TEXT NOT NULL,              -- 'A'
  capacity          INT CHECK (capacity IS NULL OR capacity > 0),
  status            row_status NOT NULL DEFAULT 'active',
  legacy_ref        TEXT,                       -- legacy class_master.class, e.g. 'VI-A'
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by        BIGINT,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by        BIGINT,
  deleted_at        TIMESTAMPTZ
);
CREATE UNIQUE INDEX class_sections_name_per_year
  ON class_sections (school_id, academic_year_id, class_id, name) WHERE deleted_at IS NULL;
CREATE INDEX class_sections_by_year ON class_sections (school_id, academic_year_id) WHERE deleted_at IS NULL;

-- updated_at triggers (0001 created them only for tables existing at that time)
CREATE TRIGGER classes_set_updated_at BEFORE UPDATE ON classes
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER class_sections_set_updated_at BEFORE UPDATE ON class_sections
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- Row-level security
CALL app.apply_tenant_rls('classes');
CALL app.apply_tenant_rls('class_sections');

-- Grants for tables created after 0002 are covered by ALTER DEFAULT PRIVILEGES, restated for clarity
GRANT SELECT, INSERT, UPDATE, DELETE ON classes, class_sections TO edupro_app;
