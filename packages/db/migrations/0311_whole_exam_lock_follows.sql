-- 6 Nov 2026 (asked): an exam counts as wholly locked only while every subject of it is locked. A class
-- opened again after "Lock the whole exam" (PT1: Class VIII) left the whole-exam flag on, and the flag
-- kept that class's teachers out; from now on opening or locking a class keeps the flag in step
-- (ExamsService.wholeLockFollows). Exams already in that state follow now.
UPDATE exams e SET marks_locked = false, updated_at = now()
 WHERE e.marks_locked AND e.deleted_at IS NULL
   AND EXISTS (SELECT 1 FROM exam_subjects es WHERE es.exam_id = e.id AND NOT es.entry_locked);
