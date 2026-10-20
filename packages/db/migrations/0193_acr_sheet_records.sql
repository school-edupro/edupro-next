-- 0193: the ACR sheet shows the school's guidelines and the employee's record (docs/design/32-employee-acr.md,
-- 20 Oct 2026): the guidelines text in the ACR settings, shown above every self-appraisal; a signature
-- image on the employee record, printed under the person's line on the ACR once their step is filled.
ALTER TABLE acr_settings ADD COLUMN guidelines TEXT NOT NULL DEFAULT '';
ALTER TABLE employees ADD COLUMN signature_file_id BIGINT REFERENCES files(id);
