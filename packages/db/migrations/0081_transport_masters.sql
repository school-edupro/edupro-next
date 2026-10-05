-- 0081: the transport masters, aligned.
--   * crew: drivers, conductors and attendants in one master (code, role, vendor, verification);
--   * a route's stops come from the stoppage master: the stoppage owns the name, the slab and the place,
--     a stop adds the order and the pick and drop time (a stop typed by name finds or makes its stoppage);
--   * route-vehicle mapping carries the crew (driver, conductor, attendant) and keeps the route's
--     vehicle and driver (what the bus list, GPS and the dashboards read) in line;
--   * vehicles: name, model, category, PUC and registration dates, RC book, AIS device, camera and
--     tracking links, in-charge; stoppages: radial and route distance.

-- ---- crew ------------------------------------------------------------------------------------------
ALTER TABLE transport_drivers
  ADD COLUMN code               TEXT,
  ADD COLUMN role               TEXT NOT NULL DEFAULT 'driver' CHECK (role IN ('driver', 'conductor', 'attendant')),
  ADD COLUMN vendor_id          BIGINT REFERENCES transport_vendors(id),
  ADD COLUMN badge_no           TEXT,
  ADD COLUMN police_verified    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN police_verified_on DATE,
  ADD COLUMN emergency_mobile   TEXT,
  ADD COLUMN address            TEXT;

CREATE OR REPLACE FUNCTION app.transport_next_code(p_table REGCLASS, p_school BIGINT, p_prefix TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  v_n INT;
  v_code TEXT;
  v_taken BOOLEAN;
BEGIN
  EXECUTE format('SELECT count(*) FROM %s WHERE school_id = $1', p_table) INTO v_n USING p_school;
  LOOP
    v_n := v_n + 1;
    v_code := p_prefix || lpad(v_n::text, 3, '0');
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s WHERE school_id = $1 AND code = $2)', p_table) INTO v_taken USING p_school, v_code;
    EXIT WHEN NOT v_taken;
  END LOOP;
  RETURN v_code;
END
$$;

UPDATE transport_drivers d SET code = 'CR' || lpad(x.n::text, 3, '0')
  FROM (SELECT id, row_number() OVER (PARTITION BY school_id ORDER BY id) AS n FROM transport_drivers) x
 WHERE x.id = d.id AND d.code IS NULL;
CREATE UNIQUE INDEX transport_drivers_code ON transport_drivers (school_id, code);

CREATE OR REPLACE FUNCTION app.transport_crew_code() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.code IS NULL OR btrim(NEW.code) = '' THEN
    NEW.code := app.transport_next_code('transport_drivers', NEW.school_id, 'CR');
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER transport_crew_code BEFORE INSERT ON transport_drivers FOR EACH ROW EXECUTE FUNCTION app.transport_crew_code();

-- ---- vehicles and stoppages --------------------------------------------------------------------------
ALTER TABLE transport_vehicles
  ADD COLUMN name              TEXT,
  ADD COLUMN model             TEXT,
  ADD COLUMN category          TEXT,
  ADD COLUMN puc_expiry        DATE,
  ADD COLUMN registration_date DATE,
  ADD COLUMN rc_book           BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN ais_device        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN camera_url        TEXT,
  ADD COLUMN track_url         TEXT,
  ADD COLUMN incharge_id       BIGINT REFERENCES employees(id);

ALTER TABLE transport_stoppages
  ADD COLUMN radial_km NUMERIC(6, 2) CHECK (radial_km IS NULL OR radial_km >= 0),
  ADD COLUMN route_km  NUMERIC(6, 2) CHECK (route_km IS NULL OR route_km >= 0);

-- ---- a stop is a stoppage on a route ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.transport_stop_stoppage() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  g transport_stoppages%ROWTYPE;
BEGIN
  -- a stop typed (or renamed) by name picks the stoppage of that name, or makes it
  IF TG_OP = 'UPDATE' AND NEW.name IS DISTINCT FROM OLD.name AND NEW.stoppage_id IS NOT DISTINCT FROM OLD.stoppage_id THEN
    NEW.stoppage_id := NULL;
  END IF;
  IF NEW.stoppage_id IS NULL THEN
    SELECT id INTO NEW.stoppage_id FROM transport_stoppages
     WHERE school_id = NEW.school_id AND lower(btrim(name)) = lower(btrim(NEW.name)) ORDER BY id LIMIT 1;
    IF NEW.stoppage_id IS NULL THEN
      INSERT INTO transport_stoppages (school_id, code, name, slab_id, lat, lng)
      VALUES (NEW.school_id, app.transport_next_code('transport_stoppages', NEW.school_id, 'ST'), btrim(NEW.name), NEW.slab_id, NEW.lat, NEW.lng)
      RETURNING id INTO NEW.stoppage_id;
    END IF;
  END IF;
  SELECT * INTO g FROM transport_stoppages WHERE id = NEW.stoppage_id;
  -- what the stoppage does not know yet, it learns from the stop
  IF (g.slab_id IS NULL AND NEW.slab_id IS NOT NULL) OR (g.lat IS NULL AND NEW.lat IS NOT NULL) THEN
    UPDATE transport_stoppages SET slab_id = COALESCE(slab_id, NEW.slab_id), lat = COALESCE(lat, NEW.lat), lng = COALESCE(lng, NEW.lng)
     WHERE id = g.id RETURNING * INTO g;
  END IF;
  NEW.name := g.name;
  NEW.slab_id := g.slab_id;
  NEW.lat := g.lat;
  NEW.lng := g.lng;
  RETURN NEW;
