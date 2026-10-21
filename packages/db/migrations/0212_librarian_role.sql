-- A built-in role "Librarian" (docs/design/36-library.md): the library's own staff. Earlier migrations
-- (0032, 0033) granted 'librarian' a privacy request and the hypercare report, but the role itself was
-- never made, so those grants did nothing. The Librarian keeps the library: Library setup, the books and
-- their copies, import, labels, periodicals, circulation and fines, stock checks; finds a borrower by name
-- or number and sees students and staff (no change to them); attaches files; and has what other staff
-- roles have (a privacy request, the hypercare report).

INSERT INTO roles (school_id, code, name, kind, is_system, description) VALUES
  (NULL, 'librarian', 'Librarian', 'module', true,
   'Library: set-up, books and copies, import, labels, periodicals, circulation and fines, stock checks')
ON CONFLICT (school_id, code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r
  CROSS JOIN (VALUES ('library.catalogue.view'), ('library.catalogue.manage'), ('library.loan.circulate'),
                     ('library.stock.verify'), ('people.person.search'), ('people.student.view'),
                     ('people.employee.view'), ('platform.files.upload'), ('platform.files.view'),
                     ('platform.privacy.request'), ('platform.hypercare.report')) AS p(code)
 WHERE r.school_id IS NULL AND r.code = 'librarian'
   AND EXISTS (SELECT 1 FROM permissions x WHERE x.code = p.code)
ON CONFLICT DO NOTHING;
