-- 0392: corrections that keep the certificate number (docs/design/87, 16 Nov 2026). A school may choose that a
-- corrected certificate keeps its number: it becomes revision 2, 3 … of the same certificate, the paper prints
-- "Revision n · corrected on …", and every revision stays read-only with its own PDF in a change log (who, when, why,
-- what changed, old → new). Off (the default): a correction is a re-issue with a new number, as before.
ALTER TABLE certificate_settings ADD COLUMN corrections_keep_number BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE certificates ADD COLUMN revision INT NOT NULL DEFAULT 1 CHECK (revision >= 1);
ALTER TABLE certificates ADD COLUMN revised_at TIMESTAMPTZ;

CREATE TABLE certificate_revisions (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id           BIGINT NOT NULL REFERENCES schools(id),
  certificate_id      BIGINT NOT NULL REFERENCES certificates(id),
  revision            INT NOT NULL CHECK (revision >= 1),
  -- the paper of this revision, as frozen
  data                JSONB NOT NULL,
  template_version_id BIGINT REFERENCES document_template_versions(id),
  purpose             TEXT,
  issued_on           DATE NOT NULL,
  export_id           BIGINT REFERENCES exports(id),
  -- how it came: the reason and what changed ([{label, from, to}]); revision 1 is the issue
  reason              TEXT CHECK (reason IS NULL OR length(reason) <= 300),
  changes             JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by          BIGINT REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (certificate_id, revision)
);
CALL app.apply_tenant_rls('certificate_revisions');
CREATE TRIGGER certificate_revisions_audit AFTER INSERT OR UPDATE OR DELETE ON certificate_revisions
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
