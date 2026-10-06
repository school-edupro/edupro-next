-- 0085: the bus of a route follows the dates of its mapping.
-- The route carries today's bus and crew (the parent's live bus, the rolls and the lists read it), but it
-- was only written when a mapping was saved: a mapping that starts on a later date never took the route
-- on that date, and one that ended stayed. Now the route is brought in line whenever it is asked for.

CREATE OR REPLACE FUNCTION app.transport_routes_sync() RETURNS INT LANGUAGE plpgsql AS $$
DECLARE
  v_today DATE := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_n INT;
BEGIN
  WITH today AS (
    SELECT DISTINCT ON (rv.route_id) rv.route_id, rv.vehicle_id, rv.driver_id, v.reg_no, d.name AS driver, d.mobile AS driver_mobile,
           k.name AS conductor, k.mobile AS conductor_mobile
      FROM transport_route_vehicles rv
      JOIN transport_vehicles v ON v.id = rv.vehicle_id AND v.deleted_at IS NULL
      LEFT JOIN transport_drivers d ON d.id = rv.driver_id
      LEFT JOIN transport_drivers k ON k.id = rv.conductor_id
     WHERE rv.status = 'active'
       AND (rv.from_date IS NULL OR rv.from_date <= v_today) AND (rv.to_date IS NULL OR rv.to_date >= v_today)
     ORDER BY rv.route_id, (rv.shift = 'both') DESC, (rv.shift = 'pick') DESC, rv.id DESC
  ), want AS (
    -- a route with no mapping row at all keeps what it has
    SELECT r.id, t.vehicle_id, t.driver_id, t.reg_no, t.driver, t.driver_mobile, t.conductor, t.conductor_mobile
      FROM transport_routes r LEFT JOIN today t ON t.route_id = r.id
     WHERE r.deleted_at IS NULL
       AND (t.route_id IS NOT NULL OR EXISTS (SELECT 1 FROM transport_route_vehicles x WHERE x.route_id = r.id))
  )
  UPDATE transport_routes r
     SET vehicle_id = w.vehicle_id, driver_id = w.driver_id, vehicle_no = w.reg_no, driver_name = w.driver,
         driver_mobile = w.driver_mobile, conductor_name = w.conductor, conductor_mobile = w.conductor_mobile
    FROM want w
   WHERE r.id = w.id
     AND (r.vehicle_id IS DISTINCT FROM w.vehicle_id OR r.driver_id IS DISTINCT FROM w.driver_id OR r.vehicle_no IS DISTINCT FROM w.reg_no
       OR r.driver_name IS DISTINCT FROM w.driver OR r.driver_mobile IS DISTINCT FROM w.driver_mobile
       OR r.conductor_name IS DISTINCT FROM w.conductor OR r.conductor_mobile IS DISTINCT FROM w.conductor_mobile);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END
$$;

-- saving or removing a mapping brings the routes in line at once
CREATE OR REPLACE FUNCTION app.transport_route_crew() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM app.transport_routes_sync();
  RETURN NULL;
END
$$;
DROP TRIGGER transport_route_crew ON transport_route_vehicles;
CREATE TRIGGER transport_route_crew AFTER INSERT OR UPDATE OR DELETE ON transport_route_vehicles
  FOR EACH STATEMENT EXECUTE FUNCTION app.transport_route_crew();

-- the tick the transport pages run also brings the routes in line with today's mappings
CREATE OR REPLACE FUNCTION app.transport_tick() RETURNS INT LANGUAGE plpgsql AS $$
DECLARE
  r RECORD;
  v_n INT := 0;
  v_today DATE := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_month DATE := date_trunc('month', (now() AT TIME ZONE 'Asia/Kolkata'))::date;
BEGIN
  PERFORM app.transport_routes_sync();
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

SELECT app.transport_routes_sync();
