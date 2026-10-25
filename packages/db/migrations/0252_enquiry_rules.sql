-- Enquiries as lead management, part 3 (docs/design/45): assignment rules with escalation, laid out like
-- the approval processes. A rule covers classes and sources (none: every one); its counsellor pool takes
-- leads in turn; the first contact is due within its working hours; past that, level 2 (a person, or the
-- holder of a role with the fewest open leads) takes the lead over and is told by email. The rule marked
-- "everything else" takes what no other rule covers. The old single switch becomes the first rule.

CREATE TABLE admission_enquiry_rules (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id           BIGINT NOT NULL REFERENCES schools(id),
  name                TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 80),
  class_ids           BIGINT[] NOT NULL DEFAULT '{}',
  source_ids          BIGINT[] NOT NULL DEFAULT '{}',
  -- give each lead to a counsellor of the pool on arrival (off: it waits unassigned)
  auto_assign         BOOLEAN NOT NULL DEFAULT true,
  -- the counsellors who take its leads in turn (none: everyone who takes enquiries)
  pool                BIGINT[] NOT NULL DEFAULT '{}',
  -- the first contact is due within these working hours (none: no time limit, no escalation)
  first_contact_hours NUMERIC(6, 1) CHECK (first_contact_hours IS NULL OR first_contact_hours > 0),
  level2_user_id      BIGINT REFERENCES users(id),
  level2_role         TEXT,
  acknowledge         BOOLEAN NOT NULL DEFAULT true,
  is_default          BOOLEAN NOT NULL DEFAULT false,
  sort_order          INT NOT NULL DEFAULT 0,
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  CHECK (level2_user_id IS NULL OR level2_role IS NULL)
);
CREATE UNIQUE INDEX admission_enquiry_rules_default ON admission_enquiry_rules (school_id) WHERE is_default AND status = 'active';
CALL app.apply_tenant_rls('admission_enquiry_rules');
CREATE TRIGGER admission_enquiry_rules_audit AFTER INSERT OR UPDATE OR DELETE ON admission_enquiry_rules FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

ALTER TABLE admission_enquiries
  ADD COLUMN rule_id        BIGINT REFERENCES admission_enquiry_rules(id),
  ADD COLUMN level          INT NOT NULL DEFAULT 1 CHECK (level IN (1, 2)),
  ADD COLUMN contact_due_at TIMESTAMPTZ,
  ADD COLUMN escalated_at   TIMESTAMPTZ;
CREATE INDEX admission_enquiries_contact_due ON admission_enquiries (contact_due_at)
  WHERE first_contact_at IS NULL AND level = 1 AND contact_due_at IS NOT NULL;

-- the desk's switch of a school that set it up becomes its "everything else" rule
INSERT INTO admission_enquiry_rules (school_id, name, auto_assign, pool, acknowledge, is_default, sort_order)
SELECT s.school_id, 'Every enquiry', s.enquiry_auto_assign, s.enquiry_counsellors, s.enquiry_acknowledge, true, 99
  FROM admission_settings s;

-- leads whose first contact is past due move to level 2 (run by the workers every five minutes)
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
                   trim(to_char(e.first_contact_hours, 'FM9990.9')),
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
               trim(to_char(e.first_contact_hours, 'FM9990.9')),
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
