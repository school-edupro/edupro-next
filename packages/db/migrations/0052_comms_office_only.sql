-- Communication v2 decision (2026-10-02): only the office sends communications (admin, principal,
-- coordinator and office roles). Teachers keep viewing templates and requests but no longer compose
-- bulk messages or single messages from the admin portal.
DELETE FROM role_permissions rp
 USING roles r
 WHERE r.id = rp.role_id
   AND r.code IN ('class_teacher', 'subject_teacher')
   AND rp.permission_code IN ('comms.request.create', 'comms.message.send');
