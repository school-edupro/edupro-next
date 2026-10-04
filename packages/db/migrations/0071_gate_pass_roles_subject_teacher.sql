-- the subject teacher held the same read of the register as the class teacher (0031); see 0070
DELETE FROM role_permissions rp USING roles r
 WHERE r.id = rp.role_id AND r.school_id IS NULL AND r.code = 'subject_teacher'
   AND rp.permission_code IN ('engagement.gate_pass.view', 'engagement.gate_pass.issue');
