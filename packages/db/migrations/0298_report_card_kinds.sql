-- docs/design/65 (1 Nov 2026): a release says what kind of card it is. An exam card carries one or more
-- tests (PT1, PT2 …) and prints the periodic-test slip by default; a term card prints the term result
-- of the mark register; an annual card the whole year. A class can have several cards live at once.
ALTER TABLE report_card_releases
  ADD COLUMN kind TEXT NOT NULL DEFAULT 'term' CHECK (kind IN ('exam', 'term', 'annual'));
