-- 0185: the ACR flow (docs/design/32-employee-acr.md, part 2). Staff punches give the days present and
-- the late arrivals (first punch after this time); the office enters the leave taken on each ACR (there is
-- no staff leave register yet), as the office did on the earlier ERP's ACR.
ALTER TABLE acr_settings ADD COLUMN staff_late_after TIME NOT NULL DEFAULT '08:00';
ALTER TABLE acr_reports ADD COLUMN office_facts JSONB NOT NULL DEFAULT '{}';
