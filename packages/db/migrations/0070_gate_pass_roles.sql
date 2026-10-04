-- Gate pass v2: the register and making a pass at the desk belong to the Front Desk role; the gate to
-- Gate / Security. Teachers, coordinators and the principal approve from "To approve" (no permission
-- needed: a pass waits on them by name). The school admin keeps a read of the register and the set-up.
DELETE FROM role_permissions rp USING roles r
 WHERE r.id = rp.role_id AND r.school_id IS NULL
   AND r.code IN ('class_teacher', 'teacher', 'academic_coordinator', 'front_office', 'clerk', 'receptionist')
   AND rp.permission_code IN ('engagement.gate_pass.view', 'engagement.gate_pass.issue');
DELETE FROM role_permissions rp USING roles r
 WHERE r.id = rp.role_id AND r.school_id IS NULL AND r.code = 'school_admin' AND rp.permission_code = 'engagement.gate_pass.issue';
