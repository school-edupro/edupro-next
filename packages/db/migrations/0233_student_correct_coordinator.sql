-- Detail corrections (0232): the academic coordinator keeps the student records, so asks for corrections
-- too (the office roles named in 0232 are school-made roles; schools give them the right in Roles).
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'people.student.correct' FROM roles r
 WHERE r.school_id IS NULL AND r.code = 'academic_coordinator'
ON CONFLICT DO NOTHING;
