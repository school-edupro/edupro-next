-- The escalation note of a lead (docs/design/45, part 3) says "4 working hours", not "4." (the number
-- format left a point after whole hours). The function is otherwise as in 0252.

CREATE OR REPLACE FUNCTION app.enquiry_escalate_due() RETURNS INT LANGUAGE plpgsql AS $$
DECLARE
  e RECORD;
  v_user BIGINT;
  v_name TEXT;
  v_mail TEXT;
  v_n INT := 0;
BEGIN
  FOR e IN
    SELECT q.*, r.level2_user_id, r.level2_role, r.name AS rule_name, r.first_contact_hours,
           (SELECT display_name FROM users WHERE id = q.counsellor_user_id) AS was_with,
           (SELECT name FROM classes WHERE id = q.class_id) AS class_name
      FROM admission_enquiries q JOIN admission_enquiry_rules r ON r.id = q.rule_id
     WHERE q.first_contact_at IS NULL AND q.level = 1 AND q.contact_due_at < now()
       AND q.status IN ('new', 'follow_up', 'interested') AND q.application_id IS NULL
       AND (r.level2_user_id IS NOT NULL OR r.level2_role IS NOT NULL)
     ORDER BY q.contact_due_at
     LIMIT 500
  LOOP
    v_user := e.level2_user_id;
    IF v_user IS NULL THEN
      SELECT p.user_id INTO v_user FROM app.helpdesk_role_people(e.level2_role) p
       ORDER BY (SELECT count(*) FROM admission_enquiries x WHERE x.counsellor_user_id = p.user_id
                  AND x.status IN ('new', 'follow_up', 'interested')), p.user_id
       LIMIT 1;
    END IF;
    UPDATE admission_enquiries
       SET level = 2, escalated_at = now(), updated_at = now(),
           counsellor_user_id = COALESCE(v_user, counsellor_user_id),
           assigned_at = CASE WHEN v_user IS NOT NULL THEN now() ELSE assigned_at END
     WHERE id = e.id;
    SELECT display_name INTO v_name FROM users WHERE id = v_user;
    INSERT INTO admission_enquiry_followups (school_id, enquiry_id, mode, outcome)
    VALUES (e.school_id, e.id, 'system',
            format('Not contacted within %s working hours%s: escalated to %s',
                   CASE WHEN e.first_contact_hours = trunc(e.first_contact_hours) THEN trunc(e.first_contact_hours)::text ELSE e.first_contact_hours::text END,
                   CASE WHEN e.was_with IS NOT NULL THEN ' by ' || e.was_with ELSE '' END,
                   COALESCE(v_name, e.level2_role, 'level 2')));
    v_mail := app.helpdesk_user_email(v_user);
    IF v_mail IS NOT NULL THEN
      PERFORM app.queue_mail(
        v_mail,
        left('Enquiry not contacted in time: ' || e.parent_name, 200),
        format('<p>This admission enquiry was not contacted within %s working hours and is now with you (rule "%s").</p>'
               '<table cellpadding="4" style="border-collapse:collapse"><tr><td><strong>Enquiry</strong></td><td>ENQ-%s</td></tr>'
               '<tr><td><strong>Parent</strong></td><td>%s</td></tr><tr><td><strong>Child</strong></td><td>%s</td></tr>'
               '<tr><td><strong>Class</strong></td><td>%s</td></tr><tr><td><strong>Mobile</strong></td><td>%s</td></tr>'
               '<tr><td><strong>Was with</strong></td><td>%s</td></tr></table><p>Open EduPro → Admissions → Enquiries to call the family.</p>',
               CASE WHEN e.first_contact_hours = trunc(e.first_contact_hours) THEN trunc(e.first_contact_hours)::text ELSE e.first_contact_hours::text END,
               replace(replace(e.rule_name, '<', '&lt;'), '>', '&gt;'),
               lpad(e.id::text, 6, '0'),
               replace(replace(e.parent_name, '<', '&lt;'), '>', '&gt;'),
               replace(replace(COALESCE(e.child_name, '-'), '<', '&lt;'), '>', '&gt;'),
               replace(replace(COALESCE(e.class_name, '-'), '<', '&lt;'), '>', '&gt;'),
               COALESCE(e.mobile, '-'),
               replace(replace(COALESCE(e.was_with, 'nobody'), '<', '&lt;'), '>', '&gt;')),
        '[]'::jsonb, jsonb_build_object('enquiry', e.id::text), v_user);
    END IF;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END
$$;
