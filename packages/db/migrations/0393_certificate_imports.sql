-- 0393: certificates issued from an Excel sheet (docs/design/87, 17 Nov 2026). The office chooses a certificate and
-- who it is for, downloads a sheet built for that certificate (one row a person, filled from the records), fills or
-- corrects it and uploads it: the upload is kept here as a draft, each row checked as the Issue page checks it (the
-- person, the checks, the details). Rows that are ready are issued (a batch a section or department, in one run);
-- the others stay with what to fix, to correct and upload again into the same draft. A TC row whose withdrawal is not
-- started can have one started from here. The rows live in one JSONB list (a sheet is at most 600 rows); what happens
-- to an upload — uploaded, withdrawals started, issued — is written to the audit log as events (not each row change).
CREATE TABLE certificate_imports (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  type_id     BIGINT NOT NULL REFERENCES certificate_types(id),
  title       TEXT NOT NULL CHECK (length(title) BETWEEN 2 AND 200),
  -- who the sheet was made for (classes and sections, the leavers, departments): shown, and for a fresh sheet
  scope       JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- the file last uploaded into it, and how many uploads
  file_name   TEXT CHECK (file_name IS NULL OR length(file_name) <= 200),
  uploads     INT NOT NULL DEFAULT 1 CHECK (uploads >= 1),
  -- the sheet's columns as read (the errors file is written with them) and each row: the cells, the person found,
  -- what it would print, its state (ready, attention, issued), what to fix, the certificate it became
  columns     JSONB NOT NULL DEFAULT '[]'::jsonb,
  rows        JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- the issue runs made from it (each a batch a section or department, with its PDFs and ZIP)
  run_ids     UUID[] NOT NULL DEFAULT '{}',
  created_by  BIGINT REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  BIGINT REFERENCES users(id),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX certificate_imports_recent ON certificate_imports (school_id, created_at DESC);
CALL app.apply_tenant_rls('certificate_imports');
