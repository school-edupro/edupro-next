-- Admission duplicates and sign-in codes, part 4 of docs/design/41: closed means closed, with a late-entry
-- passcode. Once a session or a class is closed (or past its closing time) a family can no longer start,
-- save, submit or pay the registration fee of a form; the school admin gives a family a passcode for a
-- class, sent by a formatted email, which opens that class for that family until a date. The passcode is
-- stored hashed and works only for the family it was given to (its email or mobile).

CREATE TABLE admission_passcodes (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  cycle_id     BIGINT NOT NULL REFERENCES admission_cycles(id) ON DELETE CASCADE,
  class_id     BIGINT NOT NULL REFERENCES classes(id),
  -- the family it is for: the email it is sent to, and the mobile they may sign in with
  email        TEXT NOT NULL CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  mobile       TEXT CHECK (mobile ~ '^[6-9][0-9]{9}$'),
  child_name   TEXT,
  code_hash    TEXT NOT NULL,
  valid_until  TIMESTAMPTZ NOT NULL,
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  sent_at      TIMESTAMPTZ,
  message_id   BIGINT,
  -- the family that used it (it keeps working for them until valid_until)
  used_by      BIGINT REFERENCES applicants(id),
  used_at      TIMESTAMPTZ,
  note         TEXT,
  created_by   BIGINT REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_by   BIGINT REFERENCES users(id),
  revoked_at   TIMESTAMPTZ,
  UNIQUE (school_id, code_hash)
);
CREATE INDEX admission_passcodes_cycle ON admission_passcodes (cycle_id, created_at DESC);
CALL app.apply_tenant_rls('admission_passcodes');
CREATE TRIGGER admission_passcodes_audit AFTER INSERT OR UPDATE OR DELETE ON admission_passcodes FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

-- the passcode email on the school's letterhead
CREATE OR REPLACE FUNCTION app.admission_passcode_send(p_email TEXT, p_code TEXT, p_class TEXT, p_session TEXT,
                                                        p_until TEXT, p_child TEXT)
RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE
  v_school TEXT;
BEGIN
  PERFORM app.assert_context();
  SELECT name INTO v_school FROM schools WHERE id = app.current_school_id();
  INSERT INTO comms_templates (school_id, code, channel, name, subject, body, variables, category)
  VALUES (app.current_school_id(), 'admission_passcode', 'email', 'Admission: late-entry passcode',
          'Your passcode to register for {{class}} at {{school}}',
          'Dear parent, {{school}} has opened the registration for {{class}} for you. Passcode {{passcode}}, valid until {{until}}.',
          '["passcode","class","school","until"]'::jsonb, 'service')
  ON CONFLICT (school_id, code, channel) DO NOTHING;
  RETURN app.admission_mail('admission_passcode', p_email,
    jsonb_build_object('passcode', p_code, 'class', p_class, 'school', v_school, 'until', p_until),
    'Registration opened for you',
    'Registrations at ' || v_school || ' are closed, and the school has opened ' || p_class
      || ' for your family. Sign in to the admission portal with this email or your mobile, enter the passcode under “Late-entry passcode”, then fill the form and pay the registration fee.',
    p_code,
    jsonb_build_array(
      jsonb_build_array('Session', p_session),
      jsonb_build_array('Class', p_class),
      jsonb_build_array('Child', COALESCE(p_child, '')),
      jsonb_build_array('Valid until', p_until)),
    'The passcode works only for your family and only until the date above. Do not share it.');
END
$$;
