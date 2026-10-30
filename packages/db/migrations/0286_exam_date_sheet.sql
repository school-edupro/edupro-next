-- The exam's date sheet (docs/design/66): a subject's paper has a date (exam_subjects.exam_on) and now
-- its start and end time; the exam has a note printed under the date sheet (reporting time, what to
-- bring). The date sheet prints per class or for all classes, and shows in the parent and teacher apps.

ALTER TABLE exam_subjects ADD COLUMN starts_at TIME;
ALTER TABLE exam_subjects ADD COLUMN ends_at TIME;
ALTER TABLE exam_subjects ADD CONSTRAINT exam_subjects_paper_time
  CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at);

ALTER TABLE exams ADD COLUMN date_sheet_note TEXT
  CHECK (date_sheet_note IS NULL OR length(date_sheet_note) <= 1000);
