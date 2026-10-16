-- Hostel withdrawal through approval levels (16 Oct 2026, docs/design/27-hostel-withdrawal.md part 2):
-- * a built-in role "Hostel Clerk": hostel set-up, allot / transfer / vacate, registers and reports, and
--   hostel withdrawals (start, complete, cancel);
-- * a hostel withdrawal goes through its own approval levels, set on Fee setup -> Approval levels
--   (workflow "hostel_withdrawal", with its own "who may start"); the damages and mess dues are entered
--   when it is started; the last approver chooses carry-forward or refund; the last approval frees the
--   bed, settles the hostel fee and raises the charges as misc fees;
-- * the hostel's steps stay only for a hosteller leaving the school (inside the school withdrawal).

INSERT INTO roles (school_id, code, name, kind, is_system, description) VALUES
  (NULL, 'hostel_clerk', 'Hostel Clerk', 'module', true,
   'Hostel office: set-up, beds (allot, transfer, vacate), registers and reports, hostel withdrawals')
ON CONFLICT (school_id, code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r
  CROSS JOIN (VALUES ('hostel.room.view'), ('hostel.setup.manage'), ('hostel.allot.manage'),
                     ('hostel.withdrawal.view'), ('hostel.withdrawal.manage'), ('hostel.withdrawal.clear'),
                     ('hostel.leave.view'), ('hostel.visit.view'), ('hostel.incident.view'),
                     ('platform.files.upload'), ('platform.files.view')) AS p(code)
 WHERE r.school_id IS NULL AND r.code = 'hostel_clerk'
   AND EXISTS (SELECT 1 FROM permissions x WHERE x.code = p.code)
ON CONFLICT DO NOTHING;

ALTER TABLE hostel_withdrawals DROP CONSTRAINT IF EXISTS hostel_withdrawals_status_check;
ALTER TABLE hostel_withdrawals ADD CONSTRAINT hostel_withdrawals_status_check
  CHECK (status IN ('requested', 'cleared', 'completed', 'cancelled', 'rejected'));
ALTER TABLE hostel_withdrawals
  ADD COLUMN workflow_instance_id BIGINT REFERENCES workflow_instances(id),
  ADD COLUMN damage_charge NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (damage_charge >= 0),
  ADD COLUMN mess_charge NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (mess_charge >= 0),
  ADD COLUMN charge_remarks TEXT,
  ADD COLUMN damage_misc_fee_id BIGINT REFERENCES misc_fees(id),
  ADD COLUMN mess_misc_fee_id BIGINT REFERENCES misc_fees(id),
  ADD COLUMN decided_note TEXT;
DROP INDEX IF EXISTS hostel_withdrawals_open;
CREATE UNIQUE INDEX hostel_withdrawals_open ON hostel_withdrawals (student_id) WHERE status IN ('requested', 'cleared');

-- the hostel's own fee and accounts steps belonged to leaving the hostel, which now goes through the
-- approval levels; what is left of the steps clears a hosteller leaving the school
UPDATE withdrawal_departments SET status = 'inactive', updated_at = now()
 WHERE process = 'hostel' AND code IN ('hostel_fees', 'hostel_accounts');
