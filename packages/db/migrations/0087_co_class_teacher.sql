-- 0087: a section may have a co-class teacher beside the actual class teacher.
-- The actual class teacher (one per section) is the name on the report card, the register and what the
-- family sees; a co-class teacher holds the same class in the teacher app and may mark its attendance.

ALTER TABLE teacher_assignments ADD COLUMN is_actual BOOLEAN NOT NULL DEFAULT true;
DROP INDEX teacher_assignments_one_class_teacher;
CREATE UNIQUE INDEX teacher_assignments_one_class_teacher ON teacher_assignments (academic_year_id, class_section_id)
  WHERE kind = 'class_teacher' AND valid_to IS NULL AND is_actual;
