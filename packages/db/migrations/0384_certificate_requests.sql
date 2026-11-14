-- 0384: certificate management, phase C (docs/design/87). Parents (for a child), students and staff request a
-- certificate online — the type, the purpose, how many copies, a note; the office can enter one for them too. The
-- request goes through the approval levels set on the type (EduPro's approver levels), then, when the type charges a
-- fee, waits for the fee (a misc fee on the student, paid online or at the desk); the office issues it and the
-- requester downloads it in their app. A type's request settings live in certificate_types.request (0381):
-- {"open": {"parent": bool, "student": bool, "staff": bool}, "purposes": [..], "maxCopies": n, "fee": n | null,
--  "levels": [{"kind": "office" | "class_teacher" | "signatory"} | {"kind": "role", "roleId"} | {"kind": "user", "userId"}]}.

CREATE TABLE certificate_requests (
  id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id            BIGINT NOT NULL REFERENCES schools(id),
  type_id              BIGINT NOT NULL REFERENCES certificate_types(id),
  student_id           BIGINT REFERENCES students(id),
  employee_id          BIGINT REFERENCES employees(id),
  requested_by         BIGINT REFERENCES users(id),
  -- who asked: the parent app (a parent for a child), a student, a staff member, or the office on their behalf
  channel              TEXT NOT NULL CHECK (channel IN ('parent', 'student', 'staff', 'office')),
  purpose              TEXT CHECK (purpose IS NULL OR length(purpose) <= 200),
  copies               INT NOT NULL DEFAULT 1 CHECK (copies BETWEEN 1 AND 10),
  note                 TEXT CHECK (note IS NULL OR length(note) <= 500),
  -- submitted → (levels) → approved → (fee) → issued; or rejected / withdrawn
  status               TEXT NOT NULL DEFAULT 'submitted'
                       CHECK (status IN ('submitted', 'approved', 'issued', 'rejected', 'withdrawn')),
  workflow_instance_id BIGINT,
  -- the fee charged for it (a misc fee on the student) and the amount when it was asked
  fee_amount           NUMERIC(12, 2) CHECK (fee_amount IS NULL OR fee_amount >= 0),
  misc_fee_id          BIGINT,
  fee_waived_reason    TEXT CHECK (fee_waived_reason IS NULL OR length(fee_waived_reason) BETWEEN 3 AND 300),
  -- the certificates it was answered with (the original and any copies)
  certificate_ids      BIGINT[] NOT NULL DEFAULT '{}',
  -- the type's checks as they stood when it was asked (shown to the approvers; the issue checks again)
  checks               JSONB NOT NULL DEFAULT '[]'::jsonb,
  decided_by           BIGINT REFERENCES users(id),
  decided_at           TIMESTAMPTZ,
  decision_note        TEXT CHECK (decision_note IS NULL OR length(decision_note) <= 300),
  issued_at            TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((student_id IS NULL) <> (employee_id IS NULL))
);
CREATE INDEX certificate_requests_open ON certificate_requests (school_id, status, created_at);
CREATE INDEX certificate_requests_student ON certificate_requests (student_id) WHERE student_id IS NOT NULL;
CREATE INDEX certificate_requests_employee ON certificate_requests (employee_id) WHERE employee_id IS NOT NULL;
CALL app.apply_tenant_rls('certificate_requests');
CREATE TRIGGER certificate_requests_audit AFTER INSERT OR UPDATE OR DELETE ON certificate_requests
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

-- the certificate a request was answered with points back to it
ALTER TABLE certificates ADD COLUMN request_id BIGINT REFERENCES certificate_requests(id);

-- ready request settings: the everyday types open to parents and students, approved by the office in one step;
-- the TC and character certificate by the office, then the signatory (the principal set in the certificate settings);
-- staff types open to staff
UPDATE certificate_types SET request = CASE
    WHEN code IN ('BONAFIDE', 'DOB', 'STUDY', 'FEE_PAID', 'SCHOLAR', 'BOARD_REG', 'NOC', 'TRAVEL_NOC', 'VISA',
                  'DOMICILE', 'CASTE', 'DOB_JUST')
      THEN '{"open": {"parent": true, "student": true, "staff": false}, "maxCopies": 2, "fee": null,
             "levels": [{"kind": "office"}]}'::jsonb
    WHEN code IN ('TC', 'CHARACTER')
      THEN '{"open": {"parent": true, "student": false, "staff": false}, "maxCopies": 1, "fee": null,
             "levels": [{"kind": "office"}, {"kind": "signatory"}]}'::jsonb
    WHEN code IN ('EXPERIENCE', 'SERVICE', 'STAFF_VISA')
      THEN '{"open": {"parent": false, "student": false, "staff": true}, "maxCopies": 1, "fee": null,
             "levels": [{"kind": "office"}]}'::jsonb
    ELSE request END
 WHERE request = '{}'::jsonb;

-- the certificate office acts on requests in the Approvals inbox too
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'workflow.inbox.act' FROM roles r WHERE r.school_id IS NULL AND r.code = 'certificate_office'
ON CONFLICT DO NOTHING;

-- the messages a requester gets in the app (push only: no e-mail or SMS) as the request moves
CREATE OR REPLACE FUNCTION app.certificate_seed_templates(p_school BIGINT) RETURNS VOID LANGUAGE sql AS $$
  INSERT INTO comms_templates (school_id, code, channel, name, subject, body, variables, category, wa_params)
  SELECT p_school, t.code, 'push'::comms_channel, t.name, NULL, t.body, t.vars::jsonb, 'service', '[]'::jsonb
    FROM (VALUES
      ('certificate_request_approved', 'Certificate request: approved',
       'Your request for the {{type}} of {{person}} is approved. The school will issue it shortly.',
       '["type","person"]'),
      ('certificate_request_fee', 'Certificate request: fee to pay',
       'Your request for the {{type}} of {{person}} is approved. Please pay the fee of Rs {{amount}} (Fees → Misc dues); the certificate is issued once it is paid.',
       '["type","person","amount"]'),
      ('certificate_request_rejected', 'Certificate request: not approved',
       'Your request for the {{type}} of {{person}} is not approved: {{note}}',
       '["type","person","note"]'),
      ('certificate_request_ready', 'Certificate request: ready',
       'The {{type}} of {{person}} ({{number}}) is issued. Download it from Certificates in the app.',
       '["type","person","number"]')
    ) AS t(code, name, body, vars)
  ON CONFLICT (school_id, code, channel) DO NOTHING
$$;
SELECT app.certificate_seed_templates(id) FROM schools WHERE status = 'active';

