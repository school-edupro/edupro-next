-- 0263 (docs/design/55): only Accounts take admission fees (the Accountant role keeps
-- admissions.fee.collect; School Admin and Group Admin lose it, the templates and the schools' copies),
-- and the morning email of waiting registrations links to Admissions -> Approvals.
DELETE FROM role_permissions rp
 USING roles r
 WHERE rp.role_id = r.id AND rp.permission_code = 'admissions.fee.collect'
   AND r.code IN ('school_admin', 'group_admin');

CREATE OR REPLACE FUNCTION app.admission_level_digest(p_url TEXT) RETURNS INT LANGUAGE plpgsql AS $$
DECLARE
  u RECORD;
  v_today DATE := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_rows TEXT;
  v_mail TEXT;
  v_n INT := 0;
BEGIN
  FOR u IN
    WITH lv AS (SELECT DISTINCT level FROM admission_waiting WHERE level IS NOT NULL),
         who AS (SELECT lv.level, x AS user_id FROM lv, LATERAL app.admission_level_users(lv.level) x)
    SELECT who.user_id, count(*)::int AS n,
           count(*) FILTER (WHERE w.due_at < now())::int AS overdue,
           count(*) FILTER (WHERE w.due_at >= now() AND (w.due_at AT TIME ZONE 'Asia/Kolkata')::date <= v_today + 1)::int AS due_soon,
           jsonb_agg(jsonb_build_object(
             'no', COALESCE(w.application_no, '-'), 'who', COALESCE(w.candidate_name, '-'),
             'class', (SELECT name FROM classes WHERE id = w.class_id),
             'at', (SELECT name FROM admission_stages WHERE id = (w.step ->> 'stageId')::bigint)
                   || CASE WHEN w.levels > 1 THEN ' · ' || COALESCE(w.level ->> 'name', 'level ' || w.level_no) ELSE '' END,
             'days', GREATEST(0, (v_today - (w.level_since AT TIME ZONE 'Asia/Kolkata')::date)),
             'state', CASE WHEN w.due_at < now() THEN 'Overdue'
                           WHEN w.due_at IS NOT NULL AND (w.due_at AT TIME ZONE 'Asia/Kolkata')::date <= v_today + 1 THEN 'Due tomorrow'
                           WHEN w.due_at IS NOT NULL THEN 'Due ' || to_char(w.due_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon')
                           ELSE '' END,
             'rank', CASE WHEN w.due_at < now() THEN 0 WHEN w.due_at IS NOT NULL AND (w.due_at AT TIME ZONE 'Asia/Kolkata')::date <= v_today + 1 THEN 1 ELSE 2 END,
             'since', w.level_since)) AS items
      FROM who JOIN admission_waiting w ON w.level = who.level
     WHERE NOT EXISTS (SELECT 1 FROM admission_level_digests d WHERE d.user_id = who.user_id AND d.day = v_today)
     GROUP BY who.user_id
  LOOP
    v_mail := app.helpdesk_user_email(u.user_id);
    IF v_mail IS NULL THEN CONTINUE; END IF;
    SELECT string_agg(format('<tr><td>%s</td><td>%s</td><td>%s</td><td>%s</td><td style="text-align:right">%s</td><td>%s</td></tr>',
                             replace(replace(i ->> 'no', '<', '&lt;'), '>', '&gt;'),
                             replace(replace(i ->> 'who', '<', '&lt;'), '>', '&gt;'),
                             replace(replace(COALESCE(i ->> 'class', '-'), '<', '&lt;'), '>', '&gt;'),
                             replace(replace(COALESCE(i ->> 'at', '-'), '<', '&lt;'), '>', '&gt;'),
                             i ->> 'days',
                             CASE WHEN i ->> 'state' = 'Overdue' THEN '<strong style="color:#b42318">Overdue</strong>' ELSE i ->> 'state' END),
                      '' ORDER BY (i ->> 'rank')::int, i ->> 'since')
      INTO v_rows
      FROM jsonb_array_elements(u.items) i;
    PERFORM app.queue_mail(
      v_mail,
      left(format('Registrations waiting for your decision: %s%s', u.n,
                  CASE WHEN u.overdue > 0 THEN format(' (%s overdue)', u.overdue) ELSE '' END), 200),
      format('<p>These admission registrations wait for your decision.%s%s</p>'
             '<table cellpadding="4" style="border-collapse:collapse"><tr><th align="left">Registration no.</th><th align="left">Candidate</th>'
             '<th align="left">Class</th><th align="left">Waiting at</th><th align="right">Days</th><th align="left">Time limit</th></tr>%s</table>'
             '<p><a href="%s/admissions/approvals">Open Approvals</a></p>',
             CASE WHEN u.overdue > 0 THEN format(' %s past the time limit.', u.overdue) ELSE '' END,
             CASE WHEN u.due_soon > 0 THEN format(' %s due by tomorrow.', u.due_soon) ELSE '' END,
             v_rows, rtrim(p_url, '/')),
      '[]'::jsonb, jsonb_build_object('digest', 'admission_levels'), u.user_id);
    INSERT INTO admission_level_digests (school_id, user_id, day, items)
    VALUES (app.current_school_id(), u.user_id, v_today, u.n);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END
$$;
