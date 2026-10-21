-- Library, part 4 (docs/design/36-library.md): books from Excel or CSV, in our layout or the legacy one
-- (BookCode, BookName, Author, ... one row per copy). An upload is checked first and kept: each row with
-- what it would do (a new title, a new copy of a title, an update of a copy, no change, an error), its
-- problems and warnings, and the masters it would add. The import then runs in batches; each row is done
-- or fails on its own (the reason kept); a title made by one row is found by the next rows of the same
-- title.

CREATE TABLE library_imports (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id        BIGINT NOT NULL REFERENCES schools(id),
  file_name        TEXT NOT NULL,
  layout           TEXT NOT NULL CHECK (layout IN ('edupro', 'legacy')),
  status           TEXT NOT NULL DEFAULT 'checked' CHECK (status IN ('checked', 'importing', 'done', 'discarded')),
  total            INT NOT NULL DEFAULT 0,
  summary          JSONB NOT NULL DEFAULT '{}'::jsonb,
  ignored_columns  TEXT[] NOT NULL DEFAULT '{}',
  created_by       BIGINT,
  created_by_name  TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at      TIMESTAMPTZ
);
CREATE INDEX library_imports_recent ON library_imports (school_id, created_at DESC);
CALL app.apply_tenant_rls('library_imports');

CREATE TABLE library_import_rows (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  import_id   BIGINT NOT NULL REFERENCES library_imports(id) ON DELETE CASCADE,
  line        INT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('new_title', 'new_copy', 'update', 'unchanged', 'error')),
  accession_no TEXT,
  title       TEXT,
  data        JSONB NOT NULL DEFAULT '{}'::jsonb,
  errors      TEXT[] NOT NULL DEFAULT '{}',
  warnings    TEXT[] NOT NULL DEFAULT '{}',
  title_key   TEXT,
  state       TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'done', 'failed', 'skipped')),
  result      TEXT,
  title_id    BIGINT REFERENCES library_titles(id) ON DELETE SET NULL
);
CREATE INDEX library_import_rows_by_import ON library_import_rows (import_id, state, line);
CREATE INDEX library_import_rows_by_key ON library_import_rows (import_id, title_key) WHERE title_id IS NOT NULL;
CALL app.apply_tenant_rls('library_import_rows');
