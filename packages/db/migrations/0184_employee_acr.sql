-- 0184: employee ACR, the annual confidential report (docs/design/32-employee-acr.md). A cycle per year with a
-- window for the self-appraisal; levels the school sets (how many, who fills each: the employee's ACR HOD or
-- L1–L3 approver from the employee record, a role, a designation or a named person; each level rates or
-- reviews); a question bank for the self-appraisal and for rating (teaching, non-teaching or both); grade
-- bands on the score; the report disclosed to the employee, who acknowledges or objects within N days.

INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('people.acr.manage', 'people', 'Set up ACR cycles, levels, questions and grades; start, disclose and close ACRs', false),
  ('people.acr.view', 'people', 'See every employee''s ACR and the progress board', false)
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN (VALUES ('people.acr.manage'), ('people.acr.view')) AS p(code)
 WHERE r.school_id IS NULL AND r.code IN ('school_admin', 'group_admin') AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;

-- one row per school: the rating scale words, the days to object, the grade bands
CREATE TABLE acr_settings (
  school_id            BIGINT PRIMARY KEY REFERENCES schools(id),
  -- the words for each point of a rating, highest first (index 0 = the top of the scale)
  scale_labels         JSONB NOT NULL DEFAULT '["Outstanding", "Very good", "Good", "Average", "Below average"]',
  representation_days  INT NOT NULL DEFAULT 15 CHECK (representation_days BETWEEN 0 AND 90),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by           BIGINT
);
CALL app.apply_tenant_rls('acr_settings');

-- the score % to grade; "adverse" grades let the employee object
CREATE TABLE acr_grade_bands (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  min_pct     NUMERIC(5, 2) NOT NULL CHECK (min_pct BETWEEN 0 AND 100),
  label       TEXT NOT NULL,
  adverse     BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (school_id, min_pct),
  UNIQUE (school_id, label)
);
CALL app.apply_tenant_rls('acr_grade_bands');

CREATE TABLE acr_levels (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  staff_group  TEXT NOT NULL CHECK (staff_group IN ('teaching', 'non_teaching')),
  seq          INT NOT NULL CHECK (seq BETWEEN 1 AND 6),
  label        TEXT NOT NULL,
  -- who fills it: from the employee's own record, or the same people for everyone
  kind         TEXT NOT NULL CHECK (kind IN ('acr_hod', 'approver_l1', 'approver_l2', 'approver_l3', 'role', 'designation', 'employee')),
  role_code    TEXT,
  designation  TEXT,
  employee_id  BIGINT REFERENCES employees(id),
  -- 'rate': the rating questions and remarks; 'review': the grade, agree or not with the level before, remarks
  action       TEXT NOT NULL DEFAULT 'rate' CHECK (action IN ('rate', 'review')),
  UNIQUE (school_id, staff_group, seq)
);
CALL app.apply_tenant_rls('acr_levels');

CREATE TABLE acr_questions (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  -- 'self': the employee answers; 'rate': a rating level answers
  part         TEXT NOT NULL CHECK (part IN ('self', 'rate')),
  staff_group  TEXT NOT NULL CHECK (staff_group IN ('teaching', 'non_teaching', 'both')),
  section      TEXT NOT NULL,
  text         TEXT NOT NULL,
  -- 'scale': 1 to the scale's top (the settings' words); 'text': a written answer
  kind         TEXT NOT NULL CHECK (kind IN ('scale', 'text')),
  weight       NUMERIC(4, 2) NOT NULL DEFAULT 1 CHECK (weight > 0 AND weight <= 10),
  required     BOOLEAN NOT NULL DEFAULT true,
  sort_order   INT NOT NULL DEFAULT 0,
  active       BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX acr_questions_form ON acr_questions (school_id, part, staff_group, sort_order);
CALL app.apply_tenant_rls('acr_questions');

CREATE TABLE acr_cycles (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id          BIGINT NOT NULL REFERENCES schools(id),
  academic_year_id   BIGINT NOT NULL REFERENCES academic_years(id),
  name               TEXT NOT NULL,
  -- the self-appraisal window
  self_from          DATE NOT NULL,
  self_to            DATE NOT NULL CHECK (self_to >= self_from),
  -- reviews should be done by (a target shown to reviewers; not a hard stop)
  review_by          DATE,
  status             TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'closed')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by         BIGINT,
  UNIQUE (school_id, academic_year_id)
);
CALL app.apply_tenant_rls('acr_cycles');

