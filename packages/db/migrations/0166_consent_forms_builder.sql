-- Consent forms, part 1 (docs/design/28-consent-forms.md): the Sprint 19 forms become a form builder.
-- A form is answered by families (about a pupil), staff, or both; the audience is a rule; the window is
-- a date-time range; one or several responses per person with an optional total cap. A response has a
-- number (CF/<session>/000001), says who answered (family, staff, the office on behalf) and keeps its
-- files. The old tables hold test data only; their rows are carried over.

ALTER TABLE consent_forms
  ADD COLUMN academic_year_id BIGINT REFERENCES academic_years(id),
  ADD COLUMN respondents TEXT NOT NULL DEFAULT 'family' CHECK (respondents IN ('family', 'staff', 'both')),
  -- {success, opensAt, closesAt, repeat: once|many, cap, officeFill}
  ADD COLUMN settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN published_at TIMESTAMPTZ,
  ADD COLUMN closed_at TIMESTAMPTZ,
  ADD COLUMN updated_by BIGINT,
  ADD COLUMN deleted_at TIMESTAMPTZ;

UPDATE consent_forms f SET academic_year_id = (
  SELECT y.id FROM academic_years y WHERE y.school_id = f.school_id ORDER BY (y.status::text = 'active') DESC, y.start_date DESC LIMIT 1);

ALTER TABLE consent_forms DROP CONSTRAINT IF EXISTS consent_forms_status_check;
UPDATE consent_forms SET status = 'published', published_at = created_at WHERE status = 'open';
ALTER TABLE consent_forms ADD CONSTRAINT consent_forms_status_check
  CHECK (status IN ('draft', 'published', 'closed', 'archived'));

-- the old field types: choice = buttons, a typed signature = short text
UPDATE consent_forms SET fields = (
  SELECT COALESCE(jsonb_agg(
           CASE f->>'type' WHEN 'choice' THEN jsonb_set(f, '{type}', '"radio"')
                           WHEN 'signature' THEN jsonb_set(f, '{type}', '"text"')
                           ELSE f END ORDER BY o), '[]'::jsonb)
    FROM jsonb_array_elements(fields) WITH ORDINALITY AS t(f, o));
UPDATE consent_forms SET settings = jsonb_strip_nulls(jsonb_build_object(
  'repeat', 'once', 'officeFill', true,
  'opensAt', CASE WHEN opens_on IS NOT NULL THEN opens_on::text || 'T00:00' END,
  'closesAt', CASE WHEN closes_on IS NOT NULL THEN closes_on::text || 'T23:59' END));

CREATE TABLE consent_form_sequences (
  school_id        BIGINT NOT NULL REFERENCES schools(id),
  academic_year_id BIGINT NOT NULL REFERENCES academic_years(id),
  last_serial      INT NOT NULL,
  PRIMARY KEY (school_id, academic_year_id)
);
CALL app.apply_tenant_rls('consent_form_sequences');

CREATE OR REPLACE FUNCTION app.next_consent_no(p_year_id BIGINT) RETURNS TEXT
LANGUAGE plpgsql AS $$
DECLARE
  v_serial INT;
  v_year TEXT;
BEGIN
  PERFORM app.assert_context();
  SELECT code INTO v_year FROM academic_years WHERE id = p_year_id;
  INSERT INTO consent_form_sequences (school_id, academic_year_id, last_serial) VALUES (app.current_school_id(), p_year_id, 1)
  ON CONFLICT (school_id, academic_year_id) DO UPDATE SET last_serial = consent_form_sequences.last_serial + 1
  RETURNING last_serial INTO v_serial;
  RETURN 'CF/' || COALESCE(v_year, '') || '/' || lpad(v_serial::text, 6, '0');
END
$$;

ALTER TABLE consent_form_responses
  DROP CONSTRAINT IF EXISTS consent_form_responses_form_id_student_id_key,
  ALTER COLUMN student_id DROP NOT NULL,
  ALTER COLUMN signed_name DROP NOT NULL,
  ADD COLUMN number TEXT,
  ADD COLUMN employee_id BIGINT REFERENCES employees(id),
  ADD COLUMN respondent TEXT NOT NULL DEFAULT 'family' CHECK (respondent IN ('family', 'staff', 'office', 'public')),
  ADD COLUMN entered_by BIGINT,
  ADD COLUMN files JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'approved', 'rejected', 'withdrawn')),
  ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD CONSTRAINT consent_form_responses_about CHECK (student_id IS NOT NULL OR employee_id IS NOT NULL OR respondent = 'public');

UPDATE consent_form_responses r SET number = 'CF/OLD/' || lpad(r.id::text, 6, '0');
CREATE UNIQUE INDEX consent_form_responses_number ON consent_form_responses (school_id, number) WHERE number IS NOT NULL;
CREATE INDEX consent_form_responses_form ON consent_form_responses (form_id, student_id, employee_id);
