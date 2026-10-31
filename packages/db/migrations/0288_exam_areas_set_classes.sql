-- What an exam takes, and the class's indicator set (docs/design/66).
-- An exam type ticks the areas its exams take (marks, indicators / progress card, remarks, attendance,
-- health); a new exam copies its type's and its set-up may change them; an area left out is hidden and
-- its entry refused. Existing types and exams keep every area.
-- A set of indicators or a progress card lists the classes it is for (a class has one); a new exam
-- that takes indicators gives each class its set, and the exam's set-up may pick another.

ALTER TABLE exam_types ADD COLUMN areas TEXT[] NOT NULL
  DEFAULT '{marks,indicators,remarks,attendance,health}'
  CHECK (areas <@ '{marks,indicators,remarks,attendance,health}'::text[] AND cardinality(areas) >= 1);
ALTER TABLE exams ADD COLUMN areas TEXT[] NOT NULL
  DEFAULT '{marks,indicators,remarks,attendance,health}'
  CHECK (areas <@ '{marks,indicators,remarks,attendance,health}'::text[] AND cardinality(areas) >= 1);

CREATE TABLE indicator_set_classes (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  set_id      BIGINT NOT NULL REFERENCES indicator_sets(id) ON DELETE CASCADE,
  class_id    BIGINT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  updated_by  BIGINT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, class_id)
);
CREATE INDEX indicator_set_classes_by_set ON indicator_set_classes (set_id);
CREATE TRIGGER indicator_set_classes_audit AFTER INSERT OR UPDATE OR DELETE ON indicator_set_classes
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CALL app.apply_tenant_rls('indicator_set_classes');

-- the mapping starts from what the sets are used for: a class with one set across its exams takes it
INSERT INTO indicator_set_classes (school_id, set_id, class_id)
SELECT x.school_id, min(x.set_id), x.class_id
  FROM exam_indicator_sets x JOIN indicator_sets s ON s.id = x.set_id AND s.deleted_at IS NULL
 GROUP BY x.school_id, x.class_id
HAVING count(DISTINCT x.set_id) = 1
ON CONFLICT DO NOTHING;
