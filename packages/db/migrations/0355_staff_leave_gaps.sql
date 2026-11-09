-- 0355: the leave module's gaps closed (docs/design/85, "As built — the plan checked"): the messages for
-- attendance corrections, the approver's confirmation and a withdrawn message, every leave message on
-- WhatsApp too (sent once the school puts the approved template name on it), the daily digest from its
-- editable template with the corrections waiting and on WhatsApp, the missing-punch copy list, and a day
-- left blank when leave comes off it filled as the nightly run would (weekly off, holiday or absent).

-- ---- the messages: e-mail, app and WhatsApp ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.staff_leave_seed_templates(p_school BIGINT) RETURNS VOID LANGUAGE sql AS $$
  INSERT INTO comms_templates (school_id, code, channel, name, subject, body, variables, category, wa_params)
  SELECT p_school, t.code, c.channel::comms_channel, t.name, CASE WHEN c.channel = 'email' THEN t.subject END,
         t.body, t.vars::jsonb, 'service', CASE WHEN c.channel = 'whatsapp' THEN t.vars::jsonb ELSE '[]'::jsonb END
    FROM (VALUES
      ('leave_waiting', 'Leave: waiting for your approval', 'Leave {{number}} of {{employee}} waits for you',
       '{{employee}} has applied for {{type}} from {{from}} to {{to}} ({{days}} days): {{reason}}. Please approve or reject it in EduPro.',
       '["number","employee","type","from","to","days","reason"]'),
      ('leave_approved', 'Leave: approved', 'Your leave {{number}} is approved',
       'Dear {{employee}}, your {{type}} from {{from}} to {{to}} ({{days}} days) is approved by {{by}}. {{type}} left: {{balance}}.',
       '["number","employee","type","from","to","days","by","balance"]'),
      ('leave_rejected', 'Leave: rejected', 'Your leave {{number}} is not approved',
       'Dear {{employee}}, your {{type}} from {{from}} to {{to}} is not approved by {{by}}: {{note}}',
       '["number","employee","type","from","to","by","note"]'),
      ('leave_cancelled', 'Leave: cancelled', 'Your leave {{number}} is cancelled',
       'Dear {{employee}}, your {{type}} from {{from}} to {{to}} is cancelled by {{by}}: {{note}}',
       '["number","employee","type","from","to","by","note"]'),
      ('leave_changed', 'Leave: dates changed', 'The dates of your leave {{number}} are changed',
       'Dear {{employee}}, your {{type}} {{number}} is now from {{from}} to {{to}} ({{days}} days), changed by {{by}}: {{note}}',
       '["number","employee","type","from","to","days","by","note"]'),
      ('leave_cancel_waiting', 'Leave: cancellation waiting for your approval', '{{employee}} asks to cancel leave {{number}}',
       '{{employee}} asks to cancel the approved {{type}} from {{from}} to {{to}}: {{reason}}. Please decide it in EduPro.',
       '["number","employee","type","from","to","reason"]'),
      ('leave_withdrawn', 'Leave: withdrawn', '{{employee}} withdrew leave {{number}}',
       '{{employee}} withdrew the {{type}} from {{from}} to {{to}} that waited for you: nothing more to do.',
       '["number","employee","type","from","to"]'),
      ('leave_acted', 'Leave: your decision recorded', 'You {{action}} leave {{number}}',
       'You {{action}} the {{type}} of {{employee}} from {{from}} to {{to}} ({{days}} days). {{next}}',
       '["number","employee","type","from","to","days","action","next"]'),
      ('leave_correction_waiting', 'Attendance correction: waiting for your approval', '{{employee}} asks to correct {{day}}',
       '{{employee}} asks for the attendance of {{day}} to be corrected ({{asked}}): {{reason}}. Please decide it in EduPro.',
       '["employee","day","asked","reason"]'),
      ('leave_correction_approved', 'Attendance correction: approved', 'Your attendance of {{day}} is corrected',
       'Dear {{employee}}, your correction of {{day}} ({{asked}}) is approved by {{by}}.',
       '["employee","day","asked","by"]'),
      ('leave_correction_rejected', 'Attendance correction: not approved', 'Your correction of {{day}} is not approved',
       'Dear {{employee}}, your correction of {{day}} ({{asked}}) is not approved by {{by}}: {{note}}',
       '["employee","day","asked","by","note"]'),
      ('leave_digest', 'Leave: daily list of approvals waiting', 'Leave waiting for your approval ({{count}})',
       'Dear {{name}}, {{count}} leave request(s) and correction(s) wait for you in EduPro: {{list}}',
       '["name","count","list"]')
    ) AS t(code, name, subject, body, vars)
    CROSS JOIN (VALUES ('email'), ('push'), ('whatsapp')) AS c(channel)
  ON CONFLICT (school_id, code, channel) DO NOTHING
