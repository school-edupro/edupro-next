-- 0219: stock verification in cycles (docs/design/36-library.md, "Library reports", part 3). A cycle covers
-- the libraries, shelves and material types chosen (none chosen: all); several cycles may be open when no
-- copy is in two. A copy is verified by a scan, an Excel or text file of book numbers (checked before it
-- is applied) or by hand, each kept with who, when and how; numbers outside the cycle or unknown are kept
-- too. A book on loan is counted when the cycle closes (one returned meanwhile is looked for on the shelf);
-- a copy lost, withdrawn or sold during the cycle is not missing.
DO $$
DECLARE v TEXT;
BEGIN
  FOR v IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'library_stock_checks'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%status%'
  LOOP EXECUTE format('ALTER TABLE library_stock_checks DROP CONSTRAINT %I', v); END LOOP;
  FOR v IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'library_stock_check_items'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%outcome%'
  LOOP EXECUTE format('ALTER TABLE library_stock_check_items DROP CONSTRAINT %I', v); END LOOP;
END $$;

ALTER TABLE library_stock_checks
  ADD CONSTRAINT library_stock_checks_status_check CHECK (status IN ('open', 'closed', 'cancelled')),
  ADD COLUMN library_ids        BIGINT[] NOT NULL DEFAULT '{}',
  ADD COLUMN shelf_ids          BIGINT[] NOT NULL DEFAULT '{}',
  ADD COLUMN material_type_ids  BIGINT[] NOT NULL DEFAULT '{}',
  ADD COLUMN on_loan            INT NOT NULL DEFAULT 0,
  ADD COLUMN gone               INT NOT NULL DEFAULT 0,
  ADD COLUMN missing_marked_lost BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN started_by_name    TEXT,
  ADD COLUMN closed_by_name     TEXT,
  ADD COLUMN cancel_reason      TEXT;
CREATE INDEX library_stock_checks_open ON library_stock_checks (school_id) WHERE status = 'open';

ALTER TABLE library_stock_check_items
  ADD CONSTRAINT library_stock_check_items_outcome_check
    CHECK (outcome IN ('pending', 'found', 'missing', 'on_loan', 'gone')),
  ADD COLUMN found_at       TIMESTAMPTZ,
  ADD COLUMN found_by       BIGINT,
  ADD COLUMN found_by_name  TEXT,
  ADD COLUMN method         TEXT CHECK (method IS NULL OR method IN ('scan', 'excel', 'manual')),
  ADD COLUMN remark         TEXT;
CREATE INDEX library_stock_check_items_copy ON library_stock_check_items (copy_id);
CREATE INDEX library_stock_check_items_outcome ON library_stock_check_items (check_id, outcome);

-- open checks: a book on loan is counted at the close, not at the start
UPDATE library_stock_check_items i SET outcome = 'pending'
  FROM library_stock_checks k WHERE k.id = i.check_id AND k.status = 'open' AND i.outcome = 'on_loan';

-- a number scanned or uploaded that is not in the cycle: a copy outside its scope, or no copy at all
CREATE TABLE library_stock_check_extras (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id  BIGINT NOT NULL REFERENCES schools(id),
  check_id   BIGINT NOT NULL REFERENCES library_stock_checks(id) ON DELETE CASCADE,
  typed      TEXT NOT NULL,
  copy_id    BIGINT REFERENCES library_copies(id),
  kind       TEXT NOT NULL CHECK (kind IN ('outside', 'unknown')),
  method     TEXT NOT NULL CHECK (method IN ('scan', 'excel', 'manual')),
  remark     TEXT,
  at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  by_user    BIGINT,
  by_name    TEXT
);
CREATE UNIQUE INDEX library_stock_check_extras_once ON library_stock_check_extras (check_id, upper(typed));
CALL app.apply_tenant_rls('library_stock_check_extras');

-- a file of book numbers, checked against the cycle before it is applied
CREATE TABLE library_stock_uploads (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  check_id    BIGINT NOT NULL REFERENCES library_stock_checks(id) ON DELETE CASCADE,
  file_name   TEXT NOT NULL,
  rows        JSONB NOT NULL,           -- [{ "row": 2, "no": "B00001", "remark": "…" }]
  status      TEXT NOT NULL DEFAULT 'checked' CHECK (status IN ('checked', 'applied', 'discarded')),
  result      JSONB,
  by_user     BIGINT,
  by_name     TEXT,
  at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_at  TIMESTAMPTZ
);
CREATE INDEX library_stock_uploads_check ON library_stock_uploads (check_id);
CALL app.apply_tenant_rls('library_stock_uploads');

-- a book found by its accession number, an old number or (last) its barcode
CREATE OR REPLACE FUNCTION app.library_copy_by_number(p_no TEXT) RETURNS BIGINT LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT c.id FROM library_copies c WHERE c.accession_no = btrim(p_no) LIMIT 1),
    (SELECT c.id FROM library_copies c WHERE upper(c.accession_no) = upper(btrim(p_no)) LIMIT 1),
    (SELECT h.copy_id FROM library_accession_changes h
      WHERE upper(h.old_no) = upper(btrim(p_no)) ORDER BY h.changed_at DESC, h.id DESC LIMIT 1),
    (SELECT c.id FROM library_copies c WHERE upper(c.barcode) = upper(btrim(p_no)) AND btrim(p_no) <> '' LIMIT 1))
$$;
