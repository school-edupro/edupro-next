-- Indicator areas and level scales as masters (docs/design/65): an item's area (an HPC domain, a
-- co-scholastic area) and the levels a set or a heading rates on were typed per set, so a slip made a
-- new area or scale and two classes' sets could not share one. Each is now a school's list, picked from
-- in the set editor; the areas' order is the order the card prints them and teachers see them. Sets keep
-- their area names and level arrays (the engine reads those); a scale a set uses keeps its levels.

CREATE TABLE indicator_areas (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  name        TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 60),
  sort_order  INT NOT NULL DEFAULT 0,
  status      row_status NOT NULL DEFAULT 'active',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  BIGINT
);
CREATE UNIQUE INDEX indicator_areas_name ON indicator_areas (school_id, lower(name));
CREATE TRIGGER indicator_areas_audit AFTER INSERT OR UPDATE OR DELETE ON indicator_areas
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CALL app.apply_tenant_rls('indicator_areas');

CREATE TABLE indicator_scales (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  name        TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 60),
  -- lowest first
  levels      TEXT[] NOT NULL
    CHECK (cardinality(levels) BETWEEN 2 AND 10 AND array_position(levels, NULL) IS NULL),
  sort_order  INT NOT NULL DEFAULT 0,
  status      row_status NOT NULL DEFAULT 'active',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  BIGINT,
  UNIQUE (school_id, levels)
);
CREATE UNIQUE INDEX indicator_scales_name ON indicator_scales (school_id, lower(name));
CREATE TRIGGER indicator_scales_audit AFTER INSERT OR UPDATE OR DELETE ON indicator_scales
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CALL app.apply_tenant_rls('indicator_scales');

-- what the schools' sets use today: areas in the order they first appear, scales named by their levels
INSERT INTO indicator_areas (school_id, name, sort_order)
SELECT school_id, name, (row_number() OVER (PARTITION BY school_id ORDER BY first, name))::int * 10
  FROM (
    SELECT i.school_id, min(btrim(i.area)) AS name, min(i.sort_order) AS first
      FROM indicators i JOIN indicator_sets s ON s.id = i.set_id AND s.deleted_at IS NULL
     WHERE length(btrim(coalesce(i.area, ''))) >= 2
     GROUP BY i.school_id, lower(btrim(i.area))
  ) a;

INSERT INTO indicator_scales (school_id, name, levels, sort_order)
SELECT school_id, left(array_to_string(levels, ' / '), 60), levels,
       (row_number() OVER (PARTITION BY school_id ORDER BY levels))::int * 10
  FROM (
    SELECT school_id, grades AS levels FROM indicator_sets WHERE deleted_at IS NULL
    UNION
    SELECT i.school_id, i.levels FROM indicators i JOIN indicator_sets s ON s.id = i.set_id AND s.deleted_at IS NULL
     WHERE i.levels IS NOT NULL
  ) x
ON CONFLICT DO NOTHING;
