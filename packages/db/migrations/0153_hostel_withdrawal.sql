-- Hostel withdrawal (docs/design/27-hostel-withdrawal.md): a pupil leaves the hostel (and stays in school)
-- through the same step engine as the school withdrawal: departments in steps with their approvers,
-- automatic checks, bypass, documents, and a charge (damages, mess dues) raised as a misc fee. On
-- completion the bed is vacated, the hostel fee stops (a short notice keeps the next month), and the
-- hostel months paid after that are carried forward or refunded. A hosteller's school withdrawal gets the
-- hostel departments marked "also when leaving the school" and vacates the bed on completion.

-- ---- departments: one list per process -----------------------------------------------------------
ALTER TABLE withdrawal_departments ADD COLUMN process TEXT NOT NULL DEFAULT 'school'
  CHECK (process IN ('school', 'hostel'));
ALTER TABLE withdrawal_departments DROP CONSTRAINT withdrawal_departments_school_id_code_key;
ALTER TABLE withdrawal_departments ADD CONSTRAINT withdrawal_departments_process_code_key UNIQUE (school_id, process, code);
ALTER TABLE withdrawal_departments DROP CONSTRAINT IF EXISTS withdrawal_departments_auto_check_check;
ALTER TABLE withdrawal_departments ADD CONSTRAINT withdrawal_departments_auto_check_check
  CHECK (auto_check IN ('none', 'fees', 'library', 'hostel_fees'));
-- the department may raise a charge on the pupil as a misc fee: damages or mess dues
ALTER TABLE withdrawal_departments ADD COLUMN charge_kind TEXT
  CHECK (charge_kind IS NULL OR charge_kind IN ('damage', 'mess'));
-- a hostel department that also clears a hosteller leaving the school
ALTER TABLE withdrawal_departments ADD COLUMN in_school_exit BOOLEAN NOT NULL DEFAULT false;

-- a charge raised at a clearance (school withdrawal of a hosteller, too)
ALTER TABLE withdrawal_clearances
  ADD COLUMN charge NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (charge >= 0),
  ADD COLUMN charge_misc_fee_id BIGINT REFERENCES misc_fees(id);

-- ---- the hostel withdrawal ---------------------------------------------------------------------------
CREATE TABLE hostel_withdrawals (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id         BIGINT NOT NULL REFERENCES schools(id),
  student_id        BIGINT NOT NULL REFERENCES students(id),
  academic_year_id  BIGINT NOT NULL REFERENCES academic_years(id),
  allotment_id      BIGINT NOT NULL REFERENCES hostel_allotments(id),
  requested_on      DATE NOT NULL DEFAULT CURRENT_DATE,   -- the notice is counted from this day
  leaving_on        DATE NOT NULL,
  reason            TEXT NOT NULL CHECK (reason IN ('parent_request', 'discipline', 'health', 'other')),
  remarks           TEXT,
  documents         JSONB NOT NULL DEFAULT '[]'::jsonb,
  status            TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'cleared', 'completed', 'cancelled')),
  current_step      INT,
  -- paid hostel months after the fee stops: carried to the next unpaid fee, or refunded (Accounts decides)
  fee_choice        TEXT NOT NULL DEFAULT 'carry' CHECK (fee_choice IN ('carry', 'refund')),
  notice_days       INT,                -- the school's notice period when it was asked
  notice_short      BOOLEAN NOT NULL DEFAULT false,
  fee_until         DATE,               -- first day of the last month charged, set at completion
  fee_note          TEXT,               -- what the completion did to the fee
  requested_by      BIGINT,
  completed_at      TIMESTAMPTZ,
  completed_by      BIGINT,
  cancelled_at      TIMESTAMPTZ,
  cancel_reason     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by        BIGINT,
  CHECK (leaving_on >= requested_on - 31)
);
CREATE UNIQUE INDEX hostel_withdrawals_open ON hostel_withdrawals (student_id) WHERE status IN ('requested', 'cleared');
CREATE INDEX hostel_withdrawals_school ON hostel_withdrawals (school_id, status, leaving_on);
CALL app.apply_tenant_rls('hostel_withdrawals');
CREATE TRIGGER hostel_withdrawals_audit AFTER INSERT OR UPDATE OR DELETE ON hostel_withdrawals FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

CREATE TABLE hostel_withdrawal_clearances (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id           BIGINT NOT NULL REFERENCES schools(id),
  withdrawal_id       BIGINT NOT NULL REFERENCES hostel_withdrawals(id) ON DELETE CASCADE,
  department          TEXT NOT NULL,
  department_id       BIGINT REFERENCES withdrawal_departments(id),
  step                INT NOT NULL DEFAULT 1,
  status              clearance_status NOT NULL DEFAULT 'pending',
  dues                NUMERIC(12, 2) NOT NULL DEFAULT 0,
  charge              NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (charge >= 0),
  charge_misc_fee_id  BIGINT REFERENCES misc_fees(id),
  remarks             TEXT,
  documents           JSONB NOT NULL DEFAULT '[]'::jsonb,
  bypassed            BOOLEAN NOT NULL DEFAULT false,
  auto                BOOLEAN NOT NULL DEFAULT false,
  check_result        JSONB,
  acted_by            BIGINT,
  acted_at            TIMESTAMPTZ,
  UNIQUE (withdrawal_id, department)
);
CREATE INDEX hostel_withdrawal_clearances_pending ON hostel_withdrawal_clearances (school_id, step) WHERE status <> 'cleared';
CALL app.apply_tenant_rls('hostel_withdrawal_clearances');

-- a refund of hostel months paid after a hostel withdrawal
ALTER TABLE fee_refunds ADD COLUMN hostel_withdrawal_id BIGINT REFERENCES hostel_withdrawals(id);

-- ---- rights --------------------------------------------------------------------------------------------
INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('hostel.withdrawal.view', 'hostel', 'See hostel withdrawals and their register', false),
  ('hostel.withdrawal.manage', 'hostel', 'Start, complete and cancel hostel withdrawals; set their steps', false),
  ('hostel.withdrawal.clear', 'hostel', 'Clear a hostel withdrawal for a department', false)
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r
  JOIN (VALUES ('group_admin', 'hostel.withdrawal.view'), ('group_admin', 'hostel.withdrawal.manage'), ('group_admin', 'hostel.withdrawal.clear'),
               ('school_admin', 'hostel.withdrawal.view'), ('school_admin', 'hostel.withdrawal.manage'), ('school_admin', 'hostel.withdrawal.clear'),
               ('warden', 'hostel.withdrawal.view'), ('warden', 'hostel.withdrawal.manage'), ('warden', 'hostel.withdrawal.clear'),
               ('accountant', 'hostel.withdrawal.view'), ('accountant', 'hostel.withdrawal.clear')) AS p(role, code) ON p.role = r.code
 WHERE r.school_id IS NULL
ON CONFLICT DO NOTHING;
