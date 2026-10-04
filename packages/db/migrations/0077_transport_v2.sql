-- 0077: transport v2.
--   * masters: vehicle types, vendors, the stoppage master (each stoppage carries its fee slab), the
--     route-vehicle mapping; vehicles get a type and a vendor; a route stop points at its stoppage;
--   * a request says how the pupil rides (pick, drop, or both), from which stop(s) and for which months;
--     the monthly amount is worked out from the stop's slab by the school's rule;
--   * approval is the school's own: a family's request goes to the transport in-charge and then the fee
--     department; one the transport office makes goes to the fee department only (levels can be changed);
--   * the final approval writes a period (student_transport = the history), updates the fees for exactly
--     those months, and maps the pupil to the bus for as long as the period runs.

INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('transport.request.apply', 'transport', 'Apply for transport on behalf of a pupil (transport office)', false),
  ('transport.setup.manage', 'transport', 'Transport settings: charge rule and approval levels', false)
ON CONFLICT (code) DO NOTHING;

INSERT INTO roles (school_id, code, name, kind, is_system, description) VALUES
  (NULL, 'transport_incharge', 'Transport In-charge', 'module', true,
   'Transport: routes, stoppages, vehicles, drivers, requests (first approval), applying for a pupil, history, dashboard')
ON CONFLICT (school_id, code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r
  CROSS JOIN (VALUES ('transport.route.view'), ('transport.route.manage'), ('transport.fleet.view'), ('transport.fleet.manage'),
                     ('transport.request.view'), ('transport.request.decide'), ('transport.request.apply'), ('transport.log.view'),
                     ('transport.log.manage'), ('transport.gps.view')) AS p(code)
 WHERE r.school_id IS NULL AND r.code = 'transport_incharge'
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r
  CROSS JOIN (VALUES ('transport.request.apply'), ('transport.setup.manage')) AS p(code)
 WHERE r.school_id IS NULL AND r.code IN ('group_admin', 'school_admin')
ON CONFLICT DO NOTHING;
-- the fee department reads the requests it approves
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'transport.request.view' FROM roles r WHERE r.school_id IS NULL AND r.code = 'accountant'
ON CONFLICT DO NOTHING;

-- ---- masters ---------------------------------------------------------------------------------------
CREATE TABLE transport_vehicle_types (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  code        TEXT NOT NULL,
  name        TEXT NOT NULL,
  seats       INT CHECK (seats IS NULL OR seats > 0),
  status      row_status NOT NULL DEFAULT 'active',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  BIGINT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  BIGINT,
  UNIQUE (school_id, code)
);
CALL app.apply_tenant_rls('transport_vehicle_types');

CREATE TABLE transport_vendors (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id       BIGINT NOT NULL REFERENCES schools(id),
  code            TEXT NOT NULL,
  name            TEXT NOT NULL,
  contact_person  TEXT,
  mobile          TEXT,
  email           TEXT,
  address         TEXT,
  gst_no          TEXT,
  status          row_status NOT NULL DEFAULT 'active',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      BIGINT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by      BIGINT,
  UNIQUE (school_id, code)
);
CALL app.apply_tenant_rls('transport_vendors');

-- the stoppage master: a place, the area it serves and the fee slab it falls in
CREATE TABLE transport_stoppages (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  code        TEXT NOT NULL,
  name        TEXT NOT NULL,
  area        TEXT,
  slab_id     BIGINT REFERENCES transport_slabs(id),
  lat         NUMERIC(9, 6) CHECK (lat IS NULL OR (lat BETWEEN -90 AND 90)),
  lng         NUMERIC(9, 6) CHECK (lng IS NULL OR (lng BETWEEN -180 AND 180)),
  status      row_status NOT NULL DEFAULT 'active',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  BIGINT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  BIGINT,
  UNIQUE (school_id, code)
);
CALL app.apply_tenant_rls('transport_stoppages');

ALTER TABLE transport_stops ADD COLUMN stoppage_id BIGINT REFERENCES transport_stoppages(id);
ALTER TABLE transport_vehicles
  ADD COLUMN vehicle_type_id BIGINT REFERENCES transport_vehicle_types(id),
  ADD COLUMN vendor_id       BIGINT REFERENCES transport_vendors(id);

-- which vehicle (and driver) runs a route, for the pick trip, the drop trip or both, and since when
CREATE TABLE transport_route_vehicles (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  route_id    BIGINT NOT NULL REFERENCES transport_routes(id),
  vehicle_id  BIGINT NOT NULL REFERENCES transport_vehicles(id),
  driver_id   BIGINT REFERENCES transport_drivers(id),
  shift       TEXT NOT NULL DEFAULT 'both' CHECK (shift IN ('both', 'pick', 'drop')),
  from_date   DATE,
  to_date     DATE,
  status      row_status NOT NULL DEFAULT 'active',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  BIGINT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  BIGINT,
  UNIQUE (route_id, vehicle_id, shift)
);
CALL app.apply_tenant_rls('transport_route_vehicles');

-- ---- settings and approval levels ------------------------------------------------------------------
CREATE TABLE transport_settings (
  school_id         BIGINT PRIMARY KEY REFERENCES schools(id),
  -- one way (pick only or drop only) is charged at this share of the stop's slab
  one_way_percent   NUMERIC(5, 2) NOT NULL DEFAULT 100 CHECK (one_way_percent BETWEEN 0 AND 100),
  -- pick and drop on different stops: the higher slab, the pick slab, or both one-way charges added
  two_stop_rule     TEXT NOT NULL DEFAULT 'higher' CHECK (two_stop_rule IN ('higher', 'pick', 'sum')),
  parent_can_apply  BOOLEAN NOT NULL DEFAULT true,
  notify_email      BOOLEAN NOT NULL DEFAULT true,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by        BIGINT
);
CALL app.apply_tenant_rls('transport_settings');

-- who approves, in order, for a request from a family ('parent') and one made by the office ('office')
CREATE TABLE transport_approval_levels (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  source       TEXT NOT NULL CHECK (source IN ('parent', 'office')),
  seq          INT NOT NULL,
  label        TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('role', 'designation', 'employee')),
  role_code    TEXT,
  designation  TEXT,
  employee_id  BIGINT REFERENCES employees(id),
  active       BOOLEAN NOT NULL DEFAULT true
);
CREATE INDEX transport_approval_levels_by_school ON transport_approval_levels (school_id, source, seq);
CALL app.apply_tenant_rls('transport_approval_levels');

