-- Examinations v2, part 5 (docs/design/65): the Holistic Progress Card for Balvatika to Class II and
-- three-level indicators. An indicator set's areas are the groups (the HPC's domains), its indicators
-- the second level (curricular goals) and an indicator under another the third (competencies); an item
-- takes a level of the set (with what each level means for it) or a written observation. The HPC adds
-- the child's own words ("All about me"), the parent's and the teacher's, and portfolio photos.

ALTER TABLE indicator_sets ADD COLUMN kind TEXT NOT NULL DEFAULT 'indicators' CHECK (kind IN ('indicators', 'hpc'));
-- a level's words on the card (Beginner: "Stream", Progressing: "Mountain", Proficient: "Sky")
ALTER TABLE indicator_sets ADD COLUMN level_words JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE indicators ADD COLUMN parent_id BIGINT REFERENCES indicators(id) ON DELETE CASCADE;
ALTER TABLE indicators ADD COLUMN kind TEXT NOT NULL DEFAULT 'level' CHECK (kind IN ('level', 'text'));
ALTER TABLE indicators ADD COLUMN description TEXT CHECK (description IS NULL OR length(description) <= 300);
-- level → what it means for this item
ALTER TABLE indicators ADD COLUMN descriptors JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE indicators ADD CONSTRAINT indicators_not_own_parent CHECK (parent_id IS NULL OR parent_id <> id);

-- an observation in place of a level
ALTER TABLE indicator_entries ALTER COLUMN grade DROP NOT NULL;
ALTER TABLE indicator_entries ADD CONSTRAINT indicator_entries_value CHECK (grade IS NOT NULL OR note IS NOT NULL);

CREATE TABLE hpc_feedback (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id          BIGINT NOT NULL REFERENCES schools(id),
  exam_id            BIGINT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  student_id         BIGINT NOT NULL REFERENCES students(id),
  -- self: the child's "All about me" (written down by the teacher); parent; teacher: the observations
  kind               TEXT NOT NULL CHECK (kind IN ('self', 'parent', 'teacher')),
  text               TEXT NOT NULL CHECK (length(btrim(text)) BETWEEN 1 AND 2000),
  entered_by         BIGINT,
  by_family          BOOLEAN NOT NULL DEFAULT false,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (exam_id, student_id, kind)
);
CREATE TRIGGER hpc_feedback_audit AFTER INSERT OR UPDATE OR DELETE ON hpc_feedback
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CALL app.apply_tenant_rls('hpc_feedback');

CREATE TABLE portfolio_items (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id     BIGINT NOT NULL REFERENCES schools(id),
  exam_id       BIGINT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  student_id    BIGINT NOT NULL REFERENCES students(id),
  file_id       BIGINT NOT NULL REFERENCES files(id),
  caption       TEXT CHECK (caption IS NULL OR length(caption) <= 200),
  indicator_id  BIGINT REFERENCES indicators(id) ON DELETE SET NULL,
  created_by    BIGINT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ
);
CREATE INDEX portfolio_items_by_student ON portfolio_items (exam_id, student_id) WHERE deleted_at IS NULL;
CREATE TRIGGER portfolio_items_audit AFTER INSERT OR UPDATE OR DELETE ON portfolio_items
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CALL app.apply_tenant_rls('portfolio_items');
