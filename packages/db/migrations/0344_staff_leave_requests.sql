-- 0344: staff leave — applying, approving, cancelling and the balances (docs/design/85, phase B). The
-- school's earlier process, kept: the balance is held when a leave is applied (in the month it is raised)
-- and given back on reject / withdraw / cancel; a leave short of balance is split into a paid part and a
-- loss-of-pay part; approval runs through the levels of Who approves; an approved leave may be cancelled
-- through its own chain, trimmed by the office or replaced by an entry the office makes. A month locked for
-- payroll takes no leave.

-- ---- rights ----------------------------------------------------------------------------------------------
INSERT INTO permissions (code, module, description) VALUES
  ('leave.own.apply', 'leave', 'Apply for my own leave, see my balances, withdraw it or ask to cancel it'),
  ('leave.office.manage', 'leave',
   'Staff leave office: every request and balance, leave for an employee, cancel, trim, decide for the approvers, correct balances')
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'leave.own.apply' FROM roles r
 WHERE r.school_id IS NULL AND r.code NOT IN ('parent', 'student', 'auditor', 'support_engineer', 'erp_support')
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'leave.office.manage' FROM roles r
 WHERE r.school_id IS NULL AND r.code IN ('group_admin', 'school_admin', 'leave_office')
ON CONFLICT DO NOTHING;

-- ---- numbering: LV/2026-27/00001, per school and financial year ----------------------------------------
CREATE TABLE staff_leave_counters (
  school_id BIGINT NOT NULL REFERENCES schools(id),
  fy        TEXT NOT NULL,
  last      INT NOT NULL DEFAULT 0,
  PRIMARY KEY (school_id, fy)
);
CALL app.apply_tenant_rls('staff_leave_counters');

CREATE OR REPLACE FUNCTION app.staff_leave_number(p_day DATE) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE v_fy TEXT; v_n INT; v_y INT;
BEGIN
  v_y := CASE WHEN extract(month FROM p_day) >= 4 THEN extract(year FROM p_day)::int ELSE extract(year FROM p_day)::int - 1 END;
  v_fy := v_y::text || '-' || lpad(((v_y + 1) % 100)::text, 2, '0');
  INSERT INTO staff_leave_counters (school_id, fy, last) VALUES (app.current_school_id(), v_fy, 1)
  ON CONFLICT (school_id, fy) DO UPDATE SET last = staff_leave_counters.last + 1
  RETURNING last INTO v_n;
  RETURN 'LV/' || v_fy || '/' || lpad(v_n::text, 5, '0');
END $$;

-- ---- payroll month lock (the register locks and unlocks it with staff attendance) ----------------------
CREATE TABLE staff_month_locks (
  school_id     BIGINT NOT NULL REFERENCES schools(id),
  month         DATE NOT NULL CHECK (extract(day FROM month) = 1),
  locked        BOOLEAN NOT NULL DEFAULT true,
  locked_by     BIGINT REFERENCES users(id),
  locked_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  unlocked_by   BIGINT REFERENCES users(id),
  unlocked_at   TIMESTAMPTZ,
  unlock_reason TEXT CHECK (unlock_reason IS NULL OR length(unlock_reason) <= 300),
  PRIMARY KEY (school_id, month)
);
CALL app.apply_tenant_rls('staff_month_locks');
CREATE TRIGGER staff_month_locks_audit AFTER INSERT OR UPDATE OR DELETE ON staff_month_locks
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

