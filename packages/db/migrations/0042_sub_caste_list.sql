-- Sub-Caste becomes a profile list (school-editable master, one flat list) instead of free text.
-- Starter values match PROFILE_LIST_DEFAULTS.SubCaste; existing free-text values are kept as list values.
INSERT INTO profile_lists (school_id, list_code, value, sort_order)
SELECT s.id, 'SubCaste', v.value, v.sort_order
  FROM schools s CROSS JOIN (VALUES
    ('Agarwal', 1), ('Arora', 2), ('Baniya', 3), ('Bhumihar', 4), ('Brahmin', 5), ('Gujjar', 6),
    ('Jat', 7), ('Jatav', 8), ('Kayastha', 9), ('Khatri', 10), ('Kurmi', 11), ('Kushwaha', 12),
    ('Lodhi', 13), ('Maratha', 14), ('Meena', 15), ('Rajput', 16), ('Saini', 17), ('Sindhi', 18),
    ('Valmiki', 19), ('Yadav', 20), ('Other', 99)
  ) AS v(value, sort_order)
ON CONFLICT (school_id, list_code, value) DO NOTHING;

INSERT INTO profile_lists (school_id, list_code, value, sort_order)
SELECT DISTINCT school_id, 'SubCaste', btrim(details->>'sub_caste'), 50
  FROM students WHERE btrim(coalesce(details->>'sub_caste', '')) <> ''
ON CONFLICT (school_id, list_code, value) DO NOTHING;
