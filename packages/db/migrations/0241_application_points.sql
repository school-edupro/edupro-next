-- Admission fees and merit points, part 3 of docs/design/40: the points of each registration.
-- Worked out from the form's answers on submit, after a correction, and when the session's criteria
-- change, until the office confirms them (Document check). The office may award a criterion differently
-- with a reason. Merit = form points + test / interview marks.

ALTER TABLE applications
  ADD COLUMN form_points          NUMERIC(9, 2),
  -- [{ "name": "Sibling studies here", "max": 20, "auto": 20, "points": 20, "reason": null }]
  ADD COLUMN points_breakdown     JSONB,
  ADD COLUMN points_confirmed_at  TIMESTAMPTZ,
  ADD COLUMN points_confirmed_by  BIGINT REFERENCES users(id);
