-- Sprint 17: workflow engine v1 GA (SLA, reminders, escalation, delegation, cancel/reassign, history),
-- report-card template engine (layout per class band, term releases, defaulter visibility rule,
-- batch render), transport GPS positions (NeverSkip adapter) and the library (accession, copies,
-- circulation, fines). See docs/design/14-report-cards-workflow-ga-library.md.

-- ===========================================================================
-- 1. Workflow v1
-- ===========================================================================
ALTER TABLE workflow_steps
  ADD COLUMN due_at        TIMESTAMPTZ,
  ADD COLUMN reminded_at   TIMESTAMPTZ,
  ADD COLUMN escalated_at  TIMESTAMPTZ,
  ADD COLUMN escalated_to  BIGINT[] NOT NULL DEFAULT '{}';
CREATE INDEX workflow_steps_due ON workflow_steps (school_id, due_at) WHERE status = 'pending';

ALTER TABLE workflow_instances ADD COLUMN cancel_reason TEXT;
ALTER TYPE workflow_status ADD VALUE IF NOT EXISTS 'cancelled';

-- per-instance history (what the inbox and the audit both read)
CREATE TABLE workflow_events (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  instance_id  BIGINT NOT NULL REFERENCES workflow_instances(id) ON DELETE CASCADE,
  step_id      BIGINT REFERENCES workflow_steps(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('started', 'approved', 'rejected', 'cancelled', 'reassigned', 'reminded', 'escalated', 'comment', 'delegated')),
  actor_id     BIGINT,
  note         TEXT,
  detail       JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX workflow_events_by_instance ON workflow_events (instance_id, id);
CALL app.apply_tenant_rls('workflow_events');

-- ===========================================================================
-- 2. Report cards
-- ===========================================================================
CREATE TYPE class_band AS ENUM ('primary', 'middle', 'secondary', 'senior');

ALTER TABLE classes ADD COLUMN band class_band;
COMMENT ON COLUMN classes.band IS 'Report-card band; NULL = derived from display_order (1-5 primary, 6-8 middle, 9-10 secondary, 11-12 senior)';

CREATE TABLE report_card_templates (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  code         TEXT NOT NULL,
  name         TEXT NOT NULL,
  band         class_band NOT NULL,
  layout       JSONB NOT NULL DEFAULT '{}'::jsonb,       -- { sections: [{type, ...options}], showRank, showPhoto, ... }
  body_html    TEXT,                                      -- optional custom HTML (Mustache subset) instead of the layout renderer
  styles_css   TEXT NOT NULL DEFAULT '',
  page_width   TEXT NOT NULL DEFAULT '210mm',
  page_height  TEXT NOT NULL DEFAULT '297mm',
  version      INT NOT NULL DEFAULT 1,
  status       row_status NOT NULL DEFAULT 'active',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at   TIMESTAMPTZ,
  UNIQUE (school_id, code)
);
CALL app.apply_tenant_rls('report_card_templates');

-- a term release: which exams make the term, which template per band, and whether families may see it
CREATE TABLE report_card_releases (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id        BIGINT NOT NULL REFERENCES schools(id),
  academic_year_id BIGINT NOT NULL REFERENCES academic_years(id),
  term_code        TEXT NOT NULL,                          -- T1, T2, FINAL
  name             TEXT NOT NULL,
  exam_ids         BIGINT[] NOT NULL,
  templates        JSONB NOT NULL DEFAULT '{}'::jsonb,     -- { primary: templateId, middle: ..., secondary: ..., senior: ... }
  hide_defaulters  BOOLEAN NOT NULL DEFAULT false,
  defaulter_min    NUMERIC(12, 2) NOT NULL DEFAULT 0,      -- balance above which a family cannot open the card
  status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'released', 'withdrawn')),
  released_at      TIMESTAMPTZ,
  released_by      BIGINT,
  created_by       BIGINT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (academic_year_id, term_code)
);
CALL app.apply_tenant_rls('report_card_releases');

-- one row per pupil per release: the rendered card (export) and the visibility outcome of the batch
CREATE TABLE report_cards (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  release_id   BIGINT NOT NULL REFERENCES report_card_releases(id) ON DELETE CASCADE,
  student_id   BIGINT NOT NULL REFERENCES students(id),
  export_id    BIGINT REFERENCES exports(id),
  withheld     BOOLEAN NOT NULL DEFAULT false,            -- fee defaulter rule at render time
  withheld_reason TEXT,
  rendered_at  TIMESTAMPTZ,
  UNIQUE (release_id, student_id)
);
CALL app.apply_tenant_rls('report_cards');

