-- Registrations as the admissions grid, the approver's queue, alerts and time limits (docs/design/47).
-- A registration keeps when it reached its current stage and level; the people of a level are worked out
-- here once (the same rule as the API's canAct: the level's people who hold the decide right, set-up
-- managers aside); a level may carry "days" to decide, so a registration is due, due tomorrow or
-- overdue; every morning the people with registrations waiting for them get one email.

ALTER TABLE applications ADD COLUMN level_since TIMESTAMPTZ;

-- reaching another stage or level (or starting / changing the process) restarts the clock
CREATE OR REPLACE FUNCTION app.application_level_since() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.stage_no IS DISTINCT FROM OLD.stage_no OR NEW.level_no IS DISTINCT FROM OLD.level_no
     OR NEW.process_id IS DISTINCT FROM OLD.process_id THEN
    NEW.level_since := now();
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER applications_level_since BEFORE UPDATE OF stage_no, level_no, process_id ON applications
  FOR EACH ROW EXECUTE FUNCTION app.application_level_since();

-- those in a process today: since their last decision, else since registration
UPDATE applications a
   SET level_since = COALESCE(
         (SELECT max(r.decided_at) FROM admission_stage_results r WHERE r.application_id = a.id AND r.undone_at IS NULL),
         a.registered_at, a.submitted_at, a.created_at)
 WHERE a.process_steps IS NOT NULL;

-- the users who may decide at a level of a process ({name, by, roleCode, designation, employeeIds})
CREATE OR REPLACE FUNCTION app.admission_level_users(p_level JSONB)
RETURNS SETOF BIGINT LANGUAGE sql STABLE AS $$
  WITH deciders AS (
    SELECT ur.user_id FROM user_roles ur JOIN role_permissions rp ON rp.role_id = ur.role_id
     WHERE ur.school_id = app.current_school_id() AND rp.permission_code = 'admissions.application.decide'
       AND ur.revoked_at IS NULL AND ur.valid_from <= CURRENT_DATE AND (ur.valid_to IS NULL OR ur.valid_to >= CURRENT_DATE)
  ), people AS (
    SELECT d.user_id FROM deciders d WHERE p_level ->> 'by' = 'anyone'
    UNION
    SELECT ur.user_id FROM user_roles ur JOIN roles r ON r.id = ur.role_id
     WHERE p_level ->> 'by' = 'role' AND ur.school_id = app.current_school_id() AND r.code = p_level ->> 'roleCode'
       AND ur.revoked_at IS NULL AND ur.valid_from <= CURRENT_DATE AND (ur.valid_to IS NULL OR ur.valid_to >= CURRENT_DATE)
    UNION
    SELECT e.user_id FROM employees e
     WHERE p_level ->> 'by' = 'designation' AND lower(e.designation) = lower(p_level ->> 'designation')
       AND e.user_id IS NOT NULL AND e.status = 'active' AND e.deleted_at IS NULL
    UNION
    SELECT e.user_id FROM employees e
     WHERE p_level ->> 'by' = 'employees'
       AND e.id::text IN (SELECT jsonb_array_elements_text(COALESCE(p_level -> 'employeeIds', '[]'::jsonb)))
       AND e.user_id IS NOT NULL AND e.status = 'active' AND e.deleted_at IS NULL
  )
  SELECT DISTINCT p.user_id FROM people p JOIN users u ON u.id = p.user_id
   WHERE u.deleted_at IS NULL AND p.user_id IN (SELECT user_id FROM deciders)
$$;

-- registrations waiting for a decision now, with their level and its time limit
CREATE OR REPLACE VIEW admission_waiting WITH (security_invoker = true) AS
SELECT a.id, a.school_id, a.application_no, a.candidate_name, a.class_id, a.cycle_id, a.stage_no, a.level_no,
       a.process_steps -> a.stage_no AS step,
       a.process_steps -> a.stage_no -> 'levels' -> (a.level_no - 1) AS level,
       jsonb_array_length(a.process_steps -> a.stage_no -> 'levels') AS levels,
       a.level_since,
       NULLIF(a.process_steps -> a.stage_no -> 'levels' -> (a.level_no - 1) ->> 'days', '')::int AS days,
       a.level_since + make_interval(days => NULLIF(a.process_steps -> a.stage_no -> 'levels' -> (a.level_no - 1) ->> 'days', '')::int) AS due_at
  FROM applications a
 WHERE a.school_id = app.current_school_id() AND a.status::text IN ('registered', 'under_review') AND a.process_steps IS NOT NULL
   AND a.stage_no < jsonb_array_length(a.process_steps) AND a.level_no >= 1;
GRANT SELECT ON admission_waiting TO PUBLIC;

-- one email a morning per person, so a re-run the same day sends nothing again
CREATE TABLE admission_level_digests (
  school_id  BIGINT NOT NULL REFERENCES schools(id),
  user_id    BIGINT NOT NULL REFERENCES users(id),
  day        DATE NOT NULL,
  items      INT NOT NULL,
  sent_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (school_id, user_id, day)
);
CALL app.apply_tenant_rls('admission_level_digests');

-- the morning email: what waits for each person, overdue first, then due tomorrow (the reminder)
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
             '<p><a href="%s/admissions/registrations?tab=mine">Open Waiting for me</a></p>',
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
