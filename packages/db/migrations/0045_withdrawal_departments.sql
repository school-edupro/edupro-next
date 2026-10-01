-- Withdrawal (2026-10-01): school-configured departments that clear a leaving student in steps (same step
-- = in parallel), each with its approvers, an automatic check (fee dues, library books / fines), optional
-- bypass and document; documents on the request; the TC issued from the withdrawal once the departments
-- that gate it (fees) have cleared.
CREATE TABLE withdrawal_departments (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id          BIGINT NOT NULL REFERENCES schools(id),
  code               TEXT NOT NULL,
  name               TEXT NOT NULL,
  step               INT NOT NULL DEFAULT 1 CHECK (step BETWEEN 1 AND 9),
  -- any one of these may act: [{kind: office|class_teacher|role|user, roleId?, userId?, name?}]
  approvers          JSONB NOT NULL DEFAULT '[{"kind":"office"}]'::jsonb,
  auto_check         TEXT NOT NULL DEFAULT 'none' CHECK (auto_check IN ('none', 'fees', 'library')),
  auto_clear         BOOLEAN NOT NULL DEFAULT false,   -- clears by itself when the check finds nothing due
  bypass_allowed     BOOLEAN NOT NULL DEFAULT false,
  document_required  BOOLEAN NOT NULL DEFAULT false,
  gates_tc           BOOLEAN NOT NULL DEFAULT false,   -- the TC may be issued once this has cleared
  sort_order         INT NOT NULL DEFAULT 0,
  status             row_status NOT NULL DEFAULT 'active',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by         BIGINT,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by         BIGINT,
  UNIQUE (school_id, code)
);
CALL app.apply_tenant_rls('withdrawal_departments');

ALTER TABLE student_withdrawals
  ADD COLUMN initiated_on DATE,
  ADD COLUMN remarks TEXT,
  ADD COLUMN documents JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{fileId, name}]
  ADD COLUMN current_step INT,
  ADD COLUMN tc_id BIGINT REFERENCES transfer_certificates(id),
  ADD COLUMN batch_id UUID;                                  -- bulk withdrawals started together

ALTER TABLE withdrawal_clearances
  ADD COLUMN department_id BIGINT REFERENCES withdrawal_departments(id),
  ADD COLUMN step INT NOT NULL DEFAULT 1,
  ADD COLUMN documents JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN bypassed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN auto BOOLEAN NOT NULL DEFAULT false,          -- cleared by the automatic check
  ADD COLUMN check_result JSONB;                            -- what the automatic check found

CREATE INDEX withdrawal_clearances_pending ON withdrawal_clearances (school_id, step) WHERE status <> 'cleared';