-- ---- requests ---------------------------------------------------------------------------------------
ALTER TABLE transport_requests
  ADD COLUMN number          TEXT,
  ADD COLUMN source          TEXT NOT NULL DEFAULT 'parent' CHECK (source IN ('parent', 'office')),
  ADD COLUMN service         TEXT CHECK (service IN ('pick', 'drop', 'both')),
  ADD COLUMN pick_route_id   BIGINT REFERENCES transport_routes(id),
  ADD COLUMN pick_stop_id    BIGINT REFERENCES transport_stops(id),
  ADD COLUMN drop_route_id   BIGINT REFERENCES transport_routes(id),
  ADD COLUMN drop_stop_id    BIGINT REFERENCES transport_stops(id),
  ADD COLUMN slab_id         BIGINT REFERENCES transport_slabs(id),
  ADD COLUMN monthly_amount  NUMERIC(12, 2),
  -- the first month the change applies to and the last month it runs (first day of each month)
  ADD COLUMN from_month      DATE,
  ADD COLUMN to_month        DATE,
  ADD COLUMN fee_note        TEXT;
UPDATE transport_requests SET service = 'both', pick_route_id = route_id, pick_stop_id = stop_id, drop_route_id = route_id, drop_stop_id = stop_id
 WHERE kind <> 'leave' AND service IS NULL;
UPDATE transport_requests SET number = 'TR-' || to_char(requested_at, 'YYMM') || '-' || lpad(id::text, 4, '0') WHERE number IS NULL;

CREATE TABLE transport_request_approvals (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id          BIGINT NOT NULL REFERENCES schools(id),
  request_id         BIGINT NOT NULL REFERENCES transport_requests(id) ON DELETE CASCADE,
  seq                INT NOT NULL,
  label              TEXT NOT NULL,
  approver_user_ids  BIGINT[] NOT NULL DEFAULT '{}',
  status             TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'pending', 'approved', 'rejected', 'skipped')),
  acted_by           BIGINT,
  acted_at           TIMESTAMPTZ,
  note               TEXT,
  UNIQUE (request_id, seq)
);
CREATE INDEX transport_request_approvals_inbox ON transport_request_approvals USING gin (approver_user_ids) WHERE status = 'pending';
CALL app.apply_tenant_rls('transport_request_approvals');

