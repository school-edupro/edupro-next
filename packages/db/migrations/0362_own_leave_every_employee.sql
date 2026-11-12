-- 0362: My leave and My attendance are every employee's, in the admin app and the staff app (docs/design/85).
-- The right leave.own.apply now comes from being an active employee with a sign-in (the API's employee
-- baseline, AccessService.EMPLOYEE_BASELINE), whatever the roles — none at all included — and no longer from
-- roles: before, staff with no role or only a role the school made (Front Office) had no My leave, and
-- sign-ins with no staff record were shown pages that could only say they are not linked. The API ignores
-- the right on a role or a delegation; the role grants are removed here and the roles screen no longer
-- offers it.
DELETE FROM role_permissions WHERE permission_code = 'leave.own.apply';
UPDATE permissions
   SET description = 'My leave and My attendance: every active employee with a sign-in has it, whatever their roles (not given through roles)',
       updated_at = now()
 WHERE code = 'leave.own.apply';
