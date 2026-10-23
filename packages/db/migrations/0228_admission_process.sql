-- Online admission, part 4 (docs/design/39): the approval process. The school's stages (Document check,
-- Written test, Interview …); processes = ordered stages with approval levels, assigned to classes; the
-- decisions of each level; test / interview slots with admit cards and marks; selection with offers,
-- seats per category and a waiting list.

-- ---- stages -----------------------------------------------------------------------------------------
CREATE TABLE admission_stages (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  name        TEXT NOT NULL,
  -- what the stage records: the papers (and the category), a test or an interview (slots, marks), an
  -- interaction (slots, no marks needed), the selection (offer / waiting list), or the school's own
  kind        TEXT NOT NULL CHECK (kind IN ('document_check', 'test', 'interview', 'interaction', 'selection', 'custom')),
  max_marks   NUMERIC(7, 2) CHECK (max_marks IS NULL OR max_marks > 0),
  sort_order  INT NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX admission_stages_name ON admission_stages (school_id, lower(name));
CALL app.apply_tenant_rls('admission_stages');
CREATE TRIGGER admission_stages_audit AFTER INSERT OR UPDATE OR DELETE ON admission_stages FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

-- ---- processes: ordered steps (stage + approval levels), assigned to classes -------------------------
-- steps: [{ "stageId": "1", "levels": [{ "name": "Office check", "by": "anyone" | "role" | "designation" | "employees",
--          "roleCode": "...", "designation": "...", "employeeIds": ["..."] }] }]
CREATE TABLE admission_processes (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  name        TEXT NOT NULL,
  steps       JSONB NOT NULL DEFAULT '[]'::jsonb,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX admission_processes_name ON admission_processes (school_id, lower(name)) WHERE status = 'active';
CALL app.apply_tenant_rls('admission_processes');
CREATE TRIGGER admission_processes_audit AFTER INSERT OR UPDATE OR DELETE ON admission_processes FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

-- a class follows one process
CREATE TABLE admission_process_classes (
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  class_id    BIGINT NOT NULL REFERENCES classes(id),
  process_id  BIGINT NOT NULL REFERENCES admission_processes(id) ON DELETE CASCADE,
  PRIMARY KEY (school_id, class_id)
);
CALL app.apply_tenant_rls('admission_process_classes');

-- ---- the application's place in its process ---------------------------------------------------------
ALTER TABLE applications
  ADD COLUMN process_id        BIGINT REFERENCES admission_processes(id),
  -- the steps as they were when the process started (changed only by a confirmed process change)
  ADD COLUMN process_steps     JSONB,
  -- the step waiting (0-based; = number of steps when every step is done) and its level (1-based)
  ADD COLUMN stage_no          INT,
  ADD COLUMN level_no          INT,
  ADD COLUMN merit             NUMERIC(9, 2),
  ADD COLUMN wait_rank         INT,
  ADD COLUMN offered_at        TIMESTAMPTZ,
  ADD COLUMN offer_expires_at  TIMESTAMPTZ,
  ADD COLUMN admission_fee     NUMERIC(12, 2);
CREATE INDEX applications_process_stage ON applications (cycle_id, class_id, stage_no) WHERE process_id IS NOT NULL;

-- the days an offer stays open, per session
ALTER TABLE admission_cycles ADD COLUMN offer_days INT NOT NULL DEFAULT 7 CHECK (offer_days BETWEEN 1 AND 90);
-- seats of a category in a class (none: the category takes from the class's seats)
ALTER TABLE admission_fees ADD COLUMN seats INT CHECK (seats IS NULL OR seats >= 0);

-- ---- decisions --------------------------------------------------------------------------------------
CREATE TABLE admission_stage_results (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id        BIGINT NOT NULL REFERENCES schools(id),
  application_id   BIGINT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  stage_id         BIGINT NOT NULL REFERENCES admission_stages(id),
  level            INT NOT NULL CHECK (level >= 1),
  decision         TEXT NOT NULL CHECK (decision IN ('approved', 'rejected', 'hold', 'offered', 'waitlisted')),
  attendance       TEXT CHECK (attendance IN ('present', 'absent')),
  marks            NUMERIC(7, 2) CHECK (marks IS NULL OR marks >= 0),
  max_marks        NUMERIC(7, 2),
  remarks          TEXT,
  decided_by       BIGINT REFERENCES users(id),
  decided_by_name  TEXT,
  decided_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  undone_at        TIMESTAMPTZ,
  undone_by        BIGINT REFERENCES users(id),
  undo_reason      TEXT,
  CHECK (marks IS NULL OR max_marks IS NULL OR marks <= max_marks)
);
CREATE INDEX admission_stage_results_app ON admission_stage_results (application_id, decided_at);
CALL app.apply_tenant_rls('admission_stage_results');
CREATE TRIGGER admission_stage_results_audit AFTER INSERT OR UPDATE OR DELETE ON admission_stage_results FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

-- ---- test / interview slots -------------------------------------------------------------------------
CREATE TABLE admission_slots (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  cycle_id    BIGINT NOT NULL REFERENCES admission_cycles(id) ON DELETE CASCADE,
  stage_id    BIGINT NOT NULL REFERENCES admission_stages(id),
  class_id    BIGINT REFERENCES classes(id),
  starts_at   TIMESTAMPTZ NOT NULL,
  minutes     INT NOT NULL DEFAULT 60 CHECK (minutes BETWEEN 5 AND 600),
  venue       TEXT NOT NULL,
  capacity    INT NOT NULL CHECK (capacity >= 1),
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX admission_slots_cycle ON admission_slots (cycle_id, stage_id, starts_at);
CALL app.apply_tenant_rls('admission_slots');

CREATE TABLE admission_slot_allotments (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id       BIGINT NOT NULL REFERENCES schools(id),
  slot_id         BIGINT NOT NULL REFERENCES admission_slots(id) ON DELETE CASCADE,
  stage_id        BIGINT NOT NULL REFERENCES admission_stages(id),
  application_id  BIGINT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  roll_no         INT NOT NULL,
  notified_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (application_id, stage_id)
);
CREATE INDEX admission_slot_allotments_slot ON admission_slot_allotments (slot_id, roll_no);
CALL app.apply_tenant_rls('admission_slot_allotments');

-- ---- who decides ------------------------------------------------------------------------------------
INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('admissions.application.decide', 'admissions', 'Decide on registrations at the approval levels: approve, send back, reject, record marks', false),
  ('admissions.schedule.manage', 'admissions', 'Set test and interview slots, allot candidates, make offers and keep the waiting list', false)
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r
  CROSS JOIN (VALUES ('admissions.application.decide'), ('admissions.schedule.manage')) AS p(code)
 WHERE r.school_id IS NULL AND r.code IN ('group_admin', 'school_admin')
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'admissions.application.decide' FROM roles r
 WHERE r.school_id IS NULL AND r.code = 'academic_coordinator'
ON CONFLICT DO NOTHING;
