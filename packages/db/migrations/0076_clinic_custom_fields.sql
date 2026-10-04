-- The health check-up form grows with the school: the admin adds sections ("Orthopaedic") and fields in any
-- section (text, a number with a unit, or a choice list). A field's value is kept in
-- health_checkups.findings under its key (x<id>), next to the built-in findings.
CREATE TABLE health_checkup_fields (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  label       TEXT NOT NULL,
  section     TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'text' CHECK (kind IN ('text', 'number', 'choice')),
  unit        TEXT,
  options     TEXT[] NOT NULL DEFAULT '{}',
  sort_order  INT NOT NULL DEFAULT 0,
  status      row_status NOT NULL DEFAULT 'active',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  BIGINT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX health_checkup_fields_label ON health_checkup_fields (school_id, lower(section), lower(label));
CALL app.apply_tenant_rls('health_checkup_fields');
