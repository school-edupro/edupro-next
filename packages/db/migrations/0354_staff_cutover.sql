-- 0354: moving from the earlier leave module (docs/design/85, phase E). The workers read the old database
-- (read only, the server's connection) into a staging area; the cut-over page previews, then brings the
-- set-up, the balances (to the month before the parallel month) and this year's history; during the
-- parallel month the old leave is brought in again and the two systems compared; on the switch the leave
-- and corrections still waiting come in waiting at the first level.

-- ---- the cut-over of a school ----------------------------------------------------------------------------
CREATE TABLE staff_cutover (
  school_id         BIGINT PRIMARY KEY REFERENCES schools(id),
  -- the month both systems run: balances come to the month before it, history up to it
  parallel_month    DATE CHECK (parallel_month IS NULL OR extract(day FROM parallel_month) = 1),
  -- approvals stop in the old module on this day; the switch comes after it
  freeze_on         DATE,
  status            TEXT NOT NULL DEFAULT 'setup' CHECK (status IN ('setup', 'parallel', 'switched')),
  read_requested_at TIMESTAMPTZ,
  read_started_at   TIMESTAMPTZ,
  read_at           TIMESTAMPTZ,
  read_error        TEXT CHECK (read_error IS NULL OR length(read_error) <= 500),
  read_counts       JSONB NOT NULL DEFAULT '{}',
  -- each step: when it ran, by whom, what came
  steps             JSONB NOT NULL DEFAULT '{}',
  switched_at       TIMESTAMPTZ,
  switched_by       BIGINT REFERENCES users(id),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CALL app.apply_tenant_rls('staff_cutover');
CREATE TRIGGER staff_cutover_audit AFTER INSERT OR UPDATE OR DELETE ON staff_cutover
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

-- the old module's rows as read (one row a table row; the payload as the old database has it)
CREATE TABLE staff_legacy_rows (
  school_id BIGINT NOT NULL REFERENCES schools(id),
  tbl       TEXT NOT NULL CHECK (tbl ~ '^[a-z_]{3,40}$'),
  legacy_id TEXT NOT NULL CHECK (length(legacy_id) BETWEEN 1 AND 200),
  payload   JSONB NOT NULL,
  read_id   BIGINT NOT NULL,
  PRIMARY KEY (school_id, tbl, legacy_id)
);
CALL app.apply_tenant_rls('staff_legacy_rows');

-- what each old row became here: brought again, it updates the same row
CREATE TABLE staff_legacy_map (
  school_id BIGINT NOT NULL REFERENCES schools(id),
  tbl       TEXT NOT NULL CHECK (tbl ~ '^[a-z_]{3,40}$'),
  legacy_id TEXT NOT NULL CHECK (length(legacy_id) BETWEEN 1 AND 200),
  new_id    BIGINT NOT NULL,
  PRIMARY KEY (school_id, tbl, legacy_id)
);
CALL app.apply_tenant_rls('staff_legacy_map');
CREATE INDEX staff_legacy_map_new ON staff_legacy_map (school_id, tbl, new_id);

-- an old employee id: the employee code, else the biometric id
CREATE OR REPLACE FUNCTION app.staff_legacy_emp(p_code TEXT) RETURNS BIGINT LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT e.id FROM employees e WHERE e.school_id = app.current_school_id() AND e.deleted_at IS NULL
        AND lower(btrim(e.employee_code)) = lower(btrim(p_code)) ORDER BY e.status = 'active' DESC, e.id LIMIT 1),
    (SELECT e.id FROM employees e WHERE e.school_id = app.current_school_id() AND e.deleted_at IS NULL
        AND lower(btrim(e.biometric_id)) = lower(btrim(p_code)) LIMIT 1))
$$;
-- what an old row became
CREATE OR REPLACE FUNCTION app.staff_legacy_id(p_tbl TEXT, p_id TEXT) RETURNS BIGINT LANGUAGE sql STABLE AS $$
  SELECT new_id FROM staff_legacy_map WHERE school_id = app.current_school_id() AND tbl = p_tbl AND legacy_id = p_id
$$;

-- a day brought from the old module: kept as it was (the punches never change it), not "set by hand"
ALTER TABLE staff_attendance_days DROP CONSTRAINT staff_attendance_days_source_check;
ALTER TABLE staff_attendance_days ADD CONSTRAINT staff_attendance_days_source_check
  CHECK (source IN ('punches', 'manual', 'bulk', 'regularisation', 'weekoff', 'holiday', 'absent', 'leave', 'import'));

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
           a.out_at, a.worked_hours, a.late_minutes, a.early_minutes, a.manual AND a.source <> 'import' AS manual, a.shift_id, a.trace,
           a.remark, t.code AS tcode,
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
