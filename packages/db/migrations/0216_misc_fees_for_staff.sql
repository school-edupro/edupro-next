-- 0216: misc fees for staff (docs/design/36-library.md, "The register, accession corrections and lost-book
-- recovery", part 4). A misc fee line names a pupil or an employee (exactly one): the fees counter finds a
-- staff member, receives the fee on a misc receipt paid by the employee, and the library's charge for a
-- lost or damaged book of a staff borrower is announced the same way as a pupil's.
ALTER TABLE misc_fee_students
  ALTER COLUMN student_id DROP NOT NULL,
  ADD COLUMN employee_id BIGINT REFERENCES employees(id),
  ADD CONSTRAINT misc_fee_students_one_payer CHECK (num_nonnulls(student_id, employee_id) = 1),
  ADD CONSTRAINT misc_fee_students_employee_key UNIQUE (misc_fee_id, employee_id);
CREATE INDEX misc_fee_students_employee ON misc_fee_students (employee_id) WHERE employee_id IS NOT NULL;
COMMENT ON TABLE misc_fee_students IS 'who a misc fee is for: a pupil (student_id) or a staff member (employee_id), each with an amount';
