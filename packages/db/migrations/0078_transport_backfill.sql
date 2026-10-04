-- 0078: pupils mapped to a bus before transport v2 (or mapped directly on the route page) get their
-- transport period, so the student transport history, the dashboard and the parent portal show them.
-- The period runs the whole session at the slab the pupil is charged now (the one on the fee profile,
-- else the stoppage's), so the fees do not change.

CREATE OR REPLACE FUNCTION app.transport_backfill() RETURNS INT LANGUAGE plpgsql AS $$
DECLARE
  v_n INT;
BEGIN
  INSERT INTO student_transport (school_id, student_id, academic_year_id, service, pick_route_id, pick_stop_id, drop_route_id, drop_stop_id,
                                 slab_id, monthly_amount, from_month, to_month, created_by)
  SELECT a.school_id, a.student_id, a.academic_year_id, 'both', a.route_id, a.stop_id, a.route_id, a.stop_id,
         sl.id, COALESCE(sl.monthly_amount, 0), date_trunc('month', y.start_date)::date, date_trunc('month', y.end_date)::date, a.created_by
    FROM student_route_assignments a
    JOIN academic_years y ON y.id = a.academic_year_id
    LEFT JOIN student_fee_profiles p ON p.student_id = a.student_id AND p.academic_year_id = a.academic_year_id
    LEFT JOIN transport_stops st ON st.id = a.stop_id
    LEFT JOIN transport_stoppages sg ON sg.id = st.stoppage_id
    LEFT JOIN transport_slabs sl ON sl.id = COALESCE(p.transport_slab_id, st.slab_id, sg.slab_id)
   WHERE NOT EXISTS (SELECT 1 FROM student_transport t WHERE t.student_id = a.student_id AND t.academic_year_id = a.academic_year_id);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END
$$;

SELECT app.transport_backfill();

-- the month tick also picks up a pupil the office mapped directly on the route page
CREATE OR REPLACE FUNCTION app.transport_tick() RETURNS INT LANGUAGE plpgsql AS $$
DECLARE
  r RECORD;
  v_n INT := 0;
  v_today DATE := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_month DATE := date_trunc('month', (now() AT TIME ZONE 'Asia/Kolkata'))::date;
BEGIN
  v_n := app.transport_backfill();
  FOR r IN
    SELECT DISTINCT st.student_id, st.academic_year_id FROM student_transport st
      LEFT JOIN student_route_assignments a ON a.student_id = st.student_id AND a.academic_year_id = st.academic_year_id
     WHERE st.status IN ('active', 'ended')
       AND ((a.id IS NOT NULL AND a.valid_to IS NOT NULL AND a.valid_to < v_today)
         OR (a.id IS NULL AND v_month BETWEEN st.from_month AND st.to_month)
         OR (a.id IS NOT NULL AND a.valid_from IS NOT NULL AND v_month BETWEEN st.from_month AND st.to_month AND a.valid_from IS DISTINCT FROM st.from_month))
  LOOP
    PERFORM app.transport_sync(r.student_id, r.academic_year_id);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END
$$;

-- the office maps a pupil directly on the route page (no request): the history follows from this month
CREATE OR REPLACE FUNCTION app.transport_direct(p_student BIGINT, p_year BIGINT, p_route BIGINT, p_stop BIGINT) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  v_month DATE := date_trunc('month', (now() AT TIME ZONE 'Asia/Kolkata'))::date;
  v_end DATE;
  v_slab BIGINT;
  v_amount NUMERIC;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM student_transport WHERE student_id = p_student AND academic_year_id = p_year) THEN
    PERFORM app.transport_backfill();  -- first mapping: the whole session, at the slab charged now
    RETURN;
  END IF;
  SELECT date_trunc('month', end_date)::date INTO v_end FROM academic_years WHERE id = p_year;
  IF v_month > v_end THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM student_transport WHERE student_id = p_student AND academic_year_id = p_year AND status = 'active'
                AND v_month BETWEEN from_month AND to_month AND service = 'both' AND pick_route_id = p_route AND pick_stop_id IS NOT DISTINCT FROM p_stop) THEN
    RETURN;  -- nothing changed
  END IF;
  UPDATE student_transport SET status = 'cancelled' WHERE student_id = p_student AND academic_year_id = p_year AND status = 'active' AND from_month >= v_month;
  UPDATE student_transport SET to_month = (v_month - interval '1 month')::date, status = 'ended'
   WHERE student_id = p_student AND academic_year_id = p_year AND status = 'active' AND to_month >= v_month;
  SELECT sl.id, sl.monthly_amount INTO v_slab, v_amount
    FROM (SELECT 1) one
    LEFT JOIN transport_stops st ON st.id = p_stop
    LEFT JOIN transport_stoppages sg ON sg.id = st.stoppage_id
    LEFT JOIN student_fee_profiles p ON p.student_id = p_student AND p.academic_year_id = p_year
    LEFT JOIN transport_slabs sl ON sl.id = COALESCE(st.slab_id, sg.slab_id, p.transport_slab_id);
  INSERT INTO student_transport (school_id, student_id, academic_year_id, service, pick_route_id, pick_stop_id, drop_route_id, drop_stop_id,
                                 slab_id, monthly_amount, from_month, to_month, created_by)
  VALUES (app.current_school_id(), p_student, p_year, 'both', p_route, p_stop, p_route, p_stop, v_slab, COALESCE(v_amount, 0), v_month, v_end, app.current_user_id());
END
$$;

-- the office takes a pupil off the bus directly: the period ends with last month
CREATE OR REPLACE FUNCTION app.transport_direct_end(p_student BIGINT, p_year BIGINT) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  v_month DATE := date_trunc('month', (now() AT TIME ZONE 'Asia/Kolkata'))::date;
BEGIN
  UPDATE student_transport SET status = 'cancelled' WHERE student_id = p_student AND academic_year_id = p_year AND status = 'active' AND from_month >= v_month;
  UPDATE student_transport SET to_month = (v_month - interval '1 month')::date, status = 'ended'
   WHERE student_id = p_student AND academic_year_id = p_year AND status = 'active' AND to_month >= v_month;
END
$$;
