-- docs/design/73 part 3 (4 Nov 2026): a card design's pictures (the school's own: the cover's art, a
-- second emblem, a picture per page), slot → file id; the renderer prints them as data URIs.
ALTER TABLE report_card_templates ADD COLUMN assets JSONB NOT NULL DEFAULT '{}'::jsonb;

-- The Holistic progress card (Balvatika to II) becomes the A4 learning record wherever a school still has
-- its first layout (a copy the school changed stays as it is; installing the card again adds the new one
-- beside it as "… v2").
UPDATE report_card_templates
   SET layout = '{"subtitle":"Learning curve","sections":[{"type":"lr_cover","title":"Learning curve","caption":"(Progress record)"},{"type":"lr_subjects","title":"Scholastic area","areas":["English","Mathematics"]},{"type":"lr_subjects","title":"Scholastic area","areas":["Hindi","EVS","General knowledge"]},{"type":"lr_co_scholastic","title":"Co-scholastic area","areas":["Personal and social traits","Activities"]},{"type":"lr_record","title":"Health record & attendance"},{"type":"lr_key","title":"Evaluation key"}]}'::jsonb, version = version + 1, updated_at = now()
 WHERE code = 'hpc_foundational' AND deleted_at IS NULL
   AND layout = '{"subtitle":"Holistic progress card","sections":[{"type":"cover","title":"Holistic progress card"},{"type":"header"},{"type":"student","showPhoto":false},{"type":"hpc_record","title":"My progress"},{"type":"page_break"},{"type":"hpc_feedback","title":"In our words"},{"type":"portfolio","title":"My portfolio"},{"type":"attendance"},{"type":"health"},{"type":"signatures","roles":["class_teacher","parent","principal"]}]}'::jsonb;
