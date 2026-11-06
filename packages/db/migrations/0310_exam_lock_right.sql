-- 6 Nov 2026 (asked): locking and unlocking a whole exam, and a class's entry locks, is the school
-- admin's right alone (and a group admin's); coordinators and the exam office keep entering, submitting,
-- verifying and sending back. Unlocking the whole exam also reopens its submitted and verified marks
-- (a reason kept in each sheet's history), so every teacher can enter again.
INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('exams.lock.manage', 'exams',
   'Lock and unlock a whole exam or a class''s entry; unlocking the exam reopens its submitted and verified marks',
   false)
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'exams.lock.manage' FROM roles r
 WHERE r.school_id IS NULL AND r.code IN ('group_admin', 'school_admin')
ON CONFLICT DO NOTHING;
