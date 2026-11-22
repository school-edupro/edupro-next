import type { PoolClient } from 'pg';

/**
 * The sections the signed-in person teaches in the working year: as class or subject teacher, for indicators or
 * remarks — and, as a coordinator, every section of the class. The Remark, Attendance and Height & Weight registers
 * show these; mark and grade registers too, to a teacher not given the register (docs/design/96 part 19).
 */
export async function teachingSections(
  c: PoolClient,
): Promise<Array<{ id: string; classId: string }>> {
  const r = await c.query<{ id: string; class_id: string }>(
    `SELECT cs.id::text, cs.class_id::text
       FROM class_sections cs
      WHERE cs.academic_year_id = app.current_academic_year_id() AND cs.deleted_at IS NULL
        AND EXISTS (
              SELECT 1 FROM teacher_assignments ta
                JOIN employees e ON e.id = ta.employee_id AND e.user_id = app.current_user_id()
                JOIN class_sections mine ON mine.id = ta.class_section_id
               WHERE ta.academic_year_id = cs.academic_year_id AND ta.valid_to IS NULL
                 AND (mine.id = cs.id OR (ta.kind = 'coordinator' AND mine.class_id = cs.class_id)))`,
  );
  return r.rows.map((x) => ({ id: x.id, classId: x.class_id }));
}
