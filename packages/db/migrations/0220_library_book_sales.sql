-- 0220: books sold (docs/design/36-library.md, "Library reports", part 4). A sale is one buyer and one or
-- more books, numbered LS-0001 on: a pupil or a staff member owes it as a misc fee announced at once
-- (head LIBSALE, paid at the fees counter, as a lost book is); someone outside the school pays at the
-- library on a numbered misc receipt (payer "other"). Each book sold keeps its price and the status it
-- was sold from. A file of sales is checked before it is applied.
CREATE TABLE library_sale_orders (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id        BIGINT NOT NULL REFERENCES schools(id),
  sale_no          TEXT NOT NULL,
  sold_on          DATE NOT NULL DEFAULT CURRENT_DATE,
  buyer_kind       TEXT NOT NULL CHECK (buyer_kind IN ('student', 'employee', 'other')),
  buyer_id         BIGINT,
  buyer_name       TEXT NOT NULL,
  buyer_mobile     TEXT,
  books            INT NOT NULL CHECK (books > 0),
  total            NUMERIC(12, 2) NOT NULL CHECK (total >= 0),
  misc_fee_id      BIGINT REFERENCES misc_fees(id),
  misc_line_id     BIGINT REFERENCES misc_fee_students(id),
  misc_receipt_id  BIGINT REFERENCES misc_receipts(id),
  mode             TEXT,
  reference        TEXT,
  note             TEXT,
  upload_id        BIGINT,
  sold_by          BIGINT,
  sold_by_name     TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, sale_no),
  CHECK ((buyer_kind = 'other') = (buyer_id IS NULL))
);
CREATE INDEX library_sale_orders_day ON library_sale_orders (school_id, sold_on);
CREATE INDEX library_sale_orders_buyer ON library_sale_orders (school_id, buyer_kind, buyer_id);
CALL app.apply_tenant_rls('library_sale_orders');

ALTER TABLE library_sales
  ADD COLUMN order_id     BIGINT REFERENCES library_sale_orders(id),
  ADD COLUMN copy_price   NUMERIC(10, 2),
  ADD COLUMN from_status  TEXT;
CREATE INDEX library_sales_order ON library_sales (order_id);

-- the sales made before: one sale each, numbered LS-OLD-<id>
WITH made AS (
  INSERT INTO library_sale_orders (school_id, sale_no, sold_on, buyer_kind, buyer_id, buyer_name, books, total,
                                   reference, note, sold_by, sold_by_name, created_at)
  SELECT s.school_id, 'LS-OLD-' || s.id, s.sold_on,
         CASE WHEN s.buyer_kind IN ('student', 'employee') AND s.buyer_id IS NOT NULL THEN s.buyer_kind ELSE 'other' END,
         CASE WHEN s.buyer_kind IN ('student', 'employee') THEN s.buyer_id END,
         COALESCE(NULLIF(btrim(s.buyer_name), ''), st.display_name, e.display_name, 'Buyer not named'),
         1, s.price, s.receipt_ref, s.note, s.sold_by, u.display_name, s.created_at
    FROM library_sales s
    LEFT JOIN students st ON s.buyer_kind = 'student' AND st.id = s.buyer_id
    LEFT JOIN employees e ON s.buyer_kind = 'employee' AND e.id = s.buyer_id
    LEFT JOIN users u ON u.id = s.sold_by
   WHERE s.order_id IS NULL
  RETURNING id, sale_no)
UPDATE library_sales s SET order_id = made.id FROM made WHERE made.sale_no = 'LS-OLD-' || s.id;

-- a file of sales, checked before it is applied
CREATE TABLE library_sale_uploads (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  file_name   TEXT NOT NULL,
  rows        JSONB NOT NULL,
  status      TEXT NOT NULL DEFAULT 'checked' CHECK (status IN ('checked', 'applied', 'discarded')),
  result      JSONB,
  by_user     BIGINT,
  by_name     TEXT,
  at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_at  TIMESTAMPTZ
);
CALL app.apply_tenant_rls('library_sale_uploads');
