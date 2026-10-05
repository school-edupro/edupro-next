-- 0082: transport in-charges and replacement buses.
--   * the school names its transport in-charge(s), and may name another per route: a request of a route
--     waits on that route's in-charge, and the family sees who to call;
--   * when a vehicle is off the road (breakdown, maintenance) the in-charge maps a replacement vehicle
--     and crew for some days: every route the vehicle runs follows the replacement for those days (live
--     tracking in the parent portal too), the parents are told, and are told again when it is over.

INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('transport.replacement.manage', 'transport', 'Arrange a replacement bus for a vehicle that is off the road', false)
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'transport.replacement.manage' FROM roles r
 WHERE r.school_id IS NULL AND r.code IN ('group_admin', 'school_admin', 'transport_incharge')
ON CONFLICT DO NOTHING;

CREATE TABLE transport_incharges (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  -- NULL = in-charge of the whole school's transport
  route_id     BIGINT REFERENCES transport_routes(id) ON DELETE CASCADE,
  employee_id  BIGINT NOT NULL REFERENCES employees(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by   BIGINT
);
CREATE UNIQUE INDEX transport_incharges_one ON transport_incharges (school_id, COALESCE(route_id, 0), employee_id);
CALL app.apply_tenant_rls('transport_incharges');

-- an approval level may be "the in-charge of the request's route"
ALTER TABLE transport_approval_levels DROP CONSTRAINT IF EXISTS transport_approval_levels_kind_check;
ALTER TABLE transport_approval_levels
  ADD CONSTRAINT transport_approval_levels_kind_check CHECK (kind IN ('role', 'designation', 'employee', 'route_incharge'));
UPDATE transport_approval_levels SET kind = 'route_incharge', role_code = NULL
 WHERE kind = 'role' AND role_code = 'transport_incharge';

CREATE TABLE transport_replacements (
  id                      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id               BIGINT NOT NULL REFERENCES schools(id),
  number                  TEXT,
  vehicle_id              BIGINT NOT NULL REFERENCES transport_vehicles(id),
  replacement_vehicle_id  BIGINT NOT NULL REFERENCES transport_vehicles(id),
  driver_id               BIGINT REFERENCES transport_drivers(id),
  conductor_id            BIGINT REFERENCES transport_drivers(id),
  attendant_id            BIGINT REFERENCES transport_drivers(id),
  from_date               DATE NOT NULL,
  to_date                 DATE NOT NULL,
  reason                  TEXT NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  notified                INT NOT NULL DEFAULT 0,
  notified_at             TIMESTAMPTZ,
  back_notified_at        TIMESTAMPTZ,
  ended_note              TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by              BIGINT,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by              BIGINT,
  request_id              UUID,
  CHECK (to_date >= from_date),
  CHECK (replacement_vehicle_id <> vehicle_id)
);
CREATE INDEX transport_replacements_by_vehicle ON transport_replacements (vehicle_id, from_date, to_date);
CALL app.apply_tenant_rls('transport_replacements');

-- the vehicle that runs in a vehicle's place today (itself when nothing is arranged)
CREATE OR REPLACE FUNCTION app.transport_vehicle_today(p_vehicle BIGINT) RETURNS BIGINT LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT x.replacement_vehicle_id FROM transport_replacements x
                    WHERE x.vehicle_id = p_vehicle AND x.status = 'active'
                      AND (now() AT TIME ZONE 'Asia/Kolkata')::date BETWEEN x.from_date AND x.to_date
                    ORDER BY x.id DESC LIMIT 1), p_vehicle)
$$;

-- SMS / WhatsApp templates (email keeps its built-in design)
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
       '["number","who","reason","school"]'),
      ('transport_replacement', 'Transport: replacement bus',
       'Route {{route}}: bus {{regular}} is off the road from {{from}} to {{to}}. Replacement bus {{bus}}, driver {{driver}} {{mobile}}. Live tracking in the parent app follows it. - {{school}}',
       '["route","regular","bus","driver","mobile","from","to","school"]'),
      ('transport_replacement_over', 'Transport: regular bus is back',
       'Route {{route}}: the regular bus {{regular}} is back from {{from}}. - {{school}}',
       '["route","regular","from","school"]')
    ) AS t(code, name, body, variables)
    CROSS JOIN (VALUES ('sms'), ('whatsapp')) AS ch(channel)
  ON CONFLICT (school_id, code, channel) DO NOTHING
$$;