-- one ACR of one employee in one cycle
CREATE TABLE acr_reports (
  id                     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id              BIGINT NOT NULL REFERENCES schools(id),
  cycle_id               BIGINT NOT NULL REFERENCES acr_cycles(id),
  employee_id            BIGINT NOT NULL REFERENCES employees(id),
  staff_group            TEXT NOT NULL CHECK (staff_group IN ('teaching', 'non_teaching')),
  -- self: the employee fills it; review: at level current_level; disclosed: the employee sees it and may
  -- object; represented: an objection waits for a decision; closed: final
  status                 TEXT NOT NULL DEFAULT 'self' CHECK (status IN ('self', 'review', 'disclosed', 'represented', 'closed')),
  current_level          INT,
  self_answers           JSONB NOT NULL DEFAULT '{}',
  -- what was filled in from the school's records when the employee submitted (leave, results, profile, log)
  auto_facts             JSONB,
  self_pct               NUMERIC(5, 2),
  self_submitted_at      TIMESTAMPTZ,
  score_pct              NUMERIC(5, 2),
  grade                  TEXT,
  adverse                BOOLEAN NOT NULL DEFAULT false,
  disclosed_at           TIMESTAMPTZ,
  object_by              DATE,
  acknowledged_at        TIMESTAMPTZ,
  representation         TEXT,
  represented_at         TIMESTAMPTZ,
  decision               TEXT CHECK (decision IN ('upheld', 'revised')),
  decision_note          TEXT,
  decided_by             BIGINT,
  decided_at             TIMESTAMPTZ,
  closed_at              TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cycle_id, employee_id)
);
CREATE INDEX acr_reports_board ON acr_reports (school_id, cycle_id, status);
CALL app.apply_tenant_rls('acr_reports');

-- each level of one ACR: who fills it (resolved when the ACR starts), what they gave
CREATE TABLE acr_reviews (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id        BIGINT NOT NULL REFERENCES schools(id),
  report_id        BIGINT NOT NULL REFERENCES acr_reports(id) ON DELETE CASCADE,
  seq              INT NOT NULL,
  label            TEXT NOT NULL,
  action           TEXT NOT NULL CHECK (action IN ('rate', 'review')),
  -- the people who may fill it (employee ids), from the level's kind
  reviewer_ids     BIGINT[] NOT NULL DEFAULT '{}',
  status           TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'pending', 'done')),
  answers          JSONB NOT NULL DEFAULT '{}',
  remarks          TEXT,
  score_pct        NUMERIC(5, 2),
  grade            TEXT,
  grade_reason     TEXT,
  agreement        TEXT CHECK (agreement IN ('agree', 'partly', 'disagree')),
  filled_by        BIGINT,
  filled_by_name   TEXT,
  filled_at        TIMESTAMPTZ,
  UNIQUE (report_id, seq)
);
CALL app.apply_tenant_rls('acr_reviews');

-- every step: submitted, rated, sent back (with the reason), disclosed, acknowledged, objected, decided
CREATE TABLE acr_events (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  report_id   BIGINT NOT NULL REFERENCES acr_reports(id) ON DELETE CASCADE,
  at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  what        TEXT NOT NULL,
  note        TEXT,
  by_user     BIGINT,
  by_name     TEXT
);
CREATE INDEX acr_events_of ON acr_events (report_id, at);
CALL app.apply_tenant_rls('acr_events');

