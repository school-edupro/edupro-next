-- 0260: the report builder saves reports on the Admissions dataset too (docs/design/39 part 7 offered it,
-- but the check still allowed only students and employees, so "Save report" failed).
ALTER TABLE report_definitions DROP CONSTRAINT report_definitions_dataset_check;
ALTER TABLE report_definitions ADD CONSTRAINT report_definitions_dataset_check
  CHECK (dataset IN ('student_profile', 'employee_profile', 'admissions'));
