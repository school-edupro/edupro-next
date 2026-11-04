-- docs/design/71 part 2: a Teacher assignment of kind Remarks names the remark categories a teacher writes
-- in its section (the PE teacher writing "Sports"). Its own file: a new enum value cannot be used in the
-- transaction that adds it (0306 uses it).
ALTER TYPE teacher_assignment_kind ADD VALUE IF NOT EXISTS 'remarks';
