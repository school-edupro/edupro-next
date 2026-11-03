-- docs/design/69, part 3: an Indicator teacher assignment names the indicator areas the teacher rates in
-- its section (the areas master). A grade register run "as per mapping" shows such a teacher only those
-- areas; an Indicator assignment with no area picked covers every area (as the rows made before this).
ALTER TABLE teacher_assignments
  ADD COLUMN indicator_area_ids BIGINT[] NOT NULL DEFAULT '{}',
  ADD CONSTRAINT teacher_assignments_indicator_areas
    CHECK (kind = 'indicator' OR cardinality(indicator_area_ids) = 0);