-- ---- requests and their days -----------------------------------------------------------------------------
CREATE TABLE staff_leave_requests (
  id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id            BIGINT NOT NULL REFERENCES schools(id),
  number               TEXT NOT NULL,
  employee_id          BIGINT NOT NULL REFERENCES employees(id),
  leave_type_id        BIGINT NOT NULL REFERENCES staff_leave_types(id),
  from_date            DATE NOT NULL,
  to_date              DATE NOT NULL CHECK (to_date >= from_date),
  days                 NUMERIC(6,2) NOT NULL CHECK (days > 0),
  half_day             BOOLEAN NOT NULL DEFAULT false,
  session              TEXT CHECK (session IS NULL OR session IN ('first', 'second')),
  reason               TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 1000),
  document_file_id     BIGINT REFERENCES files(id),
  status               TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn', 'cancelled')),
  -- self, on behalf (the office), the system's deductions (late marks, missing punches, absence, the
  -- shift's late / early rule), an import
  source               TEXT NOT NULL DEFAULT 'self'
                         CHECK (source IN ('self', 'on_behalf', 'auto_late', 'auto_missing', 'auto_absent', 'auto_rule', 'import')),
  applied_by           BIGINT REFERENCES users(id),
  -- the loss-of-pay part of a split leave points at its paid part (and follows its decisions)
  linked_request_id    BIGINT REFERENCES staff_leave_requests(id),
  -- the month the balance is held in (the month the leave was raised)
  held_month           DATE,
  -- what the system added or noted (sandwich, bridge, split)
  note                 TEXT CHECK (note IS NULL OR length(note) <= 500),
  workflow_instance_id BIGINT REFERENCES workflow_instances(id),
  approval_rule_id     BIGINT REFERENCES staff_leave_approval_rules(id),
  decided_at           TIMESTAMPTZ,
  decided_by           BIGINT REFERENCES users(id),
  decision_note        TEXT CHECK (decision_note IS NULL OR length(decision_note) <= 500),
  -- a cancellation asked for an approved leave, decided through its own chain
  cancel_status        TEXT CHECK (cancel_status IS NULL OR cancel_status IN ('pending', 'approved', 'rejected')),
  cancel_reason        TEXT CHECK (cancel_reason IS NULL OR length(cancel_reason) <= 500),
  cancel_raised_by     BIGINT REFERENCES users(id),
  cancel_raised_at     TIMESTAMPTZ,
  cancel_instance_id   BIGINT REFERENCES workflow_instances(id),
  edits                INT NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, number),
  CHECK (NOT half_day OR (from_date = to_date AND session IS NOT NULL))
);
CALL app.apply_tenant_rls('staff_leave_requests');
CREATE TRIGGER staff_leave_requests_audit AFTER INSERT OR UPDATE OR DELETE ON staff_leave_requests
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE INDEX staff_leave_requests_emp ON staff_leave_requests (employee_id, from_date DESC);
CREATE INDEX staff_leave_requests_dates ON staff_leave_requests (school_id, from_date, to_date);
CREATE INDEX staff_leave_requests_linked ON staff_leave_requests (linked_request_id) WHERE linked_request_id IS NOT NULL;
CREATE INDEX staff_leave_requests_wf ON staff_leave_requests (workflow_instance_id) WHERE workflow_instance_id IS NOT NULL;
CREATE INDEX staff_leave_requests_cwf ON staff_leave_requests (cancel_instance_id) WHERE cancel_instance_id IS NOT NULL;

-- one row a day counted: a whole day, or a half (the first or second half of the day)
CREATE TABLE staff_leave_days (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  request_id  BIGINT NOT NULL REFERENCES staff_leave_requests(id),
  employee_id BIGINT NOT NULL REFERENCES employees(id),
  day         DATE NOT NULL,
  portion     NUMERIC(3,2) NOT NULL CHECK (portion IN (0.5, 1)),
  session     TEXT CHECK (session IS NULL OR session IN ('first', 'second')),
  -- a weekly off or holiday charged by the sandwich or the bridge
  kind        TEXT NOT NULL DEFAULT 'work' CHECK (kind IN ('work', 'weekoff', 'holiday', 'optional')),
  status      TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn', 'cancelled')),
  UNIQUE (request_id, day),
  CHECK (portion = 1 OR session IS NOT NULL)
);
CALL app.apply_tenant_rls('staff_leave_days');
CREATE INDEX staff_leave_days_live ON staff_leave_days (employee_id, day) WHERE status IN ('pending', 'approved');

