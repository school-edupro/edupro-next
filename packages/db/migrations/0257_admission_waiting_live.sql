-- docs/design/47: the registrations waiting for a decision are those the registrations list shows — with a
-- form and in a session that is not deleted — so the approvals count, Waiting for me and the morning
-- email agree with the list.
CREATE OR REPLACE VIEW admission_waiting WITH (security_invoker = true) AS
SELECT a.id, a.school_id, a.application_no, a.candidate_name, a.class_id, a.cycle_id, a.stage_no, a.level_no,
       a.process_steps -> a.stage_no AS step,
       a.process_steps -> a.stage_no -> 'levels' -> (a.level_no - 1) AS level,
       jsonb_array_length(a.process_steps -> a.stage_no -> 'levels') AS levels,
       a.level_since,
       NULLIF(a.process_steps -> a.stage_no -> 'levels' -> (a.level_no - 1) ->> 'days', '')::int AS days,
       a.level_since + make_interval(days => NULLIF(a.process_steps -> a.stage_no -> 'levels' -> (a.level_no - 1) ->> 'days', '')::int) AS due_at
  FROM applications a JOIN admission_cycles y ON y.id = a.cycle_id AND y.deleted_at IS NULL
 WHERE a.school_id = app.current_school_id() AND a.status::text IN ('registered', 'under_review') AND a.process_steps IS NOT NULL
   AND a.form_id IS NOT NULL AND a.stage_no < jsonb_array_length(a.process_steps) AND a.level_no >= 1;
