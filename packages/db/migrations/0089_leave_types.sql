-- 0089: the leave types a family may pick are the school's own list.
-- A master under Attendance: the name, when a certificate is needed (never, for a long leave, always) and
-- the most days in one application. Every school starts with the four types used so far.

CREATE TABLE leave_types (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  code         TEXT NOT NULL,
  name         TEXT NOT NULL,
  certificate  TEXT NOT NULL DEFAULT 'never' CHECK (certificate IN ('never', 'long', 'always')),
  max_days     INT CHECK (max_days IS NULL OR max_days BETWEEN 1 AND 365),
  sort_order   INT NOT NULL DEFAULT 100,
  status       row_status NOT NULL DEFAULT 'active',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by   BIGINT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by   BIGINT,
  UNIQUE (school_id, code)
);
CALL app.apply_tenant_rls('leave_types');

CREATE OR REPLACE FUNCTION app.leave_types_seed(p_school BIGINT) RETURNS VOID LANGUAGE sql AS $$
  INSERT INTO leave_types (school_id, code, name, certificate, sort_order)
  SELECT p_school, x.code, x.name, x.certificate, x.n
    FROM (VALUES ('medical', 'Medical', 'long', 10), ('family', 'Family function', 'never', 20),
                 ('travel', 'Out of station', 'never', 30), ('other', 'Other', 'never', 40)) AS x(code, name, certificate, n)
   WHERE NOT EXISTS (SELECT 1 FROM leave_types t WHERE t.school_id = p_school)
$$;
SELECT app.leave_types_seed(id) FROM schools;

-- the type on a leave is now any code of the master
ALTER TABLE student_leaves DROP CONSTRAINT student_leaves_leave_type_check;
