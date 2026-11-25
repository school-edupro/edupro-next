-- 0426: linking sibling families. A student's Sibling section (Sibling in school, Sibling admission no) is information
-- only: the two children can still hang off different father and mother records, so a parent's login (it sees the
-- children of its own parent record) shows only one of them. The office now links the families: for the father and
-- the mother it keeps one record for both children (or leaves them apart), the other child's link moves to it.
-- Each move is kept here, in batches, so Undo puts the old links back exactly.

CREATE TABLE family_links (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id      BIGINT NOT NULL REFERENCES schools(id),
  batch_id       UUID NOT NULL,
  -- the two children the office linked (from the student's page; the sibling from its Sibling section)
  student_id     BIGINT NOT NULL REFERENCES students(id),
  sibling_id     BIGINT NOT NULL REFERENCES students(id),
  relation       guardian_relation NOT NULL,
  -- the child whose link changed: it now hangs off guardian_to; guardian_from was its own record (NULL: it had none)
  moved_student  BIGINT NOT NULL REFERENCES students(id),
  guardian_from  BIGINT REFERENCES guardians(id),
  guardian_to    BIGINT NOT NULL REFERENCES guardians(id),
  was_primary    BOOLEAN NOT NULL DEFAULT false,
  was_notified   BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by     BIGINT,
  undone_at      TIMESTAMPTZ,
  undone_by      BIGINT
);
COMMENT ON TABLE family_links IS 'one parent link moved when the office linked two sibling families (father or mother record shared); a batch is one Link families, Undo reverses it';
COMMENT ON COLUMN family_links.moved_student IS 'the child whose link changed (now on guardian_to)';
COMMENT ON COLUMN family_links.guardian_from IS 'the parent record the moved child had for this relation before (NULL: none, it was only added)';
CREATE INDEX family_links_batch ON family_links (school_id, batch_id);
CREATE INDEX family_links_student ON family_links (school_id, student_id, created_at DESC);
CREATE INDEX family_links_sibling ON family_links (school_id, sibling_id, created_at DESC);
CALL app.apply_tenant_rls('family_links');
