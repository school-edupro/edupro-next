-- Consent forms, part 2 (docs/design/28-consent-forms.md): a fee through the misc fee ledger, approval of
-- answers by levels set on the form (the pupil's class teacher is a new kind of approver), and editing an
-- answer until a date set on the form, before it is approved, with every earlier version kept.

-- the form's misc fee (one per form, raised at the first answer that carries a fee)
ALTER TABLE consent_forms ADD COLUMN misc_fee_id BIGINT REFERENCES misc_fees(id);

ALTER TABLE consent_form_responses
  ADD COLUMN fee_amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (fee_amount >= 0),
  -- the pupil's line on the form's misc fee (several answers of one pupil share it)
  ADD COLUMN misc_line_id BIGINT REFERENCES misc_fee_students(id),
  ADD COLUMN instance_id BIGINT REFERENCES workflow_instances(id),
  ADD COLUMN decided_at TIMESTAMPTZ,
  ADD COLUMN decided_note TEXT,
  ADD COLUMN edited_at TIMESTAMPTZ,
  ADD COLUMN edits INT NOT NULL DEFAULT 0;

CREATE TABLE consent_form_response_versions (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  response_id  BIGINT NOT NULL REFERENCES consent_form_responses(id) ON DELETE CASCADE,
  answers      JSONB NOT NULL,
  files        JSONB NOT NULL DEFAULT '[]'::jsonb,
  signed_name  TEXT,
  fee_amount   NUMERIC(12, 2) NOT NULL DEFAULT 0,
  -- who wrote this version and when (the version it replaced is the next newer one, or the response)
  written_by   BIGINT,
  written_at   TIMESTAMPTZ NOT NULL,
  replaced_by  BIGINT,
  replaced_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX consent_form_response_versions_response ON consent_form_response_versions (response_id, replaced_at);
CALL app.apply_tenant_rls('consent_form_response_versions');
