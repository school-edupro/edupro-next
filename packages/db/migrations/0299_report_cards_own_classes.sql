-- docs/design/65 (1 Nov 2026): Report cards are the principal's, the coordinators' and the class
-- teachers' page. The principal (whoever may publish results) sees every class; a coordinator the
-- classes they coordinate; a class teacher their own section (the API reads Teacher assignments).
-- Subject teachers and the auditor no longer open it. A school's own roles are left as they are.
DELETE FROM role_permissions rp USING roles r
 WHERE r.id = rp.role_id AND r.school_id IS NULL
   AND r.code IN ('subject_teacher', 'auditor')
   AND rp.permission_code = 'exams.report_card.view';
