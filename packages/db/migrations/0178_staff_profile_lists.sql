-- 0178: the staff drop-downs of the employee master (docs/design/30-employee-master.md) are rows of the
-- profile lists master like the student ones, so the school sees and edits them in System setup →
-- Profile lists (students and staff): marital status, nature of appointment, role, pay band, language,
-- qualification, education mode. Until now they were starter values in code only. A school that already
-- has values for a list keeps them; new schools get the lists when the staff master first opens.
CREATE OR REPLACE FUNCTION app.staff_profile_lists_seed(p_school BIGINT) RETURNS VOID LANGUAGE sql AS $$
  INSERT INTO profile_lists (school_id, list_code, value, sort_order)
  SELECT p_school, x.code, x.value, x.n
    FROM (VALUES
      ('MaritalStatus', 'Single', 10), ('MaritalStatus', 'Married', 20), ('MaritalStatus', 'Widowed', 30),
      ('MaritalStatus', 'Divorced', 40), ('MaritalStatus', 'Separated', 50),
      ('NatureOfAppointment', 'Permanent', 10), ('NatureOfAppointment', 'Probation', 20),
      ('NatureOfAppointment', 'Contract', 30), ('NatureOfAppointment', 'Temporary', 40),
      ('NatureOfAppointment', 'Ad hoc', 50), ('NatureOfAppointment', 'Guest', 60),
      ('StaffRole', 'Teacher', 10), ('StaffRole', 'Class teacher', 20), ('StaffRole', 'Coordinator', 30),
      ('StaffRole', 'Head of department', 40), ('StaffRole', 'Administrator', 50), ('StaffRole', 'Support staff', 60),
      ('PayBand', 'Level 1', 10), ('PayBand', 'Level 2', 20), ('PayBand', 'Level 3', 30), ('PayBand', 'Level 4', 40),
      ('PayBand', 'Level 5', 50), ('PayBand', 'Level 6', 60), ('PayBand', 'Level 7', 70), ('PayBand', 'Level 8', 80),
      ('Language', 'English', 10), ('Language', 'Hindi', 20), ('Language', 'Sanskrit', 30), ('Language', 'Punjabi', 40),
      ('Language', 'Urdu', 50), ('Language', 'Bengali', 60), ('Language', 'Marathi', 70), ('Language', 'Tamil', 80),
      ('Language', 'Telugu', 90), ('Language', 'French', 100), ('Language', 'German', 110),
      ('Qualification', '10th', 10), ('Qualification', '12th', 20), ('Qualification', 'Diploma', 30),
      ('Qualification', 'B.A.', 40), ('Qualification', 'B.Sc.', 50), ('Qualification', 'B.Com.', 60),
      ('Qualification', 'B.Tech.', 70), ('Qualification', 'BCA', 80), ('Qualification', 'B.Ed.', 90),
      ('Qualification', 'M.A.', 100), ('Qualification', 'M.Sc.', 110), ('Qualification', 'M.Com.', 120),
      ('Qualification', 'M.Ed.', 130), ('Qualification', 'MCA', 140), ('Qualification', 'MBA', 150),
      ('Qualification', 'M.Phil.', 160), ('Qualification', 'Ph.D.', 170), ('Qualification', 'NTT', 180),
      ('Qualification', 'D.El.Ed.', 190), ('Qualification', 'CTET', 200), ('Qualification', 'Other', 210),
      ('EducationMode', 'Regular', 10), ('EducationMode', 'Distance', 20), ('EducationMode', 'Part time', 30),
      ('EducationMode', 'Online', 40)
    ) AS x(code, value, n)
   -- a list the school already filled is left as it is
   WHERE NOT EXISTS (SELECT 1 FROM profile_lists p WHERE p.school_id = p_school AND p.list_code = x.code)
  ON CONFLICT DO NOTHING
$$;
SELECT app.staff_profile_lists_seed(id) FROM schools;