-- ===========================================================================
-- 3. Transport GPS
-- ===========================================================================
CREATE TABLE vehicle_positions (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  vehicle_id   BIGINT NOT NULL REFERENCES transport_vehicles(id) ON DELETE CASCADE,
  recorded_at  TIMESTAMPTZ NOT NULL,
  lat          NUMERIC(9, 6) NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng          NUMERIC(9, 6) NOT NULL CHECK (lng BETWEEN -180 AND 180),
  speed_kmh    NUMERIC(6, 1),
  heading      NUMERIC(5, 1),
  ignition     BOOLEAN,
  source       TEXT NOT NULL DEFAULT 'neverskip',
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX vehicle_positions_latest ON vehicle_positions (vehicle_id, recorded_at DESC);
CREATE INDEX vehicle_positions_expiry ON vehicle_positions (school_id, received_at);
CALL app.apply_tenant_rls('vehicle_positions');

-- ===========================================================================
-- 4. Library
-- ===========================================================================
CREATE TYPE library_copy_status AS ENUM ('available', 'issued', 'lost', 'damaged', 'withdrawn', 'sold');
CREATE TYPE library_borrower AS ENUM ('student', 'employee');

CREATE TABLE library_titles (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  code         TEXT NOT NULL,                              -- catalogue code (ISBN or the school's own)
  title        TEXT NOT NULL,
  author       TEXT,
  publisher    TEXT,
  edition      TEXT,
  year         INT,
  isbn         TEXT,
  category     TEXT,
  language     TEXT,
  price        NUMERIC(10, 2),
  pages        INT,
  location     TEXT,                                       -- rack / shelf
  is_reference BOOLEAN NOT NULL DEFAULT false,             -- not for issue
  status       row_status NOT NULL DEFAULT 'active',
  legacy_ref   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, code)
);
CREATE INDEX library_titles_search ON library_titles (school_id, lower(title));
CALL app.apply_tenant_rls('library_titles');

CREATE TABLE library_copies (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id     BIGINT NOT NULL REFERENCES schools(id),
  title_id      BIGINT NOT NULL REFERENCES library_titles(id),
  accession_no  TEXT NOT NULL,
  accessioned_on DATE NOT NULL DEFAULT CURRENT_DATE,
  source        TEXT,                                      -- purchase, donation
  price         NUMERIC(10, 2),
  status        library_copy_status NOT NULL DEFAULT 'available',
  remarks       TEXT,
  last_verified_on DATE,                                   -- stock verification (Sprint 18)
  legacy_ref    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, accession_no)
);
CREATE INDEX library_copies_by_title ON library_copies (title_id, status);
CALL app.apply_tenant_rls('library_copies');

