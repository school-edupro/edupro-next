-- 0394: the Board exam registration form (docs/design/87, 17 Nov 2026) — a built-in student type for classes X and XII:
-- the circular the school gives each candidate's parents, filled from the records (the candidate, the parents, the
-- date of birth, APAAR, the Aadhaar numbers masked to their last four digits, category, minority, the subjects
-- offered …), to check, correct where needed and sign before the school registers the candidates with the Board.
-- One a student a year, numbered BEF/<year>/00001 in the register; its ready layout is added by the API on first use.
CREATE OR REPLACE FUNCTION app.certificate_types_seed(p_school BIGINT) RETURNS VOID LANGUAGE sql AS $$
  INSERT INTO certificate_types (school_id, code, name, audience, prefix, rules, multiple, uses_book, sort_order, built_in)
  SELECT p_school, x.code, x.name, x.audience, x.prefix, x.rules::jsonb, x.multiple, x.book, x.n, true
    FROM (VALUES
      ('TC', 'Transfer certificate', 'STUDENT', 'TC',
       '{"state": "leaving", "fees": true, "library": true, "hostel": true, "transport": true}', 'ONE', true, 10),
      ('BONAFIDE', 'Bonafide certificate', 'STUDENT', 'BON', '{"state": "active"}', 'ANY', false, 20),
      ('CHARACTER', 'Character certificate', 'STUDENT', 'CHR', '{"state": "any"}', 'ANY', false, 30),
      ('DOB', 'Date of birth certificate', 'STUDENT', 'DOB', '{"state": "any"}', 'ANY', false, 40),
      ('DOB_JUST', 'Date of birth justification', 'STUDENT', 'DOBJ', '{"state": "any"}', 'ANY', false, 45),
      ('STUDY', 'Study certificate', 'STUDENT', 'STU', '{"state": "any"}', 'ANY', false, 50),
      ('CASTE', 'Caste certificate (school record)', 'STUDENT', 'CST', '{"state": "any"}', 'ANY', false, 55),
      ('DOMICILE', 'Domicile (residence) certificate', 'STUDENT', 'DOM', '{"state": "active"}', 'ANY', false, 60),
      ('NOC', 'No objection certificate', 'STUDENT', 'NOC', '{"state": "active"}', 'ANY', false, 65),
      ('TRAVEL_NOC', 'No objection certificate for travel', 'STUDENT', 'TNOC', '{"state": "active"}', 'ANY', false, 70),
      ('VISA', 'Visa letter', 'STUDENT', 'VISA', '{"state": "active"}', 'ANY', false, 75),
      ('SCHOLAR', 'Scholarship certificate', 'STUDENT', 'SCH', '{"state": "active"}', 'ANY', false, 80),
      ('BOARD_REG', 'Board registration verification', 'STUDENT', 'BRV',
       '{"state": "active", "classes": ["VIII", "IX", "X", "XI", "XII"]}', 'ANY', false, 85),
      ('BOARD_FORM', 'Board exam registration form', 'STUDENT', 'BEF',
       '{"state": "active", "classes": ["X", "XII"]}', 'YEAR', false, 86),
      ('FEE_PAID', 'Fee paid certificate', 'STUDENT', 'FEE', '{"state": "any"}', 'ANY', false, 90),
      ('ACHIEVEMENT', 'Achievement certificate', 'STUDENT', 'ACH', '{"state": "any"}', 'ANY', false, 95),
      ('MERIT', 'Merit certificate', 'STUDENT', 'MRT', '{"state": "any"}', 'ANY', false, 96),
      ('PARTICIPATION', 'Participation certificate', 'STUDENT', 'PRT', '{"state": "any"}', 'ANY', false, 97),
      ('AWARD', 'Award certificate', 'STUDENT', 'AWD', '{"state": "any"}', 'ANY', false, 98),
      ('EXPERIENCE', 'Experience certificate', 'STAFF', 'EXP', '{"state": "leaving"}', 'ONE', false, 110),
      ('SERVICE', 'Service certificate', 'STAFF', 'SRV', '{"state": "active"}', 'ANY', false, 120),
      ('STAFF_VISA', 'Staff visa NOC', 'STAFF', 'SVN', '{"state": "active"}', 'ANY', false, 130)
    ) AS x(code, name, audience, prefix, rules, multiple, book, n)
  ON CONFLICT DO NOTHING
$$;
SELECT app.certificate_types_seed(id) FROM schools;
