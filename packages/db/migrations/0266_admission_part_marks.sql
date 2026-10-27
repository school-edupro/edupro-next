-- Test and interview marks by part (docs/design/57, part 2): a candidate's marks in each part of their
-- class's paper (a subject, or an interview parameter), entered on the Test results page or uploaded
-- in its sheet; the part's name and maximum are kept as they were. Per candidate and stage: absent, the
-- total of the parts entered, out of what, and a remark. When the stage is decided the total goes into
-- the decision's marks (and so into merit); a later change to a decided candidate's marks needs a
-- reason (kept in the registration's history).

CREATE TABLE admission_part_marks (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id       BIGINT NOT NULL REFERENCES schools(id),
  application_id  BIGINT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  stage_id        BIGINT NOT NULL REFERENCES admission_stages(id),
  part_id         BIGINT NOT NULL REFERENCES admission_paper_parts(id),
  part_name       TEXT NOT NULL,
  max_marks       NUMERIC(7, 2) NOT NULL CHECK (max_marks > 0),
  marks           NUMERIC(7, 2) CHECK (marks IS NULL OR (marks >= 0 AND marks <= max_marks)),
  entered_by      BIGINT REFERENCES users(id),
  entered_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (application_id, part_id)
);
CREATE INDEX admission_part_marks_stage ON admission_part_marks (stage_id, application_id);
CALL app.apply_tenant_rls('admission_part_marks');
CREATE TRIGGER admission_part_marks_audit AFTER INSERT OR UPDATE OR DELETE ON admission_part_marks FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

CREATE TABLE admission_stage_marks (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id       BIGINT NOT NULL REFERENCES schools(id),
  application_id  BIGINT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  stage_id        BIGINT NOT NULL REFERENCES admission_stages(id),
  absent          BOOLEAN NOT NULL DEFAULT false,
  -- the sum of the parts entered (none entered, or absent: null), out of the paper's total then
  total           NUMERIC(8, 2) CHECK (total IS NULL OR total >= 0),
  max_total       NUMERIC(8, 2),
  remark          TEXT CHECK (remark IS NULL OR length(remark) <= 500),
  updated_by      BIGINT REFERENCES users(id),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (application_id, stage_id)
);
CREATE INDEX admission_stage_marks_stage ON admission_stage_marks (stage_id);
CALL app.apply_tenant_rls('admission_stage_marks');
CREATE TRIGGER admission_stage_marks_audit AFTER INSERT OR UPDATE OR DELETE ON admission_stage_marks FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
