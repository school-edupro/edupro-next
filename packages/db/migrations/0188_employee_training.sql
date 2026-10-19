-- 0188: training records of an employee (docs/design/30-employee-master.md): the legacy "Add Training
-- Detail" (training date, topic, venue, duration, name of organisation, date of entry) as a row list
-- like education and work experience. The office keeps it on the employee's page; staff add, change or
-- remove rows from My profile under the staff profile policy (0187 lists; key `list:training`).
CREATE TABLE employee_training (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id     BIGINT NOT NULL REFERENCES schools(id),
  employee_id   BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  trained_on    DATE NOT NULL,
  topic         TEXT NOT NULL,
  venue         TEXT,
  duration      TEXT,
  organisation  TEXT,
  -- when the record was entered (the legacy "Date Of Entry"); today unless given
  entered_on    DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    BIGINT
);
CREATE INDEX employee_training_emp ON employee_training (employee_id);
CALL app.apply_tenant_rls('employee_training');
