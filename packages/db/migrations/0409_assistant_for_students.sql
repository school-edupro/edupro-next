-- 0409: the chatbot for students (docs/design/91, phase B). The standard Student role gets the assistant right
-- (insights.assistant.use), so the Assistant shows in a student's menu (website and app). It answers about the student
-- only (the student scope) and only once a parent has given the AI assistant consent — the API checks that on every
-- question. Schools' own copies of the role are theirs to change on Access → Roles.
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'insights.assistant.use' FROM roles r
 WHERE r.school_id IS NULL AND r.code = 'student'
ON CONFLICT DO NOTHING;
