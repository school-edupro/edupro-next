-- Merit score tables and number series (docs/design/48).
-- The school's scoring masters, reused by every session: qualifications (a father's and a mother's
-- score), localities (a distance band and a score, for a class or every class) and alumni schools (a
-- pass-out class and a score). A merit criterion is now fixed (today's), "from a table" or "sibling
-- checked", with a cap; a session (or a class with its own list) has a maximum. Number series give the
-- registration and admission numbers per session and class (and form answers such as round or student
-- type), each with a prefix, a next number and its digits.

CREATE TABLE admission_qualifications (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id     BIGINT NOT NULL REFERENCES schools(id),
  name          TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  father_score  NUMERIC(7, 2) NOT NULL DEFAULT 0,
  mother_score  NUMERIC(7, 2) NOT NULL DEFAULT 0,
  father_weight NUMERIC(7, 2) NOT NULL DEFAULT 0,
  mother_weight NUMERIC(7, 2) NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX admission_qualifications_name ON admission_qualifications (school_id, lower(btrim(name))) WHERE status = 'active';
CALL app.apply_tenant_rls('admission_qualifications');
CREATE TRIGGER admission_qualifications_audit AFTER INSERT OR UPDATE OR DELETE ON admission_qualifications FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

CREATE TABLE admission_localities (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  name        TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  -- for one class (null: every class)
  class_id    BIGINT REFERENCES classes(id),
  band        TEXT CHECK (band IS NULL OR length(band) <= 40),
  area        TEXT CHECK (area IS NULL OR length(area) <= 40),
  score       NUMERIC(7, 2) NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX admission_localities_name ON admission_localities (school_id, lower(btrim(name)), COALESCE(class_id, 0)) WHERE status = 'active';
CALL app.apply_tenant_rls('admission_localities');
CREATE TRIGGER admission_localities_audit AFTER INSERT OR UPDATE OR DELETE ON admission_localities FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

CREATE TABLE admission_alumni_schools (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id     BIGINT NOT NULL REFERENCES schools(id),
  name          TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  -- the class the parent passed out of: 10, 12, Both, Others (or the school's own words)
  passout_class TEXT NOT NULL CHECK (length(btrim(passout_class)) BETWEEN 1 AND 40),
  score         NUMERIC(7, 2) NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX admission_alumni_schools_name ON admission_alumni_schools (school_id, lower(btrim(name)), lower(btrim(passout_class))) WHERE status = 'active';
CALL app.apply_tenant_rls('admission_alumni_schools');
CREATE TRIGGER admission_alumni_schools_audit AFTER INSERT OR UPDATE OR DELETE ON admission_alumni_schools FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

-- a criterion's kind and what it reads; a table or sibling criterion may give 0 by itself
ALTER TABLE admission_point_rules
  ADD COLUMN kind TEXT NOT NULL DEFAULT 'fixed' CHECK (kind IN ('fixed', 'table', 'sibling')),
  -- table: { table, sources: [{ role, field, classField }], school }; fixed: { proof }
  ADD COLUMN spec JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN cap  NUMERIC(7, 2) CHECK (cap IS NULL OR cap > 0);
ALTER TABLE admission_point_rules DROP CONSTRAINT admission_point_rules_points_check;
ALTER TABLE admission_point_rules ADD CONSTRAINT admission_point_rules_points_check
  CHECK (points BETWEEN -1000 AND 1000 AND (points <> 0 OR kind = 'table'));

-- the most a registration can score (null: no maximum)
ALTER TABLE admission_cycles ADD COLUMN points_max NUMERIC(7, 2) CHECK (points_max IS NULL OR points_max > 0);
ALTER TABLE admission_class_criteria ADD COLUMN points_max NUMERIC(7, 2) CHECK (points_max IS NULL OR points_max > 0);

CREATE TABLE admission_number_series (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  kind        TEXT NOT NULL CHECK (kind IN ('registration', 'admission')),
  cycle_id    BIGINT NOT NULL REFERENCES admission_cycles(id) ON DELETE CASCADE,
  -- for one class (null: every class of the session)
  class_id    BIGINT REFERENCES classes(id),
  -- form answers the registration must have (round, student type, board…): [{ field, op, value }]
  conditions  JSONB NOT NULL DEFAULT '[]'::jsonb,
  name        TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 80),
  prefix      TEXT NOT NULL DEFAULT '' CHECK (length(prefix) <= 30 AND prefix !~ '\s'),
  next_no     BIGINT NOT NULL CHECK (next_no >= 0),
  digits      INT NOT NULL DEFAULT 4 CHECK (digits BETWEEN 1 AND 10),
  last_given  TEXT,
  given       INT NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX admission_number_series_cycle ON admission_number_series (cycle_id, kind) WHERE status = 'active';
CALL app.apply_tenant_rls('admission_number_series');
CREATE TRIGGER admission_number_series_audit AFTER INSERT OR UPDATE OR DELETE ON admission_number_series FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