-- ---- the balance ledger: one row an employee, leave type and month --------------------------------------
CREATE TABLE staff_leave_balances (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id     BIGINT NOT NULL REFERENCES schools(id),
  employee_id   BIGINT NOT NULL REFERENCES employees(id),
  leave_type_id BIGINT NOT NULL REFERENCES staff_leave_types(id),
  month         DATE NOT NULL CHECK (extract(day FROM month) = 1),
  opening       NUMERIC(8,2) NOT NULL DEFAULT 0,
  credited      NUMERIC(8,2) NOT NULL DEFAULT 0,
  -- days held by leave raised this month (pending or approved)
  held          NUMERIC(8,2) NOT NULL DEFAULT 0 CHECK (held >= 0),
  correction    NUMERIC(8,2) NOT NULL DEFAULT 0,
  closing       NUMERIC(8,2),
  lapsed        NUMERIC(8,2) NOT NULL DEFAULT 0,
  closed        BOOLEAN NOT NULL DEFAULT false,
  -- the opening was set by an import (the opening balances), not carried from the month before
  imported      BOOLEAN NOT NULL DEFAULT false,
  -- one line a movement: "09-11-2026 held 2 — LV/2026-27/00004 (pending)"
  trail         TEXT[] NOT NULL DEFAULT '{}',
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_id, leave_type_id, month)
);
CALL app.apply_tenant_rls('staff_leave_balances');
CREATE TRIGGER staff_leave_balances_audit AFTER INSERT OR UPDATE OR DELETE ON staff_leave_balances
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE INDEX staff_leave_balances_month ON staff_leave_balances (school_id, month);

-- an approved leave's dates cut by the office (one end at a time)
CREATE TABLE staff_leave_edits (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  request_id  BIGINT NOT NULL REFERENCES staff_leave_requests(id),
  old_from    DATE NOT NULL,
  old_to      DATE NOT NULL,
  old_days    NUMERIC(6,2) NOT NULL,
  new_from    DATE NOT NULL,
  new_to      DATE NOT NULL,
  new_days    NUMERIC(6,2) NOT NULL,
  removed     DATE[] NOT NULL,
  reason      TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 400),
  edited_by   BIGINT REFERENCES users(id),
  edited_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CALL app.apply_tenant_rls('staff_leave_edits');

-- ---- messages --------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.staff_leave_seed_templates(p_school BIGINT) RETURNS VOID LANGUAGE sql AS $$
  INSERT INTO comms_templates (school_id, code, channel, name, subject, body, variables, category)
  SELECT p_school, t.code, c.channel::comms_channel, t.name, CASE WHEN c.channel = 'email' THEN t.subject END,
         t.body, t.vars::jsonb, 'service'
    FROM (VALUES
      ('leave_waiting', 'Leave: waiting for your approval', 'Leave {{number}} of {{employee}} waits for you',
       '{{employee}} has applied for {{type}} from {{from}} to {{to}} ({{days}} days): {{reason}}. Please approve or reject it in EduPro.',
       '["number","employee","type","from","to","days","reason"]'),
      ('leave_approved', 'Leave: approved', 'Your leave {{number}} is approved',
       'Dear {{employee}}, your {{type}} from {{from}} to {{to}} ({{days}} days) is approved by {{by}}. {{type}} left: {{balance}}.',
       '["number","employee","type","from","to","days","by","balance"]'),
      ('leave_rejected', 'Leave: rejected', 'Your leave {{number}} is not approved',
       'Dear {{employee}}, your {{type}} from {{from}} to {{to}} is not approved by {{by}}: {{note}}',
       '["number","employee","type","from","to","by","note"]'),
      ('leave_cancelled', 'Leave: cancelled', 'Your leave {{number}} is cancelled',
       'Dear {{employee}}, your {{type}} from {{from}} to {{to}} is cancelled by {{by}}: {{note}}',
       '["number","employee","type","from","to","by","note"]'),
      ('leave_changed', 'Leave: dates changed', 'The dates of your leave {{number}} are changed',
       'Dear {{employee}}, your {{type}} {{number}} is now from {{from}} to {{to}} ({{days}} days), changed by {{by}}: {{note}}',
       '["number","employee","type","from","to","days","by","note"]'),
      ('leave_cancel_waiting', 'Leave: cancellation waiting for your approval', '{{employee}} asks to cancel leave {{number}}',
       '{{employee}} asks to cancel the approved {{type}} from {{from}} to {{to}}: {{reason}}. Please decide it in EduPro.',
       '["number","employee","type","from","to","reason"]'),
      ('leave_digest', 'Leave: daily list of approvals waiting', 'Leave waiting for your approval ({{count}})',
       'Dear {{name}}, {{count}} leave request(s) wait for you in EduPro: {{list}}',
       '["name","count","list"]')
    ) AS t(code, name, subject, body, vars)
    CROSS JOIN (VALUES ('email'), ('push')) AS c(channel)
  ON CONFLICT (school_id, code, channel) DO NOTHING
$$;
SELECT app.staff_leave_seed_templates(id) FROM schools WHERE status = 'active';