-- ---- the history: one row per stretch of months a pupil rides in one way -----------------------------
CREATE TABLE student_transport (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id         BIGINT NOT NULL REFERENCES schools(id),
  student_id        BIGINT NOT NULL REFERENCES students(id),
  academic_year_id  BIGINT NOT NULL REFERENCES academic_years(id),
  request_id        BIGINT REFERENCES transport_requests(id),
  service           TEXT NOT NULL CHECK (service IN ('pick', 'drop', 'both')),
  pick_route_id     BIGINT REFERENCES transport_routes(id),
  pick_stop_id      BIGINT REFERENCES transport_stops(id),
  drop_route_id     BIGINT REFERENCES transport_routes(id),
  drop_stop_id      BIGINT REFERENCES transport_stops(id),
  slab_id           BIGINT REFERENCES transport_slabs(id),
  monthly_amount    NUMERIC(12, 2) NOT NULL DEFAULT 0,
  from_month        DATE NOT NULL,
  to_month          DATE NOT NULL,
  -- active (runs or will run), ended (cut short by a change or a withdrawal), cancelled (never ran)
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended', 'cancelled')),
  ended_by_request  BIGINT REFERENCES transport_requests(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by        BIGINT,
  CHECK (to_month >= from_month)
);
CREATE INDEX student_transport_by_student ON student_transport (student_id, academic_year_id, from_month);
CREATE INDEX student_transport_by_route ON student_transport (school_id, pick_route_id, drop_route_id);
CALL app.apply_tenant_rls('student_transport');

-- the mapping the buses, GPS and the portal read: valid only while the period runs
ALTER TABLE student_route_assignments
  ADD COLUMN service        TEXT,
  ADD COLUMN drop_route_id  BIGINT REFERENCES transport_routes(id),
  ADD COLUMN drop_stop_id   BIGINT REFERENCES transport_stops(id),
  ADD COLUMN valid_from     DATE,
  ADD COLUMN valid_to       DATE;

-- puts the bus mapping of one pupil in line with the period that covers today (or removes it)
CREATE OR REPLACE FUNCTION app.transport_sync(p_student BIGINT, p_year BIGINT) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  t RECORD;
  v_today DATE := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_month DATE := date_trunc('month', (now() AT TIME ZONE 'Asia/Kolkata'))::date;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM student_transport WHERE student_id = p_student AND academic_year_id = p_year) THEN
    RETURN;  -- a pupil mapped the old way (no history) is left alone
  END IF;
  SELECT st.*, COALESCE(st.pick_route_id, st.drop_route_id) AS route, COALESCE(st.pick_stop_id, st.drop_stop_id) AS stop INTO t
    FROM student_transport st
   WHERE st.student_id = p_student AND st.academic_year_id = p_year AND st.status IN ('active', 'ended') AND v_month BETWEEN st.from_month AND st.to_month
   ORDER BY st.id DESC LIMIT 1;
  IF NOT FOUND THEN
    DELETE FROM student_route_assignments WHERE student_id = p_student AND academic_year_id = p_year;
    RETURN;
  END IF;
  INSERT INTO student_route_assignments (school_id, student_id, route_id, academic_year_id, stop_id, stop_name, pickup_time, drop_time, created_by,
                                         service, drop_route_id, drop_stop_id, valid_from, valid_to)
  SELECT t.school_id, p_student, t.route, p_year, t.stop, s.name,
         CASE WHEN t.service IN ('pick', 'both') THEN ps.pickup_time END,
         CASE WHEN t.service IN ('drop', 'both') THEN COALESCE(ds.drop_time, ps.drop_time) END,
         t.created_by, t.service, t.drop_route_id, t.drop_stop_id, t.from_month, (t.to_month + interval '1 month' - interval '1 day')::date
    FROM (SELECT 1) one
    LEFT JOIN transport_stops s ON s.id = t.stop
    LEFT JOIN transport_stops ps ON ps.id = t.pick_stop_id
    LEFT JOIN transport_stops ds ON ds.id = t.drop_stop_id
  ON CONFLICT (student_id, academic_year_id) DO UPDATE SET route_id = EXCLUDED.route_id, stop_id = EXCLUDED.stop_id, stop_name = EXCLUDED.stop_name,
       pickup_time = EXCLUDED.pickup_time, drop_time = EXCLUDED.drop_time, service = EXCLUDED.service, drop_route_id = EXCLUDED.drop_route_id,
       drop_stop_id = EXCLUDED.drop_stop_id, valid_from = EXCLUDED.valid_from, valid_to = EXCLUDED.valid_to;
END
$$;