-- The first set-up of a school: two levels (ACR HOD rates, the Principal reviews), five grade bands and the
-- question bank of the earlier ACR forms (teaching and non-teaching). Nothing is added once a school has any.
CREATE OR REPLACE FUNCTION app.acr_seed(p_school BIGINT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO acr_settings (school_id) VALUES (p_school) ON CONFLICT DO NOTHING;
  IF NOT EXISTS (SELECT 1 FROM acr_grade_bands WHERE school_id = p_school) THEN
    INSERT INTO acr_grade_bands (school_id, min_pct, label, adverse) VALUES
      (p_school, 90, 'Outstanding', false), (p_school, 75, 'Very good', false), (p_school, 60, 'Good', false),
      (p_school, 45, 'Average', true), (p_school, 0, 'Below average', true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM acr_levels WHERE school_id = p_school) THEN
    INSERT INTO acr_levels (school_id, staff_group, seq, label, kind, designation, action) VALUES
      (p_school, 'teaching', 1, 'HOD', 'acr_hod', NULL, 'rate'),
      (p_school, 'teaching', 2, 'Principal', 'designation', 'Principal', 'review'),
      (p_school, 'non_teaching', 1, 'HOD', 'acr_hod', NULL, 'rate'),
      (p_school, 'non_teaching', 2, 'Principal', 'designation', 'Principal', 'review');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM acr_questions WHERE school_id = p_school) THEN
    INSERT INTO acr_questions (school_id, part, staff_group, section, text, kind, sort_order)
    SELECT p_school, x.part, x.grp, x.section, x.text, x.kind, x.n
      FROM (VALUES
        -- teaching self-appraisal
        ('self', 'teaching', 'Self-rating', 'Truthfulness and honesty', 'scale', 10),
        ('self', 'teaching', 'Self-rating', 'Problem solving', 'scale', 20),
        ('self', 'teaching', 'Self-rating', 'Innovation', 'scale', 30),
        ('self', 'teaching', 'Self-rating', 'Leadership and mentoring', 'scale', 40),
        ('self', 'teaching', 'Self-rating', 'Team building', 'scale', 50),
        ('self', 'teaching', 'Self-rating', 'Hard work', 'scale', 60),
        ('self', 'teaching', 'Self-rating', 'Classroom performance', 'scale', 70),
        ('self', 'teaching', 'Self-rating', 'Meeting academic targets', 'scale', 80),
        ('self', 'teaching', 'Self-rating', 'Results against effort', 'scale', 90),
        ('self', 'teaching', 'Self-rating', 'Consistency', 'scale', 100),
        ('self', 'teaching', 'Teaching', 'Innovations and experiments in teaching', 'text', 110),
        ('self', 'teaching', 'Teaching', 'Weaker and talented students: action taken and the result', 'text', 120),
        ('self', 'teaching', 'Contribution', 'School functions, competitions, sports and community service', 'text', 130),
        ('self', 'teaching', 'Contribution', 'Special responsibilities held', 'text', 140),
        ('self', 'teaching', 'Contribution', 'Seminars, workshops and training attended', 'text', 150),
        ('self', 'teaching', 'Contribution', 'Publications, awards and recognition', 'text', 160),
        ('self', 'teaching', 'Looking ahead', 'Shortfalls and constraints faced', 'text', 170),
        ('self', 'teaching', 'Looking ahead', 'Support needed (new methods, training)', 'text', 180),
        ('self', 'teaching', 'Looking ahead', 'Two books read this year', 'text', 190),
        ('self', 'teaching', 'Looking ahead', 'Areas of interest for next year', 'text', 200),
        -- non-teaching self-appraisal
        ('self', 'non_teaching', 'Self-rating', 'Attendance and punctuality', 'scale', 10),
        ('self', 'non_teaching', 'Self-rating', 'Discipline and conduct', 'scale', 20),
        ('self', 'non_teaching', 'Self-rating', 'Communication', 'scale', 30),
        ('self', 'non_teaching', 'Self-rating', 'Record keeping', 'scale', 40),
        ('self', 'non_teaching', 'Self-rating', 'Time management', 'scale', 50),
        ('self', 'non_teaching', 'Self-rating', 'Coordination with staff and parents', 'scale', 60),
        ('self', 'non_teaching', 'Self-rating', 'Teamwork', 'scale', 70),
        ('self', 'non_teaching', 'Self-rating', 'Problem solving', 'scale', 80),
        ('self', 'non_teaching', 'Self-rating', 'Confidentiality', 'scale', 90),
        ('self', 'non_teaching', 'Self-rating', 'Computer and ERP skills', 'scale', 100),
        ('self', 'non_teaching', 'Self-rating', 'Responsiveness', 'scale', 110),
        ('self', 'non_teaching', 'Self-rating', 'Initiative and ownership', 'scale', 120),
        ('self', 'non_teaching', 'Work', 'Key responsibilities', 'text', 130),
        ('self', 'non_teaching', 'Work', 'Major contributions this year', 'text', 140),
        ('self', 'non_teaching', 'Work', 'Challenges faced', 'text', 150),
        ('self', 'non_teaching', 'Work', 'Training attended', 'text', 160),
        ('self', 'non_teaching', 'Work', 'Self-improvement plan', 'text', 170),
        -- rating, teaching
        ('rate', 'teaching', 'Professional competence', 'Power of expression', 'scale', 10),
        ('rate', 'teaching', 'Professional competence', 'Knowledge of the subject', 'scale', 20),
        ('rate', 'teaching', 'Professional competence', 'Lesson planning and preparation', 'scale', 30),
        ('rate', 'teaching', 'Professional competence', 'Class management', 'scale', 40),
        ('rate', 'teaching', 'Professional competence', 'Use of teaching aids and ICT', 'scale', 50),
        ('rate', 'teaching', 'Attitude and enthusiasm', 'Enthusiasm for work', 'scale', 60),
        ('rate', 'teaching', 'Attitude and enthusiasm', 'Openness to new ideas', 'scale', 70),
        ('rate', 'teaching', 'Dependability', 'Punctuality', 'scale', 80),
        ('rate', 'teaching', 'Dependability', 'Meets deadlines', 'scale', 90),
        ('rate', 'teaching', 'Dependability', 'Owns responsibility', 'scale', 100),
        ('rate', 'teaching', 'Initiative and resourcefulness', 'Creative thinking', 'scale', 110),
        ('rate', 'teaching', 'Initiative and resourcefulness', 'Solves problems', 'scale', 120),
        ('rate', 'teaching', 'Integrity and loyalty', 'Honesty', 'scale', 130),
        ('rate', 'teaching', 'Integrity and loyalty', 'Keeps confidences', 'scale', 140),
        ('rate', 'teaching', 'Interpersonal skills', 'Communication with students and parents', 'scale', 150),
        ('rate', 'teaching', 'Interpersonal skills', 'Relations with colleagues', 'scale', 160),
        ('rate', 'teaching', 'Teamwork', 'Cooperation', 'scale', 170),
        ('rate', 'teaching', 'Teamwork', 'Helps colleagues', 'scale', 180),
        ('rate', 'teaching', 'Remarks', 'Personal problems affecting performance', 'text', 190),
        ('rate', 'teaching', 'Remarks', 'Areas needing support for growth', 'text', 200),
        ('rate', 'teaching', 'Remarks', 'Frequent complaints from parents, students or colleagues', 'text', 210),
        ('rate', 'teaching', 'Remarks', 'Sparks of outstanding performance', 'text', 220),
        -- rating, non-teaching
        ('rate', 'non_teaching', 'Professional competence', 'Power of expression', 'scale', 10),
        ('rate', 'non_teaching', 'Professional competence', 'Knowledge of the work', 'scale', 20),
        ('rate', 'non_teaching', 'Professional competence', 'Involvement in office work', 'scale', 30),
        ('rate', 'non_teaching', 'Professional competence', 'Keeps up with rules and procedures', 'scale', 40),
        ('rate', 'non_teaching', 'Professional competence', 'Quality of effort', 'scale', 50),
        ('rate', 'non_teaching', 'Professional competence', 'Record keeping', 'scale', 60),
        ('rate', 'non_teaching', 'Professional competence', 'Keeps secrecy', 'scale', 70),
        ('rate', 'non_teaching', 'Professional competence', 'Health and fitness for the work', 'scale', 80),
        ('rate', 'non_teaching', 'Dependability', 'Owns responsibility', 'scale', 90),
        ('rate', 'non_teaching', 'Dependability', 'Works without being reminded', 'scale', 100),
        ('rate', 'non_teaching', 'Dependability', 'Punctuality', 'scale', 110),
        ('rate', 'non_teaching', 'Integrity and loyalty', 'Professional integrity', 'scale', 120),
        ('rate', 'non_teaching', 'Integrity and loyalty', 'Financial integrity', 'scale', 130),
        ('rate', 'non_teaching', 'Initiative', 'Creative thinking', 'scale', 140),
        ('rate', 'non_teaching', 'Initiative', 'New ideas', 'scale', 150),
        ('rate', 'non_teaching', 'Initiative', 'Solves problems', 'scale', 160),
        ('rate', 'non_teaching', 'Interpersonal skills', 'Gets along with people', 'scale', 170),
        ('rate', 'non_teaching', 'Interpersonal skills', 'Persuasiveness', 'scale', 180),
        ('rate', 'non_teaching', 'Interpersonal skills', 'Accepts discipline', 'scale', 190),
        ('rate', 'non_teaching', 'Interpersonal skills', 'Relates to all staff', 'scale', 200),
        ('rate', 'non_teaching', 'Interpersonal skills', 'Helps colleagues', 'scale', 210)
      ) AS x(part, grp, section, text, kind, n);
  END IF;
END
$$;
SELECT app.acr_seed(id) FROM schools;
