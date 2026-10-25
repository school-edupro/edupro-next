-- Enquiries as lead management, part 1 (docs/design/45): the school's own stages of a lead, and the
-- lead's facts (score, why it was lost, when it was first contacted). The old status stays and moves in
-- step with the stage both ways, so the reports and the conversion on registration keep working.

CREATE TABLE admission_enquiry_stages (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  code        TEXT NOT NULL CHECK (code ~ '^[a-z][a-z0-9_]{0,29}$'),
  name        TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  -- open: being worked; started: the form begun; registered / admitted: set by the registration; lost
  kind        TEXT NOT NULL CHECK (kind IN ('open', 'started', 'registered', 'admitted', 'lost')),
  sort_order  INT NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  UNIQUE (school_id, code)
);
CALL app.apply_tenant_rls('admission_enquiry_stages');

-- the eight stages a school starts with (renamed, reordered, added to in Admission set-up)
CREATE OR REPLACE FUNCTION app.enquiry_stages_seed(p_school BIGINT) RETURNS VOID LANGUAGE sql AS $$
  INSERT INTO admission_enquiry_stages (school_id, code, name, kind, sort_order)
  SELECT p_school, x.code, x.name, x.kind, x.ord
    FROM (VALUES ('new', 'New', 'open', 1), ('contacted', 'Contacted', 'open', 2), ('interested', 'Interested', 'open', 3),
                 ('campus_visit', 'Campus visit', 'open', 4), ('started', 'Registration started', 'started', 5),
                 ('registered', 'Registered', 'registered', 6), ('admitted', 'Admitted', 'admitted', 7),
                 ('lost', 'Lost', 'lost', 8)) AS x(code, name, kind, ord)
  ON CONFLICT (school_id, code) DO NOTHING
$$;
SELECT app.enquiry_stages_seed(id) FROM schools;

ALTER TABLE admission_enquiries
  ADD COLUMN stage_id         BIGINT REFERENCES admission_enquiry_stages(id),
  ADD COLUMN score            TEXT CHECK (score IN ('hot', 'warm', 'cold')),
  ADD COLUMN lost_reason      TEXT CHECK (lost_reason IS NULL OR length(lost_reason) <= 200),
  ADD COLUMN first_contact_at TIMESTAMPTZ;
CREATE INDEX admission_enquiries_stage ON admission_enquiries (school_id, stage_id);

-- the stage a school's lead of a given kind / code takes (the first active one of that kind)
CREATE OR REPLACE FUNCTION app.enquiry_stage_of(p_school BIGINT, p_code TEXT, p_kind TEXT) RETURNS BIGINT
LANGUAGE sql STABLE AS $$
  SELECT id FROM admission_enquiry_stages
   WHERE school_id = p_school AND status = 'active' AND (code = p_code OR (p_code IS NULL AND kind = p_kind))
   ORDER BY (code = p_code) DESC NULLS LAST, sort_order, id LIMIT 1
$$;