CREATE TABLE library_loans (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id      BIGINT NOT NULL REFERENCES schools(id),
  copy_id        BIGINT NOT NULL REFERENCES library_copies(id),
  borrower_kind  library_borrower NOT NULL,
  borrower_id    BIGINT NOT NULL,                          -- students.id or employees.id
  issued_on      DATE NOT NULL DEFAULT CURRENT_DATE,
  due_on         DATE NOT NULL,
  returned_on    DATE,
  renewed        INT NOT NULL DEFAULT 0,
  fine_amount    NUMERIC(10, 2) NOT NULL DEFAULT 0,
  fine_waived    NUMERIC(10, 2) NOT NULL DEFAULT 0,
  fine_paid_on   DATE,
  fine_receipt_id BIGINT REFERENCES misc_receipts(id),
  issued_by      BIGINT,
  returned_by    BIGINT,
  note           TEXT,
  request_id     UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX library_loans_open_copy ON library_loans (copy_id) WHERE returned_on IS NULL;
CREATE INDEX library_loans_by_borrower ON library_loans (school_id, borrower_kind, borrower_id, returned_on);
CREATE INDEX library_loans_overdue ON library_loans (school_id, due_on) WHERE returned_on IS NULL;
CALL app.apply_tenant_rls('library_loans');

-- ===========================================================================
-- 5. Results mart (AI track S17-19: results analytics for the principal)
-- ===========================================================================
CREATE TABLE mart.exam_results (
  school_id        BIGINT NOT NULL,
  academic_year_id BIGINT NOT NULL,
  exam_id          BIGINT NOT NULL,
  exam_code        TEXT NOT NULL,
  exam_name        TEXT NOT NULL,
  class_id         BIGINT NOT NULL,
  class_code       TEXT NOT NULL,
  class_section_id BIGINT,
  section          TEXT,
  pupils           INT NOT NULL,
  complete         INT NOT NULL,
  pass             INT NOT NULL,
  fail             INT NOT NULL,
  mean_pct         NUMERIC(5, 2),
  pass_pct         NUMERIC(5, 2),
  computed_at      TIMESTAMPTZ
);
CREATE UNIQUE INDEX mart_exam_results_key ON mart.exam_results (exam_id, class_id, COALESCE(class_section_id, 0));
CREATE INDEX mart_exam_results_by_school ON mart.exam_results (school_id, academic_year_id);
CALL app.apply_tenant_rls_in('mart', 'exam_results');

CREATE OR REPLACE FUNCTION app.refresh_exam_results_mart() RETURNS INT
LANGUAGE plpgsql AS $$
DECLARE v_n INT;
BEGIN
  PERFORM app.assert_context();
  DELETE FROM mart.exam_results WHERE school_id = app.current_school_id();
  INSERT INTO mart.exam_results (school_id, academic_year_id, exam_id, exam_code, exam_name, class_id, class_code, class_section_id, section,
                                 pupils, complete, pass, fail, mean_pct, pass_pct, computed_at)
  SELECT r.school_id, e.academic_year_id, e.id, e.code, e.name, r.class_id, k.code, g.section_id, g.section_name,
         g.pupils, g.complete, g.pass, g.fail,
         CASE WHEN g.complete > 0 THEN round(g.sum_pct / g.complete, 2) END,
         CASE WHEN g.complete > 0 THEN round(100.0 * g.pass / g.complete, 2) END,
         max(r.computed_at)
    FROM (
      SELECT exam_id, class_id, grp.section_id, grp.section_name,
             count(*) AS pupils,
             count(*) FILTER (WHERE result <> 'incomplete') AS complete,
             count(*) FILTER (WHERE result = 'pass') AS pass,
             count(*) FILTER (WHERE result = 'fail') AS fail,
             COALESCE(sum(pct) FILTER (WHERE result <> 'incomplete'), 0) AS sum_pct
        FROM exam_results x
        CROSS JOIN LATERAL (VALUES (x.class_section_id, (SELECT cs.name FROM class_sections cs WHERE cs.id = x.class_section_id)), (NULL::bigint, NULL::text)) AS grp(section_id, section_name)
       WHERE x.school_id = app.current_school_id()
       GROUP BY exam_id, class_id, grp.section_id, grp.section_name
    ) g
    JOIN exam_results r ON r.exam_id = g.exam_id AND r.class_id = g.class_id AND (r.class_section_id = g.section_id OR g.section_id IS NULL)
    JOIN exams e ON e.id = g.exam_id
    JOIN classes k ON k.id = g.class_id
   GROUP BY r.school_id, e.academic_year_id, e.id, e.code, e.name, r.class_id, k.code, g.section_id, g.section_name,
            g.pupils, g.complete, g.pass, g.fail, g.sum_pct;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

-- ===========================================================================
-- 6. Permissions and grants
-- ===========================================================================
INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('workflow.instance.cancel',   'workflow',  'Cancel a pending approval (the requester or a definition manager)', false),
  ('exams.report_card.view',     'exams',     'View report-card templates, releases and rendered cards', false),
  ('exams.report_card.manage',   'exams',     'Design templates, create and release terms, render cards in batch', false),
  ('exams.family.view',          'exams',     'A family reads released results and report cards of its own children', false),
  ('transport.gps.view',         'transport', 'See vehicle positions', false),
  ('transport.family.track',     'transport', 'A family sees the live position of its child''s bus', false),
  ('library.catalogue.view',               'library',   'Search the catalogue, see copies and loans', false),
  ('library.catalogue.manage',             'library',   'Maintain titles and copies (accession)', false),
  ('library.loan.circulate',          'library',   'Issue, renew and return copies; collect or waive fines', false),
  ('library.family.view',        'library',   'A family sees the loans of its own children', false)
ON CONFLICT (code) DO UPDATE SET module = EXCLUDED.module, description = EXCLUDED.description, requires_mfa = EXCLUDED.requires_mfa;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code IN ('group_admin', 'school_admin')
  AND p.code IN ('workflow.instance.cancel', 'exams.report_card.view', 'exams.report_card.manage', 'transport.gps.view',
                 'library.catalogue.view', 'library.catalogue.manage', 'library.loan.circulate')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code = 'academic_coordinator'
  AND p.code IN ('exams.report_card.view', 'exams.report_card.manage', 'library.catalogue.view')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code IN ('class_teacher', 'subject_teacher')
  AND p.code IN ('exams.report_card.view', 'library.catalogue.view')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code = 'auditor'
  AND p.code IN ('exams.report_card.view', 'transport.gps.view', 'library.catalogue.view')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code = 'parent'
  AND p.code IN ('exams.family.view', 'transport.family.track', 'library.family.view')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code = 'student'
  AND p.code IN ('exams.family.view', 'library.family.view')
ON CONFLICT DO NOTHING;
