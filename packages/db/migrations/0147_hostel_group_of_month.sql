-- The hostel fee group of a month comes from the stay that touches the month: its room type's group, or the
-- pupil's default (profile hostel fee group, else school fee group) when the room type names none. 0146
-- skipped stays whose room type had no group and fell through to an older or newer stay's group.
CREATE OR REPLACE FUNCTION app.hostel_fee_group_on(p_student BIGINT, p_month DATE, p_default TEXT)
RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT COALESCE((
    SELECT t.fee_group
      FROM hostel_allotments a
      JOIN hostel_beds b ON b.id = a.bed_id
      JOIN hostel_rooms r ON r.id = b.room_id
      JOIN hostel_room_types t ON t.id = r.room_type_id
     WHERE a.student_id = p_student
       AND a.from_date <= (date_trunc('month', p_month) + interval '1 month - 1 day')::date
       AND (a.to_date IS NULL OR a.to_date >= date_trunc('month', p_month)::date)
     ORDER BY a.from_date DESC, a.id DESC
     LIMIT 1), p_default)
$$;
