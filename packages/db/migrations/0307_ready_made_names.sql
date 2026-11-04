-- docs/design/73 part 1 (4 Nov 2026): no school's name in the product.
--   * The ready-made report cards installed as dps_* get neutral codes (lr_* for the learning records, rc_*
--     for the report cards); their names too while they are still the shipped ones (a name the school
--     gave stays). Releases point at templates by id, so they keep their cards. A school that already has
--     a template with the new code keeps both (the old row is left as it is).
--   * The ready-made register schemes DPS_* are CLASS_* (mark_schemes.preset records where a register
--     started).
WITH m(old_code, new_code, old_name, new_name) AS (
  VALUES
    ('dps_i_ii', 'lr_i_ii', 'DPS Noida I-II learning record', 'Learning record (I-II)'),
    ('dps_iii_v', 'lr_iii_v', 'DPS Noida III-V learning record', 'Learning record (III-V)'),
    ('dps_vi_viii', 'rc_vi_viii', 'DPS Noida VI-VIII (Term 1 and Term 2)', 'Report card VI-VIII (Term 1 and Term 2)'),
    ('dps_ix', 'rc_ix', 'DPS Noida IX', 'Report card IX'),
    ('dps_x', 'rc_x', 'DPS Noida X (pre-term / mid-term)', 'Report card X (pre-term / mid-term)'),
    ('dps_xi', 'rc_xi', 'DPS Noida XI', 'Report card XI'),
    ('dps_xii', 'rc_xii', 'DPS Noida XII (pre-term / mid-term)', 'Report card XII (pre-term / mid-term)')
)
UPDATE report_card_templates t
   SET code = m.new_code,
       name = CASE WHEN t.name = m.old_name THEN m.new_name ELSE t.name END,
       updated_at = now()
  FROM m
 WHERE t.code = m.old_code
   AND NOT EXISTS (SELECT 1 FROM report_card_templates o WHERE o.school_id = t.school_id AND o.code = m.new_code);

UPDATE mark_schemes
   SET preset = 'CLASS_' || substr(preset, 5)
 WHERE preset IN ('DPS_VI_VIII', 'DPS_IX', 'DPS_X', 'DPS_XI', 'DPS_XII');
