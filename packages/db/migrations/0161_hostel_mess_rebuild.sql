-- 0161: the hostel mess rebuilt (docs/design/25-hostel-module.md, 2026-10-16).
--  * Meals are set once for the school (Breakfast, Lunch, Snacks, Dinner) and ticked for the hostels that
--    serve them; a hostel may keep its own time. hostel_meals stays the meal of one hostel (menu, marks and
--    the staff app keep working) and now points at the school's meal.
--  * A rotating menu: each hostel repeats a cycle of 1 to 4 weeks from a Monday; the menu is kept per week
--    of the cycle.
--  * The school's own diet types and allergies; a boarder's diet holds the allergies the kitchen must know.
--  * Mess feedback: a parent rates a meal a child had (1 to 5, with a comment).

-- ---- meals of the school -----------------------------------------------------------------------------------
CREATE TABLE mess_meals (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  name        TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 40),
  at_time     TIME NOT NULL,
  sort_order  INT NOT NULL DEFAULT 0,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  BIGINT
);
CREATE UNIQUE INDEX mess_meals_name ON mess_meals (school_id, lower(btrim(name)));
CALL app.apply_tenant_rls('mess_meals');

ALTER TABLE hostel_meals ADD COLUMN mess_meal_id BIGINT REFERENCES mess_meals(id);
-- the meals already made per hostel become the school's meals (one per name; the earliest time)
INSERT INTO mess_meals (school_id, name, at_time, sort_order)
SELECT school_id, min(name), min(at_time), 0 FROM hostel_meals GROUP BY school_id, lower(btrim(name));
UPDATE hostel_meals hm SET mess_meal_id = mm.id
  FROM mess_meals mm WHERE mm.school_id = hm.school_id AND lower(btrim(mm.name)) = lower(btrim(hm.name));
UPDATE mess_meals mm SET sort_order = x.n
  FROM (SELECT id, row_number() OVER (PARTITION BY school_id ORDER BY at_time, name)::int AS n FROM mess_meals) x
 WHERE x.id = mm.id;
CREATE UNIQUE INDEX hostel_meals_one ON hostel_meals (hostel_id, mess_meal_id) WHERE mess_meal_id IS NOT NULL;

-- ---- the rotating menu -------------------------------------------------------------------------------------
ALTER TABLE hostels
  ADD COLUMN menu_cycle_weeks INT NOT NULL DEFAULT 1 CHECK (menu_cycle_weeks BETWEEN 1 AND 4),
  -- the Monday week 1 of the cycle starts on
  ADD COLUMN menu_cycle_start DATE NOT NULL DEFAULT DATE '2026-01-05' CHECK (extract(isodow FROM menu_cycle_start) = 1);
ALTER TABLE hostel_menu ADD COLUMN cycle_week INT NOT NULL DEFAULT 1 CHECK (cycle_week BETWEEN 1 AND 4);
ALTER TABLE hostel_menu DROP CONSTRAINT IF EXISTS hostel_menu_meal_id_weekday_key;
ALTER TABLE hostel_menu ADD CONSTRAINT hostel_menu_one UNIQUE (meal_id, cycle_week, weekday);

-- ---- diet types and allergies of the school ------------------------------------------------------------------
CREATE TABLE mess_diet_types (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  code        TEXT NOT NULL CHECK (code ~ '^[a-z][a-z0-9_]{0,29}$'),
  name        TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 40),
  sort_order  INT NOT NULL DEFAULT 0,
  active      BOOLEAN NOT NULL DEFAULT true,
  -- the diet of a boarder nobody has set
  is_default  BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (school_id, code)
);
CREATE UNIQUE INDEX mess_diet_types_default ON mess_diet_types (school_id) WHERE is_default;
CALL app.apply_tenant_rls('mess_diet_types');

CREATE TABLE mess_allergies (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  name        TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 40),
  active      BOOLEAN NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX mess_allergies_name ON mess_allergies (school_id, lower(btrim(name)));
CALL app.apply_tenant_rls('mess_allergies');

-- the diet is now one of the school's codes (checked by the service)
ALTER TABLE hostel_diets DROP CONSTRAINT IF EXISTS hostel_diets_diet_check;
ALTER TABLE hostel_diets ADD CONSTRAINT hostel_diets_diet_code CHECK (diet ~ '^[a-z][a-z0-9_]{0,29}$');
ALTER TABLE hostel_diets ADD COLUMN allergies TEXT[] NOT NULL DEFAULT '{}';

-- ---- feedback ------------------------------------------------------------------------------------------------
CREATE TABLE hostel_meal_feedback (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  meal_id     BIGINT NOT NULL REFERENCES hostel_meals(id) ON DELETE CASCADE,
  on_date     DATE NOT NULL,
  student_id  BIGINT NOT NULL REFERENCES students(id),
  rating      INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment     TEXT CHECK (comment IS NULL OR length(comment) <= 500),
  by_user     BIGINT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (meal_id, on_date, student_id, by_user)
);
CREATE INDEX hostel_meal_feedback_by_day ON hostel_meal_feedback (school_id, on_date DESC);
CALL app.apply_tenant_rls('hostel_meal_feedback');
