-- 0061: appointments are decided by the front desk. Teachers held "view" and "decide" from the days when
-- the class teacher confirmed a request; that would now let them read every visitor's details and approve
-- anything. They keep only their own appointments (the API's "with me" list). The front office roles get
-- the queue, the decisions and the gate.
DELETE FROM role_permissions rp USING roles r
 WHERE r.id = rp.role_id AND r.code IN ('class_teacher', 'subject_teacher')
   AND rp.permission_code IN ('engagement.appointment.view', 'engagement.appointment.decide', 'engagement.appointment.checkin');

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r
  CROSS JOIN (VALUES ('engagement.appointment.view'), ('engagement.appointment.decide'), ('engagement.appointment.checkin')) AS p(code)
 WHERE r.code IN ('front_office', 'clerk', 'receptionist') AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;
