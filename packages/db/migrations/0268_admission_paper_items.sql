-- Test subjects and interview parameters (docs/design/57, follow-up of 28 Oct 2026): the school's own list
-- that a class's paper picks its parts from (no free text). An entry is for the written test, the
-- interview, or both, with an optional usual maximum. A paper part points at its entry; renaming the
-- entry renames the parts (the marks keep the name they were entered under). An entry in use is
-- switched off, never deleted.

CREATE TABLE admission_paper_items (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  name        TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  kind        TEXT NOT NULL CHECK (kind IN ('test', 'interview', 'both')),
  max_marks   NUMERIC(7, 2) CHECK (max_marks IS NULL OR (max_marks > 0 AND max_marks <= 1000)),
  sort_order  INT NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX admission_paper_items_name ON admission_paper_items (school_id, lower(btrim(name)));
CALL app.apply_tenant_rls('admission_paper_items');
CREATE TRIGGER admission_paper_items_audit AFTER INSERT OR UPDATE OR DELETE ON admission_paper_items FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

ALTER TABLE admission_paper_parts ADD COLUMN item_id BIGINT REFERENCES admission_paper_items(id);
CREATE INDEX admission_paper_parts_item ON admission_paper_parts (item_id);

-- the parts already written in become the school's entries (a name used by a test and an interview: both)
INSERT INTO admission_paper_items (school_id, name, kind)
SELECT pp.school_id, min(btrim(pp.name)),
       CASE WHEN bool_or(st.kind = 'test') AND bool_or(st.kind = 'interview') THEN 'both'
            WHEN bool_or(st.kind = 'interview') THEN 'interview' ELSE 'test' END
  FROM admission_paper_parts pp JOIN admission_papers p ON p.id = pp.paper_id
  JOIN admission_stages st ON st.id = p.stage_id
 GROUP BY pp.school_id, lower(btrim(pp.name))
ON CONFLICT DO NOTHING;
UPDATE admission_paper_parts pp SET item_id = i.id
  FROM admission_paper_items i
 WHERE i.school_id = pp.school_id AND lower(btrim(i.name)) = lower(btrim(pp.name));

-- an entry renamed: the parts that use it follow
CREATE OR REPLACE FUNCTION app.admission_paper_item_renamed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE admission_paper_parts SET name = NEW.name WHERE item_id = NEW.id AND name IS DISTINCT FROM NEW.name;
  RETURN NEW;
END
$$;
CREATE TRIGGER admission_paper_items_rename AFTER UPDATE OF name ON admission_paper_items
  FOR EACH ROW WHEN (OLD.name IS DISTINCT FROM NEW.name) EXECUTE FUNCTION app.admission_paper_item_renamed();
