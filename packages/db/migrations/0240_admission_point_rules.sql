-- Admission fees and merit points, part 2 of docs/design/40: merit point criteria on the form's answers.
-- A session has one list for all its classes; a class may keep its own list instead (Nursery differs from
-- IX). Each criterion is a name, conditions on form answers (admission-engine, as fee categories) and
-- points, negative for a deduction. Part 3 works the points out on each registration.

CREATE TABLE admission_point_rules (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  cycle_id    BIGINT NOT NULL REFERENCES admission_cycles(id) ON DELETE CASCADE,
  -- null: the session's list; a class: that class's own list
  class_id    BIGINT REFERENCES classes(id),
  name        TEXT NOT NULL CHECK (length(name) BETWEEN 2 AND 80),
  -- [{ field, op, value }] on the form's answers
  conditions  JSONB NOT NULL DEFAULT '[]'::jsonb,
  logic       TEXT NOT NULL DEFAULT 'all' CHECK (logic IN ('all', 'any')),
  points      NUMERIC(7, 2) NOT NULL CHECK (points BETWEEN -1000 AND 1000 AND points <> 0),
  sort_order  INT NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  BIGINT
);
CREATE INDEX admission_point_rules_cycle ON admission_point_rules (cycle_id, class_id, sort_order);
CALL app.apply_tenant_rls('admission_point_rules');
CREATE TRIGGER admission_point_rules_audit AFTER INSERT OR UPDATE OR DELETE ON admission_point_rules FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

-- a class that keeps its own list (false: it uses the session's)
ALTER TABLE admission_class_criteria ADD COLUMN own_points BOOLEAN NOT NULL DEFAULT false;