$$;
SELECT app.staff_leave_seed_templates(id) FROM schools WHERE status = 'active';

-- ---- the daily digest: its template, the corrections, WhatsApp ----------------------------------------------
CREATE OR REPLACE FUNCTION app.staff_leave_digest(p_url TEXT) RETURNS INT LANGUAGE plpgsql AS $$
DECLARE u RECORD; v_n INT := 0; v_rows TEXT; v_text TEXT; s staff_leave_settings; t RECORD; v_subject TEXT; v_intro TEXT;
BEGIN
  SELECT * INTO s FROM staff_leave_settings WHERE school_id = app.current_school_id();
  IF s.school_id IS NULL OR NOT (s.send_email OR s.send_whatsapp) THEN RETURN 0; END IF;
  SELECT subject, body INTO t FROM comms_templates
   WHERE school_id = app.current_school_id() AND code = 'leave_digest' AND channel = 'email' AND status = 'active' AND deleted_at IS NULL;
  FOR u IN
    WITH items AS (
      SELECT a.user_id, i.requested_at, r.number AS no, e.display_name AS who, lt.code AS type,
             to_char(r.from_date, 'DD-MM-YYYY') AS f, to_char(r.to_date, 'DD-MM-YYYY') AS tt,
             CASE WHEN i.entity_type = 'staff_leave_cancel' THEN 'Cancellation' ELSE 'Leave' END AS what
        FROM workflow_instances i
        JOIN workflow_steps st ON st.instance_id = i.id AND st.level = i.current_level AND st.status = 'pending'
        CROSS JOIN LATERAL unnest(st.assignee_user_ids) a(user_id)
        JOIN staff_leave_requests r ON r.id = i.entity_id
        JOIN employees e ON e.id = r.employee_id
        JOIN staff_leave_types lt ON lt.id = r.leave_type_id
       WHERE i.status = 'pending' AND i.entity_type IN ('staff_leave', 'staff_leave_cancel')
      UNION ALL
      SELECT a.user_id, i.requested_at, '—', e.display_name, '—', to_char(g.day, 'DD-MM-YYYY'), to_char(g.day, 'DD-MM-YYYY'),
             'Correction'
        FROM workflow_instances i
        JOIN workflow_steps st ON st.instance_id = i.id AND st.level = i.current_level AND st.status = 'pending'
        CROSS JOIN LATERAL unnest(st.assignee_user_ids) a(user_id)
        JOIN staff_regularisations g ON g.id = i.entity_id
        JOIN employees e ON e.id = g.employee_id
       WHERE i.status = 'pending' AND i.entity_type = 'staff_regularisation'
    )
    SELECT x.user_id, us.email, us.mobile, us.display_name AS name, count(*)::int AS n,
           jsonb_agg(jsonb_build_object('no', x.no, 'who', x.who, 'type', x.type, 'from', x.f, 'to', x.tt, 'what', x.what,
                                        'days', ((now() AT TIME ZONE 'Asia/Kolkata')::date - (x.requested_at AT TIME ZONE 'Asia/Kolkata')::date))
                     ORDER BY x.requested_at) AS items
      FROM items x JOIN users us ON us.id = x.user_id
     GROUP BY x.user_id, us.email, us.mobile, us.display_name
  LOOP
    SELECT string_agg(format('<tr><td>%s</td><td>%s</td><td>%s</td><td>%s</td><td>%s%s</td><td align="right">%s</td></tr>',
                             replace(replace(i ->> 'no', '<', '&lt;'), '>', '&gt;'), i ->> 'what',
                             replace(replace(i ->> 'who', '<', '&lt;'), '>', '&gt;'), i ->> 'type', i ->> 'from',
                             CASE WHEN i ->> 'to' <> i ->> 'from' THEN ' to ' || (i ->> 'to') ELSE '' END,
                             CASE WHEN (i ->> 'days')::int >= 3 THEN '<strong style="color:#b42318">' || (i ->> 'days') || '</strong>'
                                  ELSE i ->> 'days' END), ''),
           string_agg(format('%s %s %s (%s%s, waiting %s days)', i ->> 'what', i ->> 'no', i ->> 'who', i ->> 'from',
                             CASE WHEN i ->> 'to' <> i ->> 'from' THEN ' to ' || (i ->> 'to') ELSE '' END, i ->> 'days'), '; ')
      INTO v_rows, v_text FROM jsonb_array_elements(u.items) i;
    v_subject := replace(COALESCE(t.subject, 'Leave waiting for your approval ({{count}})'), '{{count}}', u.n::text);
    v_intro := replace(replace(replace(replace(replace(
                 COALESCE(t.body, 'Dear {{name}}, {{count}} leave request(s) and correction(s) wait for you in EduPro: {{list}}'),
                 '&', '&amp;'), '<', '&lt;'), '{{name}}', replace(replace(COALESCE(u.name, ''), '&', '&amp;'), '<', '&lt;')),
                 '{{count}}', u.n::text), '{{list}}', '');
    IF s.send_email AND u.email IS NOT NULL THEN
      PERFORM app.queue_mail(
        u.email, v_subject,
        format('<p>%s</p><p>Waiting 3 days or more in red.</p>'
               '<table cellpadding="4" style="border-collapse:collapse"><tr><th align="left">Leave no.</th><th align="left">For</th>'
               '<th align="left">Employee</th><th align="left">Leave</th><th align="left">Dates</th><th align="right">Days waiting</th></tr>%s</table>'
               '<p><a href="%s/approvals">Open what waits for me</a></p>', v_intro, v_rows, rtrim(p_url, '/')),
        '[]'::jsonb, jsonb_build_object('digest', 'staff_leave'), u.user_id);
    END IF;
    IF s.send_whatsapp AND u.mobile IS NOT NULL THEN
      PERFORM app.send_template('leave_digest', 'whatsapp', u.mobile,
                                jsonb_build_object('name', COALESCE(u.name, ''), 'count', u.n::text, 'list', v_text), u.user_id);
    END IF;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;

