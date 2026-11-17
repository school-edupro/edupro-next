-- CBSE board result analysis, phase D (docs/design/88): a teacher's own board results — the sections and subjects
-- they taught (the section-wise figures, the Performance Index, the ACR bands, their students' marks) — on the staff
-- app. Teachers see nothing of other teachers' sections; the whole analysis stays with exams.board_result.view.
INSERT INTO permissions (code, module, description) VALUES
  ('exams.board_result.own', 'exams', 'See my own CBSE board results: the sections and subjects I taught')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'exams.board_result.own' FROM roles r
 WHERE r.school_id IS NULL AND r.code IN ('group_admin', 'school_admin', 'academic_coordinator', 'class_teacher', 'subject_teacher')
ON CONFLICT DO NOTHING;