-- stage and status in step: a new stage sets the status; a status set the old way picks the stage
CREATE OR REPLACE FUNCTION app.enquiry_stage_sync() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_kind TEXT;
  v_code TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.stage_id IS DISTINCT FROM OLD.stage_id AND NEW.stage_id IS NOT NULL THEN
    SELECT kind, code INTO v_kind, v_code FROM admission_enquiry_stages WHERE id = NEW.stage_id;
    NEW.status := CASE
      WHEN v_kind IN ('registered', 'admitted') THEN 'converted'
      WHEN v_kind = 'lost' THEN 'not_interested'
      WHEN v_code = 'new' THEN 'new'
      WHEN v_code = 'interested' THEN 'interested'
      ELSE 'follow_up' END;
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status OR NEW.stage_id IS NULL THEN
    IF TG_OP = 'INSERT' AND NEW.stage_id IS NOT NULL THEN RETURN NEW; END IF;
    NEW.stage_id := CASE NEW.status
      WHEN 'new' THEN app.enquiry_stage_of(NEW.school_id, 'new', 'open')
      WHEN 'interested' THEN app.enquiry_stage_of(NEW.school_id, 'interested', 'open')
      WHEN 'follow_up' THEN COALESCE(
        -- a stage of its own further on stays; New moves to Contacted
        CASE WHEN TG_OP = 'UPDATE' AND OLD.stage_id IS NOT NULL
                  AND (SELECT code FROM admission_enquiry_stages WHERE id = OLD.stage_id) <> 'new'
                  AND (SELECT kind FROM admission_enquiry_stages WHERE id = OLD.stage_id) = 'open'
             THEN OLD.stage_id END,
        app.enquiry_stage_of(NEW.school_id, 'contacted', 'open'))
      WHEN 'converted' THEN COALESCE(
        CASE WHEN TG_OP = 'UPDATE' AND (SELECT kind FROM admission_enquiry_stages WHERE id = OLD.stage_id) = 'admitted'
             THEN OLD.stage_id END,
        app.enquiry_stage_of(NEW.school_id, 'registered', 'registered'))
      ELSE app.enquiry_stage_of(NEW.school_id, 'lost', 'lost') END;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER admission_enquiries_stage BEFORE INSERT OR UPDATE ON admission_enquiries
  FOR EACH ROW EXECUTE FUNCTION app.enquiry_stage_sync();

-- every enquiry gets its stage now
UPDATE admission_enquiries SET stage_id = NULL WHERE stage_id IS NULL;

-- the first call, visit, message, reply or invitation counts as the first contact
CREATE OR REPLACE FUNCTION app.enquiry_first_contact() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.mode IN ('call', 'visit', 'email', 'sms', 'whatsapp', 'reply', 'invite') THEN
    UPDATE admission_enquiries SET first_contact_at = COALESCE(first_contact_at, NEW.at) WHERE id = NEW.enquiry_id;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER admission_enquiry_followups_contact AFTER INSERT ON admission_enquiry_followups
  FOR EACH ROW EXECUTE FUNCTION app.enquiry_first_contact();
UPDATE admission_enquiries e
   SET first_contact_at = (SELECT min(f.at) FROM admission_enquiry_followups f
                            WHERE f.enquiry_id = e.id AND f.mode IN ('call', 'visit', 'email', 'sms', 'whatsapp', 'reply', 'invite'))
 WHERE first_contact_at IS NULL;

-- the registration moves its enquiry: a form begun from it, then admitted
CREATE OR REPLACE FUNCTION app.enquiry_follow_registration() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.enquiry_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.status::text = 'admitted' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    UPDATE admission_enquiries
       SET stage_id = COALESCE(app.enquiry_stage_of(school_id, 'admitted', 'admitted'), stage_id), updated_at = now()
     WHERE id = NEW.enquiry_id;
  ELSIF NEW.status::text = 'draft' AND (TG_OP = 'INSERT' OR OLD.enquiry_id IS DISTINCT FROM NEW.enquiry_id) THEN
    UPDATE admission_enquiries e
       SET stage_id = COALESCE(app.enquiry_stage_of(e.school_id, 'started', 'started'), e.stage_id), updated_at = now()
     WHERE e.id = NEW.enquiry_id
       AND (SELECT kind FROM admission_enquiry_stages s WHERE s.id = e.stage_id) IN ('open', 'lost');
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER applications_enquiry_stage AFTER INSERT OR UPDATE OF status, enquiry_id ON applications
  FOR EACH ROW EXECUTE FUNCTION app.enquiry_follow_registration();

-- enquiries already admitted
UPDATE admission_enquiries e
   SET stage_id = app.enquiry_stage_of(e.school_id, 'admitted', 'admitted')
  FROM applications a
 WHERE a.id = e.application_id AND a.status::text = 'admitted';
