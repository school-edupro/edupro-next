-- 0221: library staff (docs/design/36-library.md, "Library round 3", part 3). Each library names its staff
-- (employees); a signed-in user whose employee record is named on one or more libraries works only in
-- those: the libraries, shelves, series, copies and subscriptions of the others are not there for them,
-- and with the copies everything that hangs on a copy (loans, fines, charges, sales, stock checks, the
-- reports). A user named on none (the admin) works in all. A book of another library may still be taken
-- back at any desk: the return switches the limit off for its own transaction (app.library_all).
CREATE TABLE library_staff (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id     BIGINT NOT NULL REFERENCES schools(id),
  library_id    BIGINT NOT NULL REFERENCES library_libraries(id) ON DELETE CASCADE,
  employee_id   BIGINT NOT NULL REFERENCES employees(id),
  added_by      BIGINT,
  added_by_name TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (library_id, employee_id)
);
CREATE INDEX library_staff_employee ON library_staff (employee_id);
CALL app.apply_tenant_rls('library_staff');

-- the libraries of the signed-in user (NULL: every library), worked out once a transaction
CREATE OR REPLACE FUNCTION app.my_libraries() RETURNS BIGINT[] LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  v   TEXT := current_setting('app.my_library_ids', true);
  ids BIGINT[];
BEGIN
  IF v IS NOT NULL AND v <> '' THEN
    RETURN CASE WHEN v = 'all' THEN NULL ELSE v::BIGINT[] END;
  END IF;
  IF app.current_user_id() IS NOT NULL THEN
    SELECT array_agg(DISTINCT s.library_id ORDER BY s.library_id) INTO ids
      FROM library_staff s JOIN employees e ON e.id = s.employee_id
     WHERE e.user_id = app.current_user_id() AND e.deleted_at IS NULL
       AND s.school_id = app.current_school_id();
  END IF;
  PERFORM set_config('app.my_library_ids', COALESCE(ids::TEXT, 'all'), true);
  RETURN ids;
END $$;

-- one of my libraries (whatever the switch says)
CREATE OR REPLACE FUNCTION app.library_mine(p_library BIGINT) RETURNS BOOLEAN LANGUAGE sql VOLATILE AS $$
  SELECT p_library = ANY (COALESCE(app.my_libraries(), ARRAY[p_library]))
$$;

-- a row of a library this transaction may see: one of mine, or any while a return has the switch on
CREATE OR REPLACE FUNCTION app.library_ok(p_library BIGINT) RETURNS BOOLEAN LANGUAGE sql VOLATILE AS $$
  SELECT current_setting('app.library_all', true) = 'on' OR app.library_mine(p_library)
$$;

-- the limit, with each table's tenant rule (restrictive: both must hold)
CREATE POLICY library_libraries_staff ON library_libraries AS RESTRICTIVE FOR ALL TO PUBLIC
  USING (app.library_ok(id)) WITH CHECK (app.library_ok(id) OR app.my_libraries() IS NULL);
CREATE POLICY library_shelves_staff ON library_shelves AS RESTRICTIVE FOR ALL TO PUBLIC
  USING (app.library_ok(library_id)) WITH CHECK (app.library_ok(library_id));
CREATE POLICY library_accession_series_staff ON library_accession_series AS RESTRICTIVE FOR ALL TO PUBLIC
  USING (app.library_ok(library_id)) WITH CHECK (app.library_ok(library_id));
CREATE POLICY library_copies_staff ON library_copies AS RESTRICTIVE FOR ALL TO PUBLIC
  USING (app.library_ok(library_id)) WITH CHECK (app.library_ok(library_id));
CREATE POLICY library_subscriptions_staff ON library_subscriptions AS RESTRICTIVE FOR ALL TO PUBLIC
  USING (app.library_ok(library_id)) WITH CHECK (app.library_ok(library_id));
