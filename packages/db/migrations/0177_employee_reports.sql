-- 0177: the report builder also reports on employees (docs/design/30-employee-master.md, part 2): a saved
-- report and a saved list view carry the dataset whose fields they use.
ALTER TABLE report_definitions DROP CONSTRAINT report_definitions_dataset_check;
ALTER TABLE report_definitions ADD CONSTRAINT report_definitions_dataset_check
  CHECK (dataset IN ('student_profile', 'employee_profile'));
