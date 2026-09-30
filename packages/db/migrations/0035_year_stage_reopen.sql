-- Year stage reopen on a locked year (post-freeze change, 2026-09-30).
--
-- Before: a locked year refused every write, whatever its stage flags said. Reopening a stage only
-- worked by turning the year active again, which the one-active-year-per-school index forbids while
-- the next year is the working one. So a late correction in last year's fees was impossible.
--
-- After: an active year is writable unless the stage is locked (flag true); a locked year is
-- read only unless the stage was explicitly reopened (flag false). A closed year stays read only.

CREATE OR REPLACE FUNCTION app.assert_year_open(p_year_id BIGINT, p_stage TEXT) RETURNS VOID
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_status year_status;
  v_flag   BOOLEAN;
BEGIN
  PERFORM app.assert_context();

  SELECT status, (locks ->> p_stage)::BOOLEAN INTO v_status, v_flag
  FROM academic_years
  WHERE id = p_year_id;                       -- RLS restricts to the current school

  IF NOT FOUND THEN
    RAISE EXCEPTION 'year.not_found'
      USING ERRCODE = 'P0002', DETAIL = jsonb_build_object('academic_year_id', p_year_id)::TEXT;
  END IF;

  IF v_status = 'closed' THEN
    RAISE EXCEPTION 'year.closed'
      USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('academic_year_id', p_year_id)::TEXT;
  END IF;

  -- locked year: only an explicitly reopened stage (false) is writable; other years: a true flag locks
  IF (v_status = 'locked' AND v_flag IS DISTINCT FROM false)
     OR (v_status <> 'locked' AND COALESCE(v_flag, false)) THEN
    RAISE EXCEPTION 'year.stage_locked'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object('academic_year_id', p_year_id, 'stage', p_stage)::TEXT;
  END IF;
END
$$;

-- A year that stops being the working year starts fully locked: stage flags left at false while it was
-- active would otherwise keep those stages writable under the new rule.
UPDATE academic_years
   SET locks = '{"attendance": true, "exams": true, "fees": true, "academics": true}'::jsonb
 WHERE status IN ('locked', 'closed');
UPDATE financial_years
   SET locks = '{"attendance": true, "exams": true, "fees": true, "academics": true}'::jsonb
 WHERE status IN ('locked', 'closed');