-- every month end and start: pupils whose period ended lose the mapping, those whose period begins get it
CREATE OR REPLACE FUNCTION app.transport_tick() RETURNS INT LANGUAGE plpgsql AS $$
DECLARE
  r RECORD;
  v_n INT := 0;
  v_today DATE := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_month DATE := date_trunc('month', (now() AT TIME ZONE 'Asia/Kolkata'))::date;
BEGIN
  FOR r IN
    SELECT DISTINCT st.student_id, st.academic_year_id FROM student_transport st
      LEFT JOIN student_route_assignments a ON a.student_id = st.student_id AND a.academic_year_id = st.academic_year_id
     WHERE st.status IN ('active', 'ended')
       AND ((a.id IS NOT NULL AND a.valid_to IS NOT NULL AND a.valid_to < v_today)
         OR (a.id IS NULL AND v_month BETWEEN st.from_month AND st.to_month)
         OR (a.id IS NOT NULL AND v_month BETWEEN st.from_month AND st.to_month AND a.valid_from IS DISTINCT FROM st.from_month))
  LOOP
    PERFORM app.transport_sync(r.student_id, r.academic_year_id);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END
$$;

-- transport fees follow the periods: a month is charged what the period covering it says; a pupil with
-- no period at all keeps the old rule (the slab on the fee profile, every month)
DO $$
DECLARE
  v_def text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'app' AND p.proname = 'generate_fee_demand';
  v_new := replace(v_def,
    'SELECT monthly_amount INTO v_gross FROM transport_slabs WHERE id = v_profile.transport_slab_id;',
    'SELECT CASE WHEN EXISTS (SELECT 1 FROM student_transport x WHERE x.student_id = p_student_id AND x.academic_year_id = p_academic_year_id AND x.status <> ''cancelled'')
                 THEN (SELECT x.monthly_amount FROM student_transport x
                        WHERE x.student_id = p_student_id AND x.academic_year_id = p_academic_year_id AND x.status <> ''cancelled''
                          AND make_date(p.year, p.month, 1) BETWEEN x.from_month AND x.to_month ORDER BY x.id DESC LIMIT 1)
                 ELSE (SELECT monthly_amount FROM transport_slabs WHERE id = v_profile.transport_slab_id) END INTO v_gross;
      IF v_gross IS NULL THEN CONTINUE; END IF;');
  IF v_new = v_def THEN
    RAISE EXCEPTION 'app.generate_fee_demand: the transport amount line was not found';
  END IF;
  EXECUTE v_new;
END $$;

-- SMS / WhatsApp templates of the module (email keeps its built-in design)
CREATE OR REPLACE FUNCTION app.transport_seed_templates(p_school BIGINT) RETURNS VOID LANGUAGE sql AS $$
  INSERT INTO comms_templates (school_id, code, channel, name, subject, body, variables, category)
  SELECT p_school, t.code, ch.channel::comms_channel, t.name, NULL, t.body, t.variables::jsonb, 'service'
    FROM (VALUES
      ('transport_to_approve', 'Transport: waiting for your approval',
       'Transport request {{number}} for {{who}} ({{what}}) is waiting for your approval as {{level}}. Open EduPro to decide. - {{school}}',
       '["number","who","what","level","school"]'),
      ('transport_approved', 'Transport: request approved',
       'Transport request {{number}} for {{who}} is approved: {{what}} from {{from}}. Monthly charge Rs {{amount}}. - {{school}}',
       '["number","who","what","from","amount","school"]'),
      ('transport_rejected', 'Transport: request not approved',
       'Transport request {{number}} for {{who}} was not approved. {{reason}} - {{school}}',
       '["number","who","reason","school"]')
    ) AS t(code, name, body, variables)
    CROSS JOIN (VALUES ('sms'), ('whatsapp')) AS ch(channel)
  ON CONFLICT (school_id, code, channel) DO NOTHING
$$;
CREATE OR REPLACE FUNCTION app.module_seed_templates(p_code TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF p_code LIKE 'gate\_pass\_%' THEN PERFORM app.gate_pass_seed_templates(app.current_school_id());
  ELSIF p_code LIKE 'helpdesk\_%' THEN PERFORM app.helpdesk_seed_templates(app.current_school_id());
  ELSIF p_code LIKE 'clinic\_%' THEN PERFORM app.clinic_seed_templates(app.current_school_id());
  ELSIF p_code LIKE 'transport\_%' THEN PERFORM app.transport_seed_templates(app.current_school_id());
  END IF;
END
$$;

-- requests keep their own approval levels from here on
UPDATE workflow_definitions SET status = 'inactive', updated_at = now() WHERE code = 'transport_request' AND status = 'active';
