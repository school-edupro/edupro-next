-- 0413: the staff app's layout kept by the school (docs/design/94, phase B). The app layouts table (0407) takes a third
-- audience, `staff`: the office's draft and the published copy of the staff app's bottom tabs, Home shortcuts and Home
-- work cards (`DEFAULT_STAFF_LAYOUT` in @edupro/menus until a school publishes). A staff member's own Home shortcuts are
-- a `user_preferences` row (`staff.shortcuts`).
ALTER TABLE family_app_layouts
  DROP CONSTRAINT family_app_layouts_audience_check,
  ADD CONSTRAINT family_app_layouts_audience_check CHECK (audience IN ('parent', 'student', 'staff'));