END
$$;
CREATE TRIGGER transport_stop_stoppage BEFORE INSERT OR UPDATE ON transport_stops FOR EACH ROW EXECUTE FUNCTION app.transport_stop_stoppage();

-- the stops on record get their stoppage (one per name in a school)
UPDATE transport_stops SET sequence = sequence WHERE stoppage_id IS NULL;

CREATE OR REPLACE FUNCTION app.transport_stoppage_changed() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.name, NEW.slab_id, NEW.lat, NEW.lng) IS DISTINCT FROM (OLD.name, OLD.slab_id, OLD.lat, OLD.lng) THEN
    UPDATE transport_stops SET name = NEW.name, slab_id = NEW.slab_id, lat = NEW.lat, lng = NEW.lng, stoppage_id = NEW.id
     WHERE stoppage_id = NEW.id;
    UPDATE student_route_assignments a SET stop_name = NEW.name
      FROM transport_stops st WHERE st.stoppage_id = NEW.id AND a.stop_id = st.id AND a.stop_name IS DISTINCT FROM NEW.name;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER transport_stoppage_changed AFTER UPDATE ON transport_stoppages FOR EACH ROW EXECUTE FUNCTION app.transport_stoppage_changed();

-- ---- route-vehicle mapping carries the crew ------------------------------------------------------------
ALTER TABLE transport_route_vehicles
  ADD COLUMN conductor_id BIGINT REFERENCES transport_drivers(id),
  ADD COLUMN attendant_id BIGINT REFERENCES transport_drivers(id),
  ADD CONSTRAINT transport_route_vehicles_dates CHECK (to_date IS NULL OR from_date IS NULL OR to_date >= from_date);

CREATE OR REPLACE FUNCTION app.transport_route_crew() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  m RECORD;
  v_today DATE := (now() AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
  SELECT rv.vehicle_id, rv.driver_id, v.reg_no, d.name AS driver, d.mobile AS driver_mobile, k.name AS conductor, k.mobile AS conductor_mobile INTO m
    FROM transport_route_vehicles rv
    JOIN transport_vehicles v ON v.id = rv.vehicle_id
    LEFT JOIN transport_drivers d ON d.id = rv.driver_id
    LEFT JOIN transport_drivers k ON k.id = rv.conductor_id
   WHERE rv.route_id = NEW.route_id AND rv.status = 'active'
     AND (rv.from_date IS NULL OR rv.from_date <= v_today) AND (rv.to_date IS NULL OR rv.to_date >= v_today)
   ORDER BY (rv.shift = 'both') DESC, (rv.shift = 'pick') DESC, rv.id DESC LIMIT 1;
  IF FOUND THEN
    UPDATE transport_routes SET vehicle_id = m.vehicle_id, driver_id = m.driver_id, vehicle_no = m.reg_no, driver_name = m.driver,
           driver_mobile = m.driver_mobile, conductor_name = m.conductor, conductor_mobile = m.conductor_mobile
     WHERE id = NEW.route_id;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER transport_route_crew AFTER INSERT OR UPDATE ON transport_route_vehicles FOR EACH ROW EXECUTE FUNCTION app.transport_route_crew();

-- routes that already have a vehicle get their mapping row, so nothing is lost when the route master
-- stops carrying the vehicle and the driver itself
INSERT INTO transport_route_vehicles (school_id, route_id, vehicle_id, driver_id, shift)
SELECT r.school_id, r.id, r.vehicle_id, r.driver_id, 'both' FROM transport_routes r
 WHERE r.vehicle_id IS NOT NULL AND r.deleted_at IS NULL
   AND NOT EXISTS (SELECT 1 FROM transport_route_vehicles x WHERE x.route_id = r.id)
ON CONFLICT DO NOTHING;
