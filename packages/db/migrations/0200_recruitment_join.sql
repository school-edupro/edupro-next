-- 0200: recruitment, part 4 (docs/design/34-recruitment.md): a selected candidate moves to the employee master;
-- the application keeps the employee it became.
ALTER TABLE job_applications
  ADD COLUMN employee_id BIGINT REFERENCES employees(id),
  ADD COLUMN joined_at   TIMESTAMPTZ;
