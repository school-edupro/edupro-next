-- 0191: ACR forms and sections (docs/design/32-employee-acr.md, 19 Oct 2026). The question bank becomes
-- forms the school builds: a self-appraisal form per staff category, and a questionnaire per approval
-- level; each form holds sections (title, help, weight) and questions (a rating, a written answer or
-- yes / no). A level names the questionnaire it answers; an ACR snapshots the forms it was made with.
CREATE TABLE acr_forms (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  name         TEXT NOT NULL,
  -- 'self': the employee's self-appraisal; 'level': a questionnaire an approval level answers
  part         TEXT NOT NULL CHECK (part IN ('self', 'level')),
  staff_group  TEXT NOT NULL CHECK (staff_group IN ('teaching', 'non_teaching', 'both')),
  description  TEXT,
  active       BOOLEAN NOT NULL DEFAULT true,
  sort_order   INT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CALL app.apply_tenant_rls('acr_forms');

CREATE TABLE acr_form_sections (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  form_id      BIGINT NOT NULL REFERENCES acr_forms(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  help         TEXT,
  -- the section's share of the form's score (sections with rating questions only)
  weight       NUMERIC(4, 2) NOT NULL DEFAULT 1 CHECK (weight > 0 AND weight <= 10),
  sort_order   INT NOT NULL DEFAULT 0
);
CREATE INDEX acr_form_sections_form ON acr_form_sections (form_id);
CALL app.apply_tenant_rls('acr_form_sections');

ALTER TABLE acr_questions
  ADD COLUMN form_id BIGINT REFERENCES acr_forms(id) ON DELETE CASCADE,
  ADD COLUMN section_id BIGINT REFERENCES acr_form_sections(id) ON DELETE SET NULL;
ALTER TABLE acr_questions DROP CONSTRAINT acr_questions_kind_check;
ALTER TABLE acr_questions ADD CONSTRAINT acr_questions_kind_check CHECK (kind IN ('scale', 'text', 'yesno'));
CREATE INDEX acr_questions_form_id ON acr_questions (form_id);

-- a level answers one questionnaire (none: the grade and remarks only)
ALTER TABLE acr_levels ADD COLUMN form_id BIGINT REFERENCES acr_forms(id) ON DELETE SET NULL;
-- the forms an ACR was made with
ALTER TABLE acr_reports ADD COLUMN self_form_id BIGINT;
ALTER TABLE acr_reviews ADD COLUMN form_id BIGINT;

-- The forms of a school from its question bank: one per (part, staff group), a section per section text;
-- rating levels and the ACRs already made point at their group's forms. Also run after the seed.
CREATE OR REPLACE FUNCTION app.acr_forms_from_questions(p_school BIGINT) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  g record;
  sec record;
  v_form bigint;
  v_sec bigint;
BEGIN
  FOR g IN SELECT DISTINCT part, staff_group FROM acr_questions WHERE school_id = p_school AND form_id IS NULL LOOP
    SELECT id INTO v_form FROM acr_forms
     WHERE school_id = p_school AND part = CASE WHEN g.part = 'self' THEN 'self' ELSE 'level' END AND staff_group = g.staff_group
     ORDER BY sort_order, id LIMIT 1;
    IF v_form IS NULL THEN
      INSERT INTO acr_forms (school_id, name, part, staff_group, sort_order)
      VALUES (p_school,
              (CASE WHEN g.part = 'self' THEN 'Self-appraisal' ELSE 'Rating by the levels' END) || ' · ' ||
              (CASE g.staff_group WHEN 'teaching' THEN 'Teaching' WHEN 'non_teaching' THEN 'Non-teaching' ELSE 'All staff' END),
              CASE WHEN g.part = 'self' THEN 'self' ELSE 'level' END, g.staff_group,
              CASE WHEN g.part = 'self' THEN 10 ELSE 20 END)
      RETURNING id INTO v_form;
    END IF;
    FOR sec IN SELECT section, min(sort_order) AS o FROM acr_questions
                WHERE school_id = p_school AND form_id IS NULL AND part = g.part AND staff_group = g.staff_group
                GROUP BY section ORDER BY min(sort_order), section LOOP
      SELECT id INTO v_sec FROM acr_form_sections WHERE form_id = v_form AND title = sec.section LIMIT 1;
      IF v_sec IS NULL THEN
        INSERT INTO acr_form_sections (school_id, form_id, title, sort_order)
        VALUES (p_school, v_form, sec.section, sec.o) RETURNING id INTO v_sec;
      END IF;
      UPDATE acr_questions SET form_id = v_form, section_id = v_sec
       WHERE school_id = p_school AND form_id IS NULL AND part = g.part AND staff_group = g.staff_group AND section = sec.section;
    END LOOP;
  END LOOP;
  UPDATE acr_levels l SET form_id = (
      SELECT x.id FROM acr_forms x
       WHERE x.school_id = p_school AND x.part = 'level' AND x.active AND x.staff_group IN (l.staff_group, 'both')
       ORDER BY (x.staff_group = l.staff_group) DESC, x.sort_order, x.id LIMIT 1)
   WHERE l.school_id = p_school AND l.form_id IS NULL AND l.action = 'rate';
  UPDATE acr_reports r SET self_form_id = (
      SELECT x.id FROM acr_forms x
       WHERE x.school_id = p_school AND x.part = 'self' AND x.staff_group IN (r.staff_group, 'both')
       ORDER BY (x.staff_group = r.staff_group) DESC, x.sort_order, x.id LIMIT 1)
   WHERE r.school_id = p_school AND r.self_form_id IS NULL;
  UPDATE acr_reviews v SET form_id = (
      SELECT x.id FROM acr_forms x
       WHERE x.school_id = p_school AND x.part = 'level' AND x.staff_group IN (r.staff_group, 'both')
       ORDER BY (x.staff_group = r.staff_group) DESC, x.sort_order, x.id LIMIT 1)
    FROM acr_reports r
   WHERE v.report_id = r.id AND v.school_id = p_school AND v.form_id IS NULL AND v.action = 'rate';
END
$$;
SELECT app.acr_forms_from_questions(id) FROM schools;
