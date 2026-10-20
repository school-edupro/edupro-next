-- 0195: Principal's remarks (docs/design/32-employee-acr.md, 20 Oct 2026): standard remark lines per grade
-- that the final level ticks at approval, with free text; the lines ticked are kept on the review.
CREATE TABLE acr_remarks (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  -- the grade (a band's label) the line is offered for
  grade       TEXT NOT NULL,
  text        TEXT NOT NULL,
  sort_order  INT NOT NULL DEFAULT 0,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  BIGINT
);
CREATE INDEX acr_remarks_school ON acr_remarks (school_id, grade, sort_order);
CALL app.apply_tenant_rls('acr_remarks');

ALTER TABLE acr_reviews ADD COLUMN remark_ids BIGINT[] NOT NULL DEFAULT '{}';
