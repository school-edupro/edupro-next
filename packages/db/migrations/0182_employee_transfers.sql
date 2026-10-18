-- 0182: staff transfers (docs/design/30-employee-master.md): within the school between campuses, and to
-- another school of the group (Alpha → Beta) by a request the target school accepts. As for students
-- (0049), each school keeps its own records: the employee is copied to the target (profile with ID
-- numbers encrypted, education, languages, experience, transfers, documents, photo, subjects, login) with
-- the target's code; the source closes its record (left on the transfer date) when the target accepts.

INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('people.staff_transfer.manage', 'people', 'Move staff between campuses and to other schools of the group, accept incoming staff', false)
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT DISTINCT rp.role_id, 'people.staff_transfer.manage'
  FROM role_permissions rp WHERE rp.permission_code = 'people.employee.edit'
ON CONFLICT DO NOTHING;

CREATE TABLE employee_school_transfers (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  from_school_id     BIGINT NOT NULL REFERENCES schools(id),
  to_school_id       BIGINT NOT NULL REFERENCES schools(id),
  from_employee_id   BIGINT NOT NULL REFERENCES employees(id),
  on_date            DATE NOT NULL,
  order_no           TEXT,
  status             TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'accepted', 'rejected', 'cancelled')),
  -- name, code, profile values (ID numbers encrypted), rows, documents and photo to copy, subjects, login
  snapshot           JSONB NOT NULL,
  note               TEXT,
  requested_by       BIGINT,
  requested_by_name  TEXT,
  requested_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by         BIGINT,
  decided_by_name    TEXT,
  decided_at         TIMESTAMPTZ,
  decision_note      TEXT,
  to_employee_id     BIGINT,
  CHECK (from_school_id <> to_school_id)
);
CREATE UNIQUE INDEX employee_school_transfers_open ON employee_school_transfers (from_employee_id) WHERE status = 'requested';
CREATE INDEX employee_school_transfers_incoming ON employee_school_transfers (to_school_id, status);

ALTER TABLE employee_school_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_school_transfers FORCE ROW LEVEL SECURITY;
CREATE POLICY employee_school_transfers_both_schools ON employee_school_transfers FOR ALL TO PUBLIC
  USING (from_school_id = app.current_school_id() OR to_school_id = app.current_school_id())
  WITH CHECK (from_school_id = app.current_school_id() OR to_school_id = app.current_school_id());
CREATE POLICY employee_school_transfers_migrator ON employee_school_transfers FOR ALL TO edupro_migrator USING (true) WITH CHECK (true);

-- The target school accepted: the source school's record closes on the transfer date (inactive, a
-- transfer row and a remark, its staff membership ended). Runs with the owner's rights because the
-- accepting school cannot write the source school's rows; only the transfer just accepted is closed.
CREATE OR REPLACE FUNCTION app.employee_transfer_close_source(p_transfer BIGINT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app AS $$
DECLARE
  t   record;
  src text;
  dst text;
BEGIN
  SELECT * INTO t FROM employee_school_transfers WHERE id = p_transfer;
  IF NOT FOUND OR t.status <> 'accepted' OR t.to_school_id <> app.current_school_id() THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'transfer.not_accepted';
  END IF;
  SELECT name INTO src FROM schools WHERE id = t.from_school_id;
  SELECT name INTO dst FROM schools WHERE id = t.to_school_id;
  UPDATE employees SET left_on = t.on_date,
         status = CASE WHEN t.on_date <= CURRENT_DATE THEN 'inactive'::row_status ELSE status END,
         profile = profile || jsonb_build_object('leaving_reason', 'Transferred to ' || dst),
         updated_at = now()
   WHERE id = t.from_employee_id AND school_id = t.from_school_id;
  INSERT INTO employee_transfers (school_id, employee_id, on_date, from_place, to_place, order_no, remarks, created_by)
  VALUES (t.from_school_id, t.from_employee_id, t.on_date, src, dst, t.order_no, 'Transfer accepted by ' || dst, t.decided_by);
  INSERT INTO employee_remarks (school_id, employee_id, on_date, remark, source, created_by)
  VALUES (t.from_school_id, t.from_employee_id, t.on_date, 'Transferred to ' || dst, 'system', t.decided_by);
  -- the person signs in to the new school now (their login stays the same)
  UPDATE user_school_memberships SET status = 'inactive', updated_at = now()
   WHERE school_id = t.from_school_id AND person_type = 'employee'
     AND user_id = (SELECT user_id FROM employees WHERE id = t.from_employee_id)
     AND t.on_date <= CURRENT_DATE;
END
$$;
REVOKE ALL ON FUNCTION app.employee_transfer_close_source(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.employee_transfer_close_source(BIGINT) TO edupro_app;