-- ---- missing punches: the e-mail to the employee, and a copy to each address on the copy list --------------
CREATE OR REPLACE FUNCTION app.staff_missing_detect(p_from DATE, p_to DATE) RETURNS INT LANGUAGE plpgsql AS $$
DECLARE v_floor DATE; v_n INT := 0; r RECORD; v_cc TEXT; v_mail BOOLEAN; v_count INT; v_name TEXT; v_side TEXT;
        v_body TEXT; v_addr TEXT;
BEGIN
  SELECT GREATEST(p_from, COALESCE(exceptions_from, p_from)), missing_punch_cc, send_email INTO v_floor, v_cc, v_mail
    FROM staff_leave_settings WHERE school_id = app.current_school_id();
  v_floor := COALESCE(v_floor, p_from);
  FOR r IN INSERT INTO staff_missing_punches (school_id, employee_id, day, missing)
           SELECT a.school_id, a.employee_id, a.day, CASE WHEN a.in_at IS NULL THEN 'in' ELSE 'out' END
             FROM staff_attendance_days a
            WHERE a.school_id = app.current_school_id() AND a.day BETWEEN v_floor AND p_to AND a.day_type IN ('P', 'HD', 'A')
              AND (a.in_at IS NULL) <> (a.out_at IS NULL) AND NOT a.manual
           ON CONFLICT (employee_id, day) DO NOTHING
           RETURNING id, employee_id, day, missing LOOP
    v_n := v_n + 1;
    CONTINUE WHEN NOT COALESCE(v_mail, false);
    SELECT count(*)::int INTO v_count FROM staff_missing_punches
     WHERE employee_id = r.employee_id AND date_trunc('month', day) = date_trunc('month', r.day) AND status IN ('pending', 'used');
    SELECT replace(replace(e.display_name, '<', '&lt;'), '>', '&gt;') INTO v_name FROM employees e WHERE e.id = r.employee_id;
    v_side := CASE WHEN r.missing = 'in' THEN 'an OUT punch but no IN punch' ELSE 'an IN punch but no OUT punch' END;
    v_body := format('<p>Dear %s, your attendance on %s has %s. If you were at work, ask for an attendance correction in EduPro. This is your missing punch number %s this month.</p>',
                     v_name, to_char(r.day, 'DD-MM-YYYY'), v_side, v_count);
    PERFORM app.queue_mail(u.email, format('Missing punch on %s', to_char(r.day, 'DD-MM-YYYY')), v_body,
                           '[]'::jsonb, jsonb_build_object('kind', 'missing_punch'), u.id)
      FROM employees e JOIN users u ON u.id = e.user_id
     WHERE e.id = r.employee_id AND u.email IS NOT NULL;
    FOREACH v_addr IN ARRAY string_to_array(COALESCE(v_cc, ''), ',') LOOP
      v_addr := btrim(v_addr);
      CONTINUE WHEN v_addr !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$';
      PERFORM app.queue_mail(v_addr, format('Missing punch: %s on %s', v_name, to_char(r.day, 'DD-MM-YYYY')),
                             format('<p>A copy: %s''s attendance on %s has %s (missing punch number %s this month).</p>',
                                    v_name, to_char(r.day, 'DD-MM-YYYY'), v_side, v_count),
                             '[]'::jsonb, jsonb_build_object('kind', 'missing_punch_cc'), NULL);
    END LOOP;
    UPDATE staff_missing_punches SET mailed_at = now() WHERE id = r.id;
  END LOOP;
  RETURN v_n;
