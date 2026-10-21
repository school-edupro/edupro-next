-- Recruitment part 10 (docs/design/34-recruitment.md): the candidates' Excel export with the fields the
-- office picks. A named layout (the columns in their order and the list sheets) is the school's: anyone
-- who may see candidates can use it; the one who made it, or the recruitment manager, changes or removes
-- it. Each user's last choice is a user preference ('recruitment.export.last').

CREATE TABLE recruitment_export_layouts (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id        BIGINT NOT NULL REFERENCES schools(id),
  name             TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 60),
  columns          TEXT[] NOT NULL CHECK (cardinality(columns) BETWEEN 1 AND 400),
  sheets           TEXT[] NOT NULL DEFAULT '{}',
  created_by       BIGINT REFERENCES users(id),
  created_by_name  TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX recruitment_export_layouts_name ON recruitment_export_layouts (school_id, lower(name));
CALL app.apply_tenant_rls('recruitment_export_layouts');
