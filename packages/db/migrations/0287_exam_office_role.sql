-- The exam office (docs/design/66): a ready-made role that enters marks and marks codes (and uploads
-- marks from Excel) for every section, reads the exams, and never reopens locked marks: entering and
-- reopening stay with different people (sod_rules: exams.marks.enter vs exams.marks.unlock). The
-- school admin keeps verifying and reopening.

INSERT INTO roles (school_id, code, name, kind, is_system, description) VALUES
  (NULL, 'exam_office', 'Exam office', 'module', true,
   'Enters marks and codes for every section (and from Excel); cannot reopen locked marks')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code = 'exam_office'
  AND p.code IN ('exams.master.view', 'exams.marks.view', 'exams.marks.enter')
ON CONFLICT DO NOTHING;
