-- Admission fees and merit points, part 4 of docs/design/40: the merit list's tie-break.
-- Selection ranks by merit (form points + marks), then the older child first, then a draw of lots for
-- those still equal. The draw's seed is recorded per class the first time a tie needs it, so the order
-- can be replayed and checked; it is printed on the merit list.

ALTER TABLE admission_class_criteria
  ADD COLUMN merit_seed     TEXT CHECK (merit_seed ~ '^[A-Za-z0-9-]{4,40}$'),
  ADD COLUMN merit_seed_at  TIMESTAMPTZ;
