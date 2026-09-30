-- House becomes a profile list (school-editable) so the student form offers the school's houses instead
-- of free text. Existing house values of each school are kept as list values too.
INSERT INTO profile_lists (school_id, list_code, value, sort_order)
SELECT s.id, 'House', v.value, v.sort_order
  FROM schools s CROSS JOIN (VALUES ('Red', 1), ('Blue', 2), ('Green', 3), ('Yellow', 4)) AS v(value, sort_order)
ON CONFLICT (school_id, list_code, value) DO NOTHING;

INSERT INTO profile_lists (school_id, list_code, value, sort_order)
SELECT DISTINCT school_id, 'House', btrim(house), 10
  FROM students WHERE house IS NOT NULL AND btrim(house) <> ''
ON CONFLICT (school_id, list_code, value) DO NOTHING;
