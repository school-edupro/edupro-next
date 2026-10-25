-- 0250: the sign-in code tables of 0136 get their owner policy.
--  * auth_otp_challenges and auth_trusted_devices have forced row-level security and, until now, no policy:
--    the application role cannot read them, and the app.otp_* functions (SECURITY DEFINER, owned by
--    edupro_migrator) reached them only because the migrator bypasses RLS on this installation. Where the
--    owner does not bypass RLS (a managed database), forced RLS with no policy hides every row from the
--    functions too, and sign-in with a code stops working.
--  * The owner policy is the one app.apply_tenant_rls gives every table (<table>_migrator). There is still
--    no tenant policy: the codes are issued and checked before a school is known, and the application role
--    keeps going through the functions only (code hashes and attempts are never readable in a tenant
--    transaction; app.otp_screen_log checks the school itself).
DROP POLICY IF EXISTS auth_otp_challenges_migrator ON auth_otp_challenges;
CREATE POLICY auth_otp_challenges_migrator ON auth_otp_challenges FOR ALL TO edupro_migrator USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS auth_trusted_devices_migrator ON auth_trusted_devices;
CREATE POLICY auth_trusted_devices_migrator ON auth_trusted_devices FOR ALL TO edupro_migrator USING (true) WITH CHECK (true);
