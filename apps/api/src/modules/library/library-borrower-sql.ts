/**
 * The borrower of a report's row, as `b`: name, admission no. or employee code (ref), the class-section of
 * a pupil now or a staff member's designation (place), and a pupil's class and section now (for the class
 * filter and its order). `kind` and `id` are the row's own columns (fixed in the code, never values).
 */
export const borrowerLateral = (kind: string, id: string) =>
  // eslint-disable-next-line no-restricted-syntax -- the row's own columns, fixed in the code
  `LEFT JOIN LATERAL (
  SELECT COALESCE(st.display_name, e.display_name) AS name, COALESCE(st.admission_no, e.employee_code) AS ref,
         COALESCE(en.place, NULLIF(e.designation, '')) AS place, en.class_id, en.section_id, en.roll_no,
         en.class_order
    FROM (SELECT 1) one
    LEFT JOIN students st ON ${kind} = 'student' AND st.id = ${id}
    LEFT JOIN employees e ON ${kind} = 'employee' AND e.id = ${id}
    LEFT JOIN LATERAL (
      SELECT k.name || '-' || cs.name AS place, k.id AS class_id, cs.id AS section_id, ee.roll_no,
             k.display_order AS class_order
        FROM enrolments ee JOIN class_sections cs ON cs.id = ee.class_section_id JOIN classes k ON k.id = cs.class_id
       WHERE ee.student_id = st.id AND ee.status = 'active' ORDER BY ee.id DESC LIMIT 1) en ON true) b ON true`;

/** A search as a LIKE pattern: anywhere in the text, its own % _ \ taken as they are. */
export const likeEscape = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
