-- 0353: staff leave & attendance reports (docs/design/85, phase D). The school's earlier MIS kept: every
-- report for those with the reports right, a report given to named people on its own, and a "Not
-- required" list of staff left out of the reports and the dashboard (not when one of them is picked).

-- ---- rights ----------------------------------------------------------------------------------------------
INSERT INTO permissions (code, module, description) VALUES
  ('leave.report.view', 'leave', 'Open every staff leave and attendance report and the dashboard')
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'leave.report.view' FROM roles r
 WHERE r.school_id IS NULL AND r.code IN ('group_admin', 'school_admin', 'leave_office', 'principal', 'vice_principal', 'hr')
ON CONFLICT DO NOTHING;

-- ---- staff left out of the reports ("Not required") -----------------------------------------------------
CREATE TABLE staff_report_exclusions (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  employee_id BIGINT NOT NULL REFERENCES employees(id),
  reason      TEXT CHECK (reason IS NULL OR length(reason) <= 200),
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  created_by  BIGINT REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CALL app.apply_tenant_rls('staff_report_exclusions');
CREATE UNIQUE INDEX staff_report_exclusions_live ON staff_report_exclusions (employee_id) WHERE status = 'active';
CREATE TRIGGER staff_report_exclusions_audit AFTER INSERT OR UPDATE OR DELETE ON staff_report_exclusions
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

-- ---- a report given to a person (without the reports right) ---------------------------------------------
CREATE TABLE staff_report_access (
  school_id  BIGINT NOT NULL REFERENCES schools(id),
  report     TEXT NOT NULL CHECK (report ~ '^[a-z_]{3,40}$'),
  user_id    BIGINT NOT NULL REFERENCES users(id),
  granted_by BIGINT REFERENCES users(id),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (school_id, report, user_id)
);
CALL app.apply_tenant_rls('staff_report_access');
CREATE TRIGGER staff_report_access_audit AFTER INSERT OR UPDATE OR DELETE ON staff_report_access
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

-- ---- the days the reports read ---------------------------------------------------------------------------
-- Every day of the range for each employee given: the worked-out day; a past day nothing was worked out for
-- is a weekly off or holiday by the calendar, else not marked (NULL — never counted absent, as the
-- attendance register shows it); before joining, today and later days not worked out are NULL too.
-- present: what the day counts as present (P 1, HD 0.5, leave counted as present 1, half a day of leave
-- the worked half 0.5); leave: the days of paid leave, lop: of loss of pay.
CREATE OR REPLACE FUNCTION app.staff_report_days(p_emps BIGINT[], p_from DATE, p_to DATE)
RETURNS TABLE (employee_id BIGINT, day DATE, day_type TEXT, marked BOOLEAN, joined BOOLEAN, leave_code TEXT,
               loss_of_pay BOOLEAN, portion NUMERIC, present NUMERIC, leave NUMERIC, lop NUMERIC,
               in_at TIMESTAMPTZ, out_at TIMESTAMPTZ, worked NUMERIC, late INT, early INT, manual BOOLEAN,
               missing TEXT, shift TEXT, shift_end TEXT, remark TEXT)
LANGUAGE sql STABLE AS $$
  WITH d AS (
    SELECT e.id AS emp, e.joined_on, g::date AS day
      FROM employees e CROSS JOIN generate_series(p_from, p_to, interval '1 day') g
     WHERE e.id = ANY(p_emps)
  ), x AS (
    SELECT d.emp, d.day, d.joined_on IS NULL OR d.day >= d.joined_on AS joined, a.id, a.leave_portion, a.in_at,
           a.out_at, a.worked_hours, a.late_minutes, a.early_minutes, a.manual, a.shift_id, a.trace, a.remark, t.code AS tcode,
           COALESCE(t.loss_of_pay, false) AS tlop, COALESCE(t.counts_present, false) AS tpresent,
           CASE WHEN a.id IS NOT NULL THEN a.day_type
                WHEN d.joined_on IS NOT NULL AND d.day < d.joined_on THEN NULL
                WHEN d.day >= (now() AT TIME ZONE 'Asia/Kolkata')::date THEN NULL
                WHEN app.staff_is_weekoff(d.emp, d.day) THEN 'WO'
                WHEN app.staff_is_holiday(d.emp, d.day, false) THEN 'H'
           END AS kind
      FROM d
      LEFT JOIN staff_attendance_days a ON a.employee_id = d.emp AND a.day = d.day
      LEFT JOIN staff_leave_types t ON t.id = a.leave_type_id
  )
  SELECT x.emp, x.day, x.kind, x.id IS NOT NULL, x.joined, x.tcode, x.tlop, x.leave_portion,
         CASE x.kind WHEN 'P' THEN 1 WHEN 'HD' THEN 0.5
                     WHEN 'LV' THEN CASE WHEN x.tpresent THEN 1 ELSE 1 - COALESCE(x.leave_portion, 1) END
                     ELSE 0 END::numeric,
         CASE WHEN x.kind = 'LV' AND NOT x.tlop AND NOT x.tpresent THEN COALESCE(x.leave_portion, 1) ELSE 0 END::numeric,
         CASE WHEN x.kind = 'LV' AND x.tlop THEN COALESCE(x.leave_portion, 1) ELSE 0 END::numeric,
         x.in_at, x.out_at, x.worked_hours, COALESCE(x.late_minutes, 0), COALESCE(x.early_minutes, 0), COALESCE(x.manual, false),
         (SELECT m.missing FROM staff_missing_punches m WHERE m.employee_id = x.emp AND m.day = x.day
             AND m.status IN ('pending', 'used') LIMIT 1),
         COALESCE((SELECT s.code FROM staff_shifts s WHERE s.id = x.shift_id), x.trace ->> 'shift'),
         x.trace ->> 'end', x.remark
    FROM x
$$;
