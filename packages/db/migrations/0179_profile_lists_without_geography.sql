-- 0179: Profile lists (students and staff) no longer keep Country, State or City. They are the System
-- setup masters Countries, States and Cities, which the forms already read first (a school that has not
-- filled them falls back to the built-in country and state lists in code). The old rows are removed and
-- the master no longer offers those list codes.
DELETE FROM profile_lists WHERE list_code IN ('Country', 'State', 'City');
