-- 0420: the nlq views — the data the chatbot's AI model may query (docs/design/103, phase A; docs/data/modules/*.md
-- hold the counting rules each view applies). Each view: owned by edupro_nlq_owner (row-level security binds it to
-- the school), its spine kept to app.nlq_school_id(), readable only by edupro_nlq (through app.nlq_run), described
-- view by view and column by column — the descriptions are all the model is told. No contacts, addresses, birth
-- dates, ID numbers, health details or notes about people.

-- nlq.academic_years: one row is an academic year of the school (planned, active, locked or closed). is_current marks
-- the working year: the active year (the latest-starting one if two are active), as the app picks it.
GRANT SELECT ON academic_years TO edupro_nlq_owner;
CREATE VIEW nlq.academic_years WITH (security_barrier = true) AS
SELECT x.id                                  AS academic_year_id,
       x.code                                AS academic_year,
       x.name,
       x.start_date,
       x.end_date,
       x.status::text                        AS status,
       COALESCE(x.id = cur.id, false)        AS is_current
  FROM academic_years x
  LEFT JOIN LATERAL (SELECT a.id FROM academic_years a
                      WHERE a.school_id = x.school_id AND a.status = 'active'
                      ORDER BY a.start_date DESC, a.id DESC LIMIT 1) cur ON true
 WHERE x.school_id = app.nlq_school_id();
ALTER VIEW nlq.academic_years OWNER TO edupro_nlq_owner;
GRANT SELECT ON nlq.academic_years TO edupro_nlq;
COMMENT ON VIEW nlq.academic_years IS 'One row is one academic year of the school (school session, e.g. 2026-27, usually April to March). Every year is here: planned (next year being set up), active (the working year), locked and closed (past years). For "this year" filter is_current = true; for "last year" take the year whose end_date is just before the current one''s start_date. Other nlq views carry academic_year_id and academic_year (the same code), so join on academic_year_id or filter on academic_year directly. Admission sessions point to the year the children will join, usually the next one.';
COMMENT ON COLUMN nlq.academic_years.academic_year_id IS 'The year''s id; join key to academic_year_id in the other nlq views.';
COMMENT ON COLUMN nlq.academic_years.academic_year IS 'The year''s short code as the school writes it, e.g. 2026-27. The same text appears as academic_year in other nlq views.';
COMMENT ON COLUMN nlq.academic_years.name IS 'The year''s display name, e.g. Session 2026-27.';
COMMENT ON COLUMN nlq.academic_years.start_date IS 'First day of the academic year.';
COMMENT ON COLUMN nlq.academic_years.end_date IS 'Last day of the academic year.';
COMMENT ON COLUMN nlq.academic_years.status IS 'planned (not started, being set up), active (the working year), locked (past year, closed for most changes) or closed (archived past year).';
COMMENT ON COLUMN nlq.academic_years.is_current IS 'True for exactly one year: the school''s working year (status active; the latest-starting one if two are active). False for all others.';

-- nlq.students: one row is one pupil in one academic year (an enrolment: class-section and roll number that year).
-- Left out: cancelled enrolments (admitted by mistake), removed (deleted) and merged duplicate students, erased records.
GRANT SELECT ON enrolments, students, class_sections, classes, academic_years TO edupro_nlq_owner;
CREATE VIEW nlq.students WITH (security_barrier = true) AS
SELECT s.id                                                AS student_id,
       s.admission_no,
       s.display_name                                      AS student_name,
       s.gender::text                                      AS gender,
       NULLIF(btrim(s.category), '')                       AS category,
       NULLIF(btrim(s.house), '')                          AS house,
       x.academic_year_id,
       y.code                                              AS academic_year,
       k.name                                              AS class,
       k.display_order                                     AS class_order,
       cs.name                                             AS section,
       k.code || '-' || cs.name                            AS class_section,
       x.class_section_id,
       x.roll_no,
       x.status::text                                      AS enrolment_status,
       x.joined_on,
       x.ended_on,
       (x.status = 'active' AND s.status = 'active' AND COALESCE(y.id = cur.id, false)) AS is_current
  FROM enrolments x
  JOIN students s        ON s.id = x.student_id
  JOIN academic_years y  ON y.id = x.academic_year_id
  JOIN class_sections cs ON cs.id = x.class_section_id
  JOIN classes k         ON k.id = cs.class_id
  LEFT JOIN LATERAL (SELECT a.id FROM academic_years a
                      WHERE a.school_id = x.school_id AND a.status = 'active'
                      ORDER BY a.start_date DESC, a.id DESC LIMIT 1) cur ON true
 WHERE x.school_id = app.nlq_school_id()
   AND x.status <> 'cancelled'
   AND s.deleted_at IS NULL
   AND s.merged_into_id IS NULL
   AND NOT (s.details ? 'erased_at');
ALTER VIEW nlq.students OWNER TO edupro_nlq_owner;
GRANT SELECT ON nlq.students TO edupro_nlq;
COMMENT ON VIEW nlq.students IS 'One row is one pupil in one academic year: the class, section and roll number the pupil had that year (a pupil studying 5 years has 5 rows). Left out: cancelled enrolments (admissions cancelled as made by mistake), removed and merged duplicate student records, and records erased for data protection. Pupils who left stay, with enrolment_status withdrawn / transferred / left and ended_on. For "how many pupils now" or "strength of a class" filter is_current = true (counts each pupil once). For a past year filter academic_year and enrolment_status <> ''withdrawn'' etc. as needed, or count those on roll on a date with joined_on <= date AND (ended_on IS NULL OR ended_on >= date). Always filter one academic year before counting, or a pupil is counted once per year. Group by class (sort by class_order), class_section, gender, category or house. Join other nlq views on student_id plus academic_year_id (the pupil''s class in that year).';
COMMENT ON COLUMN nlq.students.student_id IS 'The pupil''s id (the same across years); join key to student_id in other nlq views.';
COMMENT ON COLUMN nlq.students.admission_no IS 'The pupil''s admission number (unique in the school, the same across years).';
COMMENT ON COLUMN nlq.students.student_name IS 'The pupil''s full name.';
COMMENT ON COLUMN nlq.students.gender IS 'male, female, other or unspecified (boys = male, girls = female).';
COMMENT ON COLUMN nlq.students.category IS 'Reservation category as recorded, e.g. General, OBC, OBC (Non-Creamy Layer), SC, ST, Other (the school''s own list); empty when not recorded.';
COMMENT ON COLUMN nlq.students.house IS 'The school house the pupil belongs to (e.g. Red, Blue); empty when not set. Today''s value, not per year.';
COMMENT ON COLUMN nlq.students.academic_year_id IS 'The academic year of this enrolment; join key to nlq.academic_years.';
COMMENT ON COLUMN nlq.students.academic_year IS 'The academic year code of this enrolment, e.g. 2026-27.';
COMMENT ON COLUMN nlq.students.class IS 'The class the pupil was in that year, e.g. Nursery, I, VI, XI. Sort by class_order.';
COMMENT ON COLUMN nlq.students.class_order IS 'The class''s position for sorting (lower = junior). Use ORDER BY class_order, not by class name.';
COMMENT ON COLUMN nlq.students.section IS 'The section letter or name within the class, e.g. A, B.';
COMMENT ON COLUMN nlq.students.class_section IS 'Class code and section together, e.g. VI-A; the usual label for a section.';
COMMENT ON COLUMN nlq.students.class_section_id IS 'The class-section''s id; join key to nlq.class_sections.';
COMMENT ON COLUMN nlq.students.roll_no IS 'Roll number in the section that year; empty when not given.';
COMMENT ON COLUMN nlq.students.enrolment_status IS 'active (in the class now), promoted (finished the year and moved to the next year; also used for a pupil kept back in the same class), withdrawn (left through a withdrawal), transferred (left with a transfer certificate), left (left at the year end: transfer-out or passed out). Cancelled admissions are not in this view.';
COMMENT ON COLUMN nlq.students.joined_on IS 'Date the pupil joined this class-section that year.';
COMMENT ON COLUMN nlq.students.ended_on IS 'Date the enrolment ended (leaving date, or the year end when promoted); empty while active.';
COMMENT ON COLUMN nlq.students.is_current IS 'True when the pupil is in this class now: enrolment active, pupil active, and the year is the current working year. Filter is_current = true for today''s strength (one row per pupil).';

-- nlq.class_sections: one row is one class-section of one academic year, with its class teacher and strength.
-- Removed sections are left out. Strength = active enrolments now (a year not yet over) or pupils on roll on the
-- year's last day (a past year); cancelled enrolments, removed / merged / erased students never count.
GRANT SELECT ON class_sections, classes, academic_years, enrolments, students, teacher_assignments, employees TO edupro_nlq_owner;
CREATE VIEW nlq.class_sections WITH (security_barrier = true) AS
SELECT x.id                                                   AS class_section_id,
       x.academic_year_id,
       y.code                                                 AS academic_year,
       k.name                                                 AS class,
       k.display_order                                        AS class_order,
       x.name                                                 AS section,
       k.code || '-' || x.name                                AS class_section,
       ct.employee_name                                       AS class_teacher,
       ct.employee_id                                         AS class_teacher_id,
       x.capacity,
       CASE WHEN y.end_date < (now() AT TIME ZONE 'Asia/Kolkata')::date
            THEN COALESCE(st.at_end, 0) ELSE COALESCE(st.active_now, 0) END        AS strength,
       CASE WHEN y.end_date < (now() AT TIME ZONE 'Asia/Kolkata')::date
            THEN COALESCE(st.boys_end, 0) ELSE COALESCE(st.boys_now, 0) END        AS boys,
       CASE WHEN y.end_date < (now() AT TIME ZONE 'Asia/Kolkata')::date
            THEN COALESCE(st.girls_end, 0) ELSE COALESCE(st.girls_now, 0) END      AS girls,
       COALESCE(y.id = cur.id, false)                         AS is_current_year
  FROM class_sections x
  JOIN classes k        ON k.id = x.class_id
  JOIN academic_years y ON y.id = x.academic_year_id
  LEFT JOIN LATERAL (SELECT a.id FROM academic_years a
                      WHERE a.school_id = x.school_id AND a.status = 'active'
                      ORDER BY a.start_date DESC, a.id DESC LIMIT 1) cur ON true
  LEFT JOIN LATERAL (SELECT ta.employee_id, em.display_name AS employee_name
                       FROM teacher_assignments ta
                       JOIN employees em ON em.id = ta.employee_id
                      WHERE ta.class_section_id = x.id AND ta.kind = 'class_teacher' AND ta.is_actual
                        AND ta.valid_from <= LEAST((now() AT TIME ZONE 'Asia/Kolkata')::date, y.end_date)
                        AND (ta.valid_to IS NULL OR ta.valid_to >= LEAST((now() AT TIME ZONE 'Asia/Kolkata')::date, y.end_date))
                      ORDER BY ta.valid_from DESC, ta.id DESC LIMIT 1) ct ON true
  LEFT JOIN (SELECT e.class_section_id,
                    count(*) FILTER (WHERE e.status = 'active')                              AS active_now,
                    count(*) FILTER (WHERE e.status = 'active' AND s.gender = 'male')        AS boys_now,
                    count(*) FILTER (WHERE e.status = 'active' AND s.gender = 'female')      AS girls_now,
                    count(*) FILTER (WHERE e.joined_on <= ey.end_date
                                       AND (e.ended_on IS NULL OR e.ended_on >= ey.end_date)) AS at_end,
                    count(*) FILTER (WHERE e.joined_on <= ey.end_date AND s.gender = 'male'
                                       AND (e.ended_on IS NULL OR e.ended_on >= ey.end_date)) AS boys_end,
                    count(*) FILTER (WHERE e.joined_on <= ey.end_date AND s.gender = 'female'
                                       AND (e.ended_on IS NULL OR e.ended_on >= ey.end_date)) AS girls_end
               FROM enrolments e
               JOIN academic_years ey ON ey.id = e.academic_year_id
               JOIN students s        ON s.id = e.student_id
              WHERE e.status <> 'cancelled' AND s.deleted_at IS NULL AND s.merged_into_id IS NULL
                AND NOT (s.details ? 'erased_at')
              GROUP BY e.class_section_id) st ON st.class_section_id = x.id
 WHERE x.school_id = app.nlq_school_id()
   AND x.deleted_at IS NULL;
ALTER VIEW nlq.class_sections OWNER TO edupro_nlq_owner;
GRANT SELECT ON nlq.class_sections TO edupro_nlq;
COMMENT ON VIEW nlq.class_sections IS 'One row is one class-section (e.g. VI-A) of one academic year, with its class teacher and number of pupils. Sections are per year: VI-A of 2025-26 and VI-A of 2026-27 are two rows, so filter is_current_year = true (or one academic_year) first. Removed sections are left out. strength counts pupils the way the school''s strength reports do: for the current or a future year, pupils whose enrolment is active now; for a year already over, pupils on the section''s roll on the year''s last day. Cancelled admissions and removed or merged student records never count. Sum strength by class for class strength (sort by class_order). For pupil-level detail use nlq.students on class_section_id.';
COMMENT ON COLUMN nlq.class_sections.class_section_id IS 'The class-section''s id (one per year); join key to class_section_id in nlq.students and other views.';
COMMENT ON COLUMN nlq.class_sections.academic_year_id IS 'The academic year this section belongs to; join key to nlq.academic_years.';
COMMENT ON COLUMN nlq.class_sections.academic_year IS 'The academic year code, e.g. 2026-27.';
COMMENT ON COLUMN nlq.class_sections.class IS 'The class name, e.g. Nursery, I, VI, XII. Sort by class_order.';
COMMENT ON COLUMN nlq.class_sections.class_order IS 'The class''s position for sorting (lower = junior).';
COMMENT ON COLUMN nlq.class_sections.section IS 'The section letter or name, e.g. A.';
COMMENT ON COLUMN nlq.class_sections.class_section IS 'Class code and section together, e.g. VI-A.';
COMMENT ON COLUMN nlq.class_sections.class_teacher IS 'Name of the class teacher (the actual class teacher, not a co-class teacher) assigned today; for a past year, the one assigned on its last day. Empty when none is assigned.';
COMMENT ON COLUMN nlq.class_sections.class_teacher_id IS 'The class teacher''s employee id; join key to employee_id in nlq.staff. Empty when none is assigned.';
COMMENT ON COLUMN nlq.class_sections.capacity IS 'Seats the school set for the section; empty when not set. Vacant seats = capacity - strength.';
COMMENT ON COLUMN nlq.class_sections.strength IS 'Number of pupils in the section (count): active pupils now for the current or a future year; pupils on roll on the last day for a past year.';
COMMENT ON COLUMN nlq.class_sections.boys IS 'Boys counted in strength (gender male).';
COMMENT ON COLUMN nlq.class_sections.girls IS 'Girls counted in strength (gender female). Pupils with gender other or unspecified are in strength but neither boys nor girls.';
COMMENT ON COLUMN nlq.class_sections.is_current_year IS 'True when the section belongs to the current working year.';

-- nlq.staff: one row is one employee of the school (current or former). Removed records (deleted_at) and people
-- erased for data protection are left out; department and designation are the trimmed text on the record (as the
-- leave dashboard reads them); the type is the Staff setup employee type named on the profile.
GRANT SELECT ON employees, employee_types TO edupro_nlq_owner;
CREATE VIEW nlq.staff WITH (security_barrier = true) AS
SELECT x.id                                                                    AS employee_id,
       x.employee_code,
       x.display_name                                                          AS employee_name,
       x.gender::text                                                          AS gender,
       COALESCE(t.name, NULLIF(btrim(x.profile ->> 'staff_type'), ''))         AS staff_type,
       x.employee_type::text                                                   AS staff_group,
       COALESCE(NULLIF(btrim(x.department), ''), 'No department')             AS department,
       NULLIF(btrim(x.designation), '')                                        AS designation,
       x.joined_on,
       x.left_on,
       x.status::text                                                          AS status,
       (x.status = 'active'
        AND (x.left_on IS NULL OR x.left_on >= (now() AT TIME ZONE 'Asia/Kolkata')::date)) AS is_current,
       (x.user_id IS NOT NULL)                                                 AS has_login
  FROM employees x
  LEFT JOIN LATERAL (SELECT t.name FROM employee_types t
                      WHERE lower(t.name) = lower(btrim(x.profile ->> 'staff_type'))
                      ORDER BY (t.status = 'active') DESC, t.id LIMIT 1) t ON true
 WHERE x.school_id = app.nlq_school_id()
   AND x.deleted_at IS NULL
   AND NOT (x.details ? 'erased_at');
ALTER VIEW nlq.staff OWNER TO edupro_nlq_owner;
GRANT SELECT ON nlq.staff TO edupro_nlq;
COMMENT ON VIEW nlq.staff IS 'One row is one employee of the school, current or former (teaching and non-teaching staff). Removed records and people erased for data protection are left out; leavers stay (status inactive, left_on set). For "how many staff do we have" filter is_current = true. Group by department, designation, staff_type (the finer type such as Teaching Regular) or staff_group (teaching / non_teaching / contract / visiting). Department and designation are today''s values on the employee record (no history). Join other staff views on employee_id. A person moved to a sister school appears there as a new employee; here they show left_on = the transfer date.';
COMMENT ON COLUMN nlq.staff.employee_id IS 'The employee''s id; join key to every staff view (nlq.staff_attendance_days, nlq.staff_leave_days, nlq.staff_leave_balances, nlq.teacher_subjects).';
COMMENT ON COLUMN nlq.staff.employee_code IS 'The employee code the school uses (unique in the school), e.g. E0123.';
COMMENT ON COLUMN nlq.staff.employee_name IS 'The employee''s full name.';
COMMENT ON COLUMN nlq.staff.gender IS 'male, female, other or unspecified.';
COMMENT ON COLUMN nlq.staff.staff_type IS 'The employee type from Staff setup (e.g. Teaching Regular, Teaching Contract, Non-Teaching Regular, Visiting Faculty, Class Four); empty when not set.';
COMMENT ON COLUMN nlq.staff.staff_group IS 'The broad group the type gives: teaching, non_teaching, contract or visiting. Use for teaching vs non-teaching counts.';
COMMENT ON COLUMN nlq.staff.department IS 'The department on the employee record today (e.g. Teaching Primary, Accounts, Transport); ''No department'' when empty.';
COMMENT ON COLUMN nlq.staff.designation IS 'The designation on the employee record today (e.g. PGT, TGT, PRT, Accountant, Driver); empty when not set.';
COMMENT ON COLUMN nlq.staff.joined_on IS 'Date of joining the school.';
COMMENT ON COLUMN nlq.staff.left_on IS 'Last working day for those who left (resigned, retired, transferred …); empty while in service. Leavers in a period: left_on between the dates.';
COMMENT ON COLUMN nlq.staff.status IS 'active or inactive (left or switched off by the office).';
COMMENT ON COLUMN nlq.staff.is_current IS 'True when the employee is in service today: status active and no leaving date that has passed.';
COMMENT ON COLUMN nlq.staff.has_login IS 'True when the employee has a sign-in to EduPro (staff app or admin).';

-- nlq.admission_applications: one row is one child's admission application (a registration once numbered) in one
-- admission session. Drafts (form not submitted) and applications of removed sessions are left out. is_admitted =
-- admission fee paid or admitted (the school's admission reports); money taken = posted receipts, refunds = paid ones.
GRANT SELECT ON applications, admission_cycles, academic_years, classes, admission_fee_categories, admission_stages, misc_receipts, fee_heads, admission_refunds TO edupro_nlq_owner;
CREATE VIEW nlq.admission_applications WITH (security_barrier = true) AS
SELECT x.id                                                                 AS application_id,
       x.application_no                                                     AS registration_no,
       x.cycle_id,
       cy.code                                                              AS admission_session,
       cy.name                                                              AS session_name,
       cy.academic_year_id,
       y.code                                                               AS academic_year,
       k.name                                                               AS class,
       k.display_order                                                      AS class_order,
       fc.name                                                              AS fee_category,
       x.child_gender::text                                                 AS gender,
       x.status::text                                                       AS status,
       CASE x.status::text
         WHEN 'submitted' THEN 'Registration fee due' WHEN 'registered' THEN 'Registered'
         WHEN 'under_review' THEN 'Under review' WHEN 'sent_back' THEN 'Correction asked'
         WHEN 'shortlisted' THEN 'Shortlisted' WHEN 'selected' THEN 'Selected' WHEN 'waitlisted' THEN 'Waiting list'
         WHEN 'offered' THEN 'Offered' WHEN 'fee_paid' THEN 'Admission fee paid' WHEN 'admitted' THEN 'Admitted'
         WHEN 'rejected' THEN 'Not selected' WHEN 'withdrawn' THEN 'Withdrawn' WHEN 'cancelled' THEN 'Cancelled'
       END                                                                  AS status_label,
       st.name                                                              AS stage,
       CASE WHEN st.id IS NOT NULL THEN x.level_no END                      AS level_no,
       (x.level_since AT TIME ZONE 'Asia/Kolkata')::date                    AS waiting_since_on,
       (x.application_no IS NOT NULL)                                       AS is_registered,
       (x.status::text IN ('registered', 'under_review', 'sent_back', 'shortlisted')) AS is_in_process,
       (x.status::text IN ('selected', 'waitlisted', 'offered'))            AS is_selected,
       (x.status::text IN ('fee_paid', 'admitted'))                         AS is_admitted,
       (x.status::text = 'admitted')                                        AS in_student_master,
       (x.student_id IS NOT NULL)                                           AS ever_admitted,
       (x.status::text IN ('rejected', 'withdrawn', 'cancelled'))           AS is_closed,
       (x.form_id IS NOT NULL)                                              AS online_form,
       (x.entered_by IS NOT NULL)                                           AS entered_at_desk,
       (x.possible_duplicate_of IS NOT NULL)                                AS possible_duplicate,
       (x.created_at AT TIME ZONE 'Asia/Kolkata')::date                     AS started_on,
       (x.submitted_at AT TIME ZONE 'Asia/Kolkata')::date                   AS submitted_on,
       (x.registered_at AT TIME ZONE 'Asia/Kolkata')::date                  AS registered_on,
       date_trunc('month', (COALESCE(x.registered_at, x.submitted_at) AT TIME ZONE 'Asia/Kolkata'))::date AS month,
       (x.offered_at AT TIME ZONE 'Asia/Kolkata')::date                     AS offered_on,
       (x.offer_expires_at AT TIME ZONE 'Asia/Kolkata')::date               AS offer_expires_on,
       (x.fee_paid_at AT TIME ZONE 'Asia/Kolkata')::date                    AS fee_paid_on,
       (x.admitted_at AT TIME ZONE 'Asia/Kolkata')::date                    AS admitted_on,
       (x.cancelled_at AT TIME ZONE 'Asia/Kolkata')::date                   AS cancelled_on,
       x.registration_fee,
       x.admission_fee,
       COALESCE(m.registration_paid, 0)                                     AS registration_fee_paid,
       COALESCE(m.admission_paid, 0)                                        AS admission_fee_paid,
       COALESCE(r.refunded, 0)                                              AS refunded,
       COALESCE(r.moved_out, 0)                                             AS moved_out,
       x.transfer_credit,
       x.form_points,
       x.merit,
       x.wait_rank,
       x.admission_no,
       x.student_id
  FROM applications x
  JOIN admission_cycles cy ON cy.id = x.cycle_id
  JOIN academic_years y    ON y.id = cy.academic_year_id
  JOIN classes k           ON k.id = x.class_id
  LEFT JOIN admission_fee_categories fc ON fc.id = x.category_id
  LEFT JOIN admission_stages st
         ON st.id = CASE WHEN x.status::text IN ('registered', 'under_review', 'sent_back') AND x.process_steps IS NOT NULL
                          AND x.stage_no < jsonb_array_length(x.process_steps)
                         THEN (x.process_steps -> x.stage_no ->> 'stageId')::bigint END
  LEFT JOIN LATERAL (SELECT sum(mr.amount) FILTER (WHERE h.code = 'ADMREG') AS registration_paid,
                            sum(mr.amount) FILTER (WHERE h.code = 'ADMFEE') AS admission_paid
                       FROM misc_receipts mr JOIN fee_heads h ON h.id = mr.head_id
                      WHERE mr.application_id = x.id AND mr.status = 'posted') m ON true
  LEFT JOIN (SELECT ar.application_id,
                    sum(ar.amount) FILTER (WHERE ar.mode IS DISTINCT FROM 'transfer') AS refunded,
                    sum(ar.amount) FILTER (WHERE ar.mode = 'transfer')                AS moved_out
               FROM admission_refunds ar WHERE ar.status = 'paid'
              GROUP BY ar.application_id) r ON r.application_id = x.id
 WHERE x.school_id = app.nlq_school_id()
   AND x.status <> 'draft'
   AND cy.deleted_at IS NULL;
ALTER VIEW nlq.admission_applications OWNER TO edupro_nlq_owner;
GRANT SELECT ON nlq.admission_applications TO edupro_nlq;
COMMENT ON VIEW nlq.admission_applications IS 'One row is one child''s admission application in one admission session (called a registration once it has a registration number), from form submitted to admitted, rejected or cancelled. Left out: drafts (forms started but not submitted) and applications of removed sessions; no names or contact details of the child or family. Admitted means is_admitted = true (status fee_paid or admitted), as the school''s admission reports count; in_student_master = the student record is made; ever_admitted also keeps those admitted and cancelled later. Registered = is_registered (registration fee paid or none due). Filter one admission_session (or academic_year, the year the children join, usually next year), group by class (sort class_order), status_label, fee_category or stage. Dates are India dates: group registrations by registered_on, offers by offered_on, admissions by fee_paid_on. Money is rupees: *_paid are receipts actually taken (reversed and bounced left out), refunded = refunds paid out in money, moved_out = money carried to another school of the group. A registration moved to another school shows here as cancelled. Join nlq.admission_enquiries on application_id; nlq.students on student_id for the class-section after admission.';
COMMENT ON COLUMN nlq.admission_applications.application_id IS 'The application''s id; join key to nlq.admission_enquiries.application_id.';
COMMENT ON COLUMN nlq.admission_applications.registration_no IS 'The registration number, given when the registration is complete; empty before that (status submitted).';
COMMENT ON COLUMN nlq.admission_applications.cycle_id IS 'The admission session''s id.';
COMMENT ON COLUMN nlq.admission_applications.admission_session IS 'The admission session''s code, e.g. 2027-28.';
COMMENT ON COLUMN nlq.admission_applications.session_name IS 'The admission session''s name, e.g. Admissions 2027-28.';
COMMENT ON COLUMN nlq.admission_applications.academic_year_id IS 'The academic year the children of this session join; join key to nlq.academic_years.';
COMMENT ON COLUMN nlq.admission_applications.academic_year IS 'Code of the year the children join, e.g. 2027-28 (usually the next year).';
COMMENT ON COLUMN nlq.admission_applications.class IS 'The class applied for, e.g. Nursery, I, XI. Sort by class_order.';
COMMENT ON COLUMN nlq.admission_applications.class_order IS 'The class''s position for sorting (lower = junior).';
COMMENT ON COLUMN nlq.admission_applications.fee_category IS 'The fee category the form''s answers put the child in, e.g. General, EWS, Staff ward, Sibling; empty when not set.';
COMMENT ON COLUMN nlq.admission_applications.gender IS 'The child''s gender: male, female, other or unspecified.';
COMMENT ON COLUMN nlq.admission_applications.status IS 'submitted (form in, registration fee due), registered, under_review, sent_back (correction asked of the family), shortlisted, selected (older flow), waitlisted, offered (seat offered, admission fee due; may be part-paid), fee_paid (admission fee paid, admission number given, waiting to be admitted), admitted, rejected (not selected), withdrawn (by the family, or the offer lapsed unpaid), cancelled (by the school, moved to another school, or the admission cancelled later).';
COMMENT ON COLUMN nlq.admission_applications.status_label IS 'The status in the words of the admission lists: Registration fee due, Registered, Under review, Correction asked, Shortlisted, Selected, Waiting list, Offered, Admission fee paid, Admitted, Not selected, Withdrawn, Cancelled.';
COMMENT ON COLUMN nlq.admission_applications.stage IS 'For a registration in the approval process, the stage it waits at, e.g. Document check, Written test, Interview, Selection; empty otherwise.';
COMMENT ON COLUMN nlq.admission_applications.level_no IS 'The approval level it waits at within that stage (1 = first); empty when not waiting.';
COMMENT ON COLUMN nlq.admission_applications.waiting_since_on IS 'Date it reached its current stage and level (India date); days waiting = current_date - waiting_since_on.';
COMMENT ON COLUMN nlq.admission_applications.is_registered IS 'True when a registration number was given (registration complete).';
COMMENT ON COLUMN nlq.admission_applications.is_in_process IS 'True while in the approval process: registered, under_review, sent_back or shortlisted.';
COMMENT ON COLUMN nlq.admission_applications.is_selected IS 'True when selected, on the waiting list or offered a seat (not yet paid).';
COMMENT ON COLUMN nlq.admission_applications.is_admitted IS 'True when admitted as the admission reports count it: admission fee paid (fee_paid) or admitted.';
COMMENT ON COLUMN nlq.admission_applications.in_student_master IS 'True when the student record has been made (status admitted).';
COMMENT ON COLUMN nlq.admission_applications.ever_admitted IS 'True when a student record was made from it at some time, even if the admission was cancelled later.';
COMMENT ON COLUMN nlq.admission_applications.is_closed IS 'True when closed without admission: rejected, withdrawn or cancelled.';
COMMENT ON COLUMN nlq.admission_applications.online_form IS 'True for applications made on the school''s admission forms (the current process); false for the older first-version flow. The admission lists show only true.';
COMMENT ON COLUMN nlq.admission_applications.entered_at_desk IS 'True when the office filled the form at the desk for a walk-in family.';
COMMENT ON COLUMN nlq.admission_applications.possible_duplicate IS 'True when the same child may have applied twice in the session (flagged, not removed).';
COMMENT ON COLUMN nlq.admission_applications.started_on IS 'Date the form was started (India date).';
COMMENT ON COLUMN nlq.admission_applications.submitted_on IS 'Date the form was submitted (India date).';
COMMENT ON COLUMN nlq.admission_applications.registered_on IS 'Date the registration was completed and numbered (India date); empty before.';
COMMENT ON COLUMN nlq.admission_applications.month IS 'First day of the month of registered_on (or submitted_on when not registered); group by it for month-wise registrations.';
COMMENT ON COLUMN nlq.admission_applications.offered_on IS 'Date a seat was offered (India date); empty when not offered.';
COMMENT ON COLUMN nlq.admission_applications.offer_expires_on IS 'Last date to pay the admission fee for the offer (India date).';
COMMENT ON COLUMN nlq.admission_applications.fee_paid_on IS 'Date the admission fee was fully paid and the admission number given (India date).';
COMMENT ON COLUMN nlq.admission_applications.admitted_on IS 'Date the child was admitted into the student records (India date); empty for older-flow admissions, use in_student_master.';
COMMENT ON COLUMN nlq.admission_applications.cancelled_on IS 'Date the application was cancelled (India date).';
COMMENT ON COLUMN nlq.admission_applications.registration_fee IS 'Registration fee asked of this application (rupees), by class and fee category.';
COMMENT ON COLUMN nlq.admission_applications.admission_fee IS 'Admission fee asked with the offer (rupees); empty before an offer.';
COMMENT ON COLUMN nlq.admission_applications.registration_fee_paid IS 'Registration fee actually received (rupees): posted receipts; reversed and bounced left out.';
COMMENT ON COLUMN nlq.admission_applications.admission_fee_paid IS 'Admission fee actually received so far (rupees): posted receipts, part payments added up; reversed and bounced left out.';
COMMENT ON COLUMN nlq.admission_applications.refunded IS 'Money refunded and paid out to the family (rupees), after the school''s deduction.';
COMMENT ON COLUMN nlq.admission_applications.moved_out IS 'Money carried to another school of the group when the registration was moved there (rupees; no cash paid out).';
COMMENT ON COLUMN nlq.admission_applications.transfer_credit IS 'Money brought in from another school of the group not yet used against the admission fee (rupees).';
COMMENT ON COLUMN nlq.admission_applications.form_points IS 'Merit points from the form''s answers (sibling, alumni, distance and similar criteria).';
COMMENT ON COLUMN nlq.admission_applications.merit IS 'Merit total used to rank: form points plus test and interview marks; higher ranks first.';
COMMENT ON COLUMN nlq.admission_applications.wait_rank IS 'Position on the waiting list (1 = next); empty when not waiting.';
COMMENT ON COLUMN nlq.admission_applications.admission_no IS 'The admission number given when the admission fee was paid; empty before. Never given again, even if cancelled.';
COMMENT ON COLUMN nlq.admission_applications.student_id IS 'The student record made at admission; join key to nlq.students. Empty before admission.';

-- nlq.admission_enquiries: one row is one admission enquiry (lead) with its source, stage, counsellor and whether the
-- family went on to register and be admitted (admitted = admission fee paid or admitted, the enquiry report's rule).
-- Left out: the family's names, child's name and date of birth, mobile, e-mail, locality, notes and lost reason.
GRANT SELECT ON admission_enquiries, admission_enquiry_sources, admission_enquiry_stages, admission_enquiry_followups, admission_cycles, academic_years, classes, applications, users, user_school_memberships TO edupro_nlq_owner;
CREATE VIEW nlq.admission_enquiries WITH (security_barrier = true) AS
SELECT x.id                                                                    AS enquiry_id,
       (x.created_at AT TIME ZONE 'Asia/Kolkata')::date                        AS enquired_on,
       date_trunc('month', (x.created_at AT TIME ZONE 'Asia/Kolkata'))::date   AS month,
       x.cycle_id,
       cy.code                                                                 AS admission_session,
       cy.academic_year_id,
       y.code                                                                  AS academic_year,
       k.name                                                                  AS class,
       k.display_order                                                         AS class_order,
       COALESCE(src.name, 'Not given')                                         AS source,
       NULLIF(btrim(x.campaign), '')                                           AS campaign,
       x.from_website,
       x.status,
       st.name                                                                 AS stage,
       st.kind                                                                 AS stage_kind,
       (x.status IN ('new', 'follow_up', 'interested'))                        AS is_open,
       (x.status IN ('not_interested', 'closed'))                              AS is_lost,
       (a.application_no IS NOT NULL)                                          AS is_registered,
       (a.status IN ('fee_paid', 'admitted'))                                  AS is_admitted,
       x.score,
       u.display_name                                                          AS counsellor,
       (x.level = 2)                                                           AS is_escalated,
       x.next_follow_up_on,
       (x.status IN ('new', 'follow_up', 'interested')
        AND x.next_follow_up_on < (now() AT TIME ZONE 'Asia/Kolkata')::date)  AS follow_up_overdue,
       (x.first_contact_at AT TIME ZONE 'Asia/Kolkata')::date                  AS first_contact_on,
       round((extract(epoch FROM (x.first_contact_at - x.created_at)) / 3600.0)::numeric, 1) AS hours_to_first_contact,
       (x.status IN ('new', 'follow_up', 'interested') AND x.first_contact_at IS NULL
        AND x.contact_due_at < now())                                          AS first_contact_late,
       (x.last_contact_at AT TIME ZONE 'Asia/Kolkata')::date                   AS last_contact_on,
       COALESCE(f.contacts, 0)                                                 AS contacts,
       (x.converted_at AT TIME ZONE 'Asia/Kolkata')::date                      AS converted_on,
       x.application_id,
       a.application_no                                                        AS registration_no
  FROM admission_enquiries x
  LEFT JOIN admission_cycles cy          ON cy.id = x.cycle_id AND cy.deleted_at IS NULL
  LEFT JOIN academic_years y             ON y.id = cy.academic_year_id
  LEFT JOIN classes k                    ON k.id = x.class_id
  LEFT JOIN admission_enquiry_sources src ON src.id = x.source_id
  LEFT JOIN admission_enquiry_stages st  ON st.id = x.stage_id
  LEFT JOIN users u                      ON u.id = x.counsellor_user_id
  LEFT JOIN applications a               ON a.id = x.application_id
  LEFT JOIN LATERAL (SELECT count(*) AS contacts FROM admission_enquiry_followups fu
                      WHERE fu.enquiry_id = x.id
                        AND fu.mode IN ('call', 'visit', 'email', 'sms', 'whatsapp', 'reply', 'invite')) f ON true
 WHERE x.school_id = app.nlq_school_id();
ALTER VIEW nlq.admission_enquiries OWNER TO edupro_nlq_owner;
GRANT SELECT ON nlq.admission_enquiries TO edupro_nlq;
COMMENT ON VIEW nlq.admission_enquiries IS 'One row is one admission enquiry (a lead): a family asking about admission by walk-in, call, the website or a campaign, with its source, class asked for, stage on the enquiry board, counsellor, follow-up dates, and whether the family registered and was admitted. Every enquiry is here, open or closed; no personal details of the family or child are. Funnel: enquiries -> stage_kind started (registration form begun) -> is_registered (registration completed, registration number given; status converted) -> is_admitted (admission fee paid or admitted, as the school''s enquiry report counts). Lost = is_lost (not interested or closed). Filter by enquired_on (or month) for enquiries taken in a period, or by admission_session / academic_year (the year the child would join). Group by source, class (sort class_order), counsellor, stage or score. For the registration itself join nlq.admission_applications on application_id.';
COMMENT ON COLUMN nlq.admission_enquiries.enquiry_id IS 'The enquiry''s id (the enquiry number the family is told).';
COMMENT ON COLUMN nlq.admission_enquiries.enquired_on IS 'Date the enquiry was taken (India date).';
COMMENT ON COLUMN nlq.admission_enquiries.month IS 'First day of the month of enquired_on; group by it for month-wise counts.';
COMMENT ON COLUMN nlq.admission_enquiries.cycle_id IS 'The admission session the enquiry is for; join key to cycle_id in nlq.admission_applications. Empty when not given.';
COMMENT ON COLUMN nlq.admission_enquiries.admission_session IS 'The admission session''s code, e.g. 2027-28 (admissions for that joining year); empty when not given.';
COMMENT ON COLUMN nlq.admission_enquiries.academic_year_id IS 'The academic year the child would join (the session''s year); join key to nlq.academic_years.';
COMMENT ON COLUMN nlq.admission_enquiries.academic_year IS 'Code of the year the child would join, e.g. 2027-28 (usually next year, not the year the enquiry was taken).';
COMMENT ON COLUMN nlq.admission_enquiries.class IS 'The class asked for, e.g. Nursery, I, XI; empty when not given. Sort by class_order.';
COMMENT ON COLUMN nlq.admission_enquiries.class_order IS 'The class''s position for sorting (lower = junior).';
COMMENT ON COLUMN nlq.admission_enquiries.source IS 'Where the enquiry came from, as the school names its sources (e.g. Website, Walk-in, Newspaper, Reference); Not given when empty.';
COMMENT ON COLUMN nlq.admission_enquiries.campaign IS 'The campaign named on the enquiry, if any (e.g. a fair or an advertisement).';
COMMENT ON COLUMN nlq.admission_enquiries.from_website IS 'True when the family filled the enquiry form on the school''s website.';
COMMENT ON COLUMN nlq.admission_enquiries.status IS 'new, follow_up, interested (all three open), converted (the family completed a registration), not_interested or closed (both lost).';
COMMENT ON COLUMN nlq.admission_enquiries.stage IS 'The stage on the school''s enquiry board, e.g. New, Contacted, Interested, Campus visit, Registration started, Registered, Admitted, Lost (the school may rename or add stages).';
COMMENT ON COLUMN nlq.admission_enquiries.stage_kind IS 'What the stage means: open (being worked), started (registration form begun), registered, admitted or lost.';
COMMENT ON COLUMN nlq.admission_enquiries.is_open IS 'True while the enquiry is being worked (status new, follow_up or interested).';
COMMENT ON COLUMN nlq.admission_enquiries.is_lost IS 'True when the enquiry was lost (status not_interested or closed).';
COMMENT ON COLUMN nlq.admission_enquiries.is_registered IS 'True when the family completed a registration from this enquiry (registration number given; the enquiry is then converted). A registration begun but not completed shows only as stage_kind started.';
COMMENT ON COLUMN nlq.admission_enquiries.is_admitted IS 'True when the child was admitted from it: the application''s admission fee is paid or the child is admitted (the enquiry report''s rule).';
COMMENT ON COLUMN nlq.admission_enquiries.score IS 'How warm the lead is: hot, warm or cold; empty when not rated.';
COMMENT ON COLUMN nlq.admission_enquiries.counsellor IS 'Name of the counsellor the enquiry is assigned to; empty when unassigned.';
COMMENT ON COLUMN nlq.admission_enquiries.is_escalated IS 'True when the first contact was not made in time and the enquiry moved to the second level (a senior person).';
COMMENT ON COLUMN nlq.admission_enquiries.next_follow_up_on IS 'Date of the next follow-up planned; empty when none.';
COMMENT ON COLUMN nlq.admission_enquiries.follow_up_overdue IS 'True when the enquiry is open and its next follow-up date has passed.';
COMMENT ON COLUMN nlq.admission_enquiries.first_contact_on IS 'Date of the first call, visit, message, reply or invitation to the family (India date); empty when not yet contacted.';
COMMENT ON COLUMN nlq.admission_enquiries.hours_to_first_contact IS 'Hours from the enquiry to the first contact (number, one decimal; clock hours, not working hours); empty when not yet contacted.';
COMMENT ON COLUMN nlq.admission_enquiries.first_contact_late IS 'True when the enquiry is open, not yet contacted, and the time the assignment rule allows for the first contact has passed.';
COMMENT ON COLUMN nlq.admission_enquiries.last_contact_on IS 'Date of the latest contact with the family (India date).';
COMMENT ON COLUMN nlq.admission_enquiries.contacts IS 'Number of contacts made (calls, visits, e-mails, SMS, WhatsApp, replies, invitations); notes and system entries are not counted.';
COMMENT ON COLUMN nlq.admission_enquiries.converted_on IS 'Date the family registered from this enquiry (India date); empty when not converted.';
COMMENT ON COLUMN nlq.admission_enquiries.application_id IS 'The registration started from this enquiry; join key to nlq.admission_applications. Empty when none.';
COMMENT ON COLUMN nlq.admission_enquiries.registration_no IS 'The registration number of that application, once registered.';

-- nlq.assets: one row is one unit of an asset item in the asset register (its tag).
-- Rules: book value = closing of the latest depreciation year run, else cost; is_on_books for assets still held.
GRANT SELECT ON assets, purchase_items, purchase_item_categories, stores, departments, employees, vendors, purchase_orders, asset_depreciation TO edupro_nlq_owner;
CREATE VIEW nlq.assets WITH (security_barrier = true) AS
SELECT x.id AS asset_id,
       x.tag AS asset_code,
       x.item_id,
       i.code AS item_code,
       i.name AS item,
       cat.name AS category,
       sub.name AS sub_category,
       x.make,
       x.model,
       x.status,
       (x.status IN ('in_store', 'in_use', 'in_transit', 'under_repair', 'lost')) AS is_on_books,
       x.condition,
       x.store_id,
       st.name AS store,
       x.department_id,
       d.name AS department,
       x.location,
       x.custodian_employee_id AS employee_id,
       e.employee_code,
       e.display_name AS employee_name,
       CASE WHEN x.receipt_line_id IS NOT NULL THEN 'Goods receipt'
            WHEN x.opening_move_id IS NOT NULL THEN 'Opening stock'
            ELSE 'Imported or added by hand' END AS source,
       x.vendor_id,
       v.legal_name AS vendor,
       po.number || CASE WHEN po.revision > 0 THEN '-R' || po.revision ELSE '' END AS po_no,
       COALESCE(x.acquired_on, x.put_to_use_on, (x.created_at AT TIME ZONE 'Asia/Kolkata')::date) AS bought_on,
       x.put_to_use_on,
       x.cost,
       COALESCE(dep.closing, x.cost) AS book_value,
       x.cost - COALESCE(dep.closing, x.cost) AS depreciation_to_date,
       dep.fy AS book_value_year,
       x.warranty_until,
       x.insured_value,
       x.insurance_renewal,
       x.left_on,
       x.book_value_at_exit
  FROM assets x
  JOIN purchase_items i ON i.id = x.item_id
  JOIN purchase_item_categories cat ON cat.id = i.category_id
  LEFT JOIN purchase_item_categories sub ON sub.id = i.sub_category_id
  LEFT JOIN stores st ON st.id = x.store_id
  LEFT JOIN departments d ON d.id = x.department_id
  LEFT JOIN employees e ON e.id = x.custodian_employee_id
  LEFT JOIN vendors v ON v.id = x.vendor_id
  LEFT JOIN purchase_orders po ON po.id = x.order_id
  LEFT JOIN LATERAL (SELECT ad.closing, ad.fy FROM asset_depreciation ad
                      WHERE ad.asset_id = x.id ORDER BY ad.fy DESC LIMIT 1) dep ON true
 WHERE x.school_id = app.nlq_school_id();
ALTER VIEW nlq.assets OWNER TO edupro_nlq_owner;
GRANT SELECT ON nlq.assets TO edupro_nlq;
COMMENT ON VIEW nlq.assets IS 'One row is one unit of an asset item in the asset register (one tag: a laptop, a projector, a lab microscope). All assets are listed, also those that have left the books; filter is_on_books for the register as it stands (in store, in use, in transit, under repair, lost). Money in rupees. book_value is the closing value of the latest financial year for which depreciation was run (book_value_year), else the cost: it does not fall between yearly runs. Use: count or sum cost / book_value by category, department, store or status; who holds what = employee_name (the custodian). An asset item kept in a store is also counted in nlq.stock_balances, so do not add asset values to stock values. Join nlq.staff on employee_id for the custodian department or whether they still work here.';
COMMENT ON COLUMN nlq.assets.asset_id IS 'Id of the asset.';
COMMENT ON COLUMN nlq.assets.asset_code IS 'Asset tag printed on its label, e.g. AST/2026-27/0031 or an old register tag.';
COMMENT ON COLUMN nlq.assets.item_id IS 'Id of the catalogue item it is a unit of.';
COMMENT ON COLUMN nlq.assets.item_code IS 'Item code, e.g. IT-LAP-0002.';
COMMENT ON COLUMN nlq.assets.item IS 'Item name, e.g. Laptop.';
COMMENT ON COLUMN nlq.assets.category IS 'Main item category, e.g. IT equipment (depreciation is set per main category).';
COMMENT ON COLUMN nlq.assets.sub_category IS 'Item sub-category; empty when none.';
COMMENT ON COLUMN nlq.assets.make IS 'Make (brand) of the unit.';
COMMENT ON COLUMN nlq.assets.model IS 'Model of the unit.';
COMMENT ON COLUMN nlq.assets.status IS 'in_store, in_use (issued to a department or person), in_transit (between stores), under_repair, lost, returned (sent back to the vendor), written_off (condemned), disposed (condemned and sold, scrapped or given away).';
COMMENT ON COLUMN nlq.assets.is_on_books IS 'True while the school still holds it: status in_store, in_use, in_transit, under_repair or lost.';
COMMENT ON COLUMN nlq.assets.condition IS 'good, fair, poor or unserviceable.';
COMMENT ON COLUMN nlq.assets.store_id IS 'Id of the store it is kept in (when in store).';
COMMENT ON COLUMN nlq.assets.store IS 'Store it is kept in; empty when it is out in use.';
COMMENT ON COLUMN nlq.assets.department_id IS 'Id of the department that holds it.';
COMMENT ON COLUMN nlq.assets.department IS 'Department that holds it; empty while in store.';
COMMENT ON COLUMN nlq.assets.location IS 'Room or place where it is, as typed (e.g. Computer lab 2).';
COMMENT ON COLUMN nlq.assets.employee_id IS 'Id of the custodian (the employee it is handed to); join key to nlq.staff.employee_id.';
COMMENT ON COLUMN nlq.assets.employee_code IS 'Employee code of the custodian.';
COMMENT ON COLUMN nlq.assets.employee_name IS 'Name of the custodian; empty when nobody holds it personally.';
COMMENT ON COLUMN nlq.assets.source IS 'How it came on the register: Goods receipt (bought through a PO), Opening stock, or Imported or added by hand (an old register).';
COMMENT ON COLUMN nlq.assets.vendor_id IS 'Id of the vendor it was bought from.';
COMMENT ON COLUMN nlq.assets.vendor IS 'Vendor it was bought from; empty when not known.';
COMMENT ON COLUMN nlq.assets.po_no IS 'Purchase order it was bought on; empty when not bought through EduPro.';
COMMENT ON COLUMN nlq.assets.bought_on IS 'Date acquired (else the day put to use, else the day it was registered).';
COMMENT ON COLUMN nlq.assets.put_to_use_on IS 'Date put to use (depreciation runs from it); empty when not recorded.';
COMMENT ON COLUMN nlq.assets.cost IS 'Cost of the unit in rupees: its share of the PO line with GST and charges, or the opening rate.';
COMMENT ON COLUMN nlq.assets.book_value IS 'Written-down value in rupees at the end of book_value_year (the latest depreciation run), else cost.';
COMMENT ON COLUMN nlq.assets.depreciation_to_date IS 'cost less book_value, in rupees: depreciation charged in the runs so far.';
COMMENT ON COLUMN nlq.assets.book_value_year IS 'Financial year (e.g. 2025-26) whose closing value book_value is; empty when no depreciation has been run.';
COMMENT ON COLUMN nlq.assets.warranty_until IS 'Last day of the warranty; empty when none.';
COMMENT ON COLUMN nlq.assets.insured_value IS 'Insured value in rupees; empty when not insured.';
COMMENT ON COLUMN nlq.assets.insurance_renewal IS 'Date the insurance is due for renewal.';
COMMENT ON COLUMN nlq.assets.left_on IS 'Date it left the books (written off, disposed, returned to the vendor); empty while held.';
COMMENT ON COLUMN nlq.assets.book_value_at_exit IS 'Book value in rupees when it left the books; empty while held.';

-- nlq.attendance_days: one row is one pupil's mark in the day register of one school day (day sessions only; subject /
-- period attendance is not here). Present = any code but A (absent) and LV (leave), the register's own rule. Left out:
-- removed / merged / erased students, pupils whose enrolment that year is cancelled, marks archived for old years.
GRANT SELECT ON attendance_marks, attendance_sessions, students, enrolments, class_sections, classes, academic_years TO edupro_nlq_owner;
CREATE VIEW nlq.attendance_days WITH (security_barrier = true) AS
SELECT x.student_id,
       s.admission_no,
       s.display_name                                                   AS student_name,
       a.academic_year_id,
       y.code                                                           AS academic_year,
       k.name                                                           AS class,
       k.display_order                                                  AS class_order,
       cs.name                                                          AS section,
       k.code || '-' || cs.name                                         AS class_section,
       a.class_section_id,
       a.on_date,
       date_trunc('month', a.on_date)::date                             AS month,
       x.code::text                                                     AS code,
       CASE x.code WHEN 'P' THEN 'present' WHEN 'A' THEN 'absent' WHEN 'L' THEN 'late'
                   WHEN 'SR' THEN 'short_leave' WHEN 'H' THEN 'half_day' WHEN 'OD' THEN 'on_duty'
                   WHEN 'SB' THEN 'stay_back' WHEN 'LV' THEN 'leave' END            AS status,
       (x.code NOT IN ('A', 'LV'))                                      AS is_present,
       (x.code = 'A')                                                   AS is_absent,
       (x.code = 'LV')                                                  AS is_leave,
       (x.code = 'L')                                                   AS is_late,
       x.source::text                                                   AS source,
       (x.in_at AT TIME ZONE 'Asia/Kolkata')::time                      AS gate_in_time,
       (x.out_at AT TIME ZONE 'Asia/Kolkata')::time                     AS gate_out_time
  FROM attendance_marks x
  JOIN attendance_sessions a ON a.id = x.session_id AND a.kind = 'day'
  JOIN students s            ON s.id = x.student_id
  JOIN academic_years y      ON y.id = a.academic_year_id
  JOIN class_sections cs     ON cs.id = a.class_section_id
  JOIN classes k             ON k.id = cs.class_id
  LEFT JOIN enrolments e     ON e.student_id = x.student_id AND e.academic_year_id = a.academic_year_id
 WHERE x.school_id = app.nlq_school_id()
   AND s.deleted_at IS NULL
   AND s.merged_into_id IS NULL
   AND NOT (s.details ? 'erased_at')
   AND e.status IS DISTINCT FROM 'cancelled';
ALTER VIEW nlq.attendance_days OWNER TO edupro_nlq_owner;
GRANT SELECT ON nlq.attendance_days TO edupro_nlq;
COMMENT ON VIEW nlq.attendance_days IS 'One row is one pupil''s mark in the class''s day register on one school day (the daily attendance the class teacher takes; subject-period attendance is not here). Only days with a register appear: holidays and weekly offs have no rows, and a pupil the teacher did not mark has no row that day (not marked is not absent). Left out: removed, merged or erased student records, pupils whose admission that year was cancelled, and marks of old closed years the school has archived. Counting rule (the register''s own): days = rows; present = is_present (every code except A absent and LV leave; late, half day, short leave, on duty and stay back count as present, a half day as a whole day); attendance % = 100 * count(*) FILTER (WHERE is_present) / count(*), so leave lowers the %. For % without leave days use count(*) FILTER (WHERE NOT is_leave) as the base, and say so. Filter on on_date (a date range is fastest; month is for grouping) and academic_year; group by class_section, class (sort class_order) or student. class / section are those of the register the mark is in (the pupil''s section that day). Join nlq.students on student_id and academic_year_id for gender, category or house.';
COMMENT ON COLUMN nlq.attendance_days.student_id IS 'The pupil''s id; join key to nlq.students (with academic_year_id).';
COMMENT ON COLUMN nlq.attendance_days.admission_no IS 'The pupil''s admission number.';
COMMENT ON COLUMN nlq.attendance_days.student_name IS 'The pupil''s full name.';
COMMENT ON COLUMN nlq.attendance_days.academic_year_id IS 'The academic year of the register; join key to nlq.academic_years.';
COMMENT ON COLUMN nlq.attendance_days.academic_year IS 'The academic year code, e.g. 2026-27.';
COMMENT ON COLUMN nlq.attendance_days.class IS 'The class of the register, e.g. VI. Sort by class_order.';
COMMENT ON COLUMN nlq.attendance_days.class_order IS 'The class''s position for sorting (lower = junior).';
COMMENT ON COLUMN nlq.attendance_days.section IS 'The section of the register, e.g. A.';
COMMENT ON COLUMN nlq.attendance_days.class_section IS 'Class and section of the register, e.g. VI-A.';
COMMENT ON COLUMN nlq.attendance_days.class_section_id IS 'The class-section''s id; join key to nlq.class_sections and nlq.section_attendance.';
COMMENT ON COLUMN nlq.attendance_days.on_date IS 'The school day (India date).';
COMMENT ON COLUMN nlq.attendance_days.month IS 'First day of the month of on_date; group by it for month-wise attendance.';
COMMENT ON COLUMN nlq.attendance_days.code IS 'The register code: P present, A absent, L late, SR short leave (left early), H half day, OD on duty, SB stay back, LV on approved leave.';
COMMENT ON COLUMN nlq.attendance_days.status IS 'The code in words: present, absent, late, short_leave, half_day, on_duty, stay_back or leave.';
COMMENT ON COLUMN nlq.attendance_days.is_present IS 'True when the pupil counts as present that day (every code except A and LV). Use count(*) FILTER (WHERE is_present) for present days.';
COMMENT ON COLUMN nlq.attendance_days.is_absent IS 'True when marked absent (code A).';
COMMENT ON COLUMN nlq.attendance_days.is_leave IS 'True when on approved leave (code LV); neither present nor absent, but still a day of the register.';
COMMENT ON COLUMN nlq.attendance_days.is_late IS 'True when marked late (code L); a late pupil is also present.';
COMMENT ON COLUMN nlq.attendance_days.source IS 'How the mark was made: manual (by the teacher), rfid (gate card reader) or upload (an Excel list).';
COMMENT ON COLUMN nlq.attendance_days.gate_in_time IS 'India time the pupil''s card was first read at the gate that day (RFID schools); empty otherwise.';
COMMENT ON COLUMN nlq.attendance_days.gate_out_time IS 'India time of the last gate exit read that day (RFID schools); empty otherwise.';

-- nlq.certificates: one row is one certificate paper in the register (an original or a duplicate), student or staff.
-- Rules: is_valid = original (copy_no 0) still issued; the frozen printed data, purpose and reasons are not exposed.
GRANT SELECT ON certificates, certificate_types, certificate_revisions, certificate_requests, students, employees, academic_years, enrolments, class_sections, classes TO edupro_nlq_owner;
CREATE VIEW nlq.certificates WITH (security_barrier = true) AS
SELECT x.id AS certificate_id,
       t.code AS type_code,
       t.name AS type,
       CASE t.audience WHEN 'STAFF' THEN 'staff' ELSE 'student' END AS audience,
       x.number,
       x.copy_no,
       (x.copy_no > 0) AS is_duplicate,
       x.original_id,
       x.status,
       (x.copy_no = 0 AND x.status = 'issued') AS is_valid,
       x.issued_on,
       date_trunc('month', x.issued_on)::date AS month,
       COALESCE(r1.issued_on, x.issued_on) AS first_issued_on,
       (x.cancelled_at AT TIME ZONE 'Asia/Kolkata')::date AS cancelled_on,
       x.year_code AS academic_year,
       y.id AS academic_year_id,
       x.book_no,
       x.sl_no,
       x.revision,
       (x.revision > 1) AS is_corrected,
       (x.reissue_of IS NOT NULL) AS is_reissue,
       ro.number AS reissue_of_number,
       ra.number AS reissued_as_number,
       (x.override_reason IS NOT NULL) AS is_override,
       x.legacy AS is_old_system,
       COALESCE(rq.channel, 'direct') AS requested_via,
       (x.batch_id IS NOT NULL) AS is_bulk,
       x.student_id,
       s.admission_no,
       s.display_name AS student_name,
       c.name AS class,
       c.display_order AS class_order,
       cs.name AS section,
       c.code || '-' || cs.name AS class_section,
       cs.id AS class_section_id,
       x.employee_id,
       e.employee_code,
       e.display_name AS employee_name,
       COALESCE(s.display_name, e.display_name) AS person_name,
       ib.display_name AS issued_by
  FROM certificates x
  JOIN certificate_types t ON t.id = x.type_id
  LEFT JOIN certificate_revisions r1 ON r1.certificate_id = x.id AND r1.revision = 1
  LEFT JOIN certificates ro ON ro.id = x.reissue_of
  LEFT JOIN certificates ra ON ra.reissue_of = x.id
  LEFT JOIN certificate_requests rq ON rq.id = x.request_id
  LEFT JOIN students s ON s.id = x.student_id
  LEFT JOIN employees e ON e.id = x.employee_id
  LEFT JOIN academic_years y ON y.code = x.year_code
  LEFT JOIN enrolments en ON en.student_id = x.student_id AND en.academic_year_id = y.id AND en.status <> 'cancelled'
  LEFT JOIN class_sections cs ON cs.id = en.class_section_id
  LEFT JOIN classes c ON c.id = cs.class_id
  LEFT JOIN (SELECT DISTINCT ON (ie.user_id) ie.user_id, ie.display_name FROM employees ie
              WHERE ie.user_id IS NOT NULL AND ie.deleted_at IS NULL ORDER BY ie.user_id, ie.id) ib ON ib.user_id = x.issued_by
 WHERE x.school_id = app.nlq_school_id();
ALTER VIEW nlq.certificates OWNER TO edupro_nlq_owner;
GRANT SELECT ON nlq.certificates TO edupro_nlq;
COMMENT ON VIEW nlq.certificates IS 'One row is one certificate paper in the certificate register: an original (copy_no 0) or a duplicate of it (same number, copy_no 1, 2 ...), for a student or a staff member: transfer certificate (type_code TC), bonafide, character, date of birth, fee paid, award certificates, experience and others. Every TC is here (use this view, not any other TC list). Cancelled papers are kept (status cancelled). Use: certificates issued = count rows WHERE copy_no = 0 (originals); valid now = is_valid; duplicates = is_duplicate. Group by type, month (of issued_on) or academic_year. academic_year is the year recorded on the certificate (the year the office was working in), which can differ from the year of issued_on around April. The class is the student enrolment in that academic year. A re-issue cancels the old paper and gives a new number (is_reissue, reissued_as_number); a correction keeping the number raises revision and moves issued_on to the correction day (first_issued_on keeps the first). is_old_system rows came from the previous software. The printed details of the paper are not available here.';
COMMENT ON COLUMN nlq.certificates.certificate_id IS 'Id of the certificate paper.';
COMMENT ON COLUMN nlq.certificates.type_code IS 'Code of the certificate type: TC, BONAFIDE, CHARACTER, DOB, DOB_JUST, STUDY, CASTE, DOMICILE, NOC, TRAVEL_NOC, VISA, SCHOLAR, BOARD_REG, BOARD_FORM, FEE_PAID, ACHIEVEMENT, MERIT, PARTICIPATION, AWARD (students), EXPERIENCE, SERVICE, STAFF_VISA (staff), or a code the school made.';
COMMENT ON COLUMN nlq.certificates.type IS 'Name of the certificate type, e.g. Transfer certificate, Bonafide certificate.';
COMMENT ON COLUMN nlq.certificates.audience IS 'student or staff: who the type is for.';
COMMENT ON COLUMN nlq.certificates.number IS 'Certificate number, e.g. TC/2026-27/00012; a duplicate repeats the number of its original.';
COMMENT ON COLUMN nlq.certificates.copy_no IS '0 for the original, 1, 2 ... for each duplicate of it.';
COMMENT ON COLUMN nlq.certificates.is_duplicate IS 'True for a duplicate (copy_no above 0). Count duplicates apart from certificates issued.';
COMMENT ON COLUMN nlq.certificates.original_id IS 'For a duplicate, the certificate_id of its original; empty for an original.';
COMMENT ON COLUMN nlq.certificates.status IS 'issued or cancelled. Cancelling an original cancels its duplicates too.';
COMMENT ON COLUMN nlq.certificates.is_valid IS 'True for an original (copy_no 0) that is still issued (not cancelled). Count these for valid certificates.';
COMMENT ON COLUMN nlq.certificates.issued_on IS 'Date of issue (for a corrected certificate, the date of its latest correction; for a duplicate, the day the duplicate was made). Filter periods on this date.';
COMMENT ON COLUMN nlq.certificates.month IS 'First day of the month of issued_on.';
COMMENT ON COLUMN nlq.certificates.first_issued_on IS 'Date the certificate was first issued, before any correction.';
COMMENT ON COLUMN nlq.certificates.cancelled_on IS 'Date it was cancelled (India time); empty when not cancelled.';
COMMENT ON COLUMN nlq.certificates.academic_year IS 'Academic year code recorded on the certificate, e.g. 2026-27 (also the middle part of its number).';
COMMENT ON COLUMN nlq.certificates.academic_year_id IS 'Id of that academic year; join key to nlq.academic_years and nlq.students.';
COMMENT ON COLUMN nlq.certificates.book_no IS 'TC book number (100 TCs to a book); empty for other types.';
COMMENT ON COLUMN nlq.certificates.sl_no IS 'Serial number in the TC book series (runs on across books and years); empty for other types.';
COMMENT ON COLUMN nlq.certificates.revision IS '1 for a certificate as issued; 2, 3 ... after each correction that kept the number.';
COMMENT ON COLUMN nlq.certificates.is_corrected IS 'True when the certificate was corrected under the same number (revision above 1).';
COMMENT ON COLUMN nlq.certificates.is_reissue IS 'True when this certificate re-issued an earlier one (which was cancelled then).';
COMMENT ON COLUMN nlq.certificates.reissue_of_number IS 'Number of the cancelled certificate this one re-issued; empty otherwise.';
COMMENT ON COLUMN nlq.certificates.reissued_as_number IS 'Number of the new certificate that re-issued this one; empty otherwise.';
COMMENT ON COLUMN nlq.certificates.is_override IS 'True when it was issued although one of its checks failed (fees due, books out ...), on the principal override.';
COMMENT ON COLUMN nlq.certificates.is_old_system IS 'True for a certificate brought from the previous software (read-only history, old number).';
COMMENT ON COLUMN nlq.certificates.requested_via IS 'parent, student or staff when it answered a request made in an app, office when the office entered the request, direct when issued without a request.';
COMMENT ON COLUMN nlq.certificates.is_bulk IS 'True when it was issued in a bulk run (a whole section, leavers, awards, an Excel sheet).';
COMMENT ON COLUMN nlq.certificates.student_id IS 'Id of the student (empty for a staff certificate); join key to nlq.students.student_id.';
COMMENT ON COLUMN nlq.certificates.admission_no IS 'Admission number of the student.';
COMMENT ON COLUMN nlq.certificates.student_name IS 'Name of the student as on the student record now.';
COMMENT ON COLUMN nlq.certificates.class IS 'Class of the student in academic_year (from that year enrolment); empty when none.';
COMMENT ON COLUMN nlq.certificates.class_order IS 'Display order of the class, for sorting.';
COMMENT ON COLUMN nlq.certificates.section IS 'Section of the student in academic_year.';
COMMENT ON COLUMN nlq.certificates.class_section IS 'Class and section, e.g. X-A.';
COMMENT ON COLUMN nlq.certificates.class_section_id IS 'Id of the class section; join key to nlq.class_sections.';
COMMENT ON COLUMN nlq.certificates.employee_id IS 'Id of the staff member (empty for a student certificate); join key to nlq.staff.employee_id.';
COMMENT ON COLUMN nlq.certificates.employee_code IS 'Employee code of the staff member.';
COMMENT ON COLUMN nlq.certificates.employee_name IS 'Name of the staff member.';
COMMENT ON COLUMN nlq.certificates.person_name IS 'Name of the student or staff member it is for.';
COMMENT ON COLUMN nlq.certificates.issued_by IS 'Staff name of the person who issued it; empty when not known.';

-- nlq.exam_marks: one row is one pupil's paper in one exam (pupil × exam × subject), for every paper the pupil takes,
-- marked or not yet. Taken = the year's subject choices (no choices recorded = every subject) with mid-year subject
-- changes applied per exam (app.student_exam_subject_kind, inlined); deleted exams, deleted / merged / erased pupils and
-- cancelled enrolments are left out; pupils who left, and exams set up without marks, keep only papers with an entry.
GRANT SELECT ON exam_subjects, exams, exam_types, exam_classes, academic_years, classes, class_sections, enrolments,
  students, subjects, class_subjects, student_subjects, student_subject_changes, mark_entries, mark_codes,
  exam_entry_status, grade_bands TO edupro_nlq_owner;
CREATE VIEW nlq.exam_marks WITH (security_barrier = true) AS
SELECT s.id                                                    AS student_id,
       s.admission_no,
       s.display_name                                          AS student_name,
       y.id                                                    AS academic_year_id,
       y.code                                                  AS academic_year,
       k.name                                                  AS class,
       k.display_order                                         AS class_order,
       cs.name                                                 AS section,
       k.code || '-' || cs.name                                AS class_section,
       cs.id                                                   AS class_section_id,
       en.status::text                                         AS enrolment_status,
       e.id                                                    AS exam_id,
       e.code                                                  AS exam_code,
       e.name                                                  AS exam_name,
       et.name                                                 AS exam_type,
       e.starts_on                                             AS exam_starts_on,
       sub.id                                                  AS subject_id,
       sub.code                                                AS subject_code,
       sub.name                                                AS subject_name,
       COALESCE(csub.sort_order, 100000 + sub.display_order)   AS subject_order,
       tk.kind                                                 AS taken_as,
       x.exam_on                                               AS paper_on,
       x.max_marks,
       x.pass_marks,
       me.marks,
       CASE WHEN me.marks IS NOT NULL AND x.max_marks > 0 THEN round(me.marks * 100 / x.max_marks, 2) END AS percent,
       me.code,
       mc.name                                                 AS code_name,
       COALESCE(me.grade, gb.grade)                            AS grade,
       (me.id IS NOT NULL)                                     AS is_entered,
       COALESCE(st.status, 'open')                             AS entry_status,
       COALESCE(st.status = 'verified', false)                 AS is_verified,
       (x.max_marks > 0 AND tk.kind IN ('compulsory', 'optional') AND NOT COALESCE(ct.out, false)) AS counts_in_total,
       CASE WHEN me.id IS NULL OR x.max_marks <= 0 OR tk.kind NOT IN ('compulsory', 'optional') OR ct.out THEN NULL
            WHEN me.code IS NULL THEN me.marks
            WHEN ct.treatment = 'zero' THEN 0
            WHEN ct.treatment = 'fixed' THEN LEAST(mc.value, x.max_marks)
            WHEN ct.treatment = 'percent' THEN round(x.max_marks * mc.value / 100, 2)
       END                                                     AS marks_counted,
       (me.id IS NOT NULL AND x.max_marks > 0 AND tk.kind IN ('compulsory', 'optional')
        AND (COALESCE(ct.blocks, false)
             OR (me.code IS NULL AND x.pass_marks IS NOT NULL AND me.marks < x.pass_marks))) AS is_failed
  FROM exam_subjects x
  JOIN exams e ON e.id = x.exam_id AND e.deleted_at IS NULL
  JOIN exam_types et ON et.id = e.exam_type_id
  JOIN academic_years y ON y.id = e.academic_year_id
  JOIN classes k ON k.id = x.class_id
  JOIN subjects sub ON sub.id = x.subject_id
  LEFT JOIN exam_classes ec ON ec.exam_id = x.exam_id AND ec.class_id = x.class_id
  LEFT JOIN class_subjects csub ON csub.academic_year_id = e.academic_year_id AND csub.class_id = x.class_id
                               AND csub.subject_id = x.subject_id
  JOIN class_sections cs ON cs.class_id = x.class_id AND cs.academic_year_id = e.academic_year_id AND cs.deleted_at IS NULL
  JOIN enrolments en ON en.class_section_id = cs.id AND en.academic_year_id = e.academic_year_id AND en.status <> 'cancelled'
  JOIN students s ON s.id = en.student_id AND s.deleted_at IS NULL AND s.merged_into_id IS NULL
                 AND NOT (s.details ? 'erased_at')
  LEFT JOIN mark_entries me ON me.exam_subject_id = x.id AND me.student_id = en.student_id
  LEFT JOIN mark_codes mc ON mc.code = me.code
  LEFT JOIN exam_entry_status st ON st.exam_subject_id = x.id AND st.class_section_id = cs.id
  LEFT JOIN student_subjects ss ON ss.academic_year_id = e.academic_year_id AND ss.student_id = en.student_id
                               AND ss.subject_id = x.subject_id
  LEFT JOIN LATERAL (SELECT true AS has FROM student_subjects a
                      WHERE a.student_id = en.student_id AND a.academic_year_id = e.academic_year_id LIMIT 1) anyss ON true
  LEFT JOIN LATERAL (SELECT true AS has FROM student_subject_changes c
                      WHERE c.student_id = en.student_id AND c.academic_year_id = e.academic_year_id
                        AND x.subject_id IN (c.from_subject_id, c.to_subject_id) LIMIT 1) chg ON true
  -- a subject changed mid-year (rare): taken in the exams before the change as the subject it became; the new subject
  -- only from the change's first exam on. Exams are ordered by their first day (else first paper, else creation), then id.
  LEFT JOIN LATERAL (
    SELECT d.e_day,
           EXISTS (SELECT 1 FROM student_subject_changes c2 JOIN exams f2 ON f2.id = c2.from_exam_id
                    WHERE c2.student_id = en.student_id AND c2.academic_year_id = e.academic_year_id
                      AND c2.to_subject_id = x.subject_id
                      AND (d.e_day, e.id) < (COALESCE(f2.starts_on, (SELECT min(p.exam_on) FROM exam_subjects p WHERE p.exam_id = f2.id),
                                                      f2.created_at::date), f2.id)) AS not_yet,
           fc.id AS from_change, fc.before_change, fin.kind AS final_kind
      FROM (SELECT COALESCE(e.starts_on, (SELECT min(p.exam_on) FROM exam_subjects p WHERE p.exam_id = e.id),
                            e.created_at::date) AS e_day) d
      LEFT JOIN LATERAL (
        SELECT c.id, c.to_subject_id,
               ((d.e_day, e.id) < (COALESCE(f.starts_on, (SELECT min(p.exam_on) FROM exam_subjects p WHERE p.exam_id = f.id),
                                            f.created_at::date), f.id)) AS before_change
          FROM student_subject_changes c JOIN exams f ON f.id = c.from_exam_id
         WHERE c.student_id = en.student_id AND c.academic_year_id = e.academic_year_id
           AND c.from_subject_id = x.subject_id) fc ON true
      LEFT JOIN LATERAL (
        WITH RECURSIVE chain(sub, n) AS (
          SELECT fc.to_subject_id, 1
          UNION ALL
          SELECT c3.to_subject_id, chain.n + 1
            FROM chain JOIN student_subject_changes c3
              ON c3.student_id = en.student_id AND c3.academic_year_id = e.academic_year_id AND c3.from_subject_id = chain.sub
           WHERE chain.n < 10)
        SELECT CASE WHEN fs.id IS NOT NULL THEN fs.kind WHEN anyss.has THEN NULL ELSE 'compulsory' END AS kind
          FROM (SELECT chain.sub FROM chain ORDER BY chain.n DESC LIMIT 1) last
          LEFT JOIN student_subjects fs ON fs.academic_year_id = e.academic_year_id AND fs.student_id = en.student_id
                                       AND fs.subject_id = last.sub) fin ON fc.id IS NOT NULL
     WHERE chg.has
  ) cx ON true
  CROSS JOIN LATERAL (
    SELECT CASE WHEN chg.has AND cx.not_yet THEN NULL
                WHEN chg.has AND cx.from_change IS NOT NULL THEN CASE WHEN cx.before_change THEN cx.final_kind END
                WHEN ss.id IS NOT NULL THEN ss.kind
                WHEN anyss.has THEN NULL
                ELSE 'compulsory' END AS kind
  ) tk
  CROSS JOIN LATERAL (
    SELECT COALESCE(mc.treatment, CASE WHEN me.code = 'AB' THEN 'zero' ELSE 'exclude' END) AS treatment,
           (me.code IS NOT NULL AND COALESCE(mc.treatment, CASE WHEN me.code = 'AB' THEN 'zero' ELSE 'exclude' END)
              IN ('exclude', 'pro_rata')) AS out,
           (me.code IS NOT NULL AND COALESCE(mc.blocks_result, me.code = 'AB')) AS blocks
  ) ct
  LEFT JOIN LATERAL (SELECT b.grade FROM grade_bands b
                      WHERE b.scale_id = ec.grade_scale_id AND me.marks IS NOT NULL AND x.max_marks > 0
                        AND round(me.marks * 100 / x.max_marks, 2) BETWEEN b.min_pct AND b.max_pct
                      ORDER BY b.sort_order LIMIT 1) gb ON true
 WHERE x.school_id = app.nlq_school_id()
   AND tk.kind IS NOT NULL
   AND (me.id IS NOT NULL OR (en.status IN ('active', 'promoted') AND 'marks' = ANY (e.areas)));
ALTER VIEW nlq.exam_marks OWNER TO edupro_nlq_owner;
GRANT SELECT ON nlq.exam_marks TO edupro_nlq;
COMMENT ON VIEW nlq.exam_marks IS 'One row is one pupil''s paper (subject) in one exam: pupil × exam × subject, for every paper the pupil takes, whether marks are entered yet or not (is_entered). A paper the pupil does not take (subject choices, mid-year subject changes) has no row. Left out: deleted exams, deleted, merged or erased pupils, cancelled enrolments; a pupil who left the school, and an exam set up without a marks area (indicators or remarks only), keep only the papers that have an entry. Marks are the raw entries of the marks sheets: they include sheets still open or only submitted — for official (final) figures keep is_verified = true. A paper holds marks, or a code instead of marks (AB absent, ML medical leave, EX exempted, NA, OD, L, NEW ADM …), or a grade (grade-only papers, max_marks = 0). For averages use percent or marks (codes are empty there); for totals as the exam result counts them use marks_counted where counts_in_total. Filter by exam_code / exam_name and academic_year; group by class, class_section or subject_name (sort by class_order, subject_order). Join nlq.exam_results on (student_id, exam_id) for the pupil''s overall result, nlq.students on (student_id, academic_year_id) for gender, category, house.';
COMMENT ON COLUMN nlq.exam_marks.student_id IS 'The pupil''s id; join key to nlq.students (with academic_year_id), nlq.exam_results and nlq.term_results.';
COMMENT ON COLUMN nlq.exam_marks.admission_no IS 'The pupil''s admission number (unique in the school).';
COMMENT ON COLUMN nlq.exam_marks.student_name IS 'The pupil''s name.';
COMMENT ON COLUMN nlq.exam_marks.academic_year_id IS 'The academic year of the exam (id).';
COMMENT ON COLUMN nlq.exam_marks.academic_year IS 'The academic year of the exam, e.g. 2026-27.';
COMMENT ON COLUMN nlq.exam_marks.class IS 'The pupil''s class in that year (the class whose paper it is), e.g. Class VI.';
COMMENT ON COLUMN nlq.exam_marks.class_order IS 'Sort order of the class (lower = junior). Use ORDER BY class_order, not class.';
COMMENT ON COLUMN nlq.exam_marks.section IS 'The pupil''s section in that year, e.g. A.';
COMMENT ON COLUMN nlq.exam_marks.class_section IS 'Class code and section, e.g. VI-A.';
COMMENT ON COLUMN nlq.exam_marks.class_section_id IS 'The pupil''s section in that year (id); join key to nlq.class_sections.';
COMMENT ON COLUMN nlq.exam_marks.enrolment_status IS 'The pupil''s enrolment in that year: active (in the class now), promoted (year finished, moved on or retained), transferred, withdrawn or left (left the school; only papers with an entry are kept).';
COMMENT ON COLUMN nlq.exam_marks.exam_id IS 'The exam (id); join key to nlq.exam_results.';
COMMENT ON COLUMN nlq.exam_marks.exam_code IS 'The exam''s short code, unique in its year, e.g. PT1, T1, HY, ANNUAL (the school''s own codes).';
COMMENT ON COLUMN nlq.exam_marks.exam_name IS 'The exam''s name, e.g. Periodic Test 1, Term I.';
COMMENT ON COLUMN nlq.exam_marks.exam_type IS 'The exam type the exam belongs to, e.g. Periodic Test, Term Exam.';
COMMENT ON COLUMN nlq.exam_marks.exam_starts_on IS 'First day of the exam (may be empty when not set).';
COMMENT ON COLUMN nlq.exam_marks.subject_id IS 'The subject of the paper (id).';
COMMENT ON COLUMN nlq.exam_marks.subject_code IS 'The subject''s code, e.g. ENG, MATH.';
COMMENT ON COLUMN nlq.exam_marks.subject_name IS 'The subject''s name, e.g. English, Mathematics.';
COMMENT ON COLUMN nlq.exam_marks.subject_order IS 'The order the class prints its subjects in (report cards, registers). Sort by it.';
COMMENT ON COLUMN nlq.exam_marks.taken_as IS 'How the pupil takes the subject: compulsory, optional (counts in the total) or additional (printed, kept out of the total).';
COMMENT ON COLUMN nlq.exam_marks.paper_on IS 'Date of the paper (may be empty).';
COMMENT ON COLUMN nlq.exam_marks.max_marks IS 'Maximum marks of the paper; 0 = a grade-only paper (no marks, only a grade).';
COMMENT ON COLUMN nlq.exam_marks.pass_marks IS 'Pass marks of the paper; empty = no pass mark (the paper cannot be failed on marks).';
COMMENT ON COLUMN nlq.exam_marks.marks IS 'Marks obtained as entered; empty when a code or a grade was entered instead, or nothing is entered yet. Use for averages, highest, lowest.';
COMMENT ON COLUMN nlq.exam_marks.percent IS 'marks × 100 / max_marks (0–100), from entered marks only; empty for codes, grades and missing entries.';
COMMENT ON COLUMN nlq.exam_marks.code IS 'A code written instead of marks: AB (absent: counts 0 and fails the paper), ML (medical leave), EX (exempted), NA (not applicable), OD (on duty), L (late admission), NEW ADM (new admission), or the school''s own codes; empty when marks or a grade were entered. Count absentees with code = ''AB''.';
COMMENT ON COLUMN nlq.exam_marks.code_name IS 'What the code means, e.g. Absent, Medical leave (the school''s list).';
COMMENT ON COLUMN nlq.exam_marks.grade IS 'The grade: as entered on a grade-only paper, else the grade of percent on the class''s grade scale for the exam (as report cards print it); empty for codes, missing entries or no scale.';
COMMENT ON COLUMN nlq.exam_marks.is_entered IS 'true when marks, a code or a grade is entered for this pupil and paper; false = still to be entered.';
COMMENT ON COLUMN nlq.exam_marks.entry_status IS 'State of the marks sheet (this paper in this section): open (being entered), submitted (sent by the teacher, waiting for verification), verified (checked and locked: final).';
COMMENT ON COLUMN nlq.exam_marks.is_verified IS 'true when the marks sheet of this paper in this section is verified (final). Official figures: WHERE is_verified.';
COMMENT ON COLUMN nlq.exam_marks.counts_in_total IS 'true when the paper counts in the pupil''s exam total as the exam result works it out: a marks paper (max_marks > 0), taken as compulsory or optional, without a code that takes it out of the maximum (ML, EX, NA, OD, L, NEW ADM and the like).';
COMMENT ON COLUMN nlq.exam_marks.marks_counted IS 'The marks this paper adds to the exam total: the marks, 0 for AB, a fixed or percentage value for codes the school set so; empty when the paper does not count (counts_in_total false) or nothing is entered. sum(marks_counted) / sum(max_marks) over counts_in_total rows = the exam result''s percent.';
COMMENT ON COLUMN nlq.exam_marks.is_failed IS 'true when the pupil failed this paper as the exam result counts it: marks below pass_marks, or a code that fails the paper (AB); only compulsory and optional marks papers with an entry. Count failures with WHERE is_failed.';

-- nlq.exam_results: one row is one pupil's overall result in one exam (pupil × exam), read from the stored result that
-- app.compute_exam_results works out (on every verify / reopen / compute) — not live. Deleted exams, deleted / merged /
-- erased pupils and cancelled enrolments are left out; the class is the pupil's enrolment of the exam's year.
GRANT SELECT ON public.exam_results, exams, exam_types, academic_years, enrolments, class_sections, classes, students
  TO edupro_nlq_owner;
CREATE VIEW nlq.exam_results WITH (security_barrier = true) AS
SELECT s.id                                      AS student_id,
       s.admission_no,
       s.display_name                            AS student_name,
       y.id                                      AS academic_year_id,
       y.code                                    AS academic_year,
       k.name                                    AS class,
       k.display_order                           AS class_order,
       cs.name                                   AS section,
       k.code || '-' || cs.name                  AS class_section,
       cs.id                                     AS class_section_id,
       en.status::text                           AS enrolment_status,
       e.id                                      AS exam_id,
       e.code                                    AS exam_code,
       e.name                                    AS exam_name,
       et.name                                   AS exam_type,
       e.starts_on                               AS exam_starts_on,
       x.subjects                                AS subjects_counted,
       x.entered                                 AS subjects_entered,
       x.absent                                  AS subjects_absent,
       x.exempt                                  AS subjects_excluded,
       x.failed_subjects,
       x.total,
       x.max_total,
       x.pct                                     AS percent,
       x.grade,
       x.points                                  AS grade_points,
       x.result,
       x.rank_in_section,
       x.rank_in_class,
       (x.computed_at AT TIME ZONE 'Asia/Kolkata')::date AS computed_on
  FROM public.exam_results x
  JOIN exams e ON e.id = x.exam_id AND e.deleted_at IS NULL
  JOIN exam_types et ON et.id = e.exam_type_id
  JOIN academic_years y ON y.id = e.academic_year_id
  JOIN enrolments en ON en.student_id = x.student_id AND en.academic_year_id = e.academic_year_id AND en.status <> 'cancelled'
  JOIN class_sections cs ON cs.id = en.class_section_id
  JOIN classes k ON k.id = cs.class_id
  JOIN students s ON s.id = x.student_id AND s.deleted_at IS NULL AND s.merged_into_id IS NULL
                 AND NOT (s.details ? 'erased_at')
 WHERE x.school_id = app.nlq_school_id();
ALTER VIEW nlq.exam_results OWNER TO edupro_nlq_owner;
GRANT SELECT ON nlq.exam_results TO edupro_nlq;
COMMENT ON VIEW nlq.exam_results IS 'One row is one pupil''s overall result in one exam (pupil × exam): total, maximum, percent, grade, pass / fail and rank. These are the stored results EduPro works out from the marks each time a marks sheet is verified or reopened (or the office presses Compute): they reflect the last compute, not marks typed since (computed_on tells when). A pupil enrolled after the last compute has no row yet. Only pupils who were in the class when it was computed are here; left out: deleted exams, deleted, merged or erased pupils, cancelled enrolments. The total counts compulsory and optional marks papers only (additional subjects and grade-only papers stay out; AB counts 0; ML, EX, NA, OD and similar codes take the paper out of the maximum). result: pass, fail (failed a paper: below pass marks or AB) or incomplete (a paper still has no entry: no rank). For pass % use result IN (''pass'',''fail'') as the base, not incomplete rows. Ranks are dense (1, 2, 2, 3) by percent. Filter by exam_code / exam_name and academic_year; group by class (sort by class_order) or class_section. Join nlq.exam_marks on (student_id, exam_id) for the papers, nlq.students on (student_id, academic_year_id) for gender, category, house.';
COMMENT ON COLUMN nlq.exam_results.student_id IS 'The pupil''s id; join key to nlq.students (with academic_year_id), nlq.exam_marks, nlq.term_results.';
COMMENT ON COLUMN nlq.exam_results.admission_no IS 'The pupil''s admission number (unique in the school).';
COMMENT ON COLUMN nlq.exam_results.student_name IS 'The pupil''s name.';
COMMENT ON COLUMN nlq.exam_results.academic_year_id IS 'The academic year of the exam (id).';
COMMENT ON COLUMN nlq.exam_results.academic_year IS 'The academic year of the exam, e.g. 2026-27.';
COMMENT ON COLUMN nlq.exam_results.class IS 'The pupil''s class in that year, e.g. Class VI.';
COMMENT ON COLUMN nlq.exam_results.class_order IS 'Sort order of the class (lower = junior). Use ORDER BY class_order, not class.';
COMMENT ON COLUMN nlq.exam_results.section IS 'The pupil''s section in that year, e.g. A.';
COMMENT ON COLUMN nlq.exam_results.class_section IS 'Class code and section, e.g. VI-A.';
COMMENT ON COLUMN nlq.exam_results.class_section_id IS 'The pupil''s section in that year (id); join key to nlq.class_sections.';
COMMENT ON COLUMN nlq.exam_results.enrolment_status IS 'The pupil''s enrolment in that year: active (in the class now), promoted (year finished), transferred, withdrawn or left.';
COMMENT ON COLUMN nlq.exam_results.exam_id IS 'The exam (id); join key to nlq.exam_marks.';
COMMENT ON COLUMN nlq.exam_results.exam_code IS 'The exam''s short code, unique in its year, e.g. PT1, T1, HY (the school''s own codes).';
COMMENT ON COLUMN nlq.exam_results.exam_name IS 'The exam''s name, e.g. Periodic Test 1, Term I.';
COMMENT ON COLUMN nlq.exam_results.exam_type IS 'The exam type the exam belongs to, e.g. Periodic Test, Term Exam.';
COMMENT ON COLUMN nlq.exam_results.exam_starts_on IS 'First day of the exam (may be empty when not set).';
COMMENT ON COLUMN nlq.exam_results.subjects_counted IS 'Number of papers that count in the total (compulsory and optional marks papers the pupil takes).';
COMMENT ON COLUMN nlq.exam_results.subjects_entered IS 'Of those, papers with marks or a counting code (AB) entered.';
COMMENT ON COLUMN nlq.exam_results.subjects_absent IS 'Papers marked AB (absent).';
COMMENT ON COLUMN nlq.exam_results.subjects_excluded IS 'Papers taken out of the maximum by a code (ML, EX, NA, OD, L, NEW ADM and the like).';
COMMENT ON COLUMN nlq.exam_results.failed_subjects IS 'Number of papers failed (below pass marks, or AB).';
COMMENT ON COLUMN nlq.exam_results.total IS 'Marks obtained over the counted papers (AB counts 0).';
COMMENT ON COLUMN nlq.exam_results.max_total IS 'Maximum marks of the counted papers (papers with an excluding code left out).';
COMMENT ON COLUMN nlq.exam_results.percent IS 'total × 100 / max_total (0–100); empty when nothing counts.';
COMMENT ON COLUMN nlq.exam_results.grade IS 'Overall grade from the class''s grade scale for the exam, by percent; empty when the class has no scale.';
COMMENT ON COLUMN nlq.exam_results.grade_points IS 'Grade points of that grade on the scale (when the scale gives points).';
COMMENT ON COLUMN nlq.exam_results.result IS 'pass, fail (at least one paper failed) or incomplete (some paper still has no entry; no rank).';
COMMENT ON COLUMN nlq.exam_results.rank_in_section IS 'Rank in the section by percent, dense (1, 2, 2, 3); empty for incomplete results. Toppers: rank_in_section = 1.';
COMMENT ON COLUMN nlq.exam_results.rank_in_class IS 'Rank in the whole class (all sections) by percent, dense; empty for incomplete results.';
COMMENT ON COLUMN nlq.exam_results.computed_on IS 'The date (India) the results were last worked out; marks entered after it are not in this row.';

-- nlq.fee_bills: one row is one bill line of a pupil (academic year x fee month x fee head, on the school or hostel ledger).
-- Only lines billed now (status pending / partial / paid): cancelled and carried lines, removed and merged pupils left out. No late fee.
GRANT SELECT ON fee_demands, fee_periods, fee_heads, students, academic_years, enrolments, class_sections, classes TO edupro_nlq_owner;
CREATE VIEW nlq.fee_bills WITH (security_barrier = true) AS
SELECT d.id                                             AS bill_line_id,
       d.student_id,
       s.admission_no,
       s.display_name                                   AS student_name,
       d.academic_year_id,
       ay.code                                          AS academic_year,
       cs.id                                            AS class_section_id,
       k.name                                           AS class,
       k.display_order                                  AS class_order,
       cs.name                                          AS section,
       k.code || '-' || cs.name                         AS class_section,
       make_date(fp.year, fp.month, 1)                  AS fee_month,
       fp.name                                          AS fee_month_name,
       fp.sequence                                      AS fee_month_no,
       fp.instalment,
       d.due_on,
       date_trunc('month', d.due_on)::date              AS due_month,
       h.code                                           AS head_code,
       h.name                                           AS head,
       h.kind::text                                     AS head_kind,
       d.ledger::text                                   AS ledger,
       d.source,
       d.gross,
       d.discount                                       AS concession,
       d.net,
       d.paid,
       d.net - d.paid                                   AS balance,
       d.status::text                                   AS status,
       (d.net > d.paid AND d.due_on < (now() AT TIME ZONE 'Asia/Kolkata')::date) AS is_overdue,
       CASE WHEN d.net > d.paid
            THEN GREATEST((now() AT TIME ZONE 'Asia/Kolkata')::date - d.due_on, 0) ELSE 0 END AS days_overdue
  FROM fee_demands d
  JOIN students s        ON s.id = d.student_id
  JOIN academic_years ay ON ay.id = d.academic_year_id
  JOIN fee_periods fp    ON fp.id = d.period_id
  JOIN fee_heads h       ON h.id = d.head_id
  LEFT JOIN enrolments e ON e.student_id = d.student_id AND e.academic_year_id = d.academic_year_id AND e.status <> 'cancelled'
  LEFT JOIN class_sections cs ON cs.id = e.class_section_id
  LEFT JOIN classes k    ON k.id = cs.class_id
 WHERE d.school_id = app.nlq_school_id()
   AND d.status IN ('pending', 'partial', 'paid')
   AND s.deleted_at IS NULL
   AND s.merged_into_id IS NULL;
ALTER VIEW nlq.fee_bills OWNER TO edupro_nlq_owner;
GRANT SELECT ON nlq.fee_bills TO edupro_nlq;
COMMENT ON VIEW nlq.fee_bills IS 'One row is one bill line of a pupil: one fee head (Tuition, Transport, Previous dues, Bounce charge ...) for one fee month of one academic year, on the school ledger or the hostel ledger. This is what the school asks the family to pay and what has been paid against it. Left out: lines taken off the bill (cancelled: months after a pupil left, hostel months not stayed), old-year lines carried into the next year''s opening balance (carried; the same money is on the new year''s Previous dues lines), removed and merged duplicate pupils. The LATE FEE IS NOT IN THIS VIEW: it is worked out live from the day of payment and is not a bill line until collected (collected late fee is in nlq.fee_receipts.late_fee); only last year''s unpaid late fine, carried forward, appears here as head_kind late_fee. Dues / outstanding = sum(balance); billed = sum(net); concession = sum(concession). Filter one academic_year first. For "overdue" use is_overdue or due_on < a date; for "dues of a month" group by fee_month (the month billed) or due_month (the month the last date falls in; a quarterly plan puts three fee months on one due date). balance can be negative on an opening advance (credit) line, which correctly lowers the pupil''s total. paid on a single line can be overstated when an opening credit sits in the same instalment, so for money collected per head use nlq.fee_receipt_heads; per pupil, class or month sum(paid) is right. School and hostel are mixed unless you filter ledger. Join nlq.students on student_id + academic_year_id.';
COMMENT ON COLUMN nlq.fee_bills.bill_line_id IS 'Id of the bill line; join key to nlq.fee_concessions.bill_line_id.';
COMMENT ON COLUMN nlq.fee_bills.student_id IS 'The pupil''s id; join key to student_id in other nlq views (with academic_year_id for the class that year).';
COMMENT ON COLUMN nlq.fee_bills.admission_no IS 'The pupil''s admission number.';
COMMENT ON COLUMN nlq.fee_bills.student_name IS 'The pupil''s full name.';
COMMENT ON COLUMN nlq.fee_bills.academic_year_id IS 'Id of the academic year the bill belongs to; join key to nlq.academic_years.';
COMMENT ON COLUMN nlq.fee_bills.academic_year IS 'Code of the academic year of the bill, e.g. 2026-27.';
COMMENT ON COLUMN nlq.fee_bills.class_section_id IS 'Id of the pupil''s class-section in that academic year (NULL when the pupil has no enrolment that year).';
COMMENT ON COLUMN nlq.fee_bills.class IS 'The pupil''s class in that academic year (e.g. VI); sort by class_order.';
COMMENT ON COLUMN nlq.fee_bills.class_order IS 'Display order of the class, for sorting classes from youngest to oldest.';
COMMENT ON COLUMN nlq.fee_bills.section IS 'The pupil''s section name in that academic year (e.g. A).';
COMMENT ON COLUMN nlq.fee_bills.class_section IS 'Class and section together, e.g. VI-A.';
COMMENT ON COLUMN nlq.fee_bills.fee_month IS 'First day of the fee month this line bills (e.g. 2026-11-01 for November fee). Group by it for "fee of a month".';
COMMENT ON COLUMN nlq.fee_bills.fee_month_name IS 'The school''s name of the fee month (e.g. April).';
COMMENT ON COLUMN nlq.fee_bills.fee_month_no IS 'Position of the fee month in the session, 1 to 12 (1 = first month of the year).';
COMMENT ON COLUMN nlq.fee_bills.instalment IS 'Quarter or instalment number the fee month belongs to in the school calendar (1, 2, 3 ...).';
COMMENT ON COLUMN nlq.fee_bills.due_on IS 'Last date to pay this line without late fee (the pupil''s own date: class calendar and pay plan applied). Lines of one pupil and ledger with the same due_on form one instalment.';
COMMENT ON COLUMN nlq.fee_bills.due_month IS 'First day of the month of due_on.';
COMMENT ON COLUMN nlq.fee_bills.head_code IS 'Code of the fee head (e.g. TUITION, PREVDUE, BOUNCE).';
COMMENT ON COLUMN nlq.fee_bills.head IS 'Name of the fee head (e.g. Tuition fee, Transport fee, Previous dues).';
COMMENT ON COLUMN nlq.fee_bills.head_kind IS 'Kind of head: regular (class fee), transport, opening_balance (previous dues or advance carried / opened), late_fee (last year''s unpaid late fine carried), misc (bounce charge and other misc heads).';
COMMENT ON COLUMN nlq.fee_bills.ledger IS 'school (regular school fee) or hostel (hostel fee). Filter it when the question names one.';
COMMENT ON COLUMN nlq.fee_bills.source IS 'How the line was made: structure (class fee structure), transport, opening_balance (carried or opening figure), bounce_charge (charge for a returned cheque).';
COMMENT ON COLUMN nlq.fee_bills.gross IS 'Fee before any concession, in rupees.';
COMMENT ON COLUMN nlq.fee_bills.concession IS 'Everything taken off the line, in rupees: concession types, approved waivers, refunds where the fee was cancelled, write-off after a withdrawal, and rounding to whole rupees (a few paise either way). gross - concession = net.';
COMMENT ON COLUMN nlq.fee_bills.net IS 'What is asked for this line, in rupees (after concession). Negative on an opening advance (credit) line.';
COMMENT ON COLUMN nlq.fee_bills.paid IS 'What receipts hold against this line today, in rupees (whenever paid). Reliable when summed per pupil, class or month; per head use nlq.fee_receipt_heads.';
COMMENT ON COLUMN nlq.fee_bills.balance IS 'Still to pay on this line, in rupees: net - paid (0 when paid; negative on an unused credit line). Late fee not included.';
COMMENT ON COLUMN nlq.fee_bills.status IS 'pending (nothing paid), partial (part paid), paid (fully paid, or fully waived).';
COMMENT ON COLUMN nlq.fee_bills.is_overdue IS 'True when something is still to pay and the last date (due_on) is before today (India date).';
COMMENT ON COLUMN nlq.fee_bills.days_overdue IS 'Days from due_on to today when something is still to pay, else 0. Ageing buckets: 1-30, 31-60, 61-90, over 90 days.';

-- nlq.fee_concessions: one row is one bill line (pupil x year x fee month x head) that has something taken off it, split into
-- approved waivers and other concession, with the discount types the pupil holds for that month and head. Same lines as nlq.fee_bills.
GRANT SELECT ON fee_demands, fee_periods, fee_heads, fee_adjustments, fee_discounts, fee_discount_lines, student_fee_discounts, student_fee_profiles, students, academic_years, enrolments, class_sections, classes TO edupro_nlq_owner;
CREATE VIEW nlq.fee_concessions WITH (security_barrier = true) AS
SELECT d.id                                             AS bill_line_id,
       d.student_id,
       s.admission_no,
       s.display_name                                   AS student_name,
       d.academic_year_id,
       ay.code                                          AS academic_year,
       cs.id                                            AS class_section_id,
       k.name                                           AS class,
       k.display_order                                  AS class_order,
       cs.name                                          AS section,
       k.code || '-' || cs.name                         AS class_section,
       make_date(fp.year, fp.month, 1)                  AS fee_month,
       d.due_on,
       h.code                                           AS head_code,
       h.name                                           AS head,
       h.kind::text                                     AS head_kind,
       d.ledger::text                                   AS ledger,
       d.gross,
       d.discount                                       AS concession,
       LEAST(COALESCE(w.waived, 0), GREATEST(d.discount, 0)) AS waived,
       d.discount - LEAST(COALESCE(w.waived, 0), GREATEST(d.discount, 0)) AS other_concession,
       d.net,
       dt.discount_types,
       (dt.discount_types IS NOT NULL)                  AS has_discount_type,
       sp.fee_group
  FROM fee_demands d
  JOIN students s        ON s.id = d.student_id
  JOIN academic_years ay ON ay.id = d.academic_year_id
  JOIN fee_periods fp    ON fp.id = d.period_id
  JOIN fee_heads h       ON h.id = d.head_id
  LEFT JOIN student_fee_profiles sp ON sp.student_id = d.student_id AND sp.academic_year_id = d.academic_year_id
  LEFT JOIN (SELECT a.demand_id, sum(a.amount) AS waived
               FROM fee_adjustments a
              WHERE a.kind = 'waiver' AND a.status = 'approved' AND a.undone_at IS NULL
              GROUP BY a.demand_id) w ON w.demand_id = d.id
  LEFT JOIN LATERAL (
        SELECT string_agg(fd.name, ', ' ORDER BY fd.name) AS discount_types
          FROM fee_discounts fd
         WHERE (fd.id = sp.discount_id
                OR EXISTS (SELECT 1 FROM student_fee_discounts sfd
                            WHERE sfd.discount_id = fd.id AND sfd.student_id = d.student_id
                              AND sfd.academic_year_id = d.academic_year_id AND sfd.status = 'active'
                              AND fp.sequence BETWEEN sfd.from_seq AND sfd.to_seq))
           AND (NOT EXISTS (SELECT 1 FROM fee_discount_lines l0 WHERE l0.discount_id = fd.id)
                OR EXISTS (SELECT 1 FROM fee_discount_lines l1 WHERE l1.discount_id = fd.id AND l1.head_id = d.head_id))) dt ON true
  LEFT JOIN enrolments e ON e.student_id = d.student_id AND e.academic_year_id = d.academic_year_id AND e.status <> 'cancelled'
  LEFT JOIN class_sections cs ON cs.id = e.class_section_id
  LEFT JOIN classes k    ON k.id = cs.class_id
 WHERE d.school_id = app.nlq_school_id()
   AND d.status IN ('pending', 'partial', 'paid')
   AND d.discount <> 0
   AND s.deleted_at IS NULL
   AND s.merged_into_id IS NULL;
ALTER VIEW nlq.fee_concessions OWNER TO edupro_nlq_owner;
GRANT SELECT ON nlq.fee_concessions TO edupro_nlq;
COMMENT ON VIEW nlq.fee_concessions IS 'One row is one bill line (a pupil''s fee head for one fee month of one academic year) that has something taken off it. concession is the whole amount taken off; it is split into waived (fee waivers approved for this line and not taken back) and other_concession (concession types such as sibling or staff ward, refunds where the fee was cancelled, write-off of months after a withdrawal, a paid bounce charge or late fee moved into fee, and rounding to whole rupees). The bills do not record which concession type gave each rupee: discount_types lists the types the pupil holds now for that month and head, so group by discount_types for "concession by type" knowing that a line with two types shows both names together. Left out: lines not billed now (cancelled, carried), removed and merged pupils; lines with nothing taken off. Totals: sum(concession), sum(waived). Filter one academic_year; group by class, head, fee_month, ledger, discount_types or fee_group. Join nlq.fee_bills on bill_line_id for paid and balance.';
COMMENT ON COLUMN nlq.fee_concessions.bill_line_id IS 'Id of the bill line; join key to nlq.fee_bills.bill_line_id.';
COMMENT ON COLUMN nlq.fee_concessions.student_id IS 'The pupil''s id; join key to student_id in other nlq views.';
COMMENT ON COLUMN nlq.fee_concessions.admission_no IS 'The pupil''s admission number.';
COMMENT ON COLUMN nlq.fee_concessions.student_name IS 'The pupil''s full name.';
COMMENT ON COLUMN nlq.fee_concessions.academic_year_id IS 'Id of the academic year of the bill line.';
COMMENT ON COLUMN nlq.fee_concessions.academic_year IS 'Code of the academic year of the bill line, e.g. 2026-27.';
COMMENT ON COLUMN nlq.fee_concessions.class_section_id IS 'Id of the pupil''s class-section in that academic year.';
COMMENT ON COLUMN nlq.fee_concessions.class IS 'The pupil''s class in that academic year; sort by class_order.';
COMMENT ON COLUMN nlq.fee_concessions.class_order IS 'Display order of the class, for sorting.';
COMMENT ON COLUMN nlq.fee_concessions.section IS 'The pupil''s section in that academic year.';
COMMENT ON COLUMN nlq.fee_concessions.class_section IS 'Class and section together, e.g. VI-A.';
COMMENT ON COLUMN nlq.fee_concessions.fee_month IS 'First day of the fee month of the line.';
COMMENT ON COLUMN nlq.fee_concessions.due_on IS 'Last date to pay the line.';
COMMENT ON COLUMN nlq.fee_concessions.head_code IS 'Code of the fee head.';
COMMENT ON COLUMN nlq.fee_concessions.head IS 'Name of the fee head (e.g. Tuition fee, Transport fee).';
COMMENT ON COLUMN nlq.fee_concessions.head_kind IS 'Kind of head: regular, transport, opening_balance, late_fee, misc.';
COMMENT ON COLUMN nlq.fee_concessions.ledger IS 'school or hostel.';
COMMENT ON COLUMN nlq.fee_concessions.gross IS 'Fee before anything was taken off, in rupees.';
COMMENT ON COLUMN nlq.fee_concessions.concession IS 'Everything taken off the line, in rupees (gross - net). A value under one rupee is only rounding.';
COMMENT ON COLUMN nlq.fee_concessions.waived IS 'Part of concession from approved fee waivers on this line that were not taken back, in rupees.';
COMMENT ON COLUMN nlq.fee_concessions.other_concession IS 'concession - waived, in rupees: concession types, cancelled-fee refunds, withdrawal write-off, rounding.';
COMMENT ON COLUMN nlq.fee_concessions.net IS 'What is asked for the line after concession, in rupees.';
COMMENT ON COLUMN nlq.fee_concessions.discount_types IS 'Names of the concession (discount) types the pupil holds for this month that cover this head, comma-separated in name order (e.g. Sibling, Staff ward); NULL when none (the concession is then a waiver, a write-off or a refund).';
COMMENT ON COLUMN nlq.fee_concessions.has_discount_type IS 'True when the pupil holds at least one concession type covering this line.';
COMMENT ON COLUMN nlq.fee_concessions.fee_group IS 'The pupil''s fee group for the year (the school''s own codes, e.g. general, staff_ward); NULL when no fee profile.';

-- nlq.fee_receipt_heads: one row is the part of one counted fee receipt set against one fee head for one fee month, plus one
-- late fee row and one advance row per receipt. From the allocations (head-wise cash). Cancelled and bounced receipts left out.
GRANT SELECT ON fee_payments, fee_payment_allocations, fee_late_fee_postings, fee_demands, fee_heads, fee_periods, students, academic_years, enrolments, class_sections, classes TO edupro_nlq_owner;
CREATE VIEW nlq.fee_receipt_heads WITH (security_barrier = true) AS
SELECT p.id                                             AS receipt_id,
       p.receipt_no,
       p.received_on,
       date_trunc('month', p.received_on)::date         AS month,
       p.academic_year_id,
       ay.code                                          AS academic_year,
       p.student_id,
       s.admission_no,
       s.display_name                                   AS student_name,
       cs.id                                            AS class_section_id,
       k.name                                           AS class,
       k.display_order                                  AS class_order,
       cs.name                                          AS section,
       k.code || '-' || cs.name                         AS class_section,
       p.ledger::text                                   AS ledger,
       p.mode,
       COALESCE(p.mode_label, p.mode)                   AS mode_name,
       x.line_kind,
       CASE x.line_kind WHEN 'fee' THEN h.code WHEN 'late_fee' THEN 'LATE_FEE' ELSE 'ADVANCE' END AS head_code,
       CASE x.line_kind WHEN 'fee' THEN h.name WHEN 'late_fee' THEN 'Late fee' ELSE 'Advance (not yet set against fee)' END AS head,
       CASE x.line_kind WHEN 'fee' THEN h.kind::text ELSE x.line_kind END AS head_kind,
       CASE WHEN fp.id IS NOT NULL THEN make_date(fp.year, fp.month, 1) END AS fee_month,
       x.amount
  FROM (SELECT a.payment_id, 'fee' AS line_kind, d.head_id, d.period_id, sum(a.amount) AS amount
          FROM fee_payment_allocations a
          JOIN fee_demands d ON d.id = a.demand_id
         GROUP BY a.payment_id, d.head_id, d.period_id
        UNION ALL
        SELECT lf.payment_id, 'late_fee', NULL::bigint, lf.period_id, sum(lf.amount)
          FROM fee_late_fee_postings lf
         GROUP BY lf.payment_id, lf.period_id
        UNION ALL
        SELECT p2.id, 'advance', NULL::bigint, NULL::bigint, p2.amount - p2.late_fee - p2.refunded - COALESCE(al.allocated, 0)
          FROM fee_payments p2
          LEFT JOIN (SELECT a2.payment_id, sum(a2.amount) AS allocated
                       FROM fee_payment_allocations a2 GROUP BY a2.payment_id) al ON al.payment_id = p2.id
         WHERE p2.amount - p2.late_fee - p2.refunded - COALESCE(al.allocated, 0) > 0.005) x
  JOIN fee_payments p    ON p.id = x.payment_id
  JOIN students s        ON s.id = p.student_id
  JOIN academic_years ay ON ay.id = p.academic_year_id
  LEFT JOIN fee_heads h  ON h.id = x.head_id
  LEFT JOIN fee_periods fp ON fp.id = x.period_id
  LEFT JOIN enrolments e ON e.student_id = p.student_id AND e.academic_year_id = p.academic_year_id AND e.status <> 'cancelled'
  LEFT JOIN class_sections cs ON cs.id = e.class_section_id
  LEFT JOIN classes k    ON k.id = cs.class_id
 WHERE p.school_id = app.nlq_school_id()
   AND p.status NOT IN ('reversed', 'bounced')
   AND s.deleted_at IS NULL
   AND s.merged_into_id IS NULL;
ALTER VIEW nlq.fee_receipt_heads OWNER TO edupro_nlq_owner;
GRANT SELECT ON nlq.fee_receipt_heads TO edupro_nlq;
COMMENT ON VIEW nlq.fee_receipt_heads IS 'One row is the part of one fee receipt set against one fee head for one fee month (line_kind fee), plus one row for the late fee collected on the receipt (line_kind late_fee) and one for money not yet set against any bill (line_kind advance). This is the reliable head-wise cash: use it for "collection by head" (Tuition, Transport, ...), never nlq.fee_bills.paid. Left out: cancelled and bounced receipts, removed and merged pupils. The rows of a receipt add up to its amount minus what was refunded from it (a refund takes the money off the head it came from), so per receipt sum(amount) = nlq.fee_receipts.net_amount. Figures are what the receipts are set against today. Filter received_on or month for money received in a period (the receipt date); fee_month tells which month''s fee the money paid. Group by head, head_kind, ledger, class or month. Join nlq.fee_receipts on receipt_id for receipt details.';
COMMENT ON COLUMN nlq.fee_receipt_heads.receipt_id IS 'Id of the receipt; join key to nlq.fee_receipts.receipt_id.';
COMMENT ON COLUMN nlq.fee_receipt_heads.receipt_no IS 'Receipt number as printed.';
COMMENT ON COLUMN nlq.fee_receipt_heads.received_on IS 'Date of the receipt (India date).';
COMMENT ON COLUMN nlq.fee_receipt_heads.month IS 'First day of the month of received_on (the month the money came in).';
COMMENT ON COLUMN nlq.fee_receipt_heads.academic_year_id IS 'Id of the academic year whose bills the receipt settles.';
COMMENT ON COLUMN nlq.fee_receipt_heads.academic_year IS 'Code of the academic year whose bills the receipt settles, e.g. 2026-27.';
COMMENT ON COLUMN nlq.fee_receipt_heads.student_id IS 'The pupil''s id; join key to student_id in other nlq views.';
COMMENT ON COLUMN nlq.fee_receipt_heads.admission_no IS 'The pupil''s admission number.';
COMMENT ON COLUMN nlq.fee_receipt_heads.student_name IS 'The pupil''s full name.';
COMMENT ON COLUMN nlq.fee_receipt_heads.class_section_id IS 'Id of the pupil''s class-section in the receipt''s academic year.';
COMMENT ON COLUMN nlq.fee_receipt_heads.class IS 'The pupil''s class in the receipt''s academic year; sort by class_order.';
COMMENT ON COLUMN nlq.fee_receipt_heads.class_order IS 'Display order of the class, for sorting.';
COMMENT ON COLUMN nlq.fee_receipt_heads.section IS 'The pupil''s section in the receipt''s academic year.';
COMMENT ON COLUMN nlq.fee_receipt_heads.class_section IS 'Class and section together, e.g. VI-A.';
COMMENT ON COLUMN nlq.fee_receipt_heads.ledger IS 'school or hostel: the ledger of the receipt.';
COMMENT ON COLUMN nlq.fee_receipt_heads.mode IS 'Kind of payment of the receipt: online, cash, cheque, dd, upi, bank, card.';
COMMENT ON COLUMN nlq.fee_receipt_heads.mode_name IS 'The school''s own name of the mode (e.g. NEFT), else the kind.';
COMMENT ON COLUMN nlq.fee_receipt_heads.line_kind IS 'fee (set against a bill line of a head), late_fee (late fee collected), advance (not yet set against any bill).';
COMMENT ON COLUMN nlq.fee_receipt_heads.head_code IS 'Code of the fee head; LATE_FEE for the late fee row, ADVANCE for the advance row.';
COMMENT ON COLUMN nlq.fee_receipt_heads.head IS 'Name of the fee head (e.g. Tuition fee); Late fee or Advance for those rows.';
COMMENT ON COLUMN nlq.fee_receipt_heads.head_kind IS 'For fee rows the head kind: regular, transport, opening_balance (previous dues), late_fee (last year''s late fine carried), misc (bounce charge ...); late_fee or advance for those rows.';
COMMENT ON COLUMN nlq.fee_receipt_heads.fee_month IS 'First day of the fee month the money paid (the bill line''s month; for late fee the instalment''s first month); NULL for advance.';
COMMENT ON COLUMN nlq.fee_receipt_heads.amount IS 'Money of the receipt on this head and month, in rupees (always positive; refunds already taken off).';

-- nlq.fee_receipts: one row is one fee receipt (school or hostel ledger) that counts as money received.
-- Cancelled (reversed) and bounced receipts, removed and merged pupils left out; amount is gross (refunds are in nlq.fee_refunds).
GRANT SELECT ON fee_payments, fee_payment_allocations, financial_years, students, academic_years, enrolments, class_sections, classes, users, user_school_memberships TO edupro_nlq_owner;
CREATE VIEW nlq.fee_receipts WITH (security_barrier = true) AS
SELECT p.id                                             AS receipt_id,
       p.receipt_no,
       p.received_on,
       date_trunc('month', p.received_on)::date         AS month,
       fy.code                                          AS financial_year,
       p.academic_year_id,
       ay.code                                          AS academic_year,
       p.student_id,
       s.admission_no,
       s.display_name                                   AS student_name,
       cs.id                                            AS class_section_id,
       k.name                                           AS class,
       k.display_order                                  AS class_order,
       cs.name                                          AS section,
       k.code || '-' || cs.name                         AS class_section,
       p.ledger::text                                   AS ledger,
       p.mode,
       COALESCE(p.mode_label, p.mode)                   AS mode_name,
       (p.intent_id IS NOT NULL)                        AS is_online,
       p.amount,
       p.amount - p.late_fee                            AS fee_part,
       p.late_fee,
       GREATEST(p.amount - p.late_fee - p.refunded - COALESCE(al.allocated, 0), 0) AS advance,
       p.refunded,
       p.amount - p.refunded                            AS net_amount,
       p.convenience_charge,
       p.status,
       p.cleared_on,
       (p.mode IN ('cheque', 'dd') AND p.cleared_on IS NULL) AS is_uncleared_cheque,
       CASE WHEN p.intent_id IS NOT NULL THEN 'Online' ELSE u.display_name END AS received_by
  FROM fee_payments p
  JOIN students s        ON s.id = p.student_id
  JOIN academic_years ay ON ay.id = p.academic_year_id
  LEFT JOIN financial_years fy ON fy.id = p.financial_year_id
  LEFT JOIN (SELECT a.payment_id, sum(a.amount) AS allocated
               FROM fee_payment_allocations a GROUP BY a.payment_id) al ON al.payment_id = p.id
  LEFT JOIN enrolments e ON e.student_id = p.student_id AND e.academic_year_id = p.academic_year_id AND e.status <> 'cancelled'
  LEFT JOIN class_sections cs ON cs.id = e.class_section_id
  LEFT JOIN classes k    ON k.id = cs.class_id
  LEFT JOIN users u      ON u.id = p.received_by
 WHERE p.school_id = app.nlq_school_id()
   AND p.status NOT IN ('reversed', 'bounced')
   AND s.deleted_at IS NULL
   AND s.merged_into_id IS NULL;
ALTER VIEW nlq.fee_receipts OWNER TO edupro_nlq_owner;
GRANT SELECT ON nlq.fee_receipts TO edupro_nlq;
COMMENT ON VIEW nlq.fee_receipts IS 'One row is one fee receipt of a pupil (school fee or hostel fee) that counts as money received: at the counter, from an Excel upload, or paid online. Left out: cancelled receipts (reversed, never counted) and bounced cheques (the money never came), removed and merged duplicate pupils. Misc fees, admission and registration fees are not here (nlq.misc_receipts). Money collected = sum(amount) filtered on received_on (the receipt date, India) or month; amount = fee_part + late_fee and holds any advance; refunds are NOT taken off amount: subtract sum(nlq.fee_refunds.amount) by its paid_on for "net of refunds" by date, or use net_amount (amount - refunded) for the receipt as it stands today. Filter by received_on / month for "collected in a period", never by academic_year (that is the year of the bills the receipt settles: April receipts often pay last year''s dues). Class and section are the pupil''s in that academic year (as in the school''s day book). Group by mode_name, ledger, class, received_by or month. Head-wise split of the money: nlq.fee_receipt_heads (join on receipt_id).';
COMMENT ON COLUMN nlq.fee_receipts.receipt_id IS 'Id of the receipt; join key to nlq.fee_receipt_heads.receipt_id and nlq.fee_refunds.receipt_id.';
COMMENT ON COLUMN nlq.fee_receipts.receipt_no IS 'Receipt number as printed (e.g. TF/FY2026-27/000123 school, HF/... hostel; numbered per ledger and financial year).';
COMMENT ON COLUMN nlq.fee_receipts.received_on IS 'Date of the receipt (India date). Use it for day book, daily and monthly collection.';
COMMENT ON COLUMN nlq.fee_receipts.month IS 'First day of the month of received_on.';
COMMENT ON COLUMN nlq.fee_receipts.financial_year IS 'Code of the financial year (April to March) of received_on, e.g. FY2026-27.';
COMMENT ON COLUMN nlq.fee_receipts.academic_year_id IS 'Id of the academic year whose bills this receipt settles (not the year of the date).';
COMMENT ON COLUMN nlq.fee_receipts.academic_year IS 'Code of the academic year whose bills this receipt settles, e.g. 2026-27.';
COMMENT ON COLUMN nlq.fee_receipts.student_id IS 'The pupil''s id; join key to student_id in other nlq views.';
COMMENT ON COLUMN nlq.fee_receipts.admission_no IS 'The pupil''s admission number.';
COMMENT ON COLUMN nlq.fee_receipts.student_name IS 'The pupil''s full name.';
COMMENT ON COLUMN nlq.fee_receipts.class_section_id IS 'Id of the pupil''s class-section in the receipt''s academic year.';
COMMENT ON COLUMN nlq.fee_receipts.class IS 'The pupil''s class in the receipt''s academic year (e.g. VI); sort by class_order.';
COMMENT ON COLUMN nlq.fee_receipts.class_order IS 'Display order of the class, for sorting.';
COMMENT ON COLUMN nlq.fee_receipts.section IS 'The pupil''s section in the receipt''s academic year (e.g. A).';
COMMENT ON COLUMN nlq.fee_receipts.class_section IS 'Class and section together, e.g. VI-A.';
COMMENT ON COLUMN nlq.fee_receipts.ledger IS 'school (regular school fee) or hostel (hostel fee). A receipt pays only bills of its own ledger.';
COMMENT ON COLUMN nlq.fee_receipts.mode IS 'Kind of payment: online (payment gateway), cash, cheque, dd (demand draft), upi, bank (bank transfer), card.';
COMMENT ON COLUMN nlq.fee_receipts.mode_name IS 'The school''s own name of the mode (e.g. NEFT, POS machine), else the kind. Group by it for mode-wise collection.';
COMMENT ON COLUMN nlq.fee_receipts.is_online IS 'True when the family paid through the payment gateway (parent app or website).';
COMMENT ON COLUMN nlq.fee_receipts.amount IS 'Money received on the receipt for fees, in rupees: fee_part + late_fee (any advance is inside fee_part). Gross: a later refund does not change it. Excludes the online convenience charge.';
COMMENT ON COLUMN nlq.fee_receipts.fee_part IS 'The fee part of the receipt, in rupees: amount - late_fee (fee set against bills plus advance).';
COMMENT ON COLUMN nlq.fee_receipts.late_fee IS 'Late fee collected on this receipt, in rupees (after any late fee refunded from it).';
COMMENT ON COLUMN nlq.fee_receipts.advance IS 'Money on the receipt not yet set against any bill (advance / excess paid), in rupees.';
COMMENT ON COLUMN nlq.fee_receipts.refunded IS 'Amount refunded out of this receipt so far, in rupees (counted from approval; a gateway refund may still be on its way).';
COMMENT ON COLUMN nlq.fee_receipts.net_amount IS 'amount - refunded, in rupees: what the receipt still holds today.';
COMMENT ON COLUMN nlq.fee_receipts.convenience_charge IS 'Online convenience charge the family paid on top of the fee, in rupees (school income apart from the fee; not in amount). 0 at the counter.';
COMMENT ON COLUMN nlq.fee_receipts.status IS 'posted (normal), partly_refunded, refunded (fully refunded). Cancelled and bounced receipts are not in this view.';
COMMENT ON COLUMN nlq.fee_receipts.cleared_on IS 'Date the bank credited the cheque, draft or transfer (from the bank statement); NULL = not yet seen in the bank (always NULL for cash).';
COMMENT ON COLUMN nlq.fee_receipts.is_uncleared_cheque IS 'True for a cheque or draft not yet cleared by the bank.';
COMMENT ON COLUMN nlq.fee_receipts.received_by IS 'Name of the staff member who took the receipt; Online for gateway payments; NULL for receipts posted by a machine feed.';

-- nlq.fee_refunds: one row is one fee refund actually paid out (status paid), dated by paid_on: from a school or hostel
-- receipt, or of last year's advance. Drafts, requests waiting, rejected and failed refunds, removed and merged pupils left out.
GRANT SELECT ON public.fee_refunds, fee_payments, students, academic_years, enrolments, class_sections, classes TO edupro_nlq_owner;
CREATE VIEW nlq.fee_refunds WITH (security_barrier = true) AS
SELECT r.id                                             AS refund_id,
       r.voucher_no,
       r.paid_on,
       date_trunc('month', r.paid_on)::date             AS month,
       r.kind,
       r.fee_action,
       r.mode,
       r.amount,
       COALESCE(p.ledger::text, 'school')               AS ledger,
       r.payment_id                                     AS receipt_id,
       p.receipt_no,
       p.received_on                                    AS receipt_received_on,
       s.id                                             AS student_id,
       s.admission_no,
       s.display_name                                   AS student_name,
       ay.id                                            AS academic_year_id,
       ay.code                                          AS academic_year,
       cs.id                                            AS class_section_id,
       k.name                                           AS class,
       k.display_order                                  AS class_order,
       cs.name                                          AS section,
       k.code || '-' || cs.name                         AS class_section,
       (r.withdrawal_id IS NOT NULL OR r.hostel_withdrawal_id IS NOT NULL) AS is_withdrawal,
       (r.requested_at AT TIME ZONE 'Asia/Kolkata')::date AS requested_on,
       (r.decided_at AT TIME ZONE 'Asia/Kolkata')::date AS approved_on
  FROM public.fee_refunds r
  LEFT JOIN fee_payments p ON p.id = r.payment_id
  JOIN students s        ON s.id = COALESCE(r.student_id, p.student_id)
  JOIN academic_years ay ON ay.id = COALESCE(r.academic_year_id, p.academic_year_id)
  LEFT JOIN enrolments e ON e.student_id = s.id AND e.academic_year_id = ay.id AND e.status <> 'cancelled'
  LEFT JOIN class_sections cs ON cs.id = e.class_section_id
  LEFT JOIN classes k    ON k.id = cs.class_id
 WHERE r.school_id = app.nlq_school_id()
   AND r.status = 'paid'
   AND s.deleted_at IS NULL
   AND s.merged_into_id IS NULL;
ALTER VIEW nlq.fee_refunds OWNER TO edupro_nlq_owner;
GRANT SELECT ON nlq.fee_refunds TO edupro_nlq;
COMMENT ON VIEW nlq.fee_refunds IS 'One row is one fee refund actually paid out to a family (school or hostel fee): money given back from a receipt, or last year''s advance given back (kind opening_advance, no receipt). Left out: draft refunds, refunds waiting for approval, rejected ones, gateway refunds still on their way or failed, removed and merged pupils. Refunds of misc and admission fees are not here (nlq.misc_receipts already takes misc refunds off in net_amount). Money out = sum(amount) filtered on paid_on or month (the day it was paid). For collection net of refunds in a period: sum(nlq.fee_receipts.amount) by received_on minus sum(amount) here by paid_on. Group by mode, ledger, kind, fee_action, class or month. Join nlq.fee_receipts on receipt_id for the receipt.';
COMMENT ON COLUMN nlq.fee_refunds.refund_id IS 'Id of the refund.';
COMMENT ON COLUMN nlq.fee_refunds.voucher_no IS 'Refund voucher number (RF/<financial year>/... school, HR/... hostel); refunds raised together share one.';
COMMENT ON COLUMN nlq.fee_refunds.paid_on IS 'Date the refund was paid out (India date). Use it for money out in a period.';
COMMENT ON COLUMN nlq.fee_refunds.month IS 'First day of the month of paid_on.';
COMMENT ON COLUMN nlq.fee_refunds.kind IS 'receipt (money given back from a receipt) or opening_advance (last year''s advance carried forward, given back).';
COMMENT ON COLUMN nlq.fee_refunds.fee_action IS 'What became of the fee refunded: due (asked again: a wrong or double payment) or cancel (not asked again: transport stopped, pupil leaving).';
COMMENT ON COLUMN nlq.fee_refunds.mode IS 'How it was paid: cash, bank (transfer), cheque, gateway (back through the payment gateway that collected it).';
COMMENT ON COLUMN nlq.fee_refunds.amount IS 'Amount refunded, in rupees.';
COMMENT ON COLUMN nlq.fee_refunds.ledger IS 'school or hostel: the ledger of the receipt refunded (school for a refund of last year''s advance).';
COMMENT ON COLUMN nlq.fee_refunds.receipt_id IS 'Id of the receipt refunded; join key to nlq.fee_receipts.receipt_id. NULL for kind opening_advance.';
COMMENT ON COLUMN nlq.fee_refunds.receipt_no IS 'Number of the receipt refunded (NULL for kind opening_advance).';
COMMENT ON COLUMN nlq.fee_refunds.receipt_received_on IS 'Date of the receipt refunded (NULL for kind opening_advance).';
COMMENT ON COLUMN nlq.fee_refunds.student_id IS 'The pupil''s id; join key to student_id in other nlq views.';
COMMENT ON COLUMN nlq.fee_refunds.admission_no IS 'The pupil''s admission number.';
COMMENT ON COLUMN nlq.fee_refunds.student_name IS 'The pupil''s full name.';
COMMENT ON COLUMN nlq.fee_refunds.academic_year_id IS 'Id of the academic year of the fee refunded.';
COMMENT ON COLUMN nlq.fee_refunds.academic_year IS 'Code of the academic year of the fee refunded, e.g. 2026-27.';
COMMENT ON COLUMN nlq.fee_refunds.class_section_id IS 'Id of the pupil''s class-section in that academic year.';
COMMENT ON COLUMN nlq.fee_refunds.class IS 'The pupil''s class in that academic year; sort by class_order.';
COMMENT ON COLUMN nlq.fee_refunds.class_order IS 'Display order of the class, for sorting.';
COMMENT ON COLUMN nlq.fee_refunds.section IS 'The pupil''s section in that academic year.';
COMMENT ON COLUMN nlq.fee_refunds.class_section IS 'Class and section together, e.g. VI-A.';
COMMENT ON COLUMN nlq.fee_refunds.is_withdrawal IS 'True when the refund was raised on a pupil''s withdrawal from school or from the hostel.';
COMMENT ON COLUMN nlq.fee_refunds.requested_on IS 'Date the refund was asked for (India date).';
COMMENT ON COLUMN nlq.fee_refunds.approved_on IS 'Date the refund was approved (India date).';

-- nlq.gate_passes: one row is one gate pass — a pupil leaving early or arriving late, a boarder's home leave or outing,
-- or a staff member going out (RGP returnable / NRGP non-returnable). Cancelled passes are left out; the state is the
-- v2 state (never the old status); pupil's class through the enrolment of the year holding the pass date. No reason,
-- destination, escort name or mobile, OTP or photo.
GRANT SELECT ON gate_passes, gate_pass_items, students, enrolments, academic_years, class_sections, classes, employees TO edupro_nlq_owner;
CREATE VIEW nlq.gate_passes WITH (security_barrier = true) AS
SELECT x.id                                                                     AS pass_id,
       COALESCE(x.pass_no, 'REQ-' || x.id::text)                                AS pass_no,
       x.on_date                                                                AS pass_on,
       date_trunc('month', x.on_date)::date                                     AS month,
       to_char(x.at_time, 'HH24:MI')                                            AS pass_time,
       x.kind,
       CASE WHEN x.audience = 'staff' THEN 'staff' ELSE 'pupil' END             AS person_type,
       x.state,
       (x.state IN ('approved', 'handed_over', 'out', 'returned'))              AS approved,
       (x.state IN ('out', 'returned'))                                         AS through_the_gate,
       (x.state IN ('pending', 'approved', 'handed_over')
        OR (x.state = 'out' AND x.kind IN ('rgp', 'hostel_home', 'hostel_outing'))) AS still_open,
       x.source,
       x.escort_kind                                                            AS collected_by,
       (x.created_at AT TIME ZONE 'Asia/Kolkata')::date                         AS asked_on,
       round((extract(epoch FROM x.decided_at - x.created_at) / 60)::numeric, 0) AS minutes_to_decide,
       (x.out_at AT TIME ZONE 'Asia/Kolkata')::date                             AS out_on,
       to_char(x.out_at AT TIME ZONE 'Asia/Kolkata', 'HH24:MI')                 AS out_time,
       (x.in_at AT TIME ZONE 'Asia/Kolkata')::date                              AS back_on,
       to_char(x.in_at AT TIME ZONE 'Asia/Kolkata', 'HH24:MI')                  AS back_time,
       (x.return_by AT TIME ZONE 'Asia/Kolkata')::date                          AS due_back_on,
       (x.state = 'out' AND x.kind IN ('rgp', 'hostel_home', 'hostel_outing') AND x.return_by < now()) AS overdue_now,
       (x.overdue_at IS NOT NULL)                                               AS was_overdue,
       x.late_minutes,
       COALESCE(it.items_out, 0)                                                AS items_out,
       COALESCE(it.items_not_back, 0)                                           AS items_not_back,
       x.student_id,
       s.admission_no,
       s.display_name                                                           AS student_name,
       en.academic_year_id,
       en.academic_year,
       en.class,
       en.class_order,
       en.section,
       en.class_section,
       en.class_section_id,
       x.employee_id,
       em.employee_code,
       em.display_name                                                          AS employee_name,
       NULLIF(btrim(em.department), '')                                         AS department,
       NULLIF(btrim(em.designation), '')                                        AS designation
  FROM gate_passes x
  LEFT JOIN students s ON s.id = x.student_id
  LEFT JOIN employees em ON em.id = x.employee_id
  LEFT JOIN LATERAL (SELECT y.id AS academic_year_id, y.code AS academic_year, k.name AS class, k.display_order AS class_order,
                            cs.name AS section, k.code || '-' || cs.name AS class_section, cs.id AS class_section_id
                       FROM enrolments e
                       JOIN academic_years y ON y.id = e.academic_year_id
                       JOIN class_sections cs ON cs.id = e.class_section_id
                       JOIN classes k ON k.id = cs.class_id
                      WHERE e.student_id = x.student_id AND e.status <> 'cancelled'
                        AND x.on_date BETWEEN y.start_date AND y.end_date
                      ORDER BY y.start_date DESC LIMIT 1) en ON true
  LEFT JOIN LATERAL (SELECT sum(i.qty)::int AS items_out,
                            (sum(i.qty - i.returned_qty) FILTER (WHERE i.returnable))::int AS items_not_back
                       FROM gate_pass_items i
                      WHERE i.pass_id = x.id) it ON true
 WHERE x.school_id = app.nlq_school_id()
   AND x.state <> 'cancelled';
ALTER VIEW nlq.gate_passes OWNER TO edupro_nlq_owner;
GRANT SELECT ON nlq.gate_passes TO edupro_nlq;
COMMENT ON VIEW nlq.gate_passes IS 'One row is one gate pass: a pupil leaving school early or arriving late, a boarder''s home leave or outing from the hostel, or a staff member going out during school (RGP: returnable, comes back; NRGP: non-returnable). Passes cancelled before use are left out. No reason, destination, escort name or mobile is here. Filter and group by pass_on or month (the date of leaving), kind, state, class / class_section (pupils) or department (staff). "Approved" passes: WHERE approved (includes those later handed over, out and back). Rejected: state = ''rejected''. Still waiting for approval: state = ''pending''. Out now and not back: overdue_now / still_open. Pupil columns are filled for pupil and hostel passes (class from that year''s enrolment), employee columns for staff passes. Speed of approval: avg(minutes_to_decide).';
COMMENT ON COLUMN nlq.gate_passes.pass_id IS 'The pass''s id.';
COMMENT ON COLUMN nlq.gate_passes.pass_no IS 'Pass number once approved (GP/2026/00012 for pupils and boarders, RGP/… or NRGP/… for staff); REQ-<id> while not approved.';
COMMENT ON COLUMN nlq.gate_passes.pass_on IS 'The date of leaving (or arriving, for a late arrival); the usual date to filter on.';
COMMENT ON COLUMN nlq.gate_passes.month IS 'First day of the month of pass_on.';
COMMENT ON COLUMN nlq.gate_passes.pass_time IS 'The time asked for, HH:MM (24-hour); empty when not given.';
COMMENT ON COLUMN nlq.gate_passes.kind IS 'early_leave (pupil leaves before school ends), late_arrival (pupil comes late), hostel_home (boarder goes home overnight or longer), hostel_outing (boarder''s same-day outing), rgp (staff returnable gate pass: goes out and comes back), nrgp (staff non-returnable gate pass).';
COMMENT ON COLUMN nlq.gate_passes.person_type IS 'pupil (pupil and boarder passes) or staff.';
COMMENT ON COLUMN nlq.gate_passes.state IS 'pending (waiting for approval), approved (pass issued), handed_over (the front desk handed the pupil to the person collecting), out (went through the gate — out, or in for a late arrival; the end for early_leave, late_arrival and nrgp), returned (back in: rgp, hostel_home, hostel_outing), rejected.';
COMMENT ON COLUMN nlq.gate_passes.approved IS 'True when the pass was approved (state approved, handed_over, out or returned).';
COMMENT ON COLUMN nlq.gate_passes.through_the_gate IS 'True when the holder actually went through the gate (state out or returned).';
COMMENT ON COLUMN nlq.gate_passes.still_open IS 'True while the pass is not finished: waiting for approval, approved but not used, handed over, or out on a pass that must come back (rgp, hostel leave).';
COMMENT ON COLUMN nlq.gate_passes.source IS 'Who asked: parent (in the parent app), front_desk (made at the front desk), employee (a staff member for themself).';
COMMENT ON COLUMN nlq.gate_passes.collected_by IS 'For a pupil leaving: who collected the pupil — father, mother, guardian or other; empty when not recorded.';
COMMENT ON COLUMN nlq.gate_passes.asked_on IS 'India date the pass was asked for.';
COMMENT ON COLUMN nlq.gate_passes.minutes_to_decide IS 'Minutes from asking to the approval or rejection; empty while pending.';
COMMENT ON COLUMN nlq.gate_passes.out_on IS 'India date the holder went out through the gate; empty when not yet out.';
COMMENT ON COLUMN nlq.gate_passes.out_time IS 'India time out through the gate, HH:MM.';
COMMENT ON COLUMN nlq.gate_passes.back_on IS 'India date the holder came back in (rgp, hostel leave); empty when not back or not returnable.';
COMMENT ON COLUMN nlq.gate_passes.back_time IS 'India time back in, HH:MM.';
COMMENT ON COLUMN nlq.gate_passes.due_back_on IS 'India date the holder must be back by (rgp, hostel leave); empty when not set.';
COMMENT ON COLUMN nlq.gate_passes.overdue_now IS 'True when the holder is out on a pass that must come back and the return time has passed, as of now.';
COMMENT ON COLUMN nlq.gate_passes.was_overdue IS 'True when the boarder was flagged as not back in time from hostel leave (parent and warden were told).';
COMMENT ON COLUMN nlq.gate_passes.late_minutes IS 'Minutes late back from hostel leave beyond the school''s grace time; empty when on time or not hostel leave.';
COMMENT ON COLUMN nlq.gate_passes.items_out IS 'Staff passes: number of items carried out (sum of quantities); 0 when none.';
COMMENT ON COLUMN nlq.gate_passes.items_not_back IS 'Staff passes: returnable items not ticked back in yet (quantity); 0 when none.';
COMMENT ON COLUMN nlq.gate_passes.student_id IS 'The pupil (pupil and boarder passes); joins nlq.students with academic_year_id.';
COMMENT ON COLUMN nlq.gate_passes.admission_no IS 'The pupil''s admission number.';
COMMENT ON COLUMN nlq.gate_passes.student_name IS 'The pupil''s name.';
COMMENT ON COLUMN nlq.gate_passes.academic_year_id IS 'The academic year holding the pass date (pupils); joins nlq.academic_years and nlq.students.';
COMMENT ON COLUMN nlq.gate_passes.academic_year IS 'Academic year code, e.g. 2026-27.';
COMMENT ON COLUMN nlq.gate_passes.class IS 'The pupil''s class that year (e.g. VI).';
COMMENT ON COLUMN nlq.gate_passes.class_order IS 'Sort order of the class (ORDER BY class_order, section).';
COMMENT ON COLUMN nlq.gate_passes.section IS 'The pupil''s section that year (e.g. A).';
COMMENT ON COLUMN nlq.gate_passes.class_section IS 'Class and section together, e.g. VI-A.';
COMMENT ON COLUMN nlq.gate_passes.class_section_id IS 'The class section id; joins nlq.class_sections.';
COMMENT ON COLUMN nlq.gate_passes.employee_id IS 'The staff member (staff passes); joins nlq.staff.';
COMMENT ON COLUMN nlq.gate_passes.employee_code IS 'The staff member''s employee code.';
COMMENT ON COLUMN nlq.gate_passes.employee_name IS 'The staff member''s name.';
COMMENT ON COLUMN nlq.gate_passes.department IS 'The staff member''s department on the record today.';
COMMENT ON COLUMN nlq.gate_passes.designation IS 'The staff member''s designation on the record today.';

-- nlq.helpdesk_queries: one row is one helpdesk ticket of any desk (parent, staff, ERP provider, hostel, admission
-- candidate). The old family leave requests kept in the same table are left out; no subject, text or reply. Pupil's
-- class through the enrolment of the ticket's academic year (never a cancelled one).
GRANT SELECT ON parent_queries, query_categories, academic_years, students, enrolments, class_sections, classes, employees, hostels TO edupro_nlq_owner;
CREATE VIEW nlq.helpdesk_queries WITH (security_barrier = true) AS
SELECT x.id                                                                     AS query_id,
       x.number,
       x.desk,
       x.kind::text                                                             AS kind,
       COALESCE(h.name, x.category_code)                                        AS head,
       x.category_code                                                          AS head_code,
       x.status::text                                                           AS status,
       (x.status <> 'closed')                                                   AS is_open,
       (x.status IN ('open', 'in_progress') AND x.due_at < now())               AS overdue,
       x.priority,
       x.level,
       (x.level > 1 OR x.escalated_at IS NOT NULL)                              AS escalated,
       (x.breached_at IS NOT NULL)                                              AS breached,
       (x.status = 'closed' AND x.level = 1 AND x.escalated_at IS NULL AND x.breached_at IS NULL) AS closed_within_sla,
       (x.opened_at AT TIME ZONE 'Asia/Kolkata')::date                          AS opened_on,
       date_trunc('month', x.opened_at AT TIME ZONE 'Asia/Kolkata')::date       AS month,
       (x.first_response_at AT TIME ZONE 'Asia/Kolkata')::date                  AS first_response_on,
       round((extract(epoch FROM x.first_response_at - x.opened_at) / 3600)::numeric, 1) AS hours_to_first_response,
       (x.closed_at AT TIME ZONE 'Asia/Kolkata')::date                          AS closed_on,
       round((extract(epoch FROM x.closed_at - x.opened_at) / 3600)::numeric, 1) AS hours_to_close,
       (x.due_at AT TIME ZONE 'Asia/Kolkata')::date                             AS due_on,
       x.reopened_count,
       x.rating,
       x.assigned_role,
       ae.employee_name                                                         AS assigned_to,
       x.academic_year_id,
       y.code                                                                   AS academic_year,
       x.student_id,
       s.admission_no,
       s.display_name                                                           AS student_name,
       k.name                                                                   AS class,
       k.display_order                                                          AS class_order,
       cs.name                                                                  AS section,
       k.code || '-' || cs.name                                                 AS class_section,
       cs.id                                                                    AS class_section_id,
       x.employee_id,
       em.employee_code,
       em.display_name                                                          AS employee_name,
       NULLIF(btrim(em.department), '')                                         AS department,
       ho.name                                                                  AS hostel
  FROM parent_queries x
  LEFT JOIN query_categories h ON h.desk = x.desk AND h.code = x.category_code
  LEFT JOIN academic_years y ON y.id = x.academic_year_id
  LEFT JOIN students s ON s.id = x.student_id
  LEFT JOIN enrolments e ON e.student_id = x.student_id AND e.academic_year_id = x.academic_year_id AND e.status <> 'cancelled'
  LEFT JOIN class_sections cs ON cs.id = e.class_section_id
  LEFT JOIN classes k ON k.id = cs.class_id
  LEFT JOIN employees em ON em.id = x.employee_id
  LEFT JOIN hostels ho ON ho.id = x.hostel_id
  LEFT JOIN LATERAL (SELECT a.display_name AS employee_name
                       FROM employees a
                      WHERE a.user_id = x.assigned_user_id AND a.deleted_at IS NULL
                      ORDER BY a.id LIMIT 1) ae ON true
 WHERE x.school_id = app.nlq_school_id()
   AND x.kind <> 'leave';
ALTER VIEW nlq.helpdesk_queries OWNER TO edupro_nlq_owner;
GRANT SELECT ON nlq.helpdesk_queries TO edupro_nlq;
COMMENT ON VIEW nlq.helpdesk_queries IS 'One row is one helpdesk ticket: a parent''s query or complaint about a pupil (desk parent), a staff query (staff), a ticket to the ERP provider (provider), a hostel complaint (hostel) or an admission family''s question (candidate). The old family leave requests stored with them are left out (leave is in the attendance views). No subject, text or reply is here. Always say which desk: filter desk = ''parent'' for parent queries and complaints. Open work: is_open (anything not closed; answered is not closed); overdue: open or in progress past its due time now. Group by month (of opened_on), desk, head, status, class or class_section. Speed: avg(hours_to_first_response), avg(hours_to_close) — clock hours, not working hours. The app''s "within SLA" share = count(*) FILTER (WHERE closed_within_sla) / count(*) FILTER (WHERE status = ''closed''). Pupil columns are filled for parent tickets (and hostel ones a parent raised); join nlq.students on student_id and academic_year_id for more about the pupil; employee columns are the staff member who raised a staff ticket.';
COMMENT ON COLUMN nlq.helpdesk_queries.query_id IS 'The ticket''s id.';
COMMENT ON COLUMN nlq.helpdesk_queries.number IS 'The ticket number the school sees, e.g. Q/2026-27/0042.';
COMMENT ON COLUMN nlq.helpdesk_queries.desk IS 'parent (families about a pupil), staff (staff queries), provider (tickets to the ERP provider), hostel (hostel complaints), candidate (families registering for admission).';
COMMENT ON COLUMN nlq.helpdesk_queries.kind IS 'query or complaint.';
COMMENT ON COLUMN nlq.helpdesk_queries.head IS 'The query head (category) of its desk, e.g. Fees and payments, Transport, Attendance; group by it for "what do parents ask about".';
COMMENT ON COLUMN nlq.helpdesk_queries.head_code IS 'Code of the query head (e.g. fees, transport, other); the same code can exist on several desks, so use it together with desk.';
COMMENT ON COLUMN nlq.helpdesk_queries.status IS 'open (new, or the raiser wrote back), in_progress (assigned or escalated), answered (the school replied; waiting for the raiser), closed (resolved). Reopened tickets go back to open.';
COMMENT ON COLUMN nlq.helpdesk_queries.is_open IS 'True when the ticket is not closed (open, in progress or answered).';
COMMENT ON COLUMN nlq.helpdesk_queries.overdue IS 'True when the ticket is open or in progress and its due time (school working hours) has passed, as of now.';
COMMENT ON COLUMN nlq.helpdesk_queries.priority IS 'low, normal, high or urgent (used mainly on the provider desk).';
COMMENT ON COLUMN nlq.helpdesk_queries.level IS 'Escalation level now: 1 = the head''s owner, 2–6 = the escalation levels it moved up to.';
COMMENT ON COLUMN nlq.helpdesk_queries.escalated IS 'True when the ticket was escalated beyond level 1 at least once.';
COMMENT ON COLUMN nlq.helpdesk_queries.breached IS 'True when even the last escalation level ran out of time (SLA breached).';
COMMENT ON COLUMN nlq.helpdesk_queries.closed_within_sla IS 'True when the ticket is closed and never escalated or breached (the helpdesk dashboard''s "within SLA"); false otherwise, including tickets not closed yet.';
COMMENT ON COLUMN nlq.helpdesk_queries.opened_on IS 'India date the ticket was raised; the usual date to filter on.';
COMMENT ON COLUMN nlq.helpdesk_queries.month IS 'First day of the month of opened_on.';
COMMENT ON COLUMN nlq.helpdesk_queries.first_response_on IS 'India date of the school''s first answer (or of closing, when it was closed without a written answer); empty when not answered yet.';
COMMENT ON COLUMN nlq.helpdesk_queries.hours_to_first_response IS 'Clock hours from raising to the first answer (1 decimal); empty when not answered yet.';
COMMENT ON COLUMN nlq.helpdesk_queries.closed_on IS 'India date the ticket was closed; empty while not closed (a reopened ticket loses it until closed again).';
COMMENT ON COLUMN nlq.helpdesk_queries.hours_to_close IS 'Clock hours from raising to closing (1 decimal); empty while not closed.';
COMMENT ON COLUMN nlq.helpdesk_queries.due_on IS 'India date the ticket is due at its current level (working hours counted); empty when no time limit applies.';
COMMENT ON COLUMN nlq.helpdesk_queries.reopened_count IS 'How many times the raiser reopened it after closing.';
COMMENT ON COLUMN nlq.helpdesk_queries.rating IS 'The raiser''s rating of the answer, 1 (poor) to 5 (excellent); empty when not rated. Use avg(rating).';
COMMENT ON COLUMN nlq.helpdesk_queries.assigned_role IS 'Role code the ticket waits on when it is assigned to a role (e.g. class_teacher, accountant, school_admin, erp_support); empty when assigned to a named person.';
COMMENT ON COLUMN nlq.helpdesk_queries.assigned_to IS 'Name of the staff member the ticket is assigned to now, when assigned to a person; empty when it waits on a role or on the ERP provider.';
COMMENT ON COLUMN nlq.helpdesk_queries.academic_year_id IS 'The academic year the ticket belongs to; joins nlq.academic_years and nlq.students.';
COMMENT ON COLUMN nlq.helpdesk_queries.academic_year IS 'Academic year code, e.g. 2026-27.';
COMMENT ON COLUMN nlq.helpdesk_queries.student_id IS 'The pupil the ticket is about (parent desk, and hostel tickets raised by a parent); empty otherwise. Joins nlq.students (with academic_year_id).';
COMMENT ON COLUMN nlq.helpdesk_queries.admission_no IS 'The pupil''s admission number.';
COMMENT ON COLUMN nlq.helpdesk_queries.student_name IS 'The pupil''s name.';
COMMENT ON COLUMN nlq.helpdesk_queries.class IS 'The pupil''s class in the ticket''s academic year (e.g. VI); empty when no pupil.';
COMMENT ON COLUMN nlq.helpdesk_queries.class_order IS 'Sort order of the class (ORDER BY class_order, section).';
COMMENT ON COLUMN nlq.helpdesk_queries.section IS 'The pupil''s section in that year (e.g. A).';
COMMENT ON COLUMN nlq.helpdesk_queries.class_section IS 'Class and section together, e.g. VI-A.';
COMMENT ON COLUMN nlq.helpdesk_queries.class_section_id IS 'The class section id; joins nlq.class_sections.';
COMMENT ON COLUMN nlq.helpdesk_queries.employee_id IS 'The staff member who raised a staff-desk ticket; joins nlq.staff. Empty for other desks.';
COMMENT ON COLUMN nlq.helpdesk_queries.employee_code IS 'Employee code of the staff member who raised it.';
COMMENT ON COLUMN nlq.helpdesk_queries.employee_name IS 'Name of the staff member who raised it.';
COMMENT ON COLUMN nlq.helpdesk_queries.department IS 'Department on that staff member''s record today.';
COMMENT ON COLUMN nlq.helpdesk_queries.hostel IS 'The hostel a hostel complaint is about; empty for other desks.';

-- nlq.homework: one row is one daily-work post to one section — homework, classwork or an assignment. Removed posts
-- (deleted_at) are left out; posts scheduled for later are kept with is_published = false. No body text: only the
-- title, dates, subject and the teacher who posted it, with the acknowledgements and attachments counted.
GRANT SELECT ON daily_work, daily_work_files, academic_acks, academic_years, class_sections, classes, subjects, employees
  TO edupro_nlq_owner;
CREATE VIEW nlq.homework WITH (security_barrier = true) AS
SELECT x.id                                                              AS homework_id,
       y.id                                                              AS academic_year_id,
       y.code                                                            AS academic_year,
       k.name                                                            AS class,
       k.display_order                                                   AS class_order,
       cs.name                                                           AS section,
       k.code || '-' || cs.name                                          AS class_section,
       cs.id                                                             AS class_section_id,
       x.kind::text                                                      AS kind,
       x.title,
       sub.id                                                            AS subject_id,
       sub.code                                                          AS subject_code,
       sub.name                                                          AS subject_name,
       emp.id                                                            AS employee_id,
       emp.employee_code,
       COALESCE(emp.display_name, concat_ws(' ', emp.first_name, emp.last_name)) AS employee_name,
       x.assigned_on,
       date_trunc('month', x.assigned_on)::date                          AS month,
       x.due_on,
       (x.publish_at AT TIME ZONE 'Asia/Kolkata')::date                  AS published_on,
       (x.publish_at <= now())                                           AS is_published,
       x.ack_required,
       COALESCE(ak.n, 0)                                                 AS acknowledged,
       COALESCE(fl.n, 0)                                                 AS attachments
  FROM daily_work x
  JOIN academic_years y ON y.id = x.academic_year_id
  JOIN class_sections cs ON cs.id = x.class_section_id
  JOIN classes k ON k.id = cs.class_id
  LEFT JOIN subjects sub ON sub.id = x.subject_id
  LEFT JOIN employees emp ON emp.id = x.posted_by_employee_id
  LEFT JOIN LATERAL (SELECT count(DISTINCT a.student_id)::int AS n FROM academic_acks a
                      WHERE a.item_type = 'daily_work' AND a.item_id = x.id AND a.student_id IS NOT NULL) ak ON x.ack_required
  LEFT JOIN LATERAL (SELECT count(*)::int AS n FROM daily_work_files f WHERE f.daily_work_id = x.id) fl ON true
 WHERE x.school_id = app.nlq_school_id()
   AND x.deleted_at IS NULL;
ALTER VIEW nlq.homework OWNER TO edupro_nlq_owner;
GRANT SELECT ON nlq.homework TO edupro_nlq;
COMMENT ON VIEW nlq.homework IS 'One row is one daily-work post a teacher (or the office) made to one section: homework, classwork or an assignment (kind) — not only homework, so filter kind = ''homework'' for homework alone. Removed posts are left out. Posts scheduled for a later time are kept with is_published = false: families see a post only once it is published, so for "what families got" filter is_published. Date to filter and group by: assigned_on (the school day it was set; month = its first of month); due_on is the submission date. A section with nothing posted has no rows: start from nlq.class_sections and LEFT JOIN on class_section_id to show zeros. Group by class (sort by class_order), class_section, subject_name or employee_name. The body text is not here.';
COMMENT ON COLUMN nlq.homework.homework_id IS 'The post''s id (one row each).';
COMMENT ON COLUMN nlq.homework.academic_year_id IS 'The academic year of the post (id).';
COMMENT ON COLUMN nlq.homework.academic_year IS 'The academic year of the post, e.g. 2026-27.';
COMMENT ON COLUMN nlq.homework.class IS 'The class the post is for, e.g. Class VI.';
COMMENT ON COLUMN nlq.homework.class_order IS 'Sort order of the class (lower = junior). Use ORDER BY class_order, not class.';
COMMENT ON COLUMN nlq.homework.section IS 'The section the post is for, e.g. A.';
COMMENT ON COLUMN nlq.homework.class_section IS 'Class code and section, e.g. VI-A.';
COMMENT ON COLUMN nlq.homework.class_section_id IS 'The section (id); join key to nlq.class_sections and nlq.students.';
COMMENT ON COLUMN nlq.homework.kind IS 'homework, classwork or assignment.';
COMMENT ON COLUMN nlq.homework.title IS 'The post''s short title as the teacher wrote it (e.g. Exercise 4.2, Q1-5).';
COMMENT ON COLUMN nlq.homework.subject_id IS 'The subject (id); empty when the post has no subject.';
COMMENT ON COLUMN nlq.homework.subject_code IS 'The subject''s code, e.g. ENG; empty when no subject.';
COMMENT ON COLUMN nlq.homework.subject_name IS 'The subject''s name, e.g. English; empty when no subject.';
COMMENT ON COLUMN nlq.homework.employee_id IS 'The teacher who posted it (id); join key to nlq.staff; empty when the office posted it.';
COMMENT ON COLUMN nlq.homework.employee_code IS 'The posting teacher''s employee code.';
COMMENT ON COLUMN nlq.homework.employee_name IS 'The posting teacher''s name.';
COMMENT ON COLUMN nlq.homework.assigned_on IS 'The school day the work was set. Filter and group by this date.';
COMMENT ON COLUMN nlq.homework.month IS 'First day of the month of assigned_on, for month-wise counts.';
COMMENT ON COLUMN nlq.homework.due_on IS 'The date the work is due (submission); empty when none.';
COMMENT ON COLUMN nlq.homework.published_on IS 'The date (India) the post reaches families (now for most; later when scheduled).';
COMMENT ON COLUMN nlq.homework.is_published IS 'true once families can see it; false = scheduled for later.';
COMMENT ON COLUMN nlq.homework.ack_required IS 'true when families are asked to acknowledge the post.';
COMMENT ON COLUMN nlq.homework.acknowledged IS 'Number of pupils whose family acknowledged the post (0 when no acknowledgement is asked).';
COMMENT ON COLUMN nlq.homework.attachments IS 'Number of files attached to the post.';

-- nlq.hostel_beds: one row is one bed of a hostel, with whether it is usable and who holds it today (India date).
-- Usable = bed active, room active, hostel active; occupied = a stay covers today (at most one per bed).
GRANT SELECT ON hostel_beds, hostel_rooms, hostel_blocks, hostel_room_types, hostels, hostel_allotments, students TO edupro_nlq_owner;
CREATE VIEW nlq.hostel_beds WITH (security_barrier = true) AS
SELECT x.id                                                               AS bed_id,
       h.id                                                               AS hostel_id,
       h.name                                                             AS hostel,
       h.code                                                             AS hostel_code,
       h.gender                                                           AS hostel_for,
       h.status                                                           AS hostel_status,
       bl.name                                                            AS block,
       r.floor,
       r.room_no,
       r.status                                                           AS room_status,
       t.name                                                             AS room_type,
       t.seater,
       t.ac                                                               AS is_ac,
       x.label                                                            AS bed,
       x.status                                                           AS bed_status,
       (x.status = 'active' AND r.status = 'active' AND h.status = 'active') AS is_usable,
       (a.id IS NOT NULL)                                                 AS is_occupied,
       (a.id IS NULL AND x.status = 'active' AND r.status = 'active' AND h.status = 'active') AS is_free,
       a.student_id                                                       AS student_id,
       s.admission_no                                                     AS admission_no,
       s.display_name                                                     AS student_name,
       a.from_date                                                        AS occupied_since,
       a.to_date                                                          AS occupied_until
  FROM hostel_beds x
  CROSS JOIN LATERAL (SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date AS today) n
  JOIN hostel_rooms r ON r.id = x.room_id
  JOIN hostels h ON h.id = r.hostel_id
  LEFT JOIN hostel_blocks bl ON bl.id = r.block_id
  JOIN hostel_room_types t ON t.id = r.room_type_id
  LEFT JOIN LATERAL (SELECT al.id, al.student_id, al.from_date, al.to_date
                       FROM hostel_allotments al
                      WHERE al.bed_id = x.id AND al.from_date <= n.today
                        AND (al.to_date IS NULL OR al.to_date >= n.today)
                      ORDER BY al.from_date DESC, al.id DESC
                      LIMIT 1) a ON true
  LEFT JOIN students s ON s.id = a.student_id AND s.deleted_at IS NULL AND s.merged_into_id IS NULL
 WHERE x.school_id = app.nlq_school_id();
ALTER VIEW nlq.hostel_beds OWNER TO edupro_nlq_owner;
GRANT SELECT ON nlq.hostel_beds TO edupro_nlq;
COMMENT ON VIEW nlq.hostel_beds IS 'One row is one bed in a hostel room, with today''s state (India date). Capacity = count(*) FILTER (WHERE is_usable); occupied = count(*) FILTER (WHERE is_occupied); free = count(*) FILTER (WHERE is_free). A bed can be occupied while not usable (a boarder still in a room under maintenance). Group by hostel, block, floor, room_type or room_no. For who held a bed on another day, or stays over time, use nlq.hostel_stays (join on bed_id). Closed hostels, closed rooms and blocked beds are kept with their status so they can be left out.';
COMMENT ON COLUMN nlq.hostel_beds.bed_id IS 'The bed''s id; join key to nlq.hostel_stays.bed_id.';
COMMENT ON COLUMN nlq.hostel_beds.hostel_id IS 'The hostel''s id; join key to nlq.hostel_stays.hostel_id.';
COMMENT ON COLUMN nlq.hostel_beds.hostel IS 'The hostel''s name.';
COMMENT ON COLUMN nlq.hostel_beds.hostel_code IS 'The hostel''s short code (e.g. GH1).';
COMMENT ON COLUMN nlq.hostel_beds.hostel_for IS 'Who the hostel is for: boys, girls or mixed.';
COMMENT ON COLUMN nlq.hostel_beds.hostel_status IS 'The hostel''s status: active or closed.';
COMMENT ON COLUMN nlq.hostel_beds.block IS 'The block (wing) of the room; empty when the hostel has no blocks.';
COMMENT ON COLUMN nlq.hostel_beds.floor IS 'The floor of the room: 0 = ground floor, 1 = first floor, and so on.';
COMMENT ON COLUMN nlq.hostel_beds.room_no IS 'The room number.';
COMMENT ON COLUMN nlq.hostel_beds.room_status IS 'The room''s status: active, maintenance (out of use for now) or closed.';
COMMENT ON COLUMN nlq.hostel_beds.room_type IS 'The room type (e.g. 2-seater AC).';
COMMENT ON COLUMN nlq.hostel_beds.seater IS 'Beds the room type is meant to have (2 = two-seater).';
COMMENT ON COLUMN nlq.hostel_beds.is_ac IS 'True when the room type is air-conditioned.';
COMMENT ON COLUMN nlq.hostel_beds.bed IS 'The bed''s label in its room (A, B, C ...).';
COMMENT ON COLUMN nlq.hostel_beds.bed_status IS 'The bed''s status: active or blocked (not offered for allotment).';
COMMENT ON COLUMN nlq.hostel_beds.is_usable IS 'True when the bed counts in capacity: bed active, room active and hostel active.';
COMMENT ON COLUMN nlq.hostel_beds.is_occupied IS 'True when a boarder holds the bed today.';
COMMENT ON COLUMN nlq.hostel_beds.is_free IS 'True when the bed is usable and nobody holds it today (a bed booked from a later date still shows free).';
COMMENT ON COLUMN nlq.hostel_beds.student_id IS 'The id of the boarder holding the bed today; empty when free. Join key to nlq.students.';
COMMENT ON COLUMN nlq.hostel_beds.admission_no IS 'Admission number of the boarder holding the bed today.';
COMMENT ON COLUMN nlq.hostel_beds.student_name IS 'Name of the boarder holding the bed today.';
COMMENT ON COLUMN nlq.hostel_beds.occupied_since IS 'The day the present boarder''s stay on this bed began.';
COMMENT ON COLUMN nlq.hostel_beds.occupied_until IS 'The day the present boarder will leave the bed, when already set; empty when open.';

-- nlq.hostel_stays: one row is one stay of one boarder on one hostel bed (a move to another bed starts a new stay).
-- Staying on a day = from_date on or before it and to_date empty or on or after it (India date); removed and merged
-- pupils left out; the class is that of the academic year containing the stay's latest day so far.
GRANT SELECT ON hostel_allotments, hostel_beds, hostel_rooms, hostel_blocks, hostel_room_types, hostels, hostel_withdrawals, students, enrolments, class_sections, classes, academic_years TO edupro_nlq_owner;
CREATE VIEW nlq.hostel_stays WITH (security_barrier = true) AS
SELECT x.id                                                               AS stay_id,
       x.student_id,
       s.admission_no,
       s.display_name                                                     AS student_name,
       s.gender::text                                                     AS gender,
       h.id                                                               AS hostel_id,
       h.name                                                             AS hostel,
       h.code                                                             AS hostel_code,
       bl.name                                                            AS block,
       r.floor,
       r.room_no,
       t.name                                                             AS room_type,
       b.id                                                               AS bed_id,
       b.label                                                            AS bed,
       x.from_date,
       x.to_date,
       date_trunc('month', x.from_date)::date                             AS from_month,
       x.kind                                                             AS started_by,
       CASE x.end_reason WHEN 'transfer' THEN 'moved_bed' WHEN 'vacate' THEN 'left_hostel'
                         WHEN 'withdrawn' THEN 'left_school' END          AS ended_by,
       (hw.id IS NOT NULL)                                                AS ended_by_hostel_withdrawal,
       (x.from_date <= n.today AND (x.to_date IS NULL OR x.to_date >= n.today)) AS is_staying,
       (x.from_date > n.today)                                            AS is_upcoming,
       (LEAST(COALESCE(x.to_date, n.today), n.today) - x.from_date + 1)   AS days_stayed,
       y.id                                                               AS academic_year_id,
       y.code                                                             AS academic_year,
       k.name                                                             AS class,
       k.display_order                                                    AS class_order,
       cs.name                                                            AS section,
       k.code || '-' || cs.name                                           AS class_section,
       cs.id                                                              AS class_section_id
  FROM hostel_allotments x
  CROSS JOIN LATERAL (SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date AS today) n
  JOIN students s ON s.id = x.student_id
  JOIN hostel_beds b ON b.id = x.bed_id
  JOIN hostel_rooms r ON r.id = b.room_id
  JOIN hostels h ON h.id = r.hostel_id
  LEFT JOIN hostel_blocks bl ON bl.id = r.block_id
  JOIN hostel_room_types t ON t.id = r.room_type_id
  LEFT JOIN LATERAL (SELECT w.id FROM hostel_withdrawals w
                      WHERE w.allotment_id = x.id AND w.status = 'completed'
                      ORDER BY w.id DESC LIMIT 1) hw ON true
  -- the year of the stay's latest day so far: today for a current stay, the last day for an ended one,
  -- the first day for one that has not begun
  LEFT JOIN LATERAL (SELECT ay.id, ay.code
                       FROM academic_years ay
                      WHERE CASE WHEN x.from_date > n.today THEN x.from_date
                                 ELSE LEAST(COALESCE(x.to_date, n.today), n.today) END
                            BETWEEN ay.start_date AND ay.end_date
                      ORDER BY ay.start_date DESC
                      LIMIT 1) y ON true
  LEFT JOIN LATERAL (SELECT e.class_section_id
                       FROM enrolments e
                      WHERE e.student_id = x.student_id AND e.academic_year_id = y.id
                        AND e.status <> 'cancelled'
                      ORDER BY (e.status = 'active') DESC, e.id DESC
                      LIMIT 1) en ON true
  LEFT JOIN class_sections cs ON cs.id = en.class_section_id
  LEFT JOIN classes k ON k.id = cs.class_id
 WHERE x.school_id = app.nlq_school_id()
   AND s.deleted_at IS NULL
   AND s.merged_into_id IS NULL;
ALTER VIEW nlq.hostel_stays OWNER TO edupro_nlq_owner;
GRANT SELECT ON nlq.hostel_stays TO edupro_nlq;
COMMENT ON VIEW nlq.hostel_stays IS 'One row is one stay of one boarder on one hostel bed, current or past: allotted from from_date, ended on to_date (empty while open). A move to another bed ends the stay and starts a new one, so one pupil can have several rows: count boarders with count(DISTINCT student_id), never count(*). Boarders today: filter is_staying = true. Boarders on a past day D: from_date <= D AND (to_date IS NULL OR to_date >= D). Boarders in a month: from_date <= the last day AND (to_date IS NULL OR to_date >= the first day). Left the hostel in a period: ended_by IN (''left_hostel'', ''left_school'') and to_date in the period. Removed and merged pupil records are left out. Class and section are those of the academic year containing the stay''s latest day so far (today for a current stay). The hostel fee is billed in the fee views (ledger hostel), not here. Join nlq.hostel_beds on bed_id, nlq.students on student_id and academic_year_id.';
COMMENT ON COLUMN nlq.hostel_stays.stay_id IS 'The stay''s id (one allotment of a bed).';
COMMENT ON COLUMN nlq.hostel_stays.student_id IS 'The boarder''s id; join key to nlq.students (with academic_year_id).';
COMMENT ON COLUMN nlq.hostel_stays.admission_no IS 'The boarder''s admission number.';
COMMENT ON COLUMN nlq.hostel_stays.student_name IS 'The boarder''s full name.';
COMMENT ON COLUMN nlq.hostel_stays.gender IS 'The boarder''s gender: male, female, other or unspecified.';
COMMENT ON COLUMN nlq.hostel_stays.hostel_id IS 'The hostel''s id; join key to nlq.hostel_beds.hostel_id.';
COMMENT ON COLUMN nlq.hostel_stays.hostel IS 'The hostel''s name.';
COMMENT ON COLUMN nlq.hostel_stays.hostel_code IS 'The hostel''s short code (e.g. BH1).';
COMMENT ON COLUMN nlq.hostel_stays.block IS 'The block (wing) of the room; empty when the hostel has no blocks.';
COMMENT ON COLUMN nlq.hostel_stays.floor IS 'The floor of the room: 0 = ground floor, 1 = first floor, and so on.';
COMMENT ON COLUMN nlq.hostel_stays.room_no IS 'The room number.';
COMMENT ON COLUMN nlq.hostel_stays.room_type IS 'The room type (e.g. 3-seater non-AC).';
COMMENT ON COLUMN nlq.hostel_stays.bed_id IS 'The bed''s id; join key to nlq.hostel_beds.';
COMMENT ON COLUMN nlq.hostel_stays.bed IS 'The bed''s label in its room (A, B, C ...).';
COMMENT ON COLUMN nlq.hostel_stays.from_date IS 'First day of the stay on this bed.';
COMMENT ON COLUMN nlq.hostel_stays.to_date IS 'Last day of the stay on this bed; empty while the stay is open. A date in the future means the boarder is staying and will leave on that day.';
COMMENT ON COLUMN nlq.hostel_stays.from_month IS 'The month the stay began, as its first day; group joinings by it.';
COMMENT ON COLUMN nlq.hostel_stays.started_by IS 'How the stay began: allot (allotted a bed) or transfer (moved here from another bed).';
COMMENT ON COLUMN nlq.hostel_stays.ended_by IS 'How the stay ended: moved_bed (moved to another bed; still a boarder), left_hostel (left the hostel, stays in school), left_school (left the school); empty while open.';
COMMENT ON COLUMN nlq.hostel_stays.ended_by_hostel_withdrawal IS 'True when the stay was ended by a completed hostel withdrawal (the formal leaving process).';
COMMENT ON COLUMN nlq.hostel_stays.is_staying IS 'True when the boarder holds this bed today (India date).';
COMMENT ON COLUMN nlq.hostel_stays.is_upcoming IS 'True when the stay begins after today (a bed booked ahead).';
COMMENT ON COLUMN nlq.hostel_stays.days_stayed IS 'Days on this bed from from_date to to_date, or to today while the stay is open (both days counted); zero or less for a stay that has not begun.';
COMMENT ON COLUMN nlq.hostel_stays.academic_year_id IS 'The academic year the class is taken from (the one containing the stay''s latest day so far).';
COMMENT ON COLUMN nlq.hostel_stays.academic_year IS 'That academic year''s code, e.g. 2026-27.';
COMMENT ON COLUMN nlq.hostel_stays.class IS 'The boarder''s class in that academic year (e.g. VIII).';
COMMENT ON COLUMN nlq.hostel_stays.class_order IS 'Sort order of the class (lower = junior); order classes by it.';
COMMENT ON COLUMN nlq.hostel_stays.section IS 'The section in that academic year (e.g. B).';
COMMENT ON COLUMN nlq.hostel_stays.class_section IS 'Class and section together, e.g. VIII-B.';
COMMENT ON COLUMN nlq.hostel_stays.class_section_id IS 'The class-section id of that year; join key to nlq.class_sections.';

-- nlq.library_copies: one row is one physical copy in the library (accession number), with its title, authors as text,
-- subject, place and status. Holdings = status not withdrawn and not sold (lost and damaged still count, as the library
-- counts them); authors from the title's author list in order, else the title's own author text.
GRANT SELECT ON library_copies, library_titles, library_title_authors, library_authors, library_subjects, library_material_types, library_languages, library_publishers, library_libraries, library_shelves, library_vendors, library_loans, classes TO edupro_nlq_owner;
CREATE VIEW nlq.library_copies WITH (security_barrier = true) AS
SELECT x.id                                                               AS copy_id,
       x.accession_no,
       t.id                                                               AS title_id,
       t.code                                                             AS title_code,
       t.title,
       COALESCE(au.authors, NULLIF(btrim(t.author), ''))                  AS authors,
       COALESCE(sb.name::text, NULLIF(btrim(t.category), ''))             AS subject,
       mt.name                                                            AS material_type,
       COALESCE(lg.name::text, NULLIF(btrim(t.language), ''))             AS language,
       COALESCE(pb.name::text, NULLIF(btrim(t.publisher), ''))            AS publisher,
       t.year                                                             AS publication_year,
       t.isbn,
       tk.name                                                            AS for_class,
       t.is_reference,
       lb.name                                                            AS library,
       lb.code                                                            AS library_code,
       sh.code                                                            AS shelf,
       x.rack,
       x.status::text                                                     AS status,
       (x.status NOT IN ('withdrawn', 'sold'))                            AS is_holding,
       (x.status = 'available')                                           AS is_available,
       (ol.due_on IS NOT NULL)                                            AS is_on_loan,
       ol.due_on                                                          AS on_loan_due_on,
       (ol.due_on IS NOT NULL AND ol.due_on < (now() AT TIME ZONE 'Asia/Kolkata')::date) AS is_overdue,
       x.status_on,
       x.accessioned_on,
       date_trunc('month', x.accessioned_on)::date                        AS accessioned_month,
       COALESCE(x.acquisition, 'Not given')                               AS acquisition,
       vd.name                                                            AS vendor,
       x.price,
       COALESCE(x.price, t.price)                                         AS book_value,
       x.last_verified_on,
       COALESCE(ln.issues, 0)                                             AS times_issued,
       ln.last_issued_on
  FROM library_copies x
  JOIN library_titles t ON t.id = x.title_id
  LEFT JOIN LATERAL (SELECT string_agg(a.name::text, ', ' ORDER BY ta.position, a.name) AS authors
                       FROM library_title_authors ta
                       JOIN library_authors a ON a.id = ta.author_id
                      WHERE ta.title_id = t.id AND ta.role = 'Author') au ON true
  LEFT JOIN library_subjects sb ON sb.id = t.subject_id
  LEFT JOIN library_material_types mt ON mt.id = t.material_type_id
  LEFT JOIN library_languages lg ON lg.id = t.language_id
  LEFT JOIN library_publishers pb ON pb.id = t.publisher_id
  LEFT JOIN classes tk ON tk.id = t.class_id
  LEFT JOIN library_libraries lb ON lb.id = x.library_id
  LEFT JOIN library_shelves sh ON sh.id = x.shelf_id
  LEFT JOIN library_vendors vd ON vd.id = x.vendor_id
  LEFT JOIN library_loans ol ON ol.copy_id = x.id AND ol.returned_on IS NULL
  LEFT JOIN (SELECT l.copy_id, count(*)::int AS issues, max(l.issued_on) AS last_issued_on
               FROM library_loans l
              WHERE l.school_id = app.nlq_school_id()
              GROUP BY l.copy_id) ln ON ln.copy_id = x.id
 WHERE x.school_id = app.nlq_school_id();
ALTER VIEW nlq.library_copies OWNER TO edupro_nlq_owner;
GRANT SELECT ON nlq.library_copies TO edupro_nlq;
COMMENT ON VIEW nlq.library_copies IS 'One row is one physical copy of a book (or other item) in the library, identified by its accession number; a title (book) with five copies has five rows. "How many books do we have" = count(*) FILTER (WHERE is_holding) (withdrawn and sold copies are gone from stock; lost and damaged still count until withdrawn); "how many titles" = count(DISTINCT title_id) FILTER (WHERE is_holding). On the shelf now: is_available; out with a borrower: is_on_loan. Group by library, subject, material_type, language, publisher or accessioned_month (copies added). book_value is the copy price, else the title price, in rupees. For issues and returns over time use nlq.library_loans (join on copy_id or title_id).';
COMMENT ON COLUMN nlq.library_copies.copy_id IS 'The copy''s id; join key to nlq.library_loans.copy_id.';
COMMENT ON COLUMN nlq.library_copies.accession_no IS 'The accession number (the number on the book), unique in the school, e.g. B00125.';
COMMENT ON COLUMN nlq.library_copies.title_id IS 'The title (book) the copy belongs to; the same in nlq.library_loans.title_id.';
COMMENT ON COLUMN nlq.library_copies.title_code IS 'The title''s catalogue code (e.g. T0042).';
COMMENT ON COLUMN nlq.library_copies.title IS 'The book''s title.';
COMMENT ON COLUMN nlq.library_copies.authors IS 'The authors of the title as text, in printed order, separated by commas; empty when not recorded.';
COMMENT ON COLUMN nlq.library_copies.subject IS 'The subject of the title (e.g. Fiction, Science, Reference).';
COMMENT ON COLUMN nlq.library_copies.material_type IS 'What the item is (e.g. Book, Textbook, Reference, Magazine, CD/DVD, Map).';
COMMENT ON COLUMN nlq.library_copies.language IS 'The language of the title (e.g. English, Hindi).';
COMMENT ON COLUMN nlq.library_copies.publisher IS 'The publisher of the title.';
COMMENT ON COLUMN nlq.library_copies.publication_year IS 'The year the edition was published.';
COMMENT ON COLUMN nlq.library_copies.isbn IS 'The ISBN of the title, when recorded.';
COMMENT ON COLUMN nlq.library_copies.for_class IS 'The class a textbook is meant for (e.g. IX); empty for general books.';
COMMENT ON COLUMN nlq.library_copies.is_reference IS 'True for a reference title, kept in the library and not issued.';
COMMENT ON COLUMN nlq.library_copies.library IS 'The library the copy belongs to (e.g. Main library).';
COMMENT ON COLUMN nlq.library_copies.library_code IS 'The library''s short code.';
COMMENT ON COLUMN nlq.library_copies.shelf IS 'The shelf (almirah) code the copy sits on.';
COMMENT ON COLUMN nlq.library_copies.rack IS 'The rack of that shelf.';
COMMENT ON COLUMN nlq.library_copies.status IS 'The copy''s status: available (on the shelf), issued (on loan), lost, damaged, withdrawn (discarded from stock) or sold.';
COMMENT ON COLUMN nlq.library_copies.is_holding IS 'True when the copy is part of the stock: any status except withdrawn and sold.';
COMMENT ON COLUMN nlq.library_copies.is_available IS 'True when the copy is on the shelf (status available).';
COMMENT ON COLUMN nlq.library_copies.is_on_loan IS 'True when the copy is out with a borrower now.';
COMMENT ON COLUMN nlq.library_copies.on_loan_due_on IS 'The due day of the copy''s current loan; empty when not on loan.';
COMMENT ON COLUMN nlq.library_copies.is_overdue IS 'True when the copy is on loan and its due day has passed (India date).';
COMMENT ON COLUMN nlq.library_copies.status_on IS 'The day the copy''s status last changed (e.g. the day it was marked lost or withdrawn), when recorded.';
COMMENT ON COLUMN nlq.library_copies.accessioned_on IS 'The day the copy was entered in the accession register.';
COMMENT ON COLUMN nlq.library_copies.accessioned_month IS 'The month the copy was entered, as its first day; group copies added by month with it.';
COMMENT ON COLUMN nlq.library_copies.acquisition IS 'How the copy came: Purchase, Donation or Not given.';
COMMENT ON COLUMN nlq.library_copies.vendor IS 'The book seller it was bought from, when recorded.';
COMMENT ON COLUMN nlq.library_copies.price IS 'The copy''s price as entered at accession, in rupees; empty when not entered.';
COMMENT ON COLUMN nlq.library_copies.book_value IS 'The copy''s value in rupees: its own price, else the title''s list price. Sum it for the value of the stock (filter is_holding).';
COMMENT ON COLUMN nlq.library_copies.last_verified_on IS 'The day the copy was last found in a stock verification; empty when never verified.';
COMMENT ON COLUMN nlq.library_copies.times_issued IS 'How many times the copy has been issued, ever.';
COMMENT ON COLUMN nlq.library_copies.last_issued_on IS 'The day the copy was last issued; empty when never issued.';

-- nlq.library_loans: one row is one issue of one library copy to a pupil or a staff member. Lost = a lost-book charge
-- not undone by the book being found; fines only from the fees counter (the late-fine misc fee line, its paid amount),
-- plus desk waivers; old fines kept only on the loan (before Oct 2026) are not shown. Removed and merged borrowers left out.
GRANT SELECT ON library_loans, library_copies, library_titles, library_libraries, library_charges, library_fine_waivers, misc_fee_students, students, employees, enrolments, class_sections, classes, academic_years TO edupro_nlq_owner;
CREATE VIEW nlq.library_loans WITH (security_barrier = true) AS
SELECT x.id                                                               AS loan_id,
       x.copy_id,
       c.accession_no,
       t.id                                                               AS title_id,
       t.title,
       lb.name                                                            AS library,
       x.borrower_kind::text                                              AS borrower_kind,
       COALESCE(st.display_name, em.display_name)                         AS borrower_name,
       st.id                                                              AS student_id,
       st.admission_no,
       em.id                                                              AS employee_id,
       em.employee_code,
       x.issued_on,
       date_trunc('month', x.issued_on)::date                             AS issued_month,
       x.due_on,
       x.returned_on,
       x.renewed                                                          AS renewals,
       (x.returned_on IS NULL)                                            AS is_out,
       (x.returned_on IS NULL AND x.due_on < n.today)                     AS is_overdue,
       (lc.id IS NOT NULL AND lc.found_on IS NULL)                        AS is_lost,
       (x.returned_on IS NOT NULL AND NOT (lc.id IS NOT NULL AND lc.found_on IS NULL)) AS is_returned,
       CASE WHEN x.returned_on IS NULL THEN GREATEST(n.today - x.due_on, 0)
            WHEN lc.id IS NOT NULL AND lc.found_on IS NULL THEN NULL
            ELSE GREATEST(x.returned_on - x.due_on, 0) END                AS days_late,
       CASE WHEN fl.status = 'cancelled' THEN 0 ELSE COALESCE(fl.amount, 0) END AS late_fine,
       COALESCE(fl.paid, 0)                                               AS late_fine_paid,
       CASE WHEN fl.status = 'open' THEN GREATEST(fl.amount - fl.paid, 0) ELSE 0 END AS late_fine_due,
       COALESCE(w.waived, 0)                                              AS fine_waived,
       CASE WHEN bk.line_status = 'cancelled' THEN 0 ELSE COALESCE(bk.amount, 0) END AS book_charge,
       COALESCE(bk.paid, 0)                                               AS book_charge_paid,
       CASE WHEN bk.line_status = 'open' THEN GREATEST(bk.amount - bk.paid, 0) ELSE 0 END AS book_charge_due,
       y.id                                                               AS academic_year_id,
       y.code                                                             AS academic_year,
       k.name                                                             AS class,
       k.display_order                                                    AS class_order,
       cs.name                                                            AS section,
       k.code || '-' || cs.name                                           AS class_section,
       cs.id                                                              AS class_section_id
  FROM library_loans x
  CROSS JOIN LATERAL (SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date AS today) n
  JOIN library_copies c ON c.id = x.copy_id
  JOIN library_titles t ON t.id = c.title_id
  LEFT JOIN library_libraries lb ON lb.id = c.library_id
  LEFT JOIN students st ON x.borrower_kind = 'student' AND st.id = x.borrower_id
  LEFT JOIN employees em ON x.borrower_kind = 'employee' AND em.id = x.borrower_id
  -- the lost-book charge, if any (found_on set = the book came back)
  LEFT JOIN library_charges lc ON lc.loan_id = x.id AND lc.kind = 'lost'
  -- the late fine sent to the fees counter: what is owed, paid and due is on its misc fee line
  LEFT JOIN LATERAL (SELECT COALESCE(ml.amount, ch.amount) AS amount, COALESCE(ml.paid, 0) AS paid, ml.status
                       FROM library_charges ch
                       LEFT JOIN misc_fee_students ml ON ml.id = ch.misc_line_id
                      WHERE ch.loan_id = x.id AND ch.kind = 'late') fl ON true
  -- lost and damaged book charges together
  LEFT JOIN LATERAL (SELECT sum(COALESCE(ml.amount, ch.amount)) FILTER (WHERE ml.status IS DISTINCT FROM 'cancelled') AS amount,
                            sum(COALESCE(ml.paid, 0)) AS paid,
                            CASE WHEN bool_or(ml.status = 'open') THEN 'open'
                                 WHEN bool_and(ml.status = 'cancelled') THEN 'cancelled' ELSE 'closed' END AS line_status
                       FROM library_charges ch
                       LEFT JOIN misc_fee_students ml ON ml.id = ch.misc_line_id
                      WHERE ch.loan_id = x.id AND ch.kind IN ('lost', 'damaged')
                     HAVING count(*) > 0) bk ON true
  LEFT JOIN LATERAL (SELECT sum(fw.amount) AS waived FROM library_fine_waivers fw WHERE fw.loan_id = x.id) w ON true
  -- a pupil's class: the academic year containing the issue day
  LEFT JOIN LATERAL (SELECT ay.id, ay.code FROM academic_years ay
                      WHERE x.issued_on BETWEEN ay.start_date AND ay.end_date
                      ORDER BY ay.start_date DESC LIMIT 1) y ON true
  LEFT JOIN LATERAL (SELECT e.class_section_id
                       FROM enrolments e
                      WHERE x.borrower_kind = 'student' AND e.student_id = x.borrower_id AND e.academic_year_id = y.id
                        AND e.status <> 'cancelled'
                      ORDER BY (e.status = 'active') DESC, e.id DESC
                      LIMIT 1) en ON true
  LEFT JOIN class_sections cs ON cs.id = en.class_section_id
  LEFT JOIN classes k ON k.id = cs.class_id
 WHERE x.school_id = app.nlq_school_id()
   AND ((x.borrower_kind = 'student' AND st.id IS NOT NULL AND st.deleted_at IS NULL AND st.merged_into_id IS NULL)
     OR (x.borrower_kind = 'employee' AND em.id IS NOT NULL AND em.deleted_at IS NULL));
ALTER VIEW nlq.library_loans OWNER TO edupro_nlq_owner;
GRANT SELECT ON nlq.library_loans TO edupro_nlq;
COMMENT ON VIEW nlq.library_loans IS 'One row is one issue of one library copy (a book) to a pupil or a staff member, from issue to return. Books out now: is_out = true; overdue now: is_overdue = true (out and past due_on, India date). Issues in a period: filter issued_on; returns: is_returned = true and returned_on in the period (a lost book also closes its loan but is_returned is false and is_lost true). Readers: count(DISTINCT student_id) for pupils, count(DISTINCT employee_id) for staff. Fines are only those sent to the fees counter (from Oct 2026): late_fine is the fine owed after any reduction, late_fine_paid what was paid, late_fine_due what is still owed; older fines kept only at the library are not shown. book_charge is what a lost or damaged book was charged. All money in rupees. Class and section are the pupil''s in the academic year containing issued_on; empty for staff. Removed and merged borrower records are left out. Join nlq.library_copies on copy_id.';
COMMENT ON COLUMN nlq.library_loans.loan_id IS 'The loan''s id (one issue of one copy).';
COMMENT ON COLUMN nlq.library_loans.copy_id IS 'The copy issued; join key to nlq.library_copies.';
COMMENT ON COLUMN nlq.library_loans.accession_no IS 'The accession number of the copy (the number on the book).';
COMMENT ON COLUMN nlq.library_loans.title_id IS 'The title (book) the copy belongs to; the same in nlq.library_copies.title_id. Count issues per book by it.';
COMMENT ON COLUMN nlq.library_loans.title IS 'The book''s title.';
COMMENT ON COLUMN nlq.library_loans.library IS 'The library the copy belongs to (e.g. Main library, Junior library).';
COMMENT ON COLUMN nlq.library_loans.borrower_kind IS 'Who borrowed: student (a pupil) or employee (a staff member).';
COMMENT ON COLUMN nlq.library_loans.borrower_name IS 'The borrower''s full name (pupil or staff member).';
COMMENT ON COLUMN nlq.library_loans.student_id IS 'The pupil''s id when a pupil borrowed; empty for staff. Join key to nlq.students.';
COMMENT ON COLUMN nlq.library_loans.admission_no IS 'The pupil''s admission number; empty for staff.';
COMMENT ON COLUMN nlq.library_loans.employee_id IS 'The staff member''s id when staff borrowed; empty for pupils. Join key to nlq.staff.';
COMMENT ON COLUMN nlq.library_loans.employee_code IS 'The staff member''s employee code; empty for pupils.';
COMMENT ON COLUMN nlq.library_loans.issued_on IS 'The day the copy was issued.';
COMMENT ON COLUMN nlq.library_loans.issued_month IS 'The month of issue, as its first day; group issues by month with it.';
COMMENT ON COLUMN nlq.library_loans.due_on IS 'The day the copy is due back (moves later with each renewal).';
COMMENT ON COLUMN nlq.library_loans.returned_on IS 'The day the loan was closed: the book came back, or (for a lost book) the day the loss was reported. Empty while out.';
COMMENT ON COLUMN nlq.library_loans.renewals IS 'How many times the loan was renewed.';
COMMENT ON COLUMN nlq.library_loans.is_out IS 'True while the copy is still with the borrower (not returned).';
COMMENT ON COLUMN nlq.library_loans.is_overdue IS 'True when the copy is still out and its due day has passed (today, India date).';
COMMENT ON COLUMN nlq.library_loans.is_lost IS 'True when the borrower was charged for losing the book and it has not been found since.';
COMMENT ON COLUMN nlq.library_loans.is_returned IS 'True when the book actually came back (closed and not lost).';
COMMENT ON COLUMN nlq.library_loans.days_late IS 'Days past the due day: up to today while out, up to the return day once back; 0 when on time; empty for a lost book.';
COMMENT ON COLUMN nlq.library_loans.late_fine IS 'The late fine owed at the fees counter for this loan after any reduction by the fees office, in rupees; 0 when none or cancelled.';
COMMENT ON COLUMN nlq.library_loans.late_fine_paid IS 'Of the late fine, the amount paid at the fees counter, in rupees.';
COMMENT ON COLUMN nlq.library_loans.late_fine_due IS 'Of the late fine, the amount still owed, in rupees.';
COMMENT ON COLUMN nlq.library_loans.fine_waived IS 'Late fine waived at the library desk on return, in rupees (not part of late_fine).';
COMMENT ON COLUMN nlq.library_loans.book_charge IS 'What the borrower was charged for a lost or damaged book (price, processing fee and the late fine of a lost book), in rupees; 0 when none or cancelled.';
COMMENT ON COLUMN nlq.library_loans.book_charge_paid IS 'Of the book charge, the amount paid at the fees counter, in rupees.';
COMMENT ON COLUMN nlq.library_loans.book_charge_due IS 'Of the book charge, the amount still owed, in rupees.';
COMMENT ON COLUMN nlq.library_loans.academic_year_id IS 'The academic year containing the issue day.';
COMMENT ON COLUMN nlq.library_loans.academic_year IS 'That academic year''s code, e.g. 2026-27.';
COMMENT ON COLUMN nlq.library_loans.class IS 'The pupil''s class in that academic year (e.g. VII); empty for staff.';
COMMENT ON COLUMN nlq.library_loans.class_order IS 'Sort order of the class (lower = junior); order classes by it.';
COMMENT ON COLUMN nlq.library_loans.section IS 'The pupil''s section in that academic year; empty for staff.';
COMMENT ON COLUMN nlq.library_loans.class_section IS 'Class and section together, e.g. VII-C; empty for staff.';
COMMENT ON COLUMN nlq.library_loans.class_section_id IS 'The class-section id of that year; join key to nlq.class_sections.';

-- nlq.messages: one row is one outgoing message — one address on one channel (an app push is one row per phone or
-- browser). Cancelled messages are left out; the status is in plain words (waiting / sent / delivered / failed) with
-- went_out (sent + delivered) and delivered (receipt confirmed) flags; no address, recipient or message text.
GRANT SELECT ON comms_messages, comms_templates, message_requests, comms_settings, employees TO edupro_nlq_owner;
CREATE VIEW nlq.messages WITH (security_barrier = true) AS
SELECT x.id                                                                     AS message_id,
       (x.created_at AT TIME ZONE 'Asia/Kolkata')::date                         AS created_on,
       date_trunc('month', x.created_at AT TIME ZONE 'Asia/Kolkata')::date      AS month,
       (x.sent_at AT TIME ZONE 'Asia/Kolkata')::date                            AS sent_on,
       x.channel::text                                                          AS channel,
       CASE WHEN x.status IN ('queued', 'sending') THEN 'waiting' ELSE x.status::text END AS status,
       (x.status IN ('sent', 'delivered'))                                      AS went_out,
       (x.status = 'delivered')                                                 AS delivered,
       (x.status = 'failed')                                                    AS failed,
       (x.read_at IS NOT NULL)                                                  AS read_on_whatsapp,
       CASE WHEN x.message_request_id IS NOT NULL THEN 'bulk send'
            WHEN x.expires_at IS NOT NULL OR t.code LIKE '%otp%' THEN 'one-time code'
            WHEN x.channel = 'push' THEN 'app push'
            WHEN x.variables ? 'helpdesk_query' THEN 'helpdesk mail'
            WHEN x.variables ? 'visitor' THEN 'visitor mail'
            WHEN x.template_id IS NOT NULL THEN 'alert'
            WHEN x.subject LIKE '[Test]%' THEN 'test e-mail'
            ELSE 'other mail' END                                               AS kind,
       t.code                                                                   AS template_code,
       t.name                                                                   AS template_name,
       COALESCE(r.category, t.category)::text                                   AS category,
       x.message_request_id                                                     AS request_id,
       r.title                                                                  AS request_title,
       r.sender_employee_id,
       r.sender_name,
       x.units,
       CASE WHEN x.sent_at IS NULL THEN 0
            ELSE round(COALESCE(x.cost, x.units * COALESCE((st.rates ->> x.channel::text)::numeric, 0)), 2) END AS cost_estimate
  FROM comms_messages x
  LEFT JOIN comms_templates t ON t.id = x.template_id
  LEFT JOIN (SELECT q.id, q.title, q.category, se.employee_id AS sender_employee_id, se.employee_name AS sender_name
               FROM message_requests q
               LEFT JOIN LATERAL (SELECT e.id AS employee_id, e.display_name AS employee_name
                                    FROM employees e
                                   WHERE e.user_id = q.requested_by AND e.deleted_at IS NULL
                                   ORDER BY e.id LIMIT 1) se ON true) r ON r.id = x.message_request_id
  LEFT JOIN comms_settings st ON st.school_id = x.school_id
 WHERE x.school_id = app.nlq_school_id()
   AND x.status <> 'cancelled';
ALTER VIEW nlq.messages OWNER TO edupro_nlq_owner;
GRANT SELECT ON nlq.messages TO edupro_nlq;
COMMENT ON VIEW nlq.messages IS 'One row is one outgoing message from the school: one address on one channel (SMS, WhatsApp, e-mail) or one app push to one phone or browser (a person with two phones gets two push rows). It holds every message the ERP sends, not only bulk circulars: automatic alerts (attendance, fees, transport, gate pass…), one-time sign-in codes, helpdesk and visitor e-mails, payslip and order e-mails. Cancelled messages are left out. No address, recipient or text is here. For "how did our messages do": count rows, count(*) FILTER (WHERE went_out) and FILTER (WHERE delivered), FILTER (WHERE failed). Delivery receipts come only for SMS through MSG91 and WhatsApp through Meta; e-mail, push and the other gateways stay "sent" for ever, so judge them by went_out and failed, never by delivered. Group by created_on or month (India dates), channel, kind, template_name; filter kind = ''bulk send'' for circulars composed in Communication, and use request_id / request_title to look at one circular (each person counts once per channel). Usage: sum(units) of rows with went_out; cost_estimate in rupees. Most dashboards leave push out (channel <> ''push'').';
COMMENT ON COLUMN nlq.messages.message_id IS 'The message''s id.';
COMMENT ON COLUMN nlq.messages.created_on IS 'The India date the message was made (queued). The usual date to filter and group by.';
COMMENT ON COLUMN nlq.messages.month IS 'First day of the month of created_on; group by it for monthly figures.';
COMMENT ON COLUMN nlq.messages.sent_on IS 'The India date it was handed to the gateway; empty while waiting or when it failed before going out.';
COMMENT ON COLUMN nlq.messages.channel IS 'sms, whatsapp, email or push (an app notification).';
COMMENT ON COLUMN nlq.messages.status IS 'waiting (queued or being sent; also messages scheduled for later), sent (the gateway accepted it; no delivery receipt), delivered (a delivery receipt confirmed it), failed (the gateway refused it or reported failure after the last retry).';
COMMENT ON COLUMN nlq.messages.went_out IS 'True when the message left the school: status sent or delivered. Use this as "sent" in reports.';
COMMENT ON COLUMN nlq.messages.delivered IS 'True when a delivery receipt confirmed it (only SMS via MSG91 and WhatsApp via Meta ever get one).';
COMMENT ON COLUMN nlq.messages.failed IS 'True when the message failed.';
COMMENT ON COLUMN nlq.messages.read_on_whatsapp IS 'True when WhatsApp reported the message as read (Meta WhatsApp only; not the app inbox).';
COMMENT ON COLUMN nlq.messages.kind IS 'What sent it: bulk send (a circular composed in Communication → Compose), one-time code (sign-in or verification code), app push, helpdesk mail (escalation e-mails), visitor mail (telling staff a visitor came), alert (an automatic message from a template: attendance, fees, transport, gate pass, clinic, appointments…), test e-mail, other mail (system e-mails without a template: payslips, purchase orders, letters).';
COMMENT ON COLUMN nlq.messages.template_code IS 'Code of the template the message came from (e.g. a fee or absence alert); empty for bulk e-mails written on the spot and system mails.';
COMMENT ON COLUMN nlq.messages.template_name IS 'Name of the template the message came from, as set under Communication → Templates; group by it for "which alerts go out most".';
COMMENT ON COLUMN nlq.messages.category IS 'service (fees, attendance, safety: sent whatever the family''s consent) or general (skipped for families who withdrew consent for that channel); empty when neither a circular nor a template says.';
COMMENT ON COLUMN nlq.messages.request_id IS 'The circular (bulk send) the message belongs to; empty for every other kind. Group by it to see one circular''s reach.';
COMMENT ON COLUMN nlq.messages.request_title IS 'Title of the circular (bulk send) as the sender named it; empty for other kinds.';
COMMENT ON COLUMN nlq.messages.sender_employee_id IS 'Employee who composed the circular (bulk sends only); joins nlq.staff.employee_id.';
COMMENT ON COLUMN nlq.messages.sender_name IS 'Name of the employee who composed the circular (bulk sends only); empty for automatic messages.';
COMMENT ON COLUMN nlq.messages.units IS 'Billing units: SMS parts (160 characters a part, 70 when Hindi or other Unicode is used); 1 for WhatsApp, e-mail and push. Sum units of rows with went_out for usage.';
COMMENT ON COLUMN nlq.messages.cost_estimate IS 'Cost in rupees: the cost recorded on circular messages, else units × the school''s current rate for the channel; 0 when not sent. An estimate, not an invoice.';

-- nlq.misc_fee_dues: one row is one pupil's (or staff member's) line of an announced misc fee (trip, exam form, library charge ...).
-- Only announced or closed misc fees; cancelled lines, removed and merged pupils, removed staff left out.
GRANT SELECT ON misc_fee_students, misc_fees, fee_heads, students, employees, academic_years, enrolments, class_sections, classes TO edupro_nlq_owner;
CREATE VIEW nlq.misc_fee_dues WITH (security_barrier = true) AS
SELECT l.id                                             AS misc_fee_line_id,
       f.id                                             AS misc_fee_id,
       f.title                                          AS misc_fee,
       h.code                                           AS head_code,
       h.name                                           AS head,
       f.academic_year_id,
       ay.code                                          AS academic_year,
       f.status                                         AS fee_status,
       f.mandatory                                      AS is_mandatory,
       f.seats,
       (f.announced_at AT TIME ZONE 'Asia/Kolkata')::date AS announced_on,
       CASE WHEN l.employee_id IS NOT NULL THEN 'staff' ELSE 'student' END AS payer_type,
       l.student_id,
       s.admission_no,
       s.display_name                                   AS student_name,
       cs.id                                            AS class_section_id,
       k.name                                           AS class,
       k.display_order                                  AS class_order,
       cs.name                                          AS section,
       k.code || '-' || cs.name                         AS class_section,
       l.employee_id,
       emp.employee_code,
       emp.display_name                                 AS employee_name,
       l.amount,
       l.paid,
       GREATEST(l.amount - l.paid, 0)                   AS balance,
       l.status,
       COALESCE(l.last_date, f.last_date)               AS last_date,
       (f.status = 'closed' OR (NOT f.mandatory AND COALESCE(l.last_date, f.last_date) < (now() AT TIME ZONE 'Asia/Kolkata')::date)) AS is_closed,
       (l.status = 'open' AND f.status <> 'closed' AND f.mandatory
        AND COALESCE(l.last_date, f.last_date) < (now() AT TIME ZONE 'Asia/Kolkata')::date) AS is_overdue,
       CASE WHEN l.status = 'paid' THEN (l.paid_at AT TIME ZONE 'Asia/Kolkata')::date END AS paid_on
  FROM misc_fee_students l
  JOIN misc_fees f       ON f.id = l.misc_fee_id
  JOIN fee_heads h       ON h.id = f.head_id
  JOIN academic_years ay ON ay.id = f.academic_year_id
  LEFT JOIN students s   ON s.id = l.student_id
  LEFT JOIN employees emp ON emp.id = l.employee_id
  LEFT JOIN enrolments e ON e.student_id = l.student_id AND e.academic_year_id = f.academic_year_id AND e.status <> 'cancelled'
  LEFT JOIN class_sections cs ON cs.id = e.class_section_id
  LEFT JOIN classes k    ON k.id = cs.class_id
 WHERE l.school_id = app.nlq_school_id()
   AND f.status IN ('announced', 'closed')
   AND l.status <> 'cancelled'
   AND (l.student_id IS NULL OR (s.deleted_at IS NULL AND s.merged_into_id IS NULL))
   AND (l.employee_id IS NULL OR emp.deleted_at IS NULL);
ALTER VIEW nlq.misc_fee_dues OWNER TO edupro_nlq_owner;
GRANT SELECT ON nlq.misc_fee_dues TO edupro_nlq;
COMMENT ON VIEW nlq.misc_fee_dues IS 'One row is one pupil''s (or one staff member''s) line of a misc fee the school announced: a trip, an activity, an exam form, a library or hostel damage charge ... with the amount set for that person, what misc receipts have paid on it and what is left. Misc fees are separate from the regular school and hostel fee (nlq.fee_bills). Left out: misc fees not yet approved or rejected, lines cancelled, removed and merged pupils, removed staff. paid is net of cancelled, bounced and refunded misc receipts. For "who still owes" filter status = ''open'' AND NOT is_closed (an optional fee past its last date is not asked for any more); "overdue" = is_overdue. Totals per fee: count(*), sum(amount) billed, sum(paid) collected, sum(balance). Filter academic_year or misc_fee; staff lines have payer_type staff and no class. Join nlq.misc_receipts on misc_fee_line_id for the receipts.';
COMMENT ON COLUMN nlq.misc_fee_dues.misc_fee_line_id IS 'Id of the line (one person on one misc fee); join key to nlq.misc_receipts.misc_fee_line_id.';
COMMENT ON COLUMN nlq.misc_fee_dues.misc_fee_id IS 'Id of the misc fee; join key to nlq.misc_receipts.misc_fee_id.';
COMMENT ON COLUMN nlq.misc_fee_dues.misc_fee IS 'Title of the misc fee as announced (e.g. Science trip, Class X exam form).';
COMMENT ON COLUMN nlq.misc_fee_dues.head_code IS 'Code of the fee head the misc fee is collected under.';
COMMENT ON COLUMN nlq.misc_fee_dues.head IS 'Name of the fee head the misc fee is collected under.';
COMMENT ON COLUMN nlq.misc_fee_dues.academic_year_id IS 'Id of the academic year of the misc fee.';
COMMENT ON COLUMN nlq.misc_fee_dues.academic_year IS 'Code of the academic year of the misc fee, e.g. 2026-27.';
COMMENT ON COLUMN nlq.misc_fee_dues.fee_status IS 'announced (open for payment) or closed (closed by the school).';
COMMENT ON COLUMN nlq.misc_fee_dues.is_mandatory IS 'True when every person on the fee must pay; false for an optional fee (pay to take part).';
COMMENT ON COLUMN nlq.misc_fee_dues.seats IS 'Number of places on an optional fee (first come, first served by payment); NULL = no limit.';
COMMENT ON COLUMN nlq.misc_fee_dues.announced_on IS 'Date the misc fee was announced (India date).';
COMMENT ON COLUMN nlq.misc_fee_dues.payer_type IS 'student (a pupil) or staff (an employee).';
COMMENT ON COLUMN nlq.misc_fee_dues.student_id IS 'The pupil''s id (NULL for a staff line); join key to student_id in other nlq views.';
COMMENT ON COLUMN nlq.misc_fee_dues.admission_no IS 'The pupil''s admission number (NULL for a staff line).';
COMMENT ON COLUMN nlq.misc_fee_dues.student_name IS 'The pupil''s full name (NULL for a staff line).';
COMMENT ON COLUMN nlq.misc_fee_dues.class_section_id IS 'Id of the pupil''s class-section in the misc fee''s academic year.';
COMMENT ON COLUMN nlq.misc_fee_dues.class IS 'The pupil''s class in the misc fee''s academic year; sort by class_order.';
COMMENT ON COLUMN nlq.misc_fee_dues.class_order IS 'Display order of the class, for sorting.';
COMMENT ON COLUMN nlq.misc_fee_dues.section IS 'The pupil''s section in that academic year.';
COMMENT ON COLUMN nlq.misc_fee_dues.class_section IS 'Class and section together, e.g. VI-A.';
COMMENT ON COLUMN nlq.misc_fee_dues.employee_id IS 'The staff member''s id (NULL for a pupil line); join key to nlq.staff.employee_id.';
COMMENT ON COLUMN nlq.misc_fee_dues.employee_code IS 'The staff member''s employee code (NULL for a pupil line).';
COMMENT ON COLUMN nlq.misc_fee_dues.employee_name IS 'The staff member''s full name (NULL for a pupil line).';
COMMENT ON COLUMN nlq.misc_fee_dues.amount IS 'Amount set for this person, in rupees.';
COMMENT ON COLUMN nlq.misc_fee_dues.paid IS 'Paid on this line by misc receipts, in rupees (after cancelled, bounced and refunded receipts).';
COMMENT ON COLUMN nlq.misc_fee_dues.balance IS 'amount - paid, in rupees (0 when paid).';
COMMENT ON COLUMN nlq.misc_fee_dues.status IS 'open (not fully paid) or paid (paid in full).';
COMMENT ON COLUMN nlq.misc_fee_dues.last_date IS 'Last date to pay (the person''s own date, else the fee''s).';
COMMENT ON COLUMN nlq.misc_fee_dues.is_closed IS 'True when the fee is closed, or is optional and its last date has passed: then it is no longer asked for.';
COMMENT ON COLUMN nlq.misc_fee_dues.is_overdue IS 'True for an unpaid line of a mandatory, not closed fee whose last date is before today.';
COMMENT ON COLUMN nlq.misc_fee_dues.paid_on IS 'Date the line became fully paid (India date); NULL while open.';

-- nlq.misc_receipts: one row is one posted misc receipt (an announced misc fee, a registration or admission fee, or other
-- income), with what is left after refunds. Cancelled (reversed) and bounced misc receipts, removed and merged pupils left out.
GRANT SELECT ON public.misc_receipts, misc_fee_students, misc_fees, fee_heads, financial_years, students, employees, applications, academic_years, enrolments, class_sections, classes, users, user_school_memberships TO edupro_nlq_owner;
CREATE VIEW nlq.misc_receipts WITH (security_barrier = true) AS
SELECT m.id                                             AS misc_receipt_id,
       m.receipt_no,
       m.received_on,
       date_trunc('month', m.received_on)::date         AS month,
       fy.code                                          AS financial_year,
       m.academic_year_id,
       ay.code                                          AS academic_year,
       CASE WHEN m.application_id IS NOT NULL THEN 'admission' ELSE 'misc' END AS ledger,
       CASE WHEN m.application_id IS NOT NULL THEN 'admission_fee'
            WHEN m.misc_fee_student_id IS NOT NULL THEN 'misc_fee'
            ELSE 'other' END                            AS purpose,
       h.code                                           AS head_code,
       h.name                                           AS head,
       mf.id                                            AS misc_fee_id,
       mf.title                                         AS misc_fee,
       m.misc_fee_student_id                            AS misc_fee_line_id,
       m.payer_kind::text                               AS payer_kind,
       m.student_id,
       s.admission_no,
       s.display_name                                   AS student_name,
       cs.id                                            AS class_section_id,
       k.name                                           AS class,
       k.display_order                                  AS class_order,
       cs.name                                          AS section,
       k.code || '-' || cs.name                         AS class_section,
       m.employee_id,
       emp.employee_code,
       emp.display_name                                 AS employee_name,
       m.application_id,
       ap.application_no,
       m.mode,
       COALESCE(m.mode_label, m.mode)                   AS mode_name,
       m.amount,
       m.refunded,
       m.amount - m.refunded                            AS net_amount,
       m.convenience_charge,
       m.cleared_on,
       CASE WHEN m.mode = 'online' THEN 'Online' ELSE u.display_name END AS received_by
  FROM public.misc_receipts m
  JOIN fee_heads h       ON h.id = m.head_id
  JOIN academic_years ay ON ay.id = m.academic_year_id
  LEFT JOIN financial_years fy ON fy.id = m.financial_year_id
  LEFT JOIN misc_fee_students l ON l.id = m.misc_fee_student_id
  LEFT JOIN misc_fees mf ON mf.id = l.misc_fee_id
  LEFT JOIN students s   ON s.id = m.student_id
  LEFT JOIN employees emp ON emp.id = m.employee_id
  LEFT JOIN applications ap ON ap.id = m.application_id
  LEFT JOIN enrolments e ON e.student_id = m.student_id AND e.academic_year_id = m.academic_year_id AND e.status <> 'cancelled'
  LEFT JOIN class_sections cs ON cs.id = e.class_section_id
  LEFT JOIN classes k    ON k.id = cs.class_id
  LEFT JOIN users u      ON u.id = m.received_by
 WHERE m.school_id = app.nlq_school_id()
   AND m.status = 'posted'
   AND (m.student_id IS NULL OR (s.deleted_at IS NULL AND s.merged_into_id IS NULL));
ALTER VIEW nlq.misc_receipts OWNER TO edupro_nlq_owner;
GRANT SELECT ON nlq.misc_receipts TO edupro_nlq;
COMMENT ON VIEW nlq.misc_receipts IS 'One row is one misc receipt that stands: money for an announced misc fee (trip, exam form, library charge ...), a registration or admission fee of a new applicant, or other income (from pupils, staff, vendors or others). Regular school and hostel fee receipts are not here (nlq.fee_receipts). Left out: cancelled (reversed) and bounced misc receipts, receipts of removed and merged pupils. amount is what was received on received_on; refunded is what was later given back (misc refunds are not dated here); net_amount = amount - refunded is what the school keeps. For "money received in a period" sum(amount) by received_on or month; for "income kept" sum(net_amount). Group by purpose, head, misc_fee, mode_name or month. Mode transfer is money moved in from another school of the group, not cash. Payers who are not pupils or staff (parents, vendors, applicants) are not named. Join nlq.misc_fee_dues on misc_fee_line_id.';
COMMENT ON COLUMN nlq.misc_receipts.misc_receipt_id IS 'Id of the misc receipt.';
COMMENT ON COLUMN nlq.misc_receipts.receipt_no IS 'Receipt number as printed (MF/... misc; the admission series for registration and admission fees).';
COMMENT ON COLUMN nlq.misc_receipts.received_on IS 'Date of the receipt (India date).';
COMMENT ON COLUMN nlq.misc_receipts.month IS 'First day of the month of received_on.';
COMMENT ON COLUMN nlq.misc_receipts.financial_year IS 'Code of the financial year (April to March) of the receipt, e.g. FY2026-27.';
COMMENT ON COLUMN nlq.misc_receipts.academic_year_id IS 'Id of the academic year the receipt belongs to (for an admission fee: the session the child joins).';
COMMENT ON COLUMN nlq.misc_receipts.academic_year IS 'Code of that academic year, e.g. 2026-27.';
COMMENT ON COLUMN nlq.misc_receipts.ledger IS 'admission (registration or admission fee of an applicant) or misc (everything else).';
COMMENT ON COLUMN nlq.misc_receipts.purpose IS 'misc_fee (paid against an announced misc fee), admission_fee (registration or admission fee), other (any other misc income: fines, sales, charges taken at the counter).';
COMMENT ON COLUMN nlq.misc_receipts.head_code IS 'Code of the fee head the money is collected under.';
COMMENT ON COLUMN nlq.misc_receipts.head IS 'Name of the fee head the money is collected under.';
COMMENT ON COLUMN nlq.misc_receipts.misc_fee_id IS 'Id of the announced misc fee paid (NULL unless purpose misc_fee); join key to nlq.misc_fee_dues.misc_fee_id.';
COMMENT ON COLUMN nlq.misc_receipts.misc_fee IS 'Title of the announced misc fee paid (NULL unless purpose misc_fee).';
COMMENT ON COLUMN nlq.misc_receipts.misc_fee_line_id IS 'Id of the person''s misc fee line paid; join key to nlq.misc_fee_dues.misc_fee_line_id.';
COMMENT ON COLUMN nlq.misc_receipts.payer_kind IS 'Who paid: student, employee, vendor or other (an applicant''s family, a visitor ...).';
COMMENT ON COLUMN nlq.misc_receipts.student_id IS 'The pupil''s id when a pupil paid (else NULL); join key to student_id in other nlq views.';
COMMENT ON COLUMN nlq.misc_receipts.admission_no IS 'The pupil''s admission number (NULL when not a pupil).';
COMMENT ON COLUMN nlq.misc_receipts.student_name IS 'The pupil''s full name (NULL when not a pupil).';
COMMENT ON COLUMN nlq.misc_receipts.class_section_id IS 'Id of the pupil''s class-section in the receipt''s academic year.';
COMMENT ON COLUMN nlq.misc_receipts.class IS 'The pupil''s class in the receipt''s academic year; sort by class_order.';
COMMENT ON COLUMN nlq.misc_receipts.class_order IS 'Display order of the class, for sorting.';
COMMENT ON COLUMN nlq.misc_receipts.section IS 'The pupil''s section in that academic year.';
COMMENT ON COLUMN nlq.misc_receipts.class_section IS 'Class and section together, e.g. VI-A.';
COMMENT ON COLUMN nlq.misc_receipts.employee_id IS 'The staff member''s id when staff paid (else NULL); join key to nlq.staff.employee_id.';
COMMENT ON COLUMN nlq.misc_receipts.employee_code IS 'The staff member''s employee code (NULL when not staff).';
COMMENT ON COLUMN nlq.misc_receipts.employee_name IS 'The staff member''s full name (NULL when not staff).';
COMMENT ON COLUMN nlq.misc_receipts.application_id IS 'Id of the admission application for a registration or admission fee (else NULL).';
COMMENT ON COLUMN nlq.misc_receipts.application_no IS 'Number of the admission application for a registration or admission fee (else NULL).';
COMMENT ON COLUMN nlq.misc_receipts.mode IS 'Kind of payment: online, cash, cheque, dd, upi, bank, card, transfer (moved from another school of the group, no cash).';
COMMENT ON COLUMN nlq.misc_receipts.mode_name IS 'The school''s own name of the mode (e.g. NEFT), else the kind.';
COMMENT ON COLUMN nlq.misc_receipts.amount IS 'Money received on the receipt, in rupees (gross: a later refund does not change it; excludes the online convenience charge).';
COMMENT ON COLUMN nlq.misc_receipts.refunded IS 'Amount refunded from this receipt so far, in rupees.';
COMMENT ON COLUMN nlq.misc_receipts.net_amount IS 'amount - refunded, in rupees: what the school keeps.';
COMMENT ON COLUMN nlq.misc_receipts.convenience_charge IS 'Online convenience charge paid on top, in rupees (not in amount); 0 at the counter.';
COMMENT ON COLUMN nlq.misc_receipts.cleared_on IS 'Date the bank credited the cheque, draft or transfer; NULL = not yet seen in the bank (always NULL for cash).';
COMMENT ON COLUMN nlq.misc_receipts.received_by IS 'Name of the staff member who took the receipt; Online for gateway payments.';

-- nlq.payslip_lines: one row is one pay head (earning or deduction) of one employee's pay month — the head's lines of every
-- record of the month summed; heads that sum to 0 dropped; the net-pay rounding line kept as 'Rounding'. Same scope as
-- nlq.payslips: approved / locked / paid runs, no failed records, deleted runs, go-live trial runs or confidential staff.
GRANT SELECT ON payroll_records, payroll_runs, payroll_record_lines, payroll_pay_heads, payroll_settings, payroll_cutover TO edupro_nlq_owner;
CREATE VIEW nlq.payslip_lines WITH (security_barrier = true) AS
WITH rec AS (
  SELECT x.id,
         x.employee_id,
         x.month,
         x.is_top_up,
         x.employee_code,
         x.employee_name,
         COALESCE(NULLIF(btrim(x.department), ''), 'No department')                 AS department,
         NULLIF(btrim(x.designation), '')                                           AS designation,
         x.staff_type                                                               AS staff_group,
         bool_and(u.stage IN ('LOCKED', 'PAID')) OVER (PARTITION BY x.employee_id, x.month) AS month_final
    FROM payroll_records x
    JOIN payroll_runs u ON u.id = x.run_id
    LEFT JOIN payroll_settings ps ON ps.school_id = x.school_id
    LEFT JOIN payroll_cutover co ON co.school_id = x.school_id
   WHERE x.school_id = app.nlq_school_id()
     AND u.deleted_at IS NULL
     AND u.stage IN ('APPROVED', 'LOCKED', 'PAID')
     AND x.status <> 'FAILED'
     AND NOT (x.employee_id = ANY (COALESCE(ps.confidential_employee_ids, '{}'::bigint[])))
     AND (u.imported OR co.status IS NULL OR co.status = 'SWITCHED'))
SELECT rec.employee_id,
       (array_agg(rec.employee_code ORDER BY rec.is_top_up, rec.id DESC))[1]       AS employee_code,
       (array_agg(rec.employee_name ORDER BY rec.is_top_up, rec.id DESC))[1]       AS employee_name,
       (array_agg(rec.department ORDER BY rec.is_top_up, rec.id DESC))[1]          AS department,
       (array_agg(rec.designation ORDER BY rec.is_top_up, rec.id DESC))[1]         AS designation,
       (array_agg(rec.staff_group ORDER BY rec.is_top_up, rec.id DESC))[1]         AS staff_group,
       rec.month,
       (CASE WHEN extract(month FROM rec.month) >= 4 THEN extract(year FROM rec.month)::int
             ELSE extract(year FROM rec.month)::int - 1 END)::text || '-'
         || lpad(((CASE WHEN extract(month FROM rec.month) >= 4 THEN extract(year FROM rec.month)::int
                        ELSE extract(year FROM rec.month)::int - 1 END + 1) % 100)::text, 2, '0') AS financial_year,
       l.code                                                                      AS pay_head_code,
       CASE WHEN bool_or(l.source_kind = 'rounding') THEN 'Rounding'
            ELSE COALESCE(max(h.name), (array_agg(l.name ORDER BY l.is_arrear, l.calc_order))[1]) END AS pay_head,
       lower(l.head_type)                                                          AS kind,
       CASE WHEN bool_or(l.source_kind = 'rounding') THEN 'ROUNDING' ELSE max(h.category) END AS category,
       min(l.print_order)                                                          AS print_order,
       sum(l.amount)                                                               AS amount,
       COALESCE(sum(l.amount) FILTER (WHERE l.is_arrear), 0)                       AS arrear_amount,
       bool_or(l.is_taxable)                                                       AS is_taxable,
       bool_and(rec.month_final)                                                   AS is_final
  FROM rec
  JOIN payroll_record_lines l ON l.record_id = rec.id
  LEFT JOIN payroll_pay_heads h ON h.id = l.pay_head_id
 GROUP BY rec.employee_id, rec.month, l.code, l.head_type
HAVING sum(l.amount) <> 0;
ALTER VIEW nlq.payslip_lines OWNER TO edupro_nlq_owner;
GRANT SELECT ON nlq.payslip_lines TO edupro_nlq;
COMMENT ON VIEW nlq.payslip_lines IS 'One row is one pay head on one employee''s salary for one pay month: e.g. Basic Pay, Dearness Allowance, HRA, Provident Fund, Income Tax (TDS), Advance Recovery — the amounts of every pay run of that month (regular, supplementary, bonus, full and final) added together. Heads that come to 0 are left out. The small net-pay rounding adjustment is its own row (pay_head ''Rounding'', category ROUNDING, a deduction that can be negative). Same scope as nlq.payslips: approved, locked or paid runs only; failed records, deleted runs, the go-live''s trial runs and confidential staff left out. Final figures: is_final = true. Earnings minus deductions of an employee-month = nlq.payslips.net_pay; earnings summed = gross_pay. Employer contributions (school''s PF / ESI share) are NOT lines — they are in nlq.payslips. Group by pay_head (or pay_head_code) and kind; filter month (first day of the pay month) or financial_year (April to March). Amounts are rupees, deductions positive. Join nlq.payslips on (employee_id, month), nlq.staff on employee_id.';
COMMENT ON COLUMN nlq.payslip_lines.employee_id IS 'The employee''s id; with month, joins nlq.payslips; alone, joins nlq.staff.';
COMMENT ON COLUMN nlq.payslip_lines.employee_code IS 'The employee code as on that month''s payslip.';
COMMENT ON COLUMN nlq.payslip_lines.employee_name IS 'The employee''s name as on that month''s payslip.';
COMMENT ON COLUMN nlq.payslip_lines.department IS 'The department as on that month''s payslip; ''No department'' when empty.';
COMMENT ON COLUMN nlq.payslip_lines.designation IS 'The designation as on that month''s payslip; empty when not set.';
COMMENT ON COLUMN nlq.payslip_lines.staff_group IS 'The staff group when paid: teaching, non_teaching, contract or visiting.';
COMMENT ON COLUMN nlq.payslip_lines.month IS 'The pay month (its first day, e.g. 2026-10-01 = October 2026).';
COMMENT ON COLUMN nlq.payslip_lines.financial_year IS 'The financial (tax) year of the pay month, April to March, as text like 2026-27.';
COMMENT ON COLUMN nlq.payslip_lines.pay_head_code IS 'The pay head''s short code. Usual ones: BASIC, DA, HRA, TA, SPL_ALW, OT (overtime), BONUS, DA_ARR / OTH_ARR / LOP_REV / LOP_REVO (arrears), PF, VPF, NPS, ESI, PT (profession tax), TDS (income tax), LWF, ADV (loan / advance instalment), WARDFEE (a staff child''s fees), LIC, MISC_DED, GRAT_EX / GRAT_TX (gratuity), ENCASH_EX / ENCASH_TX (leave encashment), NOTICE_REC, FNF_REC, ROUND_ADJ (rounding). Schools add their own.';
COMMENT ON COLUMN nlq.payslip_lines.pay_head IS 'The pay head''s name (e.g. Basic Pay, House Rent Allowance, Provident Fund, Income Tax (TDS)); ''Rounding'' for the net-pay rounding adjustment.';
COMMENT ON COLUMN nlq.payslip_lines.kind IS 'earning or deduction.';
COMMENT ON COLUMN nlq.payslip_lines.category IS 'The head''s group: BASIC, DA, HRA, ALLOWANCE, ARREAR, BONUS, REIMB (reimbursement / claim), LOAN (loan instalments), STATUTORY (PF, VPF, NPS, ESI, PT, TDS, LWF), MISC, or ROUNDING; empty for an old-payroll head not set up here.';
COMMENT ON COLUMN nlq.payslip_lines.print_order IS 'The order the head prints on the payslip (lower first); use to sort heads.';
COMMENT ON COLUMN nlq.payslip_lines.amount IS 'The head''s amount for the employee-month (rupees), arrears included; deductions are positive (subtract them). The Rounding row can be negative.';
COMMENT ON COLUMN nlq.payslip_lines.arrear_amount IS 'The part of amount that is arrears for earlier months (a pay revision, loss of pay given back, …), rupees; 0 when none.';
COMMENT ON COLUMN nlq.payslip_lines.is_taxable IS 'True for an earning counted as taxable salary for income tax; false for tax-free earnings and for every deduction.';
COMMENT ON COLUMN nlq.payslip_lines.is_final IS 'True when every run of the employee''s month is locked or paid (final); false = PROVISIONAL (same as nlq.payslips.is_final).';

-- nlq.payslips: one row is one employee's pay for one pay month — every record of the month (regular run, supplementary,
-- bonus, full and final) summed. Runs approved, locked or paid only; failed records, deleted runs, the go-live's trial runs
-- (EduPro's runs before the switch from the old payroll) and confidential staff (payroll_settings) are left out.
GRANT SELECT ON payroll_records, payroll_runs, payroll_record_statutory, payroll_settings, payroll_cutover TO edupro_nlq_owner;
CREATE VIEW nlq.payslips WITH (security_barrier = true) AS
SELECT m.employee_id,
       m.employee_code,
       m.employee_name,
       m.department,
       m.designation,
       m.staff_group,
       m.pay_mode,
       m.tax_regime,
       m.month,
       m.financial_year,
       m.records_in_month,
       m.month_days,
       m.paid_days,
       m.lop_days,
       m.fixed_gross,
       m.lop_amount,
       m.gross_pay,
       m.total_deductions,
       m.net_pay,
       m.tds,
       m.profession_tax,
       m.employee_pf,
       m.employee_esi,
       m.employer_pf,
       m.employer_esi,
       m.employer_other,
       m.gross_pay + m.employer_pf + m.employer_esi + m.employer_other AS cost_to_school,
       m.is_final,
       m.is_paid,
       m.is_held,
       CASE WHEN NOT m.is_final THEN 'provisional'
            WHEN m.is_held THEN 'held'
            WHEN m.is_paid THEN 'paid'
            ELSE 'to_pay' END                                           AS pay_status,
       m.paid_on,
       m.has_full_and_final,
       m.from_old_payroll
  FROM (
        SELECT x.employee_id,
               (array_agg(x.employee_code ORDER BY x.is_top_up, x.id DESC))[1]                      AS employee_code,
               (array_agg(x.employee_name ORDER BY x.is_top_up, x.id DESC))[1]                      AS employee_name,
               (array_agg(COALESCE(NULLIF(btrim(x.department), ''), 'No department')
                          ORDER BY x.is_top_up, x.id DESC))[1]                                      AS department,
               (array_agg(NULLIF(btrim(x.designation), '') ORDER BY x.is_top_up, x.id DESC))[1]     AS designation,
               (array_agg(x.staff_type ORDER BY x.is_top_up, x.id DESC))[1]                         AS staff_group,
               (array_agg(COALESCE(x.pay_mode, 'BANK') ORDER BY x.is_top_up, x.id DESC))[1]         AS pay_mode,
               (array_agg(x.tax_regime ORDER BY x.is_top_up, x.id DESC))[1]                         AS tax_regime,
               x.month,
               (CASE WHEN extract(month FROM x.month) >= 4 THEN extract(year FROM x.month)::int
                     ELSE extract(year FROM x.month)::int - 1 END)::text || '-'
                 || lpad(((CASE WHEN extract(month FROM x.month) >= 4 THEN extract(year FROM x.month)::int
                                ELSE extract(year FROM x.month)::int - 1 END + 1) % 100)::text, 2, '0') AS financial_year,
               count(*)::int                                                                        AS records_in_month,
               max(x.month_days) FILTER (WHERE NOT x.is_top_up)                                     AS month_days,
               max(x.paid_days) FILTER (WHERE NOT x.is_top_up)                                      AS paid_days,
               max(x.lop_days) FILTER (WHERE NOT x.is_top_up)                                       AS lop_days,
               sum(x.gross_fixed)                                                                   AS fixed_gross,
               sum(x.lop_amount)                                                                    AS lop_amount,
               sum(x.gross_earned)                                                                  AS gross_pay,
               sum(x.total_deductions)                                                              AS total_deductions,
               sum(x.net_pay)                                                                       AS net_pay,
               sum(x.it_amount + x.cess_amount)                                                     AS tds,
               sum(x.pt_amount)                                                                     AS profession_tax,
               COALESCE(sum(st.ee_pf + st.vpf), 0)                                                  AS employee_pf,
               COALESCE(sum(st.esi_ee) FILTER (WHERE st.esi_covered), 0)                            AS employee_esi,
               COALESCE(sum(st.er_epf + st.er_eps), 0)                                              AS employer_pf,
               COALESCE(sum(st.esi_er) FILTER (WHERE st.esi_covered), 0)                            AS employer_esi,
               COALESCE(sum(st.edli + st.pf_admin + COALESCE(st.nps_er, 0) + COALESCE(st.lwf_er, 0)), 0) AS employer_other,
               bool_and(u.stage IN ('LOCKED', 'PAID'))                                              AS is_final,
               bool_and(x.status = 'PAID' OR x.net_pay = 0)                                         AS is_paid,
               bool_or(x.status = 'HELD')                                                           AS is_held,
               (max(x.paid_at) AT TIME ZONE 'Asia/Kolkata')::date                                   AS paid_on,
               bool_or(u.purpose = 'FNF')                                                           AS has_full_and_final,
               bool_or(u.imported)                                                                  AS from_old_payroll
          FROM payroll_records x
          JOIN payroll_runs u ON u.id = x.run_id
          LEFT JOIN payroll_record_statutory st ON st.record_id = x.id
          LEFT JOIN payroll_settings ps ON ps.school_id = x.school_id
          LEFT JOIN payroll_cutover co ON co.school_id = x.school_id
         WHERE x.school_id = app.nlq_school_id()
           AND u.deleted_at IS NULL
           AND u.stage IN ('APPROVED', 'LOCKED', 'PAID')
           AND x.status <> 'FAILED'
           AND NOT (x.employee_id = ANY (COALESCE(ps.confidential_employee_ids, '{}'::bigint[])))
           AND (u.imported OR co.status IS NULL OR co.status = 'SWITCHED')
         GROUP BY x.employee_id, x.month
       ) m;
ALTER VIEW nlq.payslips OWNER TO edupro_nlq_owner;
GRANT SELECT ON nlq.payslips TO edupro_nlq;
COMMENT ON VIEW nlq.payslips IS 'One row is one employee''s salary for one pay month: every pay run of that month (the regular run plus any supplementary, bonus or full-and-final run) added together, so an employee appears once per month. Only runs that were approved, locked or paid count; failed records, deleted runs, the trial runs EduPro made while the school was still moving from its old payroll, and the staff the payroll admin marked confidential are left out. Final figures: filter is_final = true (approved-only months are PROVISIONAL and can still change). Money actually paid: is_paid = true. Group by month (first day of the pay month) or financial_year (April to March, e.g. 2026-27) — never by academic year; paid_on is when the money went, not the month it is for. Amounts are rupees. gross_pay - total_deductions = net_pay. Count people with count(*) (one row per person per month). Department, designation and staff_group are as on the payslip of that month (not today''s). Join nlq.payslip_lines on (employee_id, month) for head-by-head amounts, and nlq.staff on employee_id for today''s details. Bank details, PAN, UAN and ESI numbers are not here.';
COMMENT ON COLUMN nlq.payslips.employee_id IS 'The employee''s id; join key to nlq.staff, nlq.payslip_lines (with month) and other staff views.';
COMMENT ON COLUMN nlq.payslips.employee_code IS 'The employee code as on that month''s payslip, e.g. E0123.';
COMMENT ON COLUMN nlq.payslips.employee_name IS 'The employee''s name as on that month''s payslip.';
COMMENT ON COLUMN nlq.payslips.department IS 'The department as on that month''s payslip (the text on the employee record when paid); ''No department'' when empty.';
COMMENT ON COLUMN nlq.payslips.designation IS 'The designation as on that month''s payslip (e.g. PGT, TGT, Accountant); empty when not set.';
COMMENT ON COLUMN nlq.payslips.staff_group IS 'The staff group when paid: teaching, non_teaching, contract or visiting (same values as nlq.staff.staff_group).';
COMMENT ON COLUMN nlq.payslips.pay_mode IS 'How the salary is paid: BANK (bank transfer file), CASH or CHEQUE.';
COMMENT ON COLUMN nlq.payslips.tax_regime IS 'The income-tax regime the month''s tax was worked out in: NEW or OLD (empty on old-payroll history).';
COMMENT ON COLUMN nlq.payslips.month IS 'The pay month the salary is for (its first day, e.g. 2026-10-01 = October 2026). Filter with month = DATE ''2026-10-01'' or a range.';
COMMENT ON COLUMN nlq.payslips.financial_year IS 'The financial (tax) year of the pay month, April to March, as text like 2026-27. Use for yearly totals (TDS, salary paid in the year).';
COMMENT ON COLUMN nlq.payslips.records_in_month IS 'How many pay runs paid this employee this month (1 = the regular run only; more when a supplementary, bonus or full-and-final run added to it).';
COMMENT ON COLUMN nlq.payslips.month_days IS 'Days in the pay month as counted for pay (e.g. 31).';
COMMENT ON COLUMN nlq.payslips.paid_days IS 'Days paid in the month (present, paid leave and holidays; excludes loss-of-pay days and days before joining or after leaving). Do not add up across months to get attendance.';
COMMENT ON COLUMN nlq.payslips.lop_days IS 'Loss-of-pay days of the month (absence, unpaid leave, part-pay leave''s unpaid share, salary-hold days).';
COMMENT ON COLUMN nlq.payslips.fixed_gross IS 'The full-month salary of the pay structure before any loss of pay (rupees): the employee''s monthly gross at full attendance. Not paid as such — see gross_pay.';
COMMENT ON COLUMN nlq.payslips.lop_amount IS 'Salary cut for loss of pay this month (rupees) = fixed_gross minus the structure earnings actually paid.';
COMMENT ON COLUMN nlq.payslips.gross_pay IS 'Gross salary paid for the month (rupees): all earnings — the structure after loss of pay, arrears, bonus, overtime, reimbursements and other one-off earnings.';
COMMENT ON COLUMN nlq.payslips.total_deductions IS 'All deductions from the salary (rupees): PF, ESI, NPS, profession tax, TDS, LWF, loan instalments, recurring and one-off deductions, and the small rounding adjustment.';
COMMENT ON COLUMN nlq.payslips.net_pay IS 'Take-home salary for the month (rupees) = gross_pay - total_deductions.';
COMMENT ON COLUMN nlq.payslips.tds IS 'Income tax deducted at source this month, cess included (rupees).';
COMMENT ON COLUMN nlq.payslips.profession_tax IS 'Profession tax deducted this month (rupees); 0 in states without it.';
COMMENT ON COLUMN nlq.payslips.employee_pf IS 'The employee''s own provident fund deducted: PF plus voluntary PF (rupees).';
COMMENT ON COLUMN nlq.payslips.employee_esi IS 'The employee''s ESI deducted, only for staff covered by ESI that period (rupees).';
COMMENT ON COLUMN nlq.payslips.employer_pf IS 'The school''s own PF contribution for the employee (EPF difference + pension EPS), on top of the salary (rupees). Not part of gross_pay.';
COMMENT ON COLUMN nlq.payslips.employer_esi IS 'The school''s ESI contribution for covered staff, on top of the salary (rupees).';
COMMENT ON COLUMN nlq.payslips.employer_other IS 'The school''s other statutory costs for the employee: EDLI insurance, PF admin charges, employer NPS and employer LWF (rupees).';
COMMENT ON COLUMN nlq.payslips.cost_to_school IS 'What the employee cost the school this month (rupees) = gross_pay + employer_pf + employer_esi + employer_other (gratuity not included).';
COMMENT ON COLUMN nlq.payslips.is_final IS 'True when every run of the month for this employee is locked or paid (final). False = PROVISIONAL: a run is only approved and may still change.';
COMMENT ON COLUMN nlq.payslips.is_paid IS 'True when all of the month''s salary has been paid (bank transfer confirmed, or cash / cheque marked paid). False while held or waiting for payment.';
COMMENT ON COLUMN nlq.payslips.is_held IS 'True when the salary (or part of it) is on hold and not paid until released.';
COMMENT ON COLUMN nlq.payslips.pay_status IS 'provisional (run only approved), held (on hold), to_pay (final, not yet paid) or paid.';
COMMENT ON COLUMN nlq.payslips.paid_on IS 'The date (India) the month''s salary was last paid; empty until paid. For "salary paid in a date range" use this; for "salary for a month" use month.';
COMMENT ON COLUMN nlq.payslips.has_full_and_final IS 'True when a full-and-final settlement run (a leaver''s last pay: gratuity, leave encashment, recoveries) is part of this month.';
COMMENT ON COLUMN nlq.payslips.from_old_payroll IS 'True for months brought in from the school''s old payroll system as history (read-only; employer shares and days as the old system kept them).';

-- nlq.purchase_order_lines: one row is one item line of a placed purchase order (revision in force).
-- Rules: lines of approved / sent / closed POs only; amounts before GST per line; charges are not lines.
GRANT SELECT ON purchase_order_lines, purchase_orders, vendors, departments, purchase_items, purchase_item_categories, purchase_uoms TO edupro_nlq_owner;
CREATE VIEW nlq.purchase_order_lines WITH (security_barrier = true) AS
SELECT x.id AS order_line_id,
       x.order_id,
       po.number || CASE WHEN po.revision > 0 THEN '-R' || po.revision ELSE '' END AS po_no,
       po.po_date,
       date_trunc('month', po.po_date)::date AS month,
       to_char(po.po_date - interval '3 months', 'YYYY') || '-' || to_char(po.po_date + interval '9 months', 'YY') AS financial_year,
       po.status AS order_status,
       po.vendor_id,
       v.legal_name AS vendor,
       po.department_id,
       COALESCE(d.name, 'No department') AS department,
       x.seq AS line_no,
       x.item_id,
       i.code AS item_code,
       COALESCE(i.name, x.description) AS item,
       COALESCE(cat.name, 'Not in the catalogue') AS category,
       sub.name AS sub_category,
       i.item_type,
       x.hsn_code,
       x.quantity AS qty,
       u.code AS unit,
       x.rate,
       x.discount_pct,
       x.gst_rate,
       x.taxable AS amount,
       x.cgst + x.sgst + x.igst AS tax,
       x.total AS line_total,
       (x.contract_id IS NOT NULL) AS is_rate_contract,
       x.accepted_qty,
       CASE WHEN po.status IN ('approved', 'sent')
            THEN GREATEST(x.quantity - (x.received_qty - x.rejected_qty - x.returned_qty), 0) ELSE 0 END AS qty_still_to_come,
       CASE WHEN i.id IS NOT NULL THEN round(x.quantity * i.stock_per_unit, 3) END AS qty_in_store_units
  FROM purchase_order_lines x
  JOIN purchase_orders po ON po.id = x.order_id
  JOIN vendors v ON v.id = po.vendor_id
  JOIN purchase_uoms u ON u.id = x.uom_id
  LEFT JOIN departments d ON d.id = po.department_id
  LEFT JOIN purchase_items i ON i.id = x.item_id
  LEFT JOIN purchase_item_categories cat ON cat.id = i.category_id
  LEFT JOIN purchase_item_categories sub ON sub.id = i.sub_category_id
 WHERE x.school_id = app.nlq_school_id()
   AND po.status IN ('approved', 'sent', 'closed')
   AND NOT EXISTS (SELECT 1 FROM purchase_orders n
                    WHERE n.supersedes_id = po.id AND n.status IN ('approved', 'sent', 'closed'));
ALTER VIEW nlq.purchase_order_lines OWNER TO edupro_nlq_owner;
GRANT SELECT ON nlq.purchase_order_lines TO edupro_nlq;
COMMENT ON VIEW nlq.purchase_order_lines IS 'One row is one item line of a placed purchase order (approved, sent or closed; only the revision in force). Left out: lines of drafts, waiting, rejected, cancelled and superseded POs. Use: what was bought, by item, category, vendor or department; sum amount (before GST) or line_total (with GST); filter on po_date or financial_year. qty is in the unit of the PO line (unit), not the store unit. Freight and other charges and the round-off are not lines, so the lines of a PO add up to less than nlq.purchase_orders.total; use nlq.purchase_orders for spend totals. Join nlq.purchase_orders on order_id.';
COMMENT ON COLUMN nlq.purchase_order_lines.order_line_id IS 'Id of the PO line.';
COMMENT ON COLUMN nlq.purchase_order_lines.order_id IS 'Id of the purchase order; join key to nlq.purchase_orders.order_id.';
COMMENT ON COLUMN nlq.purchase_order_lines.po_no IS 'The PO number as printed, e.g. PO/2026-27/0012 (-R1 for an amendment).';
COMMENT ON COLUMN nlq.purchase_order_lines.po_date IS 'Date of the purchase order.';
COMMENT ON COLUMN nlq.purchase_order_lines.month IS 'First day of the month of po_date.';
COMMENT ON COLUMN nlq.purchase_order_lines.financial_year IS 'Indian financial year of po_date (April to March), e.g. 2026-27.';
COMMENT ON COLUMN nlq.purchase_order_lines.order_status IS 'Status of the PO: approved, sent or closed.';
COMMENT ON COLUMN nlq.purchase_order_lines.vendor_id IS 'Id of the vendor.';
COMMENT ON COLUMN nlq.purchase_order_lines.vendor IS 'Vendor legal name.';
COMMENT ON COLUMN nlq.purchase_order_lines.department_id IS 'Id of the department the PO is booked to.';
COMMENT ON COLUMN nlq.purchase_order_lines.department IS 'Department the PO is booked to (No department when none; combined requisitions go to the purchase office department).';
COMMENT ON COLUMN nlq.purchase_order_lines.line_no IS 'Line number on the PO (1, 2, 3 ...).';
COMMENT ON COLUMN nlq.purchase_order_lines.item_id IS 'Id of the catalogue item; empty for a line written in words. Join key to nlq.stock_balances.item_id and nlq.stock_ledger.item_id.';
COMMENT ON COLUMN nlq.purchase_order_lines.item_code IS 'Catalogue item code, e.g. STAT-PAPER-0001; empty for a line in words.';
COMMENT ON COLUMN nlq.purchase_order_lines.item IS 'Item name (the line description when the item is not in the catalogue).';
COMMENT ON COLUMN nlq.purchase_order_lines.category IS 'Main item category, e.g. Stationery; Not in the catalogue for a line in words.';
COMMENT ON COLUMN nlq.purchase_order_lines.sub_category IS 'Item sub-category; empty when none.';
COMMENT ON COLUMN nlq.purchase_order_lines.item_type IS 'consumable, asset (each unit gets an asset tag) or service; empty for a line in words.';
COMMENT ON COLUMN nlq.purchase_order_lines.hsn_code IS 'HSN (goods) or SAC (services) code of the line.';
COMMENT ON COLUMN nlq.purchase_order_lines.qty IS 'Quantity ordered, in unit (the purchase unit, e.g. BOX).';
COMMENT ON COLUMN nlq.purchase_order_lines.unit IS 'Unit code of qty, e.g. NOS, BOX, KG.';
COMMENT ON COLUMN nlq.purchase_order_lines.rate IS 'Rate per unit in rupees, before discount and GST.';
COMMENT ON COLUMN nlq.purchase_order_lines.discount_pct IS 'Discount on the line, percent (0-100).';
COMMENT ON COLUMN nlq.purchase_order_lines.gst_rate IS 'GST rate of the line, percent (0, 5, 12, 18, 28 ...).';
COMMENT ON COLUMN nlq.purchase_order_lines.amount IS 'Line value before GST in rupees: qty x rate less discount.';
COMMENT ON COLUMN nlq.purchase_order_lines.tax IS 'GST charged on the line in rupees (CGST + SGST + IGST; 0 for unregistered, composition, exempt or reverse-charge lines).';
COMMENT ON COLUMN nlq.purchase_order_lines.line_total IS 'Line value with GST in rupees (amount + tax).';
COMMENT ON COLUMN nlq.purchase_order_lines.is_rate_contract IS 'True when the line was bought on a rate contract.';
COMMENT ON COLUMN nlq.purchase_order_lines.accepted_qty IS 'Quantity accepted at inspection so far, in unit.';
COMMENT ON COLUMN nlq.purchase_order_lines.qty_still_to_come IS 'Quantity still to be delivered, in unit (ordered less what came in and was not rejected or sent back); 0 for a closed PO.';
COMMENT ON COLUMN nlq.purchase_order_lines.qty_in_store_units IS 'qty converted to the store unit the stock views use (e.g. a box of 10 pieces = 10); empty for a line in words.';

-- nlq.purchase_orders: one row is a placed purchase order to one vendor, in its revision now in force.
-- Rules: only approved / sent / closed POs count (drafts, waiting, sent back, rejected, cancelled, superseded left out).
GRANT SELECT ON purchase_orders, vendors, departments, purchase_requisitions TO edupro_nlq_owner;
CREATE VIEW nlq.purchase_orders WITH (security_barrier = true) AS
SELECT x.id AS order_id,
       x.number || CASE WHEN x.revision > 0 THEN '-R' || x.revision ELSE '' END AS po_no,
       x.revision,
       x.po_date,
       date_trunc('month', x.po_date)::date AS month,
       to_char(x.po_date - interval '3 months', 'YYYY') || '-' || to_char(x.po_date + interval '9 months', 'YY') AS financial_year,
       x.status,
       x.emergency AS is_emergency,
       x.vendor_id,
       v.code AS vendor_code,
       v.legal_name AS vendor,
       v.msme_type AS vendor_msme_type,
       x.vendor_gst_status,
       x.supply AS gst_supply,
       x.department_id,
       COALESCE(d.name, 'No department') AS department,
       r.number AS requisition_no,
       x.delivery_date,
       x.receipt_status,
       (x.status IN ('approved', 'sent') AND x.receipt_status <> 'received'
         AND x.delivery_date < (now() AT TIME ZONE 'Asia/Kolkata')::date) AS is_delivery_late,
       (x.approved_at AT TIME ZONE 'Asia/Kolkata')::date AS approved_on,
       (x.sent_at AT TIME ZONE 'Asia/Kolkata')::date AS sent_on,
       (x.closed_at AT TIME ZONE 'Asia/Kolkata')::date AS closed_on,
       x.taxable,
       x.cgst + x.sgst + x.igst AS tax,
       x.rcm_gst AS reverse_charge_gst,
       x.total
  FROM purchase_orders x
  JOIN vendors v ON v.id = x.vendor_id
  LEFT JOIN departments d ON d.id = x.department_id
  LEFT JOIN purchase_requisitions r ON r.id = x.requisition_id
 WHERE x.school_id = app.nlq_school_id()
   AND x.status IN ('approved', 'sent', 'closed')
   AND NOT EXISTS (SELECT 1 FROM purchase_orders n
                    WHERE n.supersedes_id = x.id AND n.status IN ('approved', 'sent', 'closed'));
ALTER VIEW nlq.purchase_orders OWNER TO edupro_nlq_owner;
GRANT SELECT ON nlq.purchase_orders TO edupro_nlq;
COMMENT ON VIEW nlq.purchase_orders IS 'One row is a placed purchase order (PO) to one vendor: approved, sent to the vendor, or closed. This is what the school has committed to buy, i.e. purchase spend. Left out: drafts, POs waiting for approval, sent back, rejected, cancelled, and old revisions replaced by an amendment (only the revision in force is kept, so each PO number appears once). Use: sum total for spend (rupees, with GST, rounded to the rupee); group by department, vendor, month or financial_year; filter on po_date (the order date). The year is the Indian financial year April to March (financial_year like 2026-27), not the academic year. total includes freight and other charges and leaves out reverse_charge_gst. Join nlq.purchase_order_lines on order_id for the items.';
COMMENT ON COLUMN nlq.purchase_orders.order_id IS 'Id of the purchase order; join key to nlq.purchase_order_lines.order_id.';
COMMENT ON COLUMN nlq.purchase_orders.po_no IS 'The PO number as printed, e.g. PO/2026-27/0012, with -R1, -R2 for an amended order.';
COMMENT ON COLUMN nlq.purchase_orders.revision IS 'Amendment number: 0 for the first version, 1, 2 for each amendment.';
COMMENT ON COLUMN nlq.purchase_orders.po_date IS 'Date of the purchase order. Filter and group spend on this date.';
COMMENT ON COLUMN nlq.purchase_orders.month IS 'First day of the month of po_date, for grouping by month.';
COMMENT ON COLUMN nlq.purchase_orders.financial_year IS 'Indian financial year of po_date (April to March), text like 2026-27. PO numbers restart each financial year.';
COMMENT ON COLUMN nlq.purchase_orders.status IS 'approved (approved, not yet e-mailed), sent (e-mailed to the vendor), closed (received and accepted in full, or closed short by hand).';
COMMENT ON COLUMN nlq.purchase_orders.is_emergency IS 'True for an emergency purchase recorded after the fact with the vendor bill and ratified.';
COMMENT ON COLUMN nlq.purchase_orders.vendor_id IS 'Id of the vendor.';
COMMENT ON COLUMN nlq.purchase_orders.vendor_code IS 'Vendor code, e.g. V-0007.';
COMMENT ON COLUMN nlq.purchase_orders.vendor IS 'Vendor legal name (as it is now in the vendor master).';
COMMENT ON COLUMN nlq.purchase_orders.vendor_msme_type IS 'micro, small or medium for an MSME vendor, empty otherwise. Micro and small vendors must be paid within 45 days of acceptance.';
COMMENT ON COLUMN nlq.purchase_orders.vendor_gst_status IS 'Vendor GST registration when the PO was worked out: regular, composition or unregistered (composition and unregistered vendors charge no GST).';
COMMENT ON COLUMN nlq.purchase_orders.gst_supply IS 'intra (vendor in the school state: CGST + SGST) or inter (another state: IGST).';
COMMENT ON COLUMN nlq.purchase_orders.department_id IS 'Id of the department the PO is booked to.';
COMMENT ON COLUMN nlq.purchase_orders.department IS 'Department the PO is booked to (No department when none). A PO from a combined requisition of several departments is booked to the purchase office department.';
COMMENT ON COLUMN nlq.purchase_orders.requisition_no IS 'Number of the purchase requisition (PR) it came from, e.g. PR/2026-27/0004; empty for an emergency purchase.';
COMMENT ON COLUMN nlq.purchase_orders.delivery_date IS 'Date the goods are due.';
COMMENT ON COLUMN nlq.purchase_orders.receipt_status IS 'Delivery so far: none (nothing received), part (some received), received (everything ordered has come).';
COMMENT ON COLUMN nlq.purchase_orders.is_delivery_late IS 'True when the PO is approved or sent, not fully received, and its delivery_date is before today.';
COMMENT ON COLUMN nlq.purchase_orders.approved_on IS 'Date the PO was approved (India time).';
COMMENT ON COLUMN nlq.purchase_orders.sent_on IS 'Date the PO was e-mailed to the vendor; empty if never sent.';
COMMENT ON COLUMN nlq.purchase_orders.closed_on IS 'Date the PO was closed; empty while open.';
COMMENT ON COLUMN nlq.purchase_orders.taxable IS 'Value before GST in rupees: the lines (quantity x rate less discount) plus freight, installation, packing and other charges.';
COMMENT ON COLUMN nlq.purchase_orders.tax IS 'GST charged by the vendor in rupees (CGST + SGST + IGST).';
COMMENT ON COLUMN nlq.purchase_orders.reverse_charge_gst IS 'GST the school pays itself under reverse charge, in rupees. Not part of total.';
COMMENT ON COLUMN nlq.purchase_orders.total IS 'What the vendor is paid in rupees: taxable + tax, rounded to the rupee. Sum this for spend.';

-- nlq.section_attendance: one row is one class-section's day register on one school day, counted from the base
-- tables (not mart.attendance_daily, which counts leave as present): present = every code but A and LV. Left out:
-- subject-period registers; marks of removed / merged / erased students and of cancelled admissions.
GRANT SELECT ON attendance_sessions, attendance_marks, students, enrolments, class_sections, classes, academic_years, users, user_school_memberships TO edupro_nlq_owner;
CREATE VIEW nlq.section_attendance WITH (security_barrier = true) AS
SELECT x.class_section_id,
       x.academic_year_id,
       y.code                                                        AS academic_year,
       k.name                                                        AS class,
       k.display_order                                               AS class_order,
       cs.name                                                       AS section,
       k.code || '-' || cs.name                                      AS class_section,
       x.on_date,
       date_trunc('month', x.on_date)::date                          AS month,
       COALESCE(c.marked, 0)                                         AS marked,
       COALESCE(c.present, 0)                                        AS present,
       COALESCE(c.absent, 0)                                         AS absent,
       COALESCE(c.on_leave, 0)                                       AS on_leave,
       COALESCE(c.late, 0)                                           AS late,
       COALESCE(c.half_day, 0)                                       AS half_day,
       round(100.0 * c.present / NULLIF(c.marked, 0), 1)             AS present_pct,
       x.marked_late,
       x.locked                                                      AS is_locked,
       x.source::text                                                AS source,
       u.display_name                                                AS marked_by
  FROM attendance_sessions x
  JOIN academic_years y  ON y.id = x.academic_year_id
  JOIN class_sections cs ON cs.id = x.class_section_id
  JOIN classes k         ON k.id = cs.class_id
  LEFT JOIN users u      ON u.id = x.marked_by
  LEFT JOIN LATERAL (
    SELECT count(*)                                            AS marked,
           count(*) FILTER (WHERE m.code NOT IN ('A', 'LV'))   AS present,
           count(*) FILTER (WHERE m.code = 'A')                AS absent,
           count(*) FILTER (WHERE m.code = 'LV')               AS on_leave,
           count(*) FILTER (WHERE m.code = 'L')                AS late,
           count(*) FILTER (WHERE m.code = 'H')                AS half_day
      FROM attendance_marks m
      JOIN students s        ON s.id = m.student_id
      LEFT JOIN enrolments e ON e.student_id = m.student_id AND e.academic_year_id = x.academic_year_id
     WHERE m.session_id = x.id
       AND s.deleted_at IS NULL AND s.merged_into_id IS NULL AND NOT (s.details ? 'erased_at')
       AND e.status IS DISTINCT FROM 'cancelled') c ON true
 WHERE x.school_id = app.nlq_school_id()
   AND x.kind = 'day';
ALTER VIEW nlq.section_attendance OWNER TO edupro_nlq_owner;
GRANT SELECT ON nlq.section_attendance TO edupro_nlq;
COMMENT ON VIEW nlq.section_attendance IS 'One row is one class-section''s day register (daily attendance) taken on one school day, with its counts. Counted live from the registers (not from the 15-minute summary), by the register''s own rule: present = every code except A (absent) and LV (approved leave), so late, half day, short leave, on duty and stay back are present; leave is counted apart in on_leave. Only registers that were taken appear: a section with no row on a working day has not marked its attendance (compare with nlq.class_sections of the current year), and holidays have no rows. Subject-period attendance is not here. Marks of removed, merged or erased student records and of cancelled admissions are left out. For a class or the school, add the counts and work the % from the sums: 100 * sum(present) / sum(marked); never average present_pct. Filter on on_date (a date range is fastest; month is for grouping). For pupil-level questions use nlq.attendance_days.';
COMMENT ON COLUMN nlq.section_attendance.class_section_id IS 'The class-section''s id; join key to nlq.class_sections and nlq.attendance_days.';
COMMENT ON COLUMN nlq.section_attendance.academic_year_id IS 'The academic year of the register; join key to nlq.academic_years.';
COMMENT ON COLUMN nlq.section_attendance.academic_year IS 'The academic year code, e.g. 2026-27.';
COMMENT ON COLUMN nlq.section_attendance.class IS 'The class, e.g. VI. Sort by class_order.';
COMMENT ON COLUMN nlq.section_attendance.class_order IS 'The class''s position for sorting (lower = junior).';
COMMENT ON COLUMN nlq.section_attendance.section IS 'The section, e.g. A.';
COMMENT ON COLUMN nlq.section_attendance.class_section IS 'Class and section, e.g. VI-A.';
COMMENT ON COLUMN nlq.section_attendance.on_date IS 'The school day of the register (India date).';
COMMENT ON COLUMN nlq.section_attendance.month IS 'First day of the month of on_date; group by it for month-wise figures.';
COMMENT ON COLUMN nlq.section_attendance.marked IS 'Pupils marked in the register that day (count). Pupils on the roll but not marked are not counted anywhere.';
COMMENT ON COLUMN nlq.section_attendance.present IS 'Pupils counted present (count): codes P, L, SR, H, OD, SB.';
COMMENT ON COLUMN nlq.section_attendance.absent IS 'Pupils marked absent, code A (count).';
COMMENT ON COLUMN nlq.section_attendance.on_leave IS 'Pupils on approved leave, code LV (count); not present, not absent.';
COMMENT ON COLUMN nlq.section_attendance.late IS 'Pupils marked late, code L (count); they are also in present.';
COMMENT ON COLUMN nlq.section_attendance.half_day IS 'Pupils marked half day, code H (count); they are also in present (a whole day).';
COMMENT ON COLUMN nlq.section_attendance.present_pct IS 'Present as a % of pupils marked that day (0-100), one decimal. For several days or sections compute 100 * sum(present) / sum(marked) instead of averaging this.';
COMMENT ON COLUMN nlq.section_attendance.marked_late IS 'True when the register was saved after the school''s marking time (by the office, on a reopened day, or a day late).';
COMMENT ON COLUMN nlq.section_attendance.is_locked IS 'True when the register is locked against further changes.';
COMMENT ON COLUMN nlq.section_attendance.source IS 'How the register was started: manual (by the teacher), rfid (gate card readers) or upload (an Excel list).';
COMMENT ON COLUMN nlq.section_attendance.marked_by IS 'Name of the person who last saved the register (usually the class teacher); empty when not known.';

-- nlq.staff_attendance_days: one row is one employee's worked-out attendance day (from punches, the office, an approved
-- correction, leave, the weekly-off / holiday marking or the nightly absent marking). A day with no row is "not
-- marked" (never absent). Present counts as the reports count it (P 1, HD 0.5, on-duty / work-from-home leave 1, the
-- worked half of a half day of leave 0.5). Removed and erased employees are left out.
GRANT SELECT ON staff_attendance_days, employees, staff_leave_types, staff_shifts, staff_missing_punches,
  staff_month_locks, staff_report_exclusions TO edupro_nlq_owner;
CREATE VIEW nlq.staff_attendance_days WITH (security_barrier = true) AS
SELECT x.employee_id,
       e.employee_code,
       e.display_name                                                         AS employee_name,
       COALESCE(NULLIF(btrim(e.department), ''), 'No department')            AS department,
       NULLIF(btrim(e.designation), '')                                       AS designation,
       x.day                                                                  AS attendance_date,
       date_trunc('month', x.day)::date                                       AS month,
       to_char(x.day - interval '3 months', 'YYYY') || '-' || to_char(x.day + interval '9 months', 'YY') AS financial_year,
       x.day_type,
       CASE x.day_type WHEN 'P' THEN 'Present' WHEN 'HD' THEN 'Half day' WHEN 'A' THEN 'Absent'
                       WHEN 'WO' THEN 'Weekly off' WHEN 'H' THEN 'Holiday' WHEN 'LV' THEN 'Leave'
                       WHEN 'HOLD' THEN 'Salary hold' END                     AS day_status,
       t.code                                                                 AS leave_type,
       t.name                                                                 AS leave_type_name,
       x.leave_portion                                                        AS leave_days,
       (CASE x.day_type WHEN 'P' THEN 1 WHEN 'HD' THEN 0.5
                        WHEN 'LV' THEN CASE WHEN COALESCE(t.counts_present, false) THEN 1
                                            ELSE 1 - COALESCE(x.leave_portion, 1) END
                        ELSE 0 END)::numeric                                  AS present_days,
       (x.day_type IN ('P', 'HD') OR (x.day_type = 'LV' AND COALESCE(t.counts_present, false))) AS is_present,
       (x.day_type = 'A')                                                     AS is_absent,
       (x.day_type = 'LV' AND NOT COALESCE(t.counts_present, false))          AS on_leave,
       (x.day_type = 'HD' OR (x.day_type = 'LV' AND COALESCE(x.leave_portion, 1) = 0.5)) AS is_half_day,
       (x.day_type IN ('WO', 'H'))                                            AS is_off_day,
       (x.day_type = 'HOLD')                                                  AS is_salary_hold,
       (CASE WHEN x.day_type = 'LV' AND NOT COALESCE(t.loss_of_pay, false) AND NOT COALESCE(t.counts_present, false)
             THEN COALESCE(x.leave_portion, 1) ELSE 0 END)::numeric           AS paid_leave_days,
       (CASE WHEN x.day_type = 'LV' AND COALESCE(t.loss_of_pay, false)
             THEN COALESCE(x.leave_portion, 1) ELSE 0 END)::numeric           AS loss_of_pay_days,
       to_char(x.in_at AT TIME ZONE 'Asia/Kolkata', 'HH24:MI')                AS in_time,
       to_char(x.out_at AT TIME ZONE 'Asia/Kolkata', 'HH24:MI')               AS out_time,
       x.worked_hours,
       x.ot_hours                                                             AS overtime_hours,
       x.late_minutes,
       x.early_minutes,
       (x.late_minutes > 0)                                                   AS is_late,
       mp.missing                                                             AS missing_punch,
       sh.code                                                                AS shift,
       CASE x.source WHEN 'punches' THEN 'Punches' WHEN 'manual' THEN 'Set by the office'
                     WHEN 'bulk' THEN 'Bulk update' WHEN 'regularisation' THEN 'Approved correction'
                     WHEN 'weekoff' THEN 'Weekly off' WHEN 'holiday' THEN 'Holiday'
                     WHEN 'absent' THEN 'Marked absent (no punch, no leave)' WHEN 'leave' THEN 'Approved leave'
                     WHEN 'import' THEN 'Imported from the old module' END   AS worked_out_from,
       (x.manual AND x.source <> 'import')                                    AS set_by_hand,
       COALESCE(lk.locked, false)                                             AS month_locked,
       (ex.employee_id IS NULL)                                               AS counted_in_reports
  FROM staff_attendance_days x
  JOIN employees e              ON e.id = x.employee_id
  LEFT JOIN staff_leave_types t ON t.id = x.leave_type_id
  LEFT JOIN staff_shifts sh     ON sh.id = x.shift_id
  LEFT JOIN staff_missing_punches mp ON mp.employee_id = x.employee_id AND mp.day = x.day
        AND mp.status IN ('pending', 'used')
  LEFT JOIN staff_month_locks lk ON lk.month = date_trunc('month', x.day)::date
  LEFT JOIN (SELECT DISTINCT r.employee_id FROM staff_report_exclusions r WHERE r.status = 'active') ex
         ON ex.employee_id = x.employee_id
 WHERE x.school_id = app.nlq_school_id()
   AND e.deleted_at IS NULL
   AND NOT (e.details ? 'erased_at');
ALTER VIEW nlq.staff_attendance_days OWNER TO edupro_nlq_owner;
GRANT SELECT ON nlq.staff_attendance_days TO edupro_nlq;
COMMENT ON VIEW nlq.staff_attendance_days IS 'One row is one employee''s attendance day as the school''s staff attendance register shows it (staff, not pupils). A day with NO row is "not marked" (not worked out yet) and must never be counted as absent; today and future days usually have no row. Filter attendance_date (or month) for the period. Sum present_days for days present (half days count 0.5); count is_absent for absences; Attendance % = 100 * (sum(present_days) + sum(paid_leave_days)) / working days, working days = count(*) FILTER (WHERE NOT is_off_day) (the school''s reports also count past days not marked as working days, so their % can be lower). To match the school''s reports add counted_in_reports = true (staff on the "Not required" list are false). Leave the system charged for late marks or missing punches does NOT change the day (it stays present): for leave and loss-of-pay totals use nlq.staff_leave_days. Join to nlq.staff on employee_id.';
COMMENT ON COLUMN nlq.staff_attendance_days.employee_id IS 'The employee''s id (join to nlq.staff).';
COMMENT ON COLUMN nlq.staff_attendance_days.employee_code IS 'The employee code.';
COMMENT ON COLUMN nlq.staff_attendance_days.employee_name IS 'The employee''s name.';
COMMENT ON COLUMN nlq.staff_attendance_days.department IS 'The department on the employee record today; ''No department'' when empty.';
COMMENT ON COLUMN nlq.staff_attendance_days.designation IS 'The designation on the employee record today.';
COMMENT ON COLUMN nlq.staff_attendance_days.attendance_date IS 'The school day (India date). A night shift''s day is the day the shift starts.';
COMMENT ON COLUMN nlq.staff_attendance_days.month IS 'First day of the month of attendance_date; group by it for monthly figures.';
COMMENT ON COLUMN nlq.staff_attendance_days.financial_year IS 'The financial (leave) year of the day, April to March, e.g. 2026-27.';
COMMENT ON COLUMN nlq.staff_attendance_days.day_type IS 'The day''s code: P present, HD half day, A absent, WO weekly off, H holiday, LV leave, HOLD salary hold.';
COMMENT ON COLUMN nlq.staff_attendance_days.day_status IS 'The day in words: Present, Half day, Absent, Weekly off, Holiday, Leave, Salary hold.';
COMMENT ON COLUMN nlq.staff_attendance_days.leave_type IS 'For a leave day: the leave type code (CL, EL, SL, OD, WFH, LOP …); empty otherwise.';
COMMENT ON COLUMN nlq.staff_attendance_days.leave_type_name IS 'For a leave day: the leave type name (Casual leave …); empty otherwise.';
COMMENT ON COLUMN nlq.staff_attendance_days.leave_days IS 'For a leave day: 1 for a whole day, 0.5 for half a day; empty otherwise.';
COMMENT ON COLUMN nlq.staff_attendance_days.present_days IS 'What the day counts as present, in days: P 1, HD 0.5, on duty / work from home 1, the worked half of a half day of leave 0.5, else 0. Sum it.';
COMMENT ON COLUMN nlq.staff_attendance_days.is_present IS 'True for a present or half day, or on-duty / work-from-home leave.';
COMMENT ON COLUMN nlq.staff_attendance_days.is_absent IS 'True for an absent day (A): no punch, no leave and no correction.';
COMMENT ON COLUMN nlq.staff_attendance_days.on_leave IS 'True for a day of leave away from work (on duty and work from home are not counted as leave).';
COMMENT ON COLUMN nlq.staff_attendance_days.is_half_day IS 'True for a half day (HD) or a half day of leave.';
COMMENT ON COLUMN nlq.staff_attendance_days.is_off_day IS 'True for a weekly off or holiday (not a working day).';
COMMENT ON COLUMN nlq.staff_attendance_days.is_salary_hold IS 'True for a salary-hold day (HOLD).';
COMMENT ON COLUMN nlq.staff_attendance_days.paid_leave_days IS 'Days of paid leave on this day (1 or 0.5; on duty / work from home not included).';
COMMENT ON COLUMN nlq.staff_attendance_days.loss_of_pay_days IS 'Days of loss-of-pay leave shown on this day (1 or 0.5). Loss of pay charged for late marks is not here; see nlq.staff_leave_days.';
COMMENT ON COLUMN nlq.staff_attendance_days.in_time IS 'First IN, India time as HH:MI; empty when there was no punch.';
COMMENT ON COLUMN nlq.staff_attendance_days.out_time IS 'Last OUT, India time as HH:MI; empty when there was no out punch.';
COMMENT ON COLUMN nlq.staff_attendance_days.worked_hours IS 'Hours between IN and OUT, in hours (e.g. 7.5).';
COMMENT ON COLUMN nlq.staff_attendance_days.overtime_hours IS 'Overtime hours counted on the day (only shifts with overtime), in hours; 0 when none.';
COMMENT ON COLUMN nlq.staff_attendance_days.late_minutes IS 'Minutes late after the shift start and grace; 0 when on time.';
COMMENT ON COLUMN nlq.staff_attendance_days.early_minutes IS 'Minutes left before the shift end; 0 when not early.';
COMMENT ON COLUMN nlq.staff_attendance_days.is_late IS 'True when the employee came in late (late_minutes > 0).';
COMMENT ON COLUMN nlq.staff_attendance_days.missing_punch IS 'in or out when a punch of a working day is missing (still open or already turned into leave); empty otherwise.';
COMMENT ON COLUMN nlq.staff_attendance_days.shift IS 'The shift code the day was measured by (e.g. GEN, BUS); empty when none.';
COMMENT ON COLUMN nlq.staff_attendance_days.worked_out_from IS 'How the day was set: Punches, Set by the office, Bulk update, Approved correction, Weekly off, Holiday, Marked absent (no punch, no leave), Approved leave, Imported from the old module.';
COMMENT ON COLUMN nlq.staff_attendance_days.set_by_hand IS 'True when a person set the day (office correction, bulk update, upload, approved correction); the punches no longer change it.';
COMMENT ON COLUMN nlq.staff_attendance_days.month_locked IS 'True when the month is locked for payroll (its days no longer change).';
COMMENT ON COLUMN nlq.staff_attendance_days.counted_in_reports IS 'False for staff on the school''s "Not required" list, whom the leave and attendance reports leave out; filter true to match those reports.';

-- nlq.staff_leave_balances: one row is the leave ledger of one employee × leave type × month (types that keep a
-- balance only). balance = closing once the month is closed, else opening + credited + correction − used (never
-- below 0); used = days held by leave raised in that month (pending or approved). Removed and erased employees out.
GRANT SELECT ON staff_leave_balances, staff_leave_types, employees, staff_leave_requests TO edupro_nlq_owner;
CREATE VIEW nlq.staff_leave_balances WITH (security_barrier = true) AS
SELECT x.employee_id,
       e.employee_code,
       e.display_name                                                         AS employee_name,
       COALESCE(NULLIF(btrim(e.department), ''), 'No department')            AS department,
       NULLIF(btrim(e.designation), '')                                       AS designation,
       (e.status = 'active'
        AND (e.left_on IS NULL OR e.left_on >= (now() AT TIME ZONE 'Asia/Kolkata')::date)) AS employee_is_current,
       t.code                                                                 AS leave_type,
       t.name                                                                 AS leave_type_name,
       x.month,
       to_char(x.month - interval '3 months', 'YYYY') || '-' || to_char(x.month + interval '9 months', 'YY') AS financial_year,
       x.opening,
       x.credited,
       x.held                                                                 AS used,
       COALESCE(p.days, 0)::numeric(8,2)                                      AS used_pending,
       x.correction,
       x.lapsed,
       CASE WHEN x.closed THEN x.closing
            ELSE GREATEST(0, x.opening + x.credited + x.correction - x.held) END AS balance,
       x.closed                                                               AS is_closed,
       x.imported                                                             AS is_imported,
       NOT EXISTS (SELECT 1 FROM staff_leave_balances n
                    WHERE n.employee_id = x.employee_id AND n.leave_type_id = x.leave_type_id
                      AND n.month > x.month)                                  AS is_latest
  FROM staff_leave_balances x
  JOIN employees e         ON e.id = x.employee_id
  JOIN staff_leave_types t ON t.id = x.leave_type_id
  LEFT JOIN (SELECT r.employee_id, r.leave_type_id, r.held_month, sum(r.days) AS days
               FROM staff_leave_requests r
              WHERE r.status = 'pending' AND r.held_month IS NOT NULL
              GROUP BY r.employee_id, r.leave_type_id, r.held_month) p
         ON p.employee_id = x.employee_id AND p.leave_type_id = x.leave_type_id AND p.held_month = x.month
 WHERE x.school_id = app.nlq_school_id()
   AND e.deleted_at IS NULL
   AND NOT (e.details ? 'erased_at');
ALTER VIEW nlq.staff_leave_balances OWNER TO edupro_nlq_owner;
GRANT SELECT ON nlq.staff_leave_balances TO edupro_nlq;
COMMENT ON VIEW nlq.staff_leave_balances IS 'One row is the leave ledger of one employee × leave type × month, for leave types that keep a balance (e.g. CL, EL, SL, HPL, CO; on duty, maternity and loss of pay have none). The balance now = the row with is_latest = true (the month-end job opens the current month every night; a type with no row has no balance). balance is the closing once the month is closed, else opening + credited + correction − used. used = days of leave RAISED in that month (pending or approved, whatever the leave''s dates), so it is not "leave taken in that month": for leave taken in a period use nlq.staff_leave_days. Do not add balances across months (each month carries the last). Days lapse only in the leave-session''s last month (usually March). Join to nlq.staff on employee_id.';
COMMENT ON COLUMN nlq.staff_leave_balances.employee_id IS 'The employee''s id (join to nlq.staff).';
COMMENT ON COLUMN nlq.staff_leave_balances.employee_code IS 'The employee code.';
COMMENT ON COLUMN nlq.staff_leave_balances.employee_name IS 'The employee''s name.';
COMMENT ON COLUMN nlq.staff_leave_balances.department IS 'The department on the employee record today; ''No department'' when empty.';
COMMENT ON COLUMN nlq.staff_leave_balances.designation IS 'The designation on the employee record today.';
COMMENT ON COLUMN nlq.staff_leave_balances.employee_is_current IS 'True when the employee is still in service today; add it for "balances of our staff".';
COMMENT ON COLUMN nlq.staff_leave_balances.leave_type IS 'The leave type code, e.g. CL, EL, SL, HPL, CO.';
COMMENT ON COLUMN nlq.staff_leave_balances.leave_type_name IS 'The leave type name, e.g. Casual leave.';
COMMENT ON COLUMN nlq.staff_leave_balances.month IS 'The ledger month (first day of the month).';
COMMENT ON COLUMN nlq.staff_leave_balances.financial_year IS 'The leave (financial) year of the month, April to March, e.g. 2026-27.';
COMMENT ON COLUMN nlq.staff_leave_balances.opening IS 'Days at the start of the month (the month before''s closing, or an imported opening balance).';
COMMENT ON COLUMN nlq.staff_leave_balances.credited IS 'Days credited this month (only in the policy''s credit months, e.g. April and October), in days.';
COMMENT ON COLUMN nlq.staff_leave_balances.used IS 'Days held by leave raised this month, pending or approved (the ledger''s "availed"); given back when a leave is rejected, withdrawn, cancelled or shortened.';
COMMENT ON COLUMN nlq.staff_leave_balances.used_pending IS 'The part of used held by leave still waiting for approval, in days.';
COMMENT ON COLUMN nlq.staff_leave_balances.correction IS 'Days added (+) or taken off (−) by the office this month, and days given back after their month was closed.';
COMMENT ON COLUMN nlq.staff_leave_balances.lapsed IS 'Days lapsed when the month closed (only at the leave session''s end, above the carry-forward cap).';
COMMENT ON COLUMN nlq.staff_leave_balances.balance IS 'Days left: the closing for a closed month; for an open month opening + credited + correction − used (not below 0).';
COMMENT ON COLUMN nlq.staff_leave_balances.is_closed IS 'True when the month has been closed by the month-end job (its figures are final).';
COMMENT ON COLUMN nlq.staff_leave_balances.is_imported IS 'True when the opening came from an import (opening balances or the move from the old leave module).';
COMMENT ON COLUMN nlq.staff_leave_balances.is_latest IS 'True for the latest month of this employee and leave type: filter it for the balance now.';

-- nlq.staff_leave_days: one row is one approved day (or half day) of staff leave: employee × day × leave application.
-- Only approved day rows: pending, rejected, withdrawn and cancelled leave and the days cut off a shortened leave are
-- left out; the system's deductions (late marks, missing punches, absence) are in. Removed and erased employees out.
GRANT SELECT ON staff_leave_days, staff_leave_requests, staff_leave_types, employees, staff_report_exclusions
  TO edupro_nlq_owner;
CREATE VIEW nlq.staff_leave_days WITH (security_barrier = true) AS
SELECT x.employee_id,
       e.employee_code,
       e.display_name                                                         AS employee_name,
       COALESCE(NULLIF(btrim(e.department), ''), 'No department')            AS department,
       NULLIF(btrim(e.designation), '')                                       AS designation,
       x.day                                                                  AS leave_date,
       date_trunc('month', x.day)::date                                       AS month,
       to_char(x.day - interval '3 months', 'YYYY') || '-' || to_char(x.day + interval '9 months', 'YY') AS financial_year,
       t.code                                                                 AS leave_type,
       t.name                                                                 AS leave_type_name,
       x.portion                                                              AS days,
       (x.portion < 1)                                                        AS is_half_day,
       CASE x.session WHEN 'first' THEN 'First half' WHEN 'second' THEN 'Second half' END AS half,
       (t.paid AND NOT t.loss_of_pay)                                         AS is_paid,
       t.loss_of_pay                                                          AS is_loss_of_pay,
       t.counts_present                                                       AS counts_as_present,
       COALESCE(t.pay_percent, CASE WHEN t.loss_of_pay THEN 0 ELSE 100 END)   AS pay_percent,
       CASE x.kind WHEN 'work' THEN 'Working day' WHEN 'weekoff' THEN 'Weekly off (sandwich)'
                   WHEN 'holiday' THEN 'Holiday (sandwich)' WHEN 'optional' THEN 'Optional holiday' END AS day_kind,
       (x.kind = 'work')                                                      AS is_working_day,
       x.request_id,
       r.number                                                               AS leave_number,
       r.from_date                                                            AS leave_from,
       r.to_date                                                              AS leave_to,
       (r.created_at AT TIME ZONE 'Asia/Kolkata')::date                       AS applied_on,
       CASE r.source WHEN 'self' THEN 'By the employee' WHEN 'on_behalf' THEN 'By the office'
                     WHEN 'auto_late' THEN 'For late marks' WHEN 'auto_missing' THEN 'For missing punches'
                     WHEN 'auto_absent' THEN 'For absence with no leave' WHEN 'auto_rule' THEN 'By the shift''s late / early rule'
                     WHEN 'import' THEN 'Imported from the old module' END   AS how_applied,
       (r.source IN ('auto_late', 'auto_missing', 'auto_absent', 'auto_rule')) AS is_system_deduction,
       (r.cancel_status = 'pending')                                          AS cancellation_asked,
       (ex.employee_id IS NULL)                                               AS counted_in_reports
  FROM staff_leave_days x
  JOIN staff_leave_requests r ON r.id = x.request_id
  JOIN staff_leave_types t    ON t.id = r.leave_type_id
  JOIN employees e            ON e.id = x.employee_id
  LEFT JOIN (SELECT DISTINCT q.employee_id FROM staff_report_exclusions q WHERE q.status = 'active') ex
         ON ex.employee_id = x.employee_id
 WHERE x.school_id = app.nlq_school_id()
   AND x.status = 'approved'
   AND e.deleted_at IS NULL
   AND NOT (e.details ? 'erased_at');
ALTER VIEW nlq.staff_leave_days OWNER TO edupro_nlq_owner;
GRANT SELECT ON nlq.staff_leave_days TO edupro_nlq;
COMMENT ON VIEW nlq.staff_leave_days IS 'One row is one approved day (or half day) of staff leave: employee × day × leave application. Pending, rejected, withdrawn and cancelled leave and days cut off a shortened leave are left out; leave the system charged (for late marks, missing punches, absence) is included. Days taken = sum(days) (a half day is 0.5) — never count rows. Filter leave_date / month / financial_year (the leave year runs April to March). Weekly offs and holidays charged by the sandwich rule are rows too; for working days lost add is_working_day = true. On duty and work from home (counts_as_present) are leave types but the person was working: leave them out of "absent on leave" questions. A day may have two rows (two half days). One application = one leave_number; a leave split for a short balance has a paid part and a loss-of-pay part with different numbers. To match the school''s reports add counted_in_reports = true. Join to nlq.staff on employee_id; to nlq.staff_attendance_days on (employee_id, leave_date = attendance_date).';
COMMENT ON COLUMN nlq.staff_leave_days.employee_id IS 'The employee''s id (join to nlq.staff).';
COMMENT ON COLUMN nlq.staff_leave_days.employee_code IS 'The employee code.';
COMMENT ON COLUMN nlq.staff_leave_days.employee_name IS 'The employee''s name.';
COMMENT ON COLUMN nlq.staff_leave_days.department IS 'The department on the employee record today; ''No department'' when empty.';
COMMENT ON COLUMN nlq.staff_leave_days.designation IS 'The designation on the employee record today.';
COMMENT ON COLUMN nlq.staff_leave_days.leave_date IS 'The day of leave (India date).';
COMMENT ON COLUMN nlq.staff_leave_days.month IS 'First day of the month of leave_date; group by it for monthly figures.';
COMMENT ON COLUMN nlq.staff_leave_days.financial_year IS 'The leave (financial) year of the day, April to March, e.g. 2026-27.';
COMMENT ON COLUMN nlq.staff_leave_days.leave_type IS 'The leave type code: e.g. CL casual, EL earned, SL sick, HPL half pay, CO compensatory off, OD on duty, WFH work from home, ML maternity, PL paternity, LOP loss of pay (each school may have its own).';
COMMENT ON COLUMN nlq.staff_leave_days.leave_type_name IS 'The leave type name, e.g. Casual leave.';
COMMENT ON COLUMN nlq.staff_leave_days.days IS 'Days of leave on this row: 1 whole day or 0.5 half day. Sum it for days taken.';
COMMENT ON COLUMN nlq.staff_leave_days.is_half_day IS 'True for half a day of leave.';
COMMENT ON COLUMN nlq.staff_leave_days.half IS 'For a half day: First half or Second half; empty for a whole day.';
COMMENT ON COLUMN nlq.staff_leave_days.is_paid IS 'True for paid leave (not loss of pay).';
COMMENT ON COLUMN nlq.staff_leave_days.is_loss_of_pay IS 'True for loss-of-pay (unpaid) leave.';
COMMENT ON COLUMN nlq.staff_leave_days.counts_as_present IS 'True for on duty / work from home: counted as present, not as absence.';
COMMENT ON COLUMN nlq.staff_leave_days.pay_percent IS 'The share of pay for the day in %: 100 for paid leave, 50 for half-pay leave, 0 for loss of pay.';
COMMENT ON COLUMN nlq.staff_leave_days.day_kind IS 'Working day, Weekly off (sandwich), Holiday (sandwich) or Optional holiday: off days are charged when the policy''s sandwich rule counts them.';
COMMENT ON COLUMN nlq.staff_leave_days.is_working_day IS 'True when the leave day is a working day (not an off day charged by the sandwich rule).';
COMMENT ON COLUMN nlq.staff_leave_days.request_id IS 'The leave application''s id; count applications with count(DISTINCT request_id).';
COMMENT ON COLUMN nlq.staff_leave_days.leave_number IS 'The leave application number, e.g. LV/2026-27/00042.';
COMMENT ON COLUMN nlq.staff_leave_days.leave_from IS 'First day of the whole application.';
COMMENT ON COLUMN nlq.staff_leave_days.leave_to IS 'Last day of the whole application.';
COMMENT ON COLUMN nlq.staff_leave_days.applied_on IS 'The day the leave was applied for or entered (India date).';
COMMENT ON COLUMN nlq.staff_leave_days.how_applied IS 'By the employee, By the office, For late marks, For missing punches, For absence with no leave, By the shift''s late / early rule, Imported from the old module.';
COMMENT ON COLUMN nlq.staff_leave_days.is_system_deduction IS 'True when the system charged the leave (late marks, missing punches, unexplained absence, the shift rule) rather than a person applying.';
COMMENT ON COLUMN nlq.staff_leave_days.cancellation_asked IS 'True when a cancellation of this approved leave waits for approval (the leave still counts until it is approved).';
COMMENT ON COLUMN nlq.staff_leave_days.counted_in_reports IS 'False for staff on the school''s "Not required" list, whom the leave and attendance reports leave out; filter true to match those reports.';

-- nlq.stock_balances: one row is an item in a store now (in hand, reserved, free, value, reorder level).
-- Rules: every item with stock or a reorder level in a store; store units; free = in hand less reserved.
GRANT SELECT ON stock_balances, item_store_levels, stores, purchase_items, purchase_item_categories, purchase_uoms TO edupro_nlq_owner;
CREATE VIEW nlq.stock_balances WITH (security_barrier = true) AS
SELECT x.store_id,
       st.name AS store,
       st.kind AS store_kind,
       x.item_id,
       i.code AS item_code,
       i.name AS item,
       cat.name AS category,
       sub.name AS sub_category,
       i.item_type,
       COALESCE(su.code, u.code) AS unit,
       COALESCE(b.qty, 0) AS qty,
       COALESCE(b.reserved, 0) AS reserved_qty,
       GREATEST(COALESCE(b.qty, 0) - COALESCE(b.reserved, 0), 0) AS free_qty,
       COALESCE(b.value, 0) AS value,
       COALESCE(b.avg_rate, 0) AS avg_rate,
       b.last_move_on,
       l.reorder_level,
       l.reorder_qty,
       l.max_qty,
       (COALESCE(l.reorder_level, 0) > 0
         AND COALESCE(b.qty, 0) - COALESCE(b.reserved, 0) <= l.reorder_level) AS below_reorder
  FROM (SELECT sb.school_id, sb.store_id, sb.item_id FROM stock_balances sb WHERE sb.school_id = app.nlq_school_id()
        UNION
        SELECT sl.school_id, sl.store_id, sl.item_id FROM item_store_levels sl WHERE sl.school_id = app.nlq_school_id()) x
  JOIN stores st ON st.id = x.store_id
  JOIN purchase_items i ON i.id = x.item_id
  JOIN purchase_item_categories cat ON cat.id = i.category_id
  JOIN purchase_uoms u ON u.id = i.uom_id
  LEFT JOIN purchase_uoms su ON su.id = i.stock_uom_id
  LEFT JOIN purchase_item_categories sub ON sub.id = i.sub_category_id
  LEFT JOIN stock_balances b ON b.store_id = x.store_id AND b.item_id = x.item_id
  LEFT JOIN item_store_levels l ON l.store_id = x.store_id AND l.item_id = x.item_id
 WHERE x.school_id = app.nlq_school_id();
ALTER VIEW nlq.stock_balances OWNER TO edupro_nlq_owner;
GRANT SELECT ON nlq.stock_balances TO edupro_nlq;
COMMENT ON VIEW nlq.stock_balances IS 'One row is an item in a store as it stands now: quantity in hand, reserved, free, value at the moving average rate, and the reorder level set for that store. Rows: every item that has had stock in the store (qty may be 0) or has a reorder level there. Quantities are in the store unit (unit), money in rupees. Use: stock value = sum(value), by store or category; what to reorder = below_reorder; items out of stock = qty = 0. Goods in transit between two stores are in no store until received. For stock on a past day or movement in a period use nlq.stock_ledger. Join nlq.stock_ledger or nlq.purchase_order_lines on item_id (and store_id for the ledger).';
COMMENT ON COLUMN nlq.stock_balances.store_id IS 'Id of the store; join key to nlq.stock_ledger.store_id.';
COMMENT ON COLUMN nlq.stock_balances.store IS 'Store name.';
COMMENT ON COLUMN nlq.stock_balances.store_kind IS 'main (the main store that receives goods) or sub (a sub-store such as a lab or the sports room).';
COMMENT ON COLUMN nlq.stock_balances.item_id IS 'Id of the item; join key to nlq.stock_ledger.item_id and nlq.purchase_order_lines.item_id.';
COMMENT ON COLUMN nlq.stock_balances.item_code IS 'Item code, e.g. STAT-PAPER-0001.';
COMMENT ON COLUMN nlq.stock_balances.item IS 'Item name.';
COMMENT ON COLUMN nlq.stock_balances.category IS 'Main item category, e.g. Stationery.';
COMMENT ON COLUMN nlq.stock_balances.sub_category IS 'Item sub-category; empty when none.';
COMMENT ON COLUMN nlq.stock_balances.item_type IS 'consumable or asset.';
COMMENT ON COLUMN nlq.stock_balances.unit IS 'Store unit code of the quantities, e.g. PCS, KG.';
COMMENT ON COLUMN nlq.stock_balances.qty IS 'Quantity in hand in the store now, in the store unit.';
COMMENT ON COLUMN nlq.stock_balances.reserved_qty IS 'Part of qty held for approved indents and requisitions, or proposed for condemnation; it cannot be issued to anyone else.';
COMMENT ON COLUMN nlq.stock_balances.free_qty IS 'qty less reserved_qty (never below 0): what can still be issued.';
COMMENT ON COLUMN nlq.stock_balances.value IS 'Value of qty in rupees at the moving average rate (GST included when the school counts it in cost).';
COMMENT ON COLUMN nlq.stock_balances.avg_rate IS 'Moving average cost in rupees per store unit.';
COMMENT ON COLUMN nlq.stock_balances.last_move_on IS 'Date of the last move of the item in this store; empty when it never had stock.';
COMMENT ON COLUMN nlq.stock_balances.reorder_level IS 'Reorder level set for the item in this store (store units); empty when none is set.';
COMMENT ON COLUMN nlq.stock_balances.reorder_qty IS 'Suggested quantity to reorder (store units); empty when not set.';
COMMENT ON COLUMN nlq.stock_balances.max_qty IS 'Most the store should hold (store units); empty when not set.';
COMMENT ON COLUMN nlq.stock_balances.below_reorder IS 'True when a reorder level above 0 is set and free_qty is at or below it.';

-- nlq.stock_ledger: one row is one move of an item into or out of a store (the stock ledger, append-only).
-- Rules: signed qty/value in store units; transfers between stores, rate corrections and reversed openings flagged internal.
GRANT SELECT ON stock_moves, stores, purchase_items, purchase_item_categories, purchase_uoms, stock_issues, stock_returns, goods_receipts, stock_transfers, stock_counts, condemnations, stock_revaluations, departments TO edupro_nlq_owner;
CREATE VIEW nlq.stock_ledger WITH (security_barrier = true) AS
SELECT x.id AS move_id,
       x.moved_on,
       date_trunc('month', x.moved_on)::date AS month,
       to_char(x.moved_on - interval '3 months', 'YYYY') || '-' || to_char(x.moved_on + interval '9 months', 'YY') AS financial_year,
       x.store_id,
       st.name AS store,
       x.item_id,
       i.code AS item_code,
       i.name AS item,
       cat.name AS category,
       i.item_type,
       x.kind,
       CASE x.kind WHEN 'opening' THEN 'Opening stock'
                   WHEN 'opening_undo' THEN 'Opening corrected (reversed)'
                   WHEN 'receipt' THEN 'Received'
                   WHEN 'issue' THEN 'Issued'
                   WHEN 'return_in' THEN 'Returned to the store'
                   WHEN 'return_vendor' THEN 'Returned to the vendor'
                   WHEN 'transfer_out' THEN 'Sent to another store'
                   WHEN 'transfer_in' THEN 'From another store'
                   WHEN 'adjustment' THEN 'Count adjustment'
                   WHEN 'write_off' THEN 'Written off'
                   WHEN 'revalue' THEN 'Rate corrected'
                   ELSE x.kind END AS kind_words,
       CASE WHEN x.qty > 0 THEN 'in' ELSE 'out' END AS direction,
       x.qty,
       COALESCE(su.code, u.code) AS unit,
       x.rate,
       x.value,
       x.batch_no,
       x.expiry AS expiry_date,
       CASE x.doc_type WHEN 'opening' THEN 'Opening'
                       WHEN 'goods_receipt' THEN gr.number
                       WHEN 'stock_issue' THEN si.number
                       WHEN 'stock_return' THEN sr.number
                       WHEN 'stock_transfer' THEN tr.number
                       WHEN 'stock_count' THEN sc.number
                       WHEN 'condemnation' THEN cn.number
                       WHEN 'revaluation' THEN rv.number END AS document_no,
       COALESCE(si.department_id, sr.department_id) AS department_id,
       d.name AS department,
       CASE WHEN x.kind = 'transfer_out' THEN ts.name
            WHEN x.kind = 'transfer_in' AND tr.from_store_id <> x.store_id THEN fs.name END AS other_store,
       (x.kind IN ('transfer_out', 'transfer_in', 'revalue', 'opening_undo') OR un.id IS NOT NULL) AS is_internal,
       (x.kind IN ('issue', 'return_in')) AS is_consumption
  FROM stock_moves x
  JOIN stores st ON st.id = x.store_id
  JOIN purchase_items i ON i.id = x.item_id
  JOIN purchase_item_categories cat ON cat.id = i.category_id
  JOIN purchase_uoms u ON u.id = i.uom_id
  LEFT JOIN purchase_uoms su ON su.id = i.stock_uom_id
  LEFT JOIN stock_moves un ON un.doc_line_id = x.id AND un.kind = 'opening_undo' AND x.kind = 'opening'
  LEFT JOIN goods_receipts gr ON x.doc_type = 'goods_receipt' AND gr.id = x.doc_id
  LEFT JOIN stock_issues si ON x.doc_type = 'stock_issue' AND si.id = x.doc_id
  LEFT JOIN stock_returns sr ON x.doc_type = 'stock_return' AND sr.id = x.doc_id
  LEFT JOIN stock_transfers tr ON x.doc_type = 'stock_transfer' AND tr.id = x.doc_id
  LEFT JOIN stores fs ON fs.id = tr.from_store_id
  LEFT JOIN stores ts ON ts.id = tr.to_store_id
  LEFT JOIN stock_counts sc ON x.doc_type = 'stock_count' AND sc.id = x.doc_id
  LEFT JOIN condemnations cn ON x.doc_type = 'condemnation' AND cn.id = x.doc_id
  LEFT JOIN stock_revaluations rv ON x.doc_type = 'revaluation' AND rv.id = x.doc_id
  LEFT JOIN departments d ON d.id = COALESCE(si.department_id, sr.department_id)
 WHERE x.school_id = app.nlq_school_id();
ALTER VIEW nlq.stock_ledger OWNER TO edupro_nlq_owner;
GRANT SELECT ON nlq.stock_ledger TO edupro_nlq;
COMMENT ON VIEW nlq.stock_ledger IS 'One row is one move of an item into or out of a store: the stock ledger, never changed (a mistake is put right by another move). qty and value are signed: positive = into the store, negative = out of it. Quantities are in the store unit (unit), values in rupees at the moving average rate. Nothing is left out; instead is_internal marks moves that are not real stock in or out for the school: transfers between two stores (a pair, out of one store and into another; a cancelled transfer comes back into the same store), rate corrections (an out and an in of the same quantity) and openings that were reversed together with their reversal. Use: stock in or out in a period = filter moved_on and NOT is_internal, sum qty or value by kind; consumption = is_consumption (issues less goods returned unused), net = -sum(value), by department; stock of a store on a past day = sum(qty) and sum(value) of all moves (internal ones included) with moved_on up to that day. Goods enter on acceptance after inspection (kind receipt), not when they arrive. Stock now is nlq.stock_balances.';
COMMENT ON COLUMN nlq.stock_ledger.move_id IS 'Id of the move.';
COMMENT ON COLUMN nlq.stock_ledger.moved_on IS 'School date of the move. Filter periods on this date.';
COMMENT ON COLUMN nlq.stock_ledger.month IS 'First day of the month of moved_on.';
COMMENT ON COLUMN nlq.stock_ledger.financial_year IS 'Indian financial year of moved_on (April to March), e.g. 2026-27.';
COMMENT ON COLUMN nlq.stock_ledger.store_id IS 'Id of the store; join key to nlq.stock_balances.store_id.';
COMMENT ON COLUMN nlq.stock_ledger.store IS 'Store name (the main store or a sub-store such as a lab or the sports room).';
COMMENT ON COLUMN nlq.stock_ledger.item_id IS 'Id of the item; join key to nlq.stock_balances.item_id and nlq.purchase_order_lines.item_id.';
COMMENT ON COLUMN nlq.stock_ledger.item_code IS 'Item code, e.g. STAT-PAPER-0001.';
COMMENT ON COLUMN nlq.stock_ledger.item IS 'Item name.';
COMMENT ON COLUMN nlq.stock_ledger.category IS 'Main item category, e.g. Stationery.';
COMMENT ON COLUMN nlq.stock_ledger.item_type IS 'consumable or asset.';
COMMENT ON COLUMN nlq.stock_ledger.kind IS 'Kind of move: opening, opening_undo (an opening reversed), receipt (accepted goods receipt), issue (to a department), return_in (unused goods back from a department), return_vendor (defective goods back to the vendor), transfer_out, transfer_in, adjustment (approved physical count difference), write_off (approved condemnation), revalue (rate correction).';
COMMENT ON COLUMN nlq.stock_ledger.kind_words IS 'kind in plain words: Opening stock, Opening corrected (reversed), Received, Issued, Returned to the store, Returned to the vendor, Sent to another store, From another store, Count adjustment, Written off, Rate corrected.';
COMMENT ON COLUMN nlq.stock_ledger.direction IS 'in (qty positive) or out (qty negative).';
COMMENT ON COLUMN nlq.stock_ledger.qty IS 'Quantity moved in the store unit, signed: positive into the store, negative out.';
COMMENT ON COLUMN nlq.stock_ledger.unit IS 'Store unit code of qty, e.g. PCS, KG.';
COMMENT ON COLUMN nlq.stock_ledger.rate IS 'Rupees per store unit: the cost of goods coming in, or the moving average they went out at.';
COMMENT ON COLUMN nlq.stock_ledger.value IS 'Value moved in rupees, signed like qty.';
COMMENT ON COLUMN nlq.stock_ledger.batch_no IS 'Batch number for batch-tracked items (lab chemicals, medicines); empty otherwise.';
COMMENT ON COLUMN nlq.stock_ledger.expiry_date IS 'Expiry date of the batch; empty when none.';
COMMENT ON COLUMN nlq.stock_ledger.document_no IS 'Number of the document behind the move: goods receipt GRN/..., issue ISS/..., return RTN/..., transfer TRF/..., count CNT/..., condemnation CDN/..., rate correction RVL/..., or Opening.';
COMMENT ON COLUMN nlq.stock_ledger.department_id IS 'Id of the department the goods were issued to or came back from (issues and returns to the store only).';
COMMENT ON COLUMN nlq.stock_ledger.department IS 'Department the goods were issued to or came back from; empty for other kinds of move.';
COMMENT ON COLUMN nlq.stock_ledger.other_store IS 'For a transfer: the store it went to (transfer_out) or came from (transfer_in); empty for a cancelled transfer coming back.';
COMMENT ON COLUMN nlq.stock_ledger.is_internal IS 'True for moves that are not real stock in or out of the school: transfers between stores, rate corrections, reversed openings and their reversals. Leave them out of in/out totals; keep them for the stock of a store on a day.';
COMMENT ON COLUMN nlq.stock_ledger.is_consumption IS 'True for issues to departments and unused goods returned against them. -sum(qty) or -sum(value) of these rows is net consumption. Damaged goods brought back are not in the ledger, so they count as consumed here.';

-- nlq.student_leaves: one row is one leave application for a pupil (applied from the family portal), with its status
-- and the class that year. The last day taken stops the day before ended_on (rest given up). Left out: reasons,
-- certificates and notes; removed / merged / erased students; pupils whose admission that year was cancelled.
GRANT SELECT ON student_leaves, student_leave_approvals, leave_types, students, enrolments, class_sections, classes, academic_years TO edupro_nlq_owner;
CREATE VIEW nlq.student_leaves WITH (security_barrier = true) AS
SELECT x.id                                                                AS leave_id,
       COALESCE(x.number, 'LV-' || x.id::text)                             AS leave_no,
       x.student_id,
       s.admission_no,
       s.display_name                                                      AS student_name,
       x.academic_year_id,
       y.code                                                              AS academic_year,
       k.name                                                              AS class,
       k.display_order                                                     AS class_order,
       cs.name                                                             AS section,
       k.code || '-' || cs.name                                            AS class_section,
       e.class_section_id,
       x.leave_type,
       COALESCE(lt.name, x.leave_type)                                     AS leave_type_name,
       x.from_date,
       x.to_date,
       LEAST(x.to_date, COALESCE(x.ended_on - 1, x.to_date))               AS last_date,
       date_trunc('month', x.from_date)::date                              AS month,
       x.days,
       CASE WHEN x.status = 'approved'
            THEN GREATEST(0, LEAST(x.to_date, COALESCE(x.ended_on - 1, x.to_date)) - x.from_date + 1)
            ELSE 0 END                                                     AS days_taken,
       (x.chain = 'long')                                                  AS is_long,
       x.status,
       w.label                                                             AS waiting_at,
       (x.ended_on IS NOT NULL)                                            AS ended_early,
       (x.applied_at AT TIME ZONE 'Asia/Kolkata')::date                    AS applied_on,
       (x.decided_at AT TIME ZONE 'Asia/Kolkata')::date                    AS decided_on
  FROM student_leaves x
  JOIN students s        ON s.id = x.student_id
  JOIN academic_years y  ON y.id = x.academic_year_id
  LEFT JOIN enrolments e ON e.student_id = x.student_id AND e.academic_year_id = x.academic_year_id
  LEFT JOIN class_sections cs ON cs.id = e.class_section_id
  LEFT JOIN classes k    ON k.id = cs.class_id
  LEFT JOIN leave_types lt ON lt.code = x.leave_type
  LEFT JOIN LATERAL (SELECT a.label FROM student_leave_approvals a
                      WHERE a.leave_id = x.id AND a.status = 'pending'
                      ORDER BY a.seq LIMIT 1) w ON x.status = 'pending'
 WHERE x.school_id = app.nlq_school_id()
   AND s.deleted_at IS NULL
   AND s.merged_into_id IS NULL
   AND NOT (s.details ? 'erased_at')
   AND e.status IS DISTINCT FROM 'cancelled';
ALTER VIEW nlq.student_leaves OWNER TO edupro_nlq_owner;
GRANT SELECT ON nlq.student_leaves TO edupro_nlq;
COMMENT ON VIEW nlq.student_leaves IS 'One row is one leave application for a pupil, made by the family from the portal (or the office), with its type, dates, status and the pupil''s class that year. Left out: the reason, certificates and approvers'' notes; removed, merged or erased student records; pupils whose admission that year was cancelled. Leave asked through an older helpdesk "leave request" is not here. Days are calendar days (weekends and holidays included): days = as applied for; days_taken = days of an approved leave actually taken (a family may give up the rest: last_date stops the day before they came back). For "on leave today" use status = ''approved'' AND from_date <= today AND last_date >= today. For school days of leave count is_leave in nlq.attendance_days instead. Filter by from_date (or month) and academic_year; group by class (sort class_order), leave_type_name or status.';
COMMENT ON COLUMN nlq.student_leaves.leave_id IS 'The leave application''s id.';
COMMENT ON COLUMN nlq.student_leaves.leave_no IS 'The leave number the family and office see, e.g. LV-2611-0042.';
COMMENT ON COLUMN nlq.student_leaves.student_id IS 'The pupil''s id; join key to nlq.students (with academic_year_id).';
COMMENT ON COLUMN nlq.student_leaves.admission_no IS 'The pupil''s admission number.';
COMMENT ON COLUMN nlq.student_leaves.student_name IS 'The pupil''s full name.';
COMMENT ON COLUMN nlq.student_leaves.academic_year_id IS 'The academic year the leave belongs to; join key to nlq.academic_years.';
COMMENT ON COLUMN nlq.student_leaves.academic_year IS 'The academic year code, e.g. 2026-27.';
COMMENT ON COLUMN nlq.student_leaves.class IS 'The pupil''s class that year, e.g. VI. Sort by class_order.';
COMMENT ON COLUMN nlq.student_leaves.class_order IS 'The class''s position for sorting (lower = junior).';
COMMENT ON COLUMN nlq.student_leaves.section IS 'The pupil''s section that year, e.g. A.';
COMMENT ON COLUMN nlq.student_leaves.class_section IS 'Class and section that year, e.g. VI-A.';
COMMENT ON COLUMN nlq.student_leaves.class_section_id IS 'The class-section''s id; join key to nlq.class_sections.';
COMMENT ON COLUMN nlq.student_leaves.leave_type IS 'The leave type code, e.g. medical, family, travel, other (or the school''s own codes).';
COMMENT ON COLUMN nlq.student_leaves.leave_type_name IS 'The leave type as named by the school, e.g. Medical, Family function, Out of station, Other.';
COMMENT ON COLUMN nlq.student_leaves.from_date IS 'First day of leave applied for.';
COMMENT ON COLUMN nlq.student_leaves.to_date IS 'Last day of leave applied for.';
COMMENT ON COLUMN nlq.student_leaves.last_date IS 'Last day of leave actually covered: to_date, or the day before the pupil came back when the family gave up the rest.';
COMMENT ON COLUMN nlq.student_leaves.month IS 'First day of the month of from_date; group by it for month-wise counts.';
COMMENT ON COLUMN nlq.student_leaves.days IS 'Calendar days applied for (to_date - from_date + 1), weekends and holidays included.';
COMMENT ON COLUMN nlq.student_leaves.days_taken IS 'Calendar days of an approved leave actually taken (from_date to last_date); 0 for pending, rejected or cancelled leave.';
COMMENT ON COLUMN nlq.student_leaves.is_long IS 'True for a long leave (more days than the school''s limit), which needs more approval levels (class teacher, coordinator, principal by default).';
COMMENT ON COLUMN nlq.student_leaves.status IS 'pending (waiting for an approver), approved, rejected, or cancelled (withdrawn by the family before it began). Count approved for leave granted.';
COMMENT ON COLUMN nlq.student_leaves.waiting_at IS 'For a pending leave, the approval level it waits at, e.g. Class teacher, Coordinator, Principal; empty otherwise.';
COMMENT ON COLUMN nlq.student_leaves.ended_early IS 'True when the family ended an approved leave early (came back before to_date).';
COMMENT ON COLUMN nlq.student_leaves.applied_on IS 'Date the leave was applied for (India date).';
COMMENT ON COLUMN nlq.student_leaves.decided_on IS 'Date it was approved, rejected or cancelled (India date); empty while pending.';

-- nlq.teacher_subjects: one row is one live teacher assignment: a teacher × class section × subject (or the class
-- teacher / coordinator role) in one academic year. Only live rows (valid_to empty, the app's rule); ended
-- assignments, removed and erased employees are left out.
GRANT SELECT ON teacher_assignments, employees, class_sections, classes, subjects, academic_years TO edupro_nlq_owner;
CREATE VIEW nlq.teacher_subjects WITH (security_barrier = true) AS
SELECT x.employee_id,
       e.employee_code,
       e.display_name                                                     AS employee_name,
       COALESCE(NULLIF(btrim(e.department), ''), 'No department')        AS department,
       NULLIF(btrim(e.designation), '')                                   AS designation,
       (e.status = 'active'
        AND (e.left_on IS NULL OR e.left_on >= (now() AT TIME ZONE 'Asia/Kolkata')::date)) AS employee_is_current,
       x.academic_year_id,
       y.code                                                             AS academic_year,
       x.class_section_id,
       k.name                                                             AS class,
       k.display_order                                                    AS class_order,
       cs.name                                                            AS section,
       k.code || '-' || cs.name                                           AS class_section,
       x.subject_id,
       s.name                                                             AS subject,
       s.code                                                             AS subject_code,
       x.kind::text                                                       AS kind,
       CASE x.kind
         WHEN 'class_teacher'   THEN CASE WHEN x.is_actual THEN 'Class teacher' ELSE 'Co-class teacher' END
         WHEN 'subject_teacher' THEN 'Subject teacher'
         WHEN 'coordinator'     THEN 'Coordinator'
         WHEN 'indicator'       THEN 'Indicator teacher'
         WHEN 'remarks'         THEN 'Remarks teacher'
       END                                                                AS role,
       (x.kind = 'class_teacher' AND x.is_actual)                         AS is_class_teacher,
       x.can_mark_attendance,
       x.valid_from                                                       AS from_date
  FROM teacher_assignments x
  JOIN employees e       ON e.id = x.employee_id
  JOIN academic_years y  ON y.id = x.academic_year_id
  JOIN class_sections cs ON cs.id = x.class_section_id
  JOIN classes k         ON k.id = cs.class_id
  LEFT JOIN subjects s   ON s.id = x.subject_id
 WHERE x.school_id = app.nlq_school_id()
   AND x.valid_to IS NULL
   AND e.deleted_at IS NULL
   AND NOT (e.details ? 'erased_at');
ALTER VIEW nlq.teacher_subjects OWNER TO edupro_nlq_owner;
GRANT SELECT ON nlq.teacher_subjects TO edupro_nlq;
COMMENT ON VIEW nlq.teacher_subjects IS 'One row is one live teaching assignment: a teacher in a class section for a subject (subject teacher), or a role in the section without a subject (class teacher, co-class teacher, coordinator; indicator and remarks teachers may have one). Ended assignments are left out; a teacher who left keeps rows until the office ends them (see employee_is_current). Always filter one academic_year (e.g. the current one from nlq.academic_years where is_current). A teacher''s periods are not here: one row per section and subject, not per period. Count teachers with count(DISTINCT employee_id). Join to nlq.staff on employee_id, to nlq.class_sections / nlq.students on class_section_id.';
COMMENT ON COLUMN nlq.teacher_subjects.employee_id IS 'The teacher''s employee id (join to nlq.staff).';
COMMENT ON COLUMN nlq.teacher_subjects.employee_code IS 'The teacher''s employee code.';
COMMENT ON COLUMN nlq.teacher_subjects.employee_name IS 'The teacher''s name.';
COMMENT ON COLUMN nlq.teacher_subjects.department IS 'The teacher''s department on the employee record today; ''No department'' when empty.';
COMMENT ON COLUMN nlq.teacher_subjects.designation IS 'The teacher''s designation on the employee record today (e.g. PGT, TGT, PRT).';
COMMENT ON COLUMN nlq.teacher_subjects.employee_is_current IS 'True when the teacher is still in service today; false for a teacher who left but still holds the assignment.';
COMMENT ON COLUMN nlq.teacher_subjects.academic_year_id IS 'The academic year of the assignment (join to nlq.academic_years).';
COMMENT ON COLUMN nlq.teacher_subjects.academic_year IS 'The academic year code, e.g. 2026-27.';
COMMENT ON COLUMN nlq.teacher_subjects.class_section_id IS 'The class section (join to nlq.class_sections or nlq.students).';
COMMENT ON COLUMN nlq.teacher_subjects.class IS 'The class name, e.g. Class VI.';
COMMENT ON COLUMN nlq.teacher_subjects.class_order IS 'The class''s position in the school''s order; sort by it.';
COMMENT ON COLUMN nlq.teacher_subjects.section IS 'The section name, e.g. A.';
COMMENT ON COLUMN nlq.teacher_subjects.class_section IS 'Class code and section, e.g. VI-A.';
COMMENT ON COLUMN nlq.teacher_subjects.subject_id IS 'The subject''s id; empty for class teacher and coordinator rows.';
COMMENT ON COLUMN nlq.teacher_subjects.subject IS 'The subject name (e.g. Mathematics); empty for class teacher and coordinator rows.';
COMMENT ON COLUMN nlq.teacher_subjects.subject_code IS 'The subject code; empty when there is no subject.';
COMMENT ON COLUMN nlq.teacher_subjects.kind IS 'The assignment kind code: class_teacher, subject_teacher, coordinator, indicator, remarks.';
COMMENT ON COLUMN nlq.teacher_subjects.role IS 'The role in words: Class teacher, Co-class teacher, Subject teacher, Coordinator, Indicator teacher, Remarks teacher.';
COMMENT ON COLUMN nlq.teacher_subjects.is_class_teacher IS 'True for the section''s actual class teacher (one per section and year; the name on report cards). A co-class teacher is false.';
COMMENT ON COLUMN nlq.teacher_subjects.can_mark_attendance IS 'True when this assignment lets the teacher mark the section''s attendance.';
COMMENT ON COLUMN nlq.teacher_subjects.from_date IS 'The date the assignment started.';

-- nlq.term_results: one row is one pupil's term (or annual) result made by the class's locked result register (mark
-- scheme) for a term code. Only schemes in use count: purpose 'result', status 'locked', not in the bin (draft, unlocked
-- and binned schemes keep old rows that the cards do not print). Deleted / merged / erased pupils and cancelled
-- enrolments are left out; the class is the pupil's enrolment of that year. Stored results: as of the last compute.
GRANT SELECT ON public.term_results, mark_schemes, academic_years, enrolments, class_sections, classes, students
  TO edupro_nlq_owner;
CREATE VIEW nlq.term_results WITH (security_barrier = true) AS
SELECT s.id                                      AS student_id,
       s.admission_no,
       s.display_name                            AS student_name,
       y.id                                      AS academic_year_id,
       y.code                                    AS academic_year,
       k.name                                    AS class,
       k.display_order                           AS class_order,
       cs.name                                   AS section,
       k.code || '-' || cs.name                  AS class_section,
       cs.id                                     AS class_section_id,
       en.status::text                           AS enrolment_status,
       x.term_code,
       m.name                                    AS register_name,
       x.total,
       x.max_total,
       x.pct                                     AS percent,
       x.grade,
       x.division,
       x.result,
       cardinality(x.failed)                     AS failed_count,
       NULLIF(array_to_string(x.failed, ', '), '') AS failed_subjects,
       x.rank_in_section,
       x.rank_in_class,
       (x.computed_at AT TIME ZONE 'Asia/Kolkata')::date AS computed_on
  FROM public.term_results x
  JOIN mark_schemes m ON m.id = x.scheme_id AND m.purpose = 'result' AND m.status = 'locked' AND m.deleted_at IS NULL
  JOIN academic_years y ON y.id = x.academic_year_id
  JOIN enrolments en ON en.student_id = x.student_id AND en.academic_year_id = x.academic_year_id AND en.status <> 'cancelled'
  JOIN class_sections cs ON cs.id = en.class_section_id
  JOIN classes k ON k.id = cs.class_id
  JOIN students s ON s.id = x.student_id AND s.deleted_at IS NULL AND s.merged_into_id IS NULL
                 AND NOT (s.details ? 'erased_at')
 WHERE x.school_id = app.nlq_school_id();
ALTER VIEW nlq.term_results OWNER TO edupro_nlq_owner;
GRANT SELECT ON nlq.term_results TO edupro_nlq;
COMMENT ON VIEW nlq.term_results IS 'One row is one pupil''s term or annual result (pupil × term code) as the class''s result register (mark scheme) works it out from several exams (weightages, best of, conversions as the school set them) — the result the term and annual report cards print, promotion reads and the merit lists rank. Only registers in use: locked result registers not in the bin; one per class and term code. Stored rows, as of the register''s last compute (computed_on); a register not computed yet has no rows. Left out: deleted, merged or erased pupils and cancelled enrolments. result: pass, compartment (failed a few subjects, up to the register''s compartment limit), fail, absent (a blocking code such as AB in a counted subject: no total) or incomplete (marks missing: no total). Ranks are competition ranks (1, 2, 2, 4) among pass / compartment / fail rows. Subject-wise term marks are not in this view. Filter by term_code and academic_year; group by class (sort by class_order), class_section, result or division. Join nlq.students on (student_id, academic_year_id).';
COMMENT ON COLUMN nlq.term_results.student_id IS 'The pupil''s id; join key to nlq.students (with academic_year_id), nlq.exam_results, nlq.exam_marks.';
COMMENT ON COLUMN nlq.term_results.admission_no IS 'The pupil''s admission number (unique in the school).';
COMMENT ON COLUMN nlq.term_results.student_name IS 'The pupil''s name.';
COMMENT ON COLUMN nlq.term_results.academic_year_id IS 'The academic year of the term (id).';
COMMENT ON COLUMN nlq.term_results.academic_year IS 'The academic year of the term, e.g. 2026-27.';
COMMENT ON COLUMN nlq.term_results.class IS 'The pupil''s class in that year, e.g. Class VI.';
COMMENT ON COLUMN nlq.term_results.class_order IS 'Sort order of the class (lower = junior). Use ORDER BY class_order, not class.';
COMMENT ON COLUMN nlq.term_results.section IS 'The pupil''s section in that year, e.g. A.';
COMMENT ON COLUMN nlq.term_results.class_section IS 'Class code and section, e.g. VI-A.';
COMMENT ON COLUMN nlq.term_results.class_section_id IS 'The pupil''s section in that year (id); join key to nlq.class_sections.';
COMMENT ON COLUMN nlq.term_results.enrolment_status IS 'The pupil''s enrolment in that year: active (in the class now), promoted (year finished), transferred, withdrawn or left.';
COMMENT ON COLUMN nlq.term_results.term_code IS 'The term the result is for, as the school codes it, e.g. T1, T2, FINAL (the annual result).';
COMMENT ON COLUMN nlq.term_results.register_name IS 'Name of the result register (mark scheme) that made the result, e.g. Term I Result VI-VIII.';
COMMENT ON COLUMN nlq.term_results.total IS 'Marks obtained in the term total as the register counts them; empty when result is absent or incomplete.';
COMMENT ON COLUMN nlq.term_results.max_total IS 'Maximum of the term total.';
COMMENT ON COLUMN nlq.term_results.percent IS 'total × 100 / max_total (0–100); empty when result is absent or incomplete.';
COMMENT ON COLUMN nlq.term_results.grade IS 'Overall grade of the term by percent on the register''s grade scale; empty when no percent.';
COMMENT ON COLUMN nlq.term_results.division IS 'Division by percent (e.g. First, Second), only for result pass and when the register sets divisions; else empty.';
COMMENT ON COLUMN nlq.term_results.result IS 'pass, compartment, fail, absent (withheld by a blocking code such as AB) or incomplete (marks missing).';
COMMENT ON COLUMN nlq.term_results.failed_count IS 'Number of subjects failed in the term.';
COMMENT ON COLUMN nlq.term_results.failed_subjects IS 'Codes of the subjects failed, comma-separated (e.g. MATH, SCI); empty when none.';
COMMENT ON COLUMN nlq.term_results.rank_in_section IS 'Competition rank in the section (1, 2, 2, 4) by the register''s rule (total or percent); empty for absent and incomplete.';
COMMENT ON COLUMN nlq.term_results.rank_in_class IS 'Competition rank in the whole class (all sections); empty for absent and incomplete.';
COMMENT ON COLUMN nlq.term_results.computed_on IS 'The date (India) the register last worked the results out.';

-- nlq.transport_riders: one row is one pupil in one month they ride the school bus, from the transport periods
-- (student_transport, the history). Cancelled periods never count; an ended period counts up to its last month; when two
-- periods cover a month the newest wins; months after the pupil left the school (enrolment end date) are left out.
GRANT SELECT ON student_transport, transport_routes, transport_stops, students, enrolments, class_sections, classes, academic_years TO edupro_nlq_owner;
CREATE VIEW nlq.transport_riders WITH (security_barrier = true) AS
SELECT x.student_id,
       s.admission_no,
       s.display_name                                                     AS student_name,
       x.academic_year_id,
       y.code                                                             AS academic_year,
       x.month,
       (x.month = date_trunc('month', (now() AT TIME ZONE 'Asia/Kolkata'))::date) AS is_current_month,
       x.service,
       COALESCE(x.pick_route_id, x.drop_route_id)                         AS route_id,
       mr.code                                                            AS route_code,
       mr.name                                                            AS route_name,
       ms.name                                                            AS stop_name,
       x.pick_route_id,
       pr.code                                                            AS pick_route_code,
       ps.name                                                            AS pick_stop_name,
       ps.pickup_time                                                     AS pickup_time,
       x.drop_route_id,
       dr.code                                                            AS drop_route_code,
       ds.name                                                            AS drop_stop_name,
       ds.drop_time                                                       AS drop_time,
       (x.service <> 'drop')                                              AS rides_morning,
       (x.service <> 'pick')                                              AS rides_afternoon,
       x.monthly_amount,
       k.name                                                             AS class,
       k.display_order                                                    AS class_order,
       cs.name                                                            AS section,
       k.code || '-' || cs.name                                           AS class_section,
       cs.id                                                              AS class_section_id
  FROM (SELECT DISTINCT ON (t.student_id, m.m::date)
               t.school_id, t.student_id, t.academic_year_id, m.m::date AS month, t.service,
               t.pick_route_id, t.pick_stop_id, t.drop_route_id, t.drop_stop_id, t.monthly_amount
          FROM student_transport t
          CROSS JOIN LATERAL generate_series(t.from_month, t.to_month, interval '1 month') AS m(m)
         WHERE t.school_id = app.nlq_school_id()
           AND t.status IN ('active', 'ended')
         ORDER BY t.student_id, m.m::date, t.id DESC) x
  JOIN students s ON s.id = x.student_id
  JOIN academic_years y ON y.id = x.academic_year_id
  LEFT JOIN transport_routes mr ON mr.id = COALESCE(x.pick_route_id, x.drop_route_id)
  LEFT JOIN transport_stops ms ON ms.id = COALESCE(x.pick_stop_id, x.drop_stop_id)
  LEFT JOIN transport_routes pr ON pr.id = x.pick_route_id
  LEFT JOIN transport_stops ps ON ps.id = x.pick_stop_id
  LEFT JOIN transport_routes dr ON dr.id = x.drop_route_id
  LEFT JOIN transport_stops ds ON ds.id = x.drop_stop_id
  LEFT JOIN LATERAL (SELECT e.class_section_id, e.ended_on
                       FROM enrolments e
                      WHERE e.student_id = x.student_id AND e.academic_year_id = x.academic_year_id
                        AND e.status <> 'cancelled'
                      ORDER BY (e.status = 'active') DESC, e.id DESC
                      LIMIT 1) en ON true
  LEFT JOIN class_sections cs ON cs.id = en.class_section_id
  LEFT JOIN classes k ON k.id = cs.class_id
 WHERE x.school_id = app.nlq_school_id()
   AND s.deleted_at IS NULL
   AND s.merged_into_id IS NULL
   AND (en.ended_on IS NULL OR x.month <= en.ended_on);
ALTER VIEW nlq.transport_riders OWNER TO edupro_nlq_owner;
GRANT SELECT ON nlq.transport_riders TO edupro_nlq;
COMMENT ON VIEW nlq.transport_riders IS 'One row is one pupil in one month they ride the school bus (pupil x month), taken from the approved transport periods. Left out: cancelled periods (never ran), months after the pupil left the school, removed and merged pupil records. For "how many pupils use the bus" count DISTINCT student_id for one month (filter month = a first-of-month date, or is_current_month = true); never sum rows across months as pupils. A pupil may ride one route in the morning (pick) and another in the afternoon (drop): for riders of a route on the morning trip filter pick_route_id = the route and rides_morning = true; on the afternoon trip drop_route_id and rides_afternoon; route_id is the main route (the pick route, else the drop route). monthly_amount is the transport rate of that month, not the bill: the fee actually billed and paid is in the fee views (transport head). Join nlq.transport_routes on route_id, nlq.students on student_id and academic_year_id.';
COMMENT ON COLUMN nlq.transport_riders.student_id IS 'The pupil''s id; join key to nlq.students (with academic_year_id).';
COMMENT ON COLUMN nlq.transport_riders.admission_no IS 'The pupil''s admission number.';
COMMENT ON COLUMN nlq.transport_riders.student_name IS 'The pupil''s full name.';
COMMENT ON COLUMN nlq.transport_riders.academic_year_id IS 'The academic year the transport period belongs to.';
COMMENT ON COLUMN nlq.transport_riders.academic_year IS 'The academic year code, e.g. 2026-27.';
COMMENT ON COLUMN nlq.transport_riders.month IS 'The month ridden, as its first day (e.g. 2026-11-01). Filter on it for a month; group by it for month-wise counts.';
COMMENT ON COLUMN nlq.transport_riders.is_current_month IS 'True for the row of the current month (India time): the pupils on the bus now.';
COMMENT ON COLUMN nlq.transport_riders.service IS 'How the pupil rides that month: pick (morning trip only), drop (afternoon trip only) or both.';
COMMENT ON COLUMN nlq.transport_riders.route_id IS 'The main route: the pick route, else the drop route; join key to nlq.transport_routes.';
COMMENT ON COLUMN nlq.transport_riders.route_code IS 'Code of the main route (e.g. R01).';
COMMENT ON COLUMN nlq.transport_riders.route_name IS 'Name of the main route.';
COMMENT ON COLUMN nlq.transport_riders.stop_name IS 'The pupil''s stop on the main route (the pick stop, else the drop stop).';
COMMENT ON COLUMN nlq.transport_riders.pick_route_id IS 'The route of the morning (pick) trip; empty for drop only. Join key to nlq.transport_routes.';
COMMENT ON COLUMN nlq.transport_riders.pick_route_code IS 'Code of the morning (pick) route; empty for drop only.';
COMMENT ON COLUMN nlq.transport_riders.pick_stop_name IS 'The stop the pupil is picked up from in the morning; empty for drop only.';
COMMENT ON COLUMN nlq.transport_riders.pickup_time IS 'The morning pick-up time at that stop (time of day).';
COMMENT ON COLUMN nlq.transport_riders.drop_route_id IS 'The route of the afternoon (drop) trip; empty for pick only. Join key to nlq.transport_routes.';
COMMENT ON COLUMN nlq.transport_riders.drop_route_code IS 'Code of the afternoon (drop) route; empty for pick only.';
COMMENT ON COLUMN nlq.transport_riders.drop_stop_name IS 'The stop the pupil is dropped at in the afternoon; empty for pick only.';
COMMENT ON COLUMN nlq.transport_riders.drop_time IS 'The afternoon drop time at that stop (time of day).';
COMMENT ON COLUMN nlq.transport_riders.rides_morning IS 'True when the pupil rides the morning (pick) trip that month (service pick or both).';
COMMENT ON COLUMN nlq.transport_riders.rides_afternoon IS 'True when the pupil rides the afternoon (drop) trip that month (service drop or both).';
COMMENT ON COLUMN nlq.transport_riders.monthly_amount IS 'The monthly transport rate approved for the pupil, in rupees, before any concession; the expected charge, not what was billed or paid (months the school does not charge transport and concessions are not applied here).';
COMMENT ON COLUMN nlq.transport_riders.class IS 'The pupil''s class in that academic year (e.g. VI).';
COMMENT ON COLUMN nlq.transport_riders.class_order IS 'Sort order of the class (lower = junior); order classes by it.';
COMMENT ON COLUMN nlq.transport_riders.section IS 'The section in that academic year (e.g. A).';
COMMENT ON COLUMN nlq.transport_riders.class_section IS 'Class and section together, e.g. VI-A.';
COMMENT ON COLUMN nlq.transport_riders.class_section_id IS 'The class-section id of that year; join key to nlq.class_sections.';

-- nlq.transport_routes: one row is one bus route of the school (removed routes left out), with the vehicle and crew
-- that run it today (the dated route-vehicle mapping, as the app brings the route in line), a stand-in bus in force
-- today, the stops, and this month's riders counted from the transport periods (as nlq.transport_riders counts them).
GRANT SELECT ON transport_routes, transport_route_vehicles, transport_vehicles, transport_vehicle_types, transport_drivers, transport_replacements, transport_stops, student_transport, students, enrolments TO edupro_nlq_owner;
CREATE VIEW nlq.transport_routes WITH (security_barrier = true) AS
SELECT x.id                                                               AS route_id,
       x.code                                                             AS route_code,
       x.name                                                             AS route_name,
       x.status::text                                                     AS status,
       v.id                                                               AS vehicle_id,
       v.reg_no                                                           AS vehicle_reg_no,
       v.name                                                             AS vehicle_name,
       vt.name                                                            AS vehicle_type,
       COALESCE(v.capacity, vt.seats)                                     AS capacity,
       d.name                                                             AS driver_name,
       COALESCE(k.name, CASE WHEN NOT mp.has_rows THEN x.conductor_name END) AS conductor_name,
       (sb.reg_no IS NOT NULL)                                            AS has_stand_in_today,
       sb.reg_no                                                          AS stand_in_reg_no,
       COALESCE(st.stops, 0)                                              AS stops,
       COALESCE(rd.morning_riders, 0)                                     AS morning_riders,
       COALESCE(rd.afternoon_riders, 0)                                   AS afternoon_riders,
       COALESCE(rd.riders, 0)                                             AS riders,
       CASE WHEN COALESCE(v.capacity, vt.seats) > 0
            THEN round(100.0 * COALESCE(rd.morning_riders, 0) / COALESCE(v.capacity, vt.seats), 1) END AS morning_fill_percent,
       x.late_after
  FROM transport_routes x
  CROSS JOIN LATERAL (SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date AS today) n
  -- today's vehicle and crew: the mapping valid today (both trips first, then the pick trip, then the newest);
  -- a route that has no mapping row at all keeps the vehicle and crew written on the route
  CROSS JOIN LATERAL (SELECT EXISTS (SELECT 1 FROM transport_route_vehicles m WHERE m.route_id = x.id) AS has_rows) mp
  LEFT JOIN LATERAL (SELECT m.vehicle_id, m.driver_id, m.conductor_id
                       FROM transport_route_vehicles m
                      WHERE m.route_id = x.id AND m.status = 'active'
                        AND (m.from_date IS NULL OR m.from_date <= n.today)
                        AND (m.to_date IS NULL OR m.to_date >= n.today)
                      ORDER BY (m.shift = 'both') DESC, (m.shift = 'pick') DESC, m.id DESC
                      LIMIT 1) rv ON true
  LEFT JOIN transport_vehicles v ON v.id = CASE WHEN mp.has_rows THEN rv.vehicle_id ELSE x.vehicle_id END
                                AND v.deleted_at IS NULL
  LEFT JOIN transport_vehicle_types vt ON vt.id = v.vehicle_type_id
  LEFT JOIN transport_drivers d ON d.id = CASE WHEN mp.has_rows THEN rv.driver_id ELSE x.driver_id END
                               AND d.deleted_at IS NULL
  LEFT JOIN transport_drivers k ON k.id = rv.conductor_id AND k.deleted_at IS NULL
  -- a stand-in bus arranged for today
  LEFT JOIN LATERAL (SELECT nv.reg_no
                       FROM transport_replacements r
                       JOIN transport_vehicles nv ON nv.id = r.replacement_vehicle_id
                      WHERE r.vehicle_id = v.id AND r.status = 'active'
                        AND n.today BETWEEN r.from_date AND r.to_date
                      ORDER BY r.id DESC
                      LIMIT 1) sb ON true
  LEFT JOIN (SELECT s.route_id, count(*)::int AS stops FROM transport_stops s GROUP BY s.route_id) st ON st.route_id = x.id
  -- this month's riders: the newest period covering the month (cancelled never), pupils still in school that month
  LEFT JOIN (SELECT leg.route_id,
                    count(DISTINCT c.student_id) FILTER (WHERE leg.trip = 'pick')::int AS morning_riders,
                    count(DISTINCT c.student_id) FILTER (WHERE leg.trip = 'drop')::int AS afternoon_riders,
                    count(DISTINCT c.student_id)::int AS riders
               FROM (SELECT DISTINCT ON (t.student_id)
                            t.student_id, t.academic_year_id, t.service, t.pick_route_id, t.drop_route_id,
                            date_trunc('month', (now() AT TIME ZONE 'Asia/Kolkata'))::date AS month
                       FROM student_transport t
                      WHERE t.school_id = app.nlq_school_id()
                        AND t.status IN ('active', 'ended')
                        AND date_trunc('month', (now() AT TIME ZONE 'Asia/Kolkata'))::date BETWEEN t.from_month AND t.to_month
                      ORDER BY t.student_id, t.id DESC) c
               JOIN students s ON s.id = c.student_id AND s.deleted_at IS NULL AND s.merged_into_id IS NULL
               LEFT JOIN LATERAL (SELECT e.ended_on
                                    FROM enrolments e
                                   WHERE e.student_id = c.student_id AND e.academic_year_id = c.academic_year_id
                                     AND e.status <> 'cancelled'
                                   ORDER BY (e.status = 'active') DESC, e.id DESC
                                   LIMIT 1) en ON true
               CROSS JOIN LATERAL (VALUES ('pick', CASE WHEN c.service <> 'drop' THEN c.pick_route_id END),
                                          ('drop', CASE WHEN c.service <> 'pick' THEN c.drop_route_id END)) AS leg(trip, route_id)
              WHERE leg.route_id IS NOT NULL
                AND (en.ended_on IS NULL OR c.month <= en.ended_on)
              GROUP BY leg.route_id) rd ON rd.route_id = x.id
 WHERE x.school_id = app.nlq_school_id()
   AND x.deleted_at IS NULL;
ALTER VIEW nlq.transport_routes OWNER TO edupro_nlq_owner;
GRANT SELECT ON nlq.transport_routes TO edupro_nlq;
COMMENT ON VIEW nlq.transport_routes IS 'One row is one bus route of the school (removed routes left out; status tells active from switched-off routes). The vehicle, driver and conductor are those that run the route today (from its dated vehicle mapping); a stand-in bus arranged for today is shown apart. Riders are the pupils on the route this month (India time), counted from the approved transport periods: morning_riders ride its morning (pick) trip, afternoon_riders its afternoon (drop) trip, riders either trip; a pupil can ride a different route each way, so do not add riders of several routes to get pupils - use nlq.transport_riders with count(DISTINCT student_id) for school totals. Join nlq.transport_riders on route_id (or pick_route_id / drop_route_id) for the riders of other months or by class.';
COMMENT ON COLUMN nlq.transport_routes.route_id IS 'The route''s id; join key to nlq.transport_riders.route_id, pick_route_id and drop_route_id.';
COMMENT ON COLUMN nlq.transport_routes.route_code IS 'The route code (e.g. R01).';
COMMENT ON COLUMN nlq.transport_routes.route_name IS 'The route name.';
COMMENT ON COLUMN nlq.transport_routes.status IS 'active or inactive (switched off by the transport office).';
COMMENT ON COLUMN nlq.transport_routes.vehicle_id IS 'The vehicle that runs the route today; empty when none is mapped for today.';
COMMENT ON COLUMN nlq.transport_routes.vehicle_reg_no IS 'Registration number of that vehicle.';
COMMENT ON COLUMN nlq.transport_routes.vehicle_name IS 'The vehicle''s name in the fleet list (e.g. Bus 4); may be empty.';
COMMENT ON COLUMN nlq.transport_routes.vehicle_type IS 'The vehicle type (e.g. Bus, Van).';
COMMENT ON COLUMN nlq.transport_routes.capacity IS 'Seats in that vehicle (the vehicle''s capacity, else its type''s seats); a number of seats.';
COMMENT ON COLUMN nlq.transport_routes.driver_name IS 'The driver who runs the route today.';
COMMENT ON COLUMN nlq.transport_routes.conductor_name IS 'The conductor on the route today; empty when none.';
COMMENT ON COLUMN nlq.transport_routes.has_stand_in_today IS 'True when the route''s vehicle is off the road today and a stand-in (replacement) bus runs in its place.';
COMMENT ON COLUMN nlq.transport_routes.stand_in_reg_no IS 'Registration number of the stand-in bus running today; empty when none.';
COMMENT ON COLUMN nlq.transport_routes.stops IS 'Number of stops on the route.';
COMMENT ON COLUMN nlq.transport_routes.morning_riders IS 'Pupils riding the route''s morning (pick) trip this month.';
COMMENT ON COLUMN nlq.transport_routes.afternoon_riders IS 'Pupils riding the route''s afternoon (drop) trip this month.';
COMMENT ON COLUMN nlq.transport_routes.riders IS 'Pupils riding the route on either trip this month (each pupil once).';
COMMENT ON COLUMN nlq.transport_routes.morning_fill_percent IS 'Morning riders as a percent of the vehicle''s seats (0-100, can pass 100 when over-full); empty when the seats are not known.';
COMMENT ON COLUMN nlq.transport_routes.late_after IS 'The time of day after which a boarding counts as late on this route; empty when not set.';

-- nlq.visitors: one row is one visit through the school gate (a walk-in, a self-registered visitor let in, or an
-- appointment checked in). Visitors who never came in (waiting, refused, cancelled) are left out; purpose and visitor
-- type are the school's list values only (anything typed is 'Other'); no visitor name, mobile, ID, vehicle or photo.
GRANT SELECT ON visitor_log, appointment_settings, appointment_hosts, employees, hostels, students TO edupro_nlq_owner;
CREATE VIEW nlq.visitors WITH (security_barrier = true) AS
SELECT x.id                                                                     AS visit_id,
       x.number,
       (x.in_at AT TIME ZONE 'Asia/Kolkata')::date                              AS visit_on,
       date_trunc('month', x.in_at AT TIME ZONE 'Asia/Kolkata')::date           AS month,
       to_char(x.in_at AT TIME ZONE 'Asia/Kolkata', 'HH24:MI')                  AS in_time,
       extract(hour FROM x.in_at AT TIME ZONE 'Asia/Kolkata')::int              AS in_hour,
       to_char(x.out_at AT TIME ZONE 'Asia/Kolkata', 'HH24:MI')                 AS out_time,
       round((extract(epoch FROM x.out_at - x.in_at) / 60)::numeric, 0)         AS minutes_inside,
       x.state,
       (x.state = 'inside')                                                     AS inside_now,
       x.source,
       (x.source = 'appointment')                                               AS by_appointment,
       CASE WHEN x.purpose = ANY (st.purposes) THEN x.purpose ELSE 'Other' END  AS purpose,
       CASE WHEN x.visitor_type IS NULL OR btrim(x.visitor_type) = '' THEN 'Not given'
            WHEN x.visitor_type = ANY (st.visitor_types) THEN x.visitor_type
            ELSE 'Other' END                                                    AS visitor_type,
       x.party_size                                                             AS people,
       COALESCE(h.name, we.display_name, 'Not named')                           AS host,
       h.kind                                                                   AS host_kind,
       COALESCE(x.with_employee_id, h.employee_id)                              AS host_employee_id,
       COALESCE(we.display_name, he.display_name)                               AS host_employee_name,
       x.gate,
       x.exit_gate,
       (x.hostel_id IS NOT NULL)                                                AS hostel_visit,
       ho.name                                                                  AS hostel,
       x.warden_decision,
       x.student_id,
       s.admission_no,
       s.display_name                                                           AS student_name
  FROM visitor_log x
  LEFT JOIN appointment_settings st ON st.school_id = x.school_id
  LEFT JOIN appointment_hosts h ON h.id = x.host_id
  LEFT JOIN employees he ON he.id = h.employee_id
  LEFT JOIN employees we ON we.id = x.with_employee_id
  LEFT JOIN hostels ho ON ho.id = x.hostel_id
  LEFT JOIN students s ON s.id = x.student_id
 WHERE x.school_id = app.nlq_school_id()
   AND x.state IN ('inside', 'left')
   AND x.in_at IS NOT NULL;
ALTER VIEW nlq.visitors OWNER TO edupro_nlq_owner;
GRANT SELECT ON nlq.visitors TO edupro_nlq;
COMMENT ON VIEW nlq.visitors IS 'One row is one visit through the school gate: a walk-in registered by the guard, a visitor who registered on their own phone and was let in, or an appointment visitor checked in (appointment visitors are already here — do not add appointments to these counts). Visitors who never came in (still waiting, refused or cancelled) are left out. No visitor name, mobile, ID proof, vehicle or photo is here. Count visits with count(*) and people with sum(people); filter and group by visit_on or month (India dates), purpose, visitor_type, host or host_employee_name, in_hour (busiest hours). inside_now = still inside (not checked out yet). minutes_inside is empty until they leave. Hostel visits to a boarder have hostel_visit = true and the boarder in the student columns.';
COMMENT ON COLUMN nlq.visitors.visit_id IS 'The visit''s id.';
COMMENT ON COLUMN nlq.visitors.number IS 'The visitor pass number, e.g. V-2611-0042.';
COMMENT ON COLUMN nlq.visitors.visit_on IS 'India date the visitor came in; the usual date to filter on.';
COMMENT ON COLUMN nlq.visitors.month IS 'First day of the month of visit_on.';
COMMENT ON COLUMN nlq.visitors.in_time IS 'India time the visitor came in, HH:MM (24-hour).';
COMMENT ON COLUMN nlq.visitors.in_hour IS 'Hour of coming in, 0–23 (India time); group by it for the busiest hours.';
COMMENT ON COLUMN nlq.visitors.out_time IS 'India time the visitor left, HH:MM; empty while inside.';
COMMENT ON COLUMN nlq.visitors.minutes_inside IS 'Minutes between coming in and leaving; empty while inside. Use avg(minutes_inside).';
COMMENT ON COLUMN nlq.visitors.state IS 'inside (not checked out yet) or left.';
COMMENT ON COLUMN nlq.visitors.inside_now IS 'True when the visitor has not been checked out (still inside, or the guard forgot to check them out).';
COMMENT ON COLUMN nlq.visitors.source IS 'gate (registered by the guard), self (registered on their own phone from the gate QR code, then let in), appointment (a booked appointment checked in).';
COMMENT ON COLUMN nlq.visitors.by_appointment IS 'True when the visit came from a booked appointment.';
COMMENT ON COLUMN nlq.visitors.purpose IS 'Purpose of the visit from the school''s list (e.g. Admission enquiry, Fees and accounts, Meet a teacher, Vendor or supplier, Official visit); anything typed by hand shows as Other.';
COMMENT ON COLUMN nlq.visitors.visitor_type IS 'Kind of visitor from the school''s list (e.g. Parent, Vendor or supplier, Contractor or worker, Official, Courier or delivery, Interview candidate); Other when typed by hand, Not given when empty.';
COMMENT ON COLUMN nlq.visitors.people IS 'Number of people who came in together on this pass (1 or more). sum(people) = people through the gate.';
COMMENT ON COLUMN nlq.visitors.host IS 'Whom they came to meet: the desk (e.g. Admissions, Accounts) or the person''s name; Not named when the gate recorded neither.';
COMMENT ON COLUMN nlq.visitors.host_kind IS 'desk, person or class_teacher when a desk or person from the appointment set-up was chosen; empty otherwise.';
COMMENT ON COLUMN nlq.visitors.host_employee_id IS 'The staff member met, when known; joins nlq.staff.employee_id.';
COMMENT ON COLUMN nlq.visitors.host_employee_name IS 'Name of the staff member met, when known.';
COMMENT ON COLUMN nlq.visitors.gate IS 'Gate they came in by (from the school''s list, e.g. Main gate).';
COMMENT ON COLUMN nlq.visitors.exit_gate IS 'Gate they left by; empty while inside or when not recorded.';
COMMENT ON COLUMN nlq.visitors.hostel_visit IS 'True when the visit was to a boarder in a hostel.';
COMMENT ON COLUMN nlq.visitors.hostel IS 'The hostel visited, for hostel visits.';
COMMENT ON COLUMN nlq.visitors.warden_decision IS 'For hostel visits: allowed or refused by the warden; empty when not asked.';
COMMENT ON COLUMN nlq.visitors.student_id IS 'The boarder visited (hostel visits); joins nlq.students.';
COMMENT ON COLUMN nlq.visitors.admission_no IS 'Admission number of the boarder visited.';
COMMENT ON COLUMN nlq.visitors.student_name IS 'Name of the boarder visited.';
