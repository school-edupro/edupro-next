-- The legacy "Opt" tick (docs/design/67): one student's subject taken as additional (printed last on
-- the card, kept out of the total), whatever the class set-up says of the subject. The kind stays the
-- one the results read; this flag keeps the student's own choice when the set-up sets kinds again.
ALTER TABLE student_subjects ADD COLUMN opted_additional BOOLEAN NOT NULL DEFAULT false;
UPDATE student_subjects x SET opted_additional = true
  FROM class_subjects cs
 WHERE x.kind = 'additional' AND cs.subject_id = x.subject_id AND cs.academic_year_id = x.academic_year_id
   AND cs.group_id IS NULL
   AND EXISTS (SELECT 1 FROM enrolments en JOIN class_sections s ON s.id = en.class_section_id
                WHERE en.student_id = x.student_id AND en.academic_year_id = x.academic_year_id AND s.class_id = cs.class_id);
