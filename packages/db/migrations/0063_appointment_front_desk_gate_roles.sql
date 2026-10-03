-- 0063: two ready roles for appointments. "Front Desk" runs the queue (confirm, decline, move, book,
-- calendar, dashboard) and may check visitors in; "Gate / Security" only checks visitors in and out and
-- keeps the visitor log. The school admin keeps the set-up. Everyone else (the principal included) sees
-- only the confirmed appointments with them. The admin gives these roles to employees under Access.
INSERT INTO roles (school_id, code, name, kind, is_system, description) VALUES
  (NULL, 'front_desk', 'Front Desk (appointments)', 'module', true,
   'Appointments: the request queue, confirm / decline / move, book for walk-ins, calendar, dashboard, gate check-in'),
  (NULL, 'gate_security', 'Gate / Security', 'module', true,
   'Gate: check appointment visitors in and out from their pass, print the visitor card, keep the visitor log')
ON CONFLICT (school_id, code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r
  CROSS JOIN (VALUES ('engagement.appointment.view'), ('engagement.appointment.decide'), ('engagement.appointment.checkin'),
                     ('engagement.visitor.manage')) AS p(code)
 WHERE r.school_id IS NULL AND r.code = 'front_desk'
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r
  CROSS JOIN (VALUES ('engagement.appointment.checkin'), ('engagement.visitor.manage')) AS p(code)
 WHERE r.school_id IS NULL AND r.code = 'gate_security'
ON CONFLICT DO NOTHING;

-- the queue and the gate now belong to those two roles only (the group admin and the auditor keep their
-- read of everything); a school admin who also works the front desk takes the Front Desk role
DELETE FROM role_permissions rp USING roles r
 WHERE r.id = rp.role_id AND r.code IN ('school_admin', 'academic_coordinator', 'front_office', 'clerk', 'receptionist')
   AND rp.permission_code IN ('engagement.appointment.view', 'engagement.appointment.decide', 'engagement.appointment.checkin');