END $$;

-- ---- a day left blank when leave comes off it: worked out again, else filled as the nightly run would -------
CREATE OR REPLACE FUNCTION app.staff_day_refill(p_emp BIGINT, p_day DATE) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE v_new staff_attendance_days; v_school BIGINT; v_joined DATE; v_name TEXT; v_kind TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM staff_attendance_days WHERE employee_id = p_emp AND day = p_day) THEN RETURN 'kept'; END IF;
  PERFORM app.staff_day_compute(p_emp, p_day);
  IF EXISTS (SELECT 1 FROM staff_attendance_days WHERE employee_id = p_emp AND day = p_day) THEN RETURN 'punches'; END IF;
  SELECT school_id, joined_on INTO v_school, v_joined FROM employees WHERE id = p_emp;
  IF p_day >= (now() AT TIME ZONE 'Asia/Kolkata')::date OR (v_joined IS NOT NULL AND p_day < v_joined)
     OR app.staff_month_locked(v_school, p_day) THEN RETURN 'blank'; END IF;
  IF EXISTS (SELECT 1 FROM staff_leave_days x WHERE x.employee_id = p_emp AND x.day = p_day AND x.status IN ('pending', 'approved'))
     OR EXISTS (SELECT 1 FROM staff_regularisations g WHERE g.employee_id = p_emp AND g.day = p_day AND g.status = 'pending') THEN
    RETURN 'blank';
  END IF;
  v_kind := CASE WHEN app.staff_is_weekoff(p_emp, p_day) THEN 'WO' WHEN app.staff_is_holiday(p_emp, p_day, false) THEN 'H' ELSE 'A' END;
  IF v_kind = 'H' THEN
    SELECT h.name INTO v_name FROM holidays h WHERE h.school_id = v_school AND p_day BETWEEN h.starts_on AND h.ends_on
       AND h.kind IN ('holiday', 'vacation') AND NOT h.optional ORDER BY h.id LIMIT 1;
  END IF;
  v_new := NULL;
  v_new.school_id := v_school; v_new.employee_id := p_emp; v_new.day := p_day; v_new.day_type := v_kind;
  v_new.source := CASE v_kind WHEN 'WO' THEN 'weekoff' WHEN 'H' THEN 'holiday' ELSE 'absent' END;
  v_new.remark := CASE v_kind WHEN 'WO' THEN 'Weekly off' WHEN 'H' THEN v_name ELSE 'No punch recorded' END;
  PERFORM app.staff_day_write(v_new, 'leave taken off: the day filled again');
  RETURN v_kind;
END $$;

CREATE OR REPLACE FUNCTION app.staff_attendance_remove_leave(p_emp BIGINT, p_days DATE[]) RETURNS INT LANGUAGE plpgsql AS $$
DECLARE v_day DATE; v_row staff_attendance_days; v_other BIGINT; v_n INT := 0;
BEGIN
  FOREACH v_day IN ARRAY p_days LOOP
    SELECT * INTO v_row FROM staff_attendance_days WHERE employee_id = p_emp AND day = v_day;
    CONTINUE WHEN v_row.id IS NULL OR v_row.day_type <> 'LV' OR v_row.manual
                  OR app.staff_month_locked(v_row.school_id, v_day);
    SELECT x.request_id INTO v_other FROM staff_leave_days x JOIN staff_leave_requests r ON r.id = x.request_id
     WHERE x.employee_id = p_emp AND x.day = v_day AND x.status = 'approved' AND r.source NOT IN ('auto_late', 'auto_missing', 'auto_rule')
     ORDER BY x.id DESC LIMIT 1;
    IF v_other IS NOT NULL THEN
      PERFORM app.staff_attendance_apply_leave(v_other);
    ELSE
      INSERT INTO staff_attendance_history (school_id, employee_id, day, before, after, reason, changed_by)
      VALUES (v_row.school_id, p_emp, v_day, to_jsonb(v_row) - 'trace', NULL, 'leave taken off', app.current_user_id());
      DELETE FROM staff_attendance_days WHERE id = v_row.id;
      -- the punches first; with none, a past day is a weekly off, a holiday or absent (never left blank)
      PERFORM app.staff_day_refill(p_emp, v_day);
    END IF;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;
