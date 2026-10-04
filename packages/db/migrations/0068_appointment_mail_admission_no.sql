-- Appointment mails name the pupil with the admission number, like every other place in the module.
-- app.appointment_notify (0064) is long; only the one expression that reads the pupil's name changes.
DO $$
DECLARE
  v_def text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'app' AND p.proname = 'appointment_notify';
  v_new := replace(
    v_def,
    'st.display_name AS student_name',
    'st.display_name || COALESCE('' (Adm. no. '' || st.admission_no || '')'', '''') AS student_name'
  );
  IF v_new = v_def THEN
    RAISE EXCEPTION 'app.appointment_notify: the student name expression was not found';
  END IF;
  EXECUTE v_new;
END $$;
