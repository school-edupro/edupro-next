-- 0187: staff update their education, languages, work experience and documents from My profile
-- (docs/design/33-people-dashboards.md, 19 Oct 2026). The school sets per list whether staff see it,
-- change it with approval, or change it at once, and the proof document a change needs; row changes
-- (add, edit, remove) ride the same employee_change_requests with keys list:<kind>:<op>:<row>.
ALTER TABLE employee_portal_policies
  ADD COLUMN lists JSONB NOT NULL DEFAULT '{}';
COMMENT ON COLUMN employee_portal_policies.lists IS
  '{ education | languages | experience | documents: { level: hidden | view | edit_approval | edit_direct, proof: employee_document_types.id | null } }';
