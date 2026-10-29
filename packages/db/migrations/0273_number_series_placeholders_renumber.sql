-- Number series made easy (docs/design/63): a prefix may hold placeholders ({SESSION}, {YYYY}, {YY},
-- {CLASS}) filled when a number is given, so it may be longer; a registration renumbered from its series
-- keeps its earlier numbers (searches find it by them too).

ALTER TABLE admission_number_series DROP CONSTRAINT admission_number_series_prefix_check;
ALTER TABLE admission_number_series ADD CONSTRAINT admission_number_series_prefix_check
  CHECK (length(prefix) <= 40 AND prefix !~ '\s');

ALTER TABLE applications ADD COLUMN previous_numbers TEXT[] NOT NULL DEFAULT '{}';
