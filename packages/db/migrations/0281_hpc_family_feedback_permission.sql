-- Examinations v2, part 5 (docs/design/65): a parent writes their feedback for the child's Holistic
-- Progress Card in the parent app while the class's indicators are open.
INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('exams.family.feedback', 'exams', 'Write my feedback on my child''s holistic progress card', false)
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'exams.family.feedback' FROM roles r WHERE r.school_id IS NULL AND r.code = 'parent'
ON CONFLICT DO NOTHING;
