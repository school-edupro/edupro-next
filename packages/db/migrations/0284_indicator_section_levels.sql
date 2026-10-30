-- A heading of an indicator set may carry its own levels (docs/design/65): a school's progress card
-- rates its subject competencies Beginner / Progressing / Proficient but its observations, learning
-- habits, peer and parent sections Always / Mostly / Sometimes / Rarely. NULL: the set's levels; an
-- item under a heading uses the heading's.
ALTER TABLE indicators ADD COLUMN levels TEXT[]
  CHECK (levels IS NULL OR (cardinality(levels) BETWEEN 2 AND 10 AND array_position(levels, NULL) IS NULL));
