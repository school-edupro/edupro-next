-- 0414: a section's indicators, remarks, exam attendance or height and weight reopened for entry while the exam
-- (or the class's lock of that area) stays locked (docs/design/98). As the marks' one-sheet reopen (0312), but these
-- areas have no submit step, so an opening carries its own end:
--  * the school admin opens one section × area with a reason and a closing date-time (default two days);
--  * it is open while `closed_at IS NULL AND closes_at > now()`; the people who normally enter that area there enter;
--  * it closes when the class teacher presses Done (`closed_how = 'done'`), the admin presses Close now ('admin'),
--    the whole exam or the class's lock of that area changes ('lock'), or the date passes (nothing to write: a lapsed
--    row is closed as 'lapsed' when the section's area is next opened, so the one-open-row index lets it through).

CREATE TABLE exam_area_entry_opens (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id         BIGINT NOT NULL REFERENCES schools(id),
  exam_id           BIGINT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  class_section_id  BIGINT NOT NULL REFERENCES class_sections(id),
  area              TEXT NOT NULL CHECK (area IN ('indicators', 'remarks', 'attendance', 'health')),
  reason            TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 500),
  opened_by         BIGINT REFERENCES users(id),
  opened_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  closes_at         TIMESTAMPTZ NOT NULL,
  closed_at         TIMESTAMPTZ,
  closed_by         BIGINT REFERENCES users(id),
  closed_how        TEXT CHECK (closed_how IS NULL OR closed_how IN ('done', 'admin', 'lock', 'lapsed')),
  close_note        TEXT CHECK (close_note IS NULL OR length(close_note) <= 500),
  CHECK (closes_at > opened_at),
  CHECK ((closed_at IS NULL) = (closed_how IS NULL))
);
-- one opening at a time for a section's area (a closed or lapsed one stays as history)
CREATE UNIQUE INDEX exam_area_entry_opens_one ON exam_area_entry_opens (exam_id, class_section_id, area)
  WHERE closed_at IS NULL;
CREATE INDEX exam_area_entry_opens_exam ON exam_area_entry_opens (exam_id, opened_at DESC);
CALL app.apply_tenant_rls('exam_area_entry_opens');
