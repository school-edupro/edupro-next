-- 0201: recruitment, part 5 (docs/design/34-recruitment.md). Who approves a vacancy is set in Recruitment
-- set-up: named employees, everyone holding a designation, or the HOD of the vacancy's department, so a
-- department gets its HOD. A vacancy waiting for approval follows the set-up: an empty level is skipped,
-- the raiser's own level and a level of someone who already approved count as approved. The careers page
-- window gets a time: it opens and closes at the minute set, in the school's time zone.
ALTER TABLE departments ADD COLUMN hod_employee_id BIGINT REFERENCES employees(id);

ALTER TABLE vacancies
  ADD COLUMN opens_at  TIMESTAMPTZ,
  ADD COLUMN closes_at TIMESTAMPTZ;
-- dates already set: from the start of the first day to 23:59 on the last
UPDATE vacancies v
   SET opens_at  = v.opens_on::timestamp AT TIME ZONE s.timezone,
       closes_at = ((v.closes_on + 1)::timestamp - interval '1 minute') AT TIME ZONE s.timezone
  FROM schools s
 WHERE s.id = v.school_id AND v.opens_on IS NOT NULL AND v.closes_on IS NOT NULL;
-- the check on the two dates goes with them
ALTER TABLE vacancies DROP COLUMN opens_on, DROP COLUMN closes_on;
ALTER TABLE vacancies
  ADD CONSTRAINT vacancies_window CHECK (opens_at IS NULL OR closes_at IS NULL OR closes_at > opens_at);

-- a level the plan skips (nobody holds it) goes in the approval's history
ALTER TABLE workflow_events DROP CONSTRAINT workflow_events_kind_check;
ALTER TABLE workflow_events ADD CONSTRAINT workflow_events_kind_check CHECK (kind IN
  ('started', 'approved', 'rejected', 'cancelled', 'reassigned', 'reminded', 'escalated', 'comment', 'delegated', 'skipped'));

-- the vacancy approval levels the schools have: worked out again as the vacancy moves
UPDATE workflow_definitions d
   SET levels = (SELECT jsonb_agg(l || '{"autoSkip": true}'::jsonb ORDER BY (l->>'level')::int)
                   FROM jsonb_array_elements(d.levels) l),
       updated_at = now()
 WHERE d.code = 'vacancy_approval' AND d.deleted_at IS NULL AND jsonb_array_length(d.levels) > 0;
