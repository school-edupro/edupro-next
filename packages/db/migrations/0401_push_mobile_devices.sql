-- 0401: push to the mobile app (docs/design/89, phase A).
--  * A phone running the EduPro app registers as the app 'mobile' with its platform. Its pushes go through the one
--    EduPro Firebase project (the workers' MOBILE_FCM_SERVICE_ACCOUNT_FILE), not the school's own project, which
--    keeps serving the web apps' pushes.
ALTER TABLE push_devices DROP CONSTRAINT IF EXISTS push_devices_app_check;
ALTER TABLE push_devices ADD CONSTRAINT push_devices_app_check CHECK (app IN ('parent', 'teacher', 'mobile'));
ALTER TABLE push_devices ADD COLUMN platform TEXT CHECK (platform IN ('android', 'ios', 'web'));
