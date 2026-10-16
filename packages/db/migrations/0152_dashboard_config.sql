-- Landing page configuration by the school (docs/design/26-admin-landing.md, part 2): per-widget settings
-- (own title, size, days ahead, rows shown), a lock on the users' own arrangement, quick actions as
-- ordered items with an own label and icon (school links to outside pages too), and landings for the
-- school's own roles (their codes are free text under Access).

ALTER TABLE dashboard_role_defaults DROP CONSTRAINT IF EXISTS dashboard_role_defaults_role_code_check;
ALTER TABLE dashboard_role_defaults ADD CONSTRAINT dashboard_role_defaults_role_code_check
  CHECK (role_code ~ '^[A-Za-z0-9_.-]{1,60}$');

-- {"<widget key>": {"title": "...", "size": "normal|wide", "days": 7, "count": 5}}
ALTER TABLE dashboard_role_defaults ADD COLUMN settings JSONB NOT NULL DEFAULT '{}'::jsonb;
-- true: the users of this role cannot arrange their own page; their own arrangement is not used
ALTER TABLE dashboard_role_defaults ADD COLUMN locked BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN dashboard_role_defaults.quick_actions IS
  'Ordered quick actions: a menu href, or {"href", "label", "icon"} (href may be an https link of the school)';
