-- Test and interview papers by class (docs/design/57, part 1). A Test or Interview stage may have a
-- paper for a class: its parts (a test's subjects, an interview's parameters), each with maximum marks
-- and an optional pass mark, and an optional minimum total %. The class's maximum for the stage is then
-- the sum of the parts; a class with no paper keeps the stage's own maximum (one marks figure).
-- Papers are the school's (set-up), not a session's: the marks of part 2 keep each part's name and
-- maximum as they were.

CREATE TABLE admission_papers (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  stage_id     BIGINT NOT NULL REFERENCES admission_stages(id) ON DELETE CASCADE,
  class_id     BIGINT NOT NULL REFERENCES classes(id),
  -- below it the candidate is flagged "below cut-off" (nobody is rejected by it)
  min_percent  NUMERIC(5, 2) CHECK (min_percent IS NULL OR (min_percent > 0 AND min_percent <= 100)),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by   BIGINT REFERENCES users(id),
  UNIQUE (stage_id, class_id)
);
CALL app.apply_tenant_rls('admission_papers');
CREATE TRIGGER admission_papers_audit AFTER INSERT OR UPDATE OR DELETE ON admission_papers FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

CREATE TABLE admission_paper_parts (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  paper_id    BIGINT NOT NULL REFERENCES admission_papers(id) ON DELETE CASCADE,
  name        TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  max_marks   NUMERIC(7, 2) NOT NULL CHECK (max_marks > 0 AND max_marks <= 1000),
  pass_marks  NUMERIC(7, 2) CHECK (pass_marks IS NULL OR (pass_marks >= 0 AND pass_marks <= max_marks)),
  sort_order  INT NOT NULL DEFAULT 0,
  -- a part taken off the paper is switched off (its marks keep pointing to it)
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX admission_paper_parts_name ON admission_paper_parts (paper_id, lower(btrim(name))) WHERE status = 'active';
CREATE INDEX admission_paper_parts_paper ON admission_paper_parts (paper_id, sort_order);
CALL app.apply_tenant_rls('admission_paper_parts');
CREATE TRIGGER admission_paper_parts_audit AFTER INSERT OR UPDATE OR DELETE ON admission_paper_parts FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

-- A class's maximum for a stage: the sum of its paper's parts, else the stage's own maximum.
CREATE OR REPLACE FUNCTION app.admission_stage_max(p_stage BIGINT, p_class BIGINT)
RETURNS NUMERIC LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT sum(pp.max_marks) FROM admission_papers p
       JOIN admission_paper_parts pp ON pp.paper_id = p.id AND pp.status = 'active'
      WHERE p.stage_id = p_stage AND p.class_id = p_class),
    (SELECT s.max_marks FROM admission_stages s WHERE s.id = p_stage))
$$;
