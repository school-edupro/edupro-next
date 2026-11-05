-- docs/design/74 (5 Nov 2026): the periodic test slip for VI-VIII in the classic card's look (one A4 page of
-- ruled boxes, as the Term 1 card for VI-VIII), wherever a school still has its first layout (a copy the
-- school changed stays as it is).
UPDATE report_card_templates
   SET layout = '{"subtitle":"Test report","sections":[{"type":"cl_header","releaseTitle":true},{"type":"cl_student"},{"type":"cl_exam_marks"},{"type":"cl_co_health"},{"type":"cl_discipline"},{"type":"cl_remark"},{"type":"cl_sign","roles":["parent","class_teacher","coordinator","vice_principal","principal"]},{"type":"cl_grade_key"}]}'::jsonb, version = version + 1, updated_at = now()
 WHERE code = 'test_slip_middle' AND deleted_at IS NULL
   AND layout = '{"subtitle":"Test report","sections":[{"type":"header"},{"type":"student","showPhoto":false},{"type":"scholastic","mode":"slip","title":"Marks"},{"type":"attendance"},{"type":"remarks","title":"Class teacher''s remark"},{"type":"signatures","roles":["class_teacher","parent","principal"]}]}'::jsonb;
