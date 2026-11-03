import type { PoolClient } from '@edupro/db';

/**
 * The subject marks master reaching the exams (docs/design/70, part 2). A paper with no mark entered yet
 * (as a whole or in a part) follows the master of its exam's type and class: its maximum, pass marks,
 * grade scale and Optional; its parts are fitted to a new maximum (0295) and a class's parts given
 * (Class set-up). A paper with marks keeps its own (the exam shows "differs from master"); a subject
 * taken out of the master stays in an exam until it is unticked there. A locked exam is left alone.
 */
export async function followSubjectMarks(
  c: PoolClient,
  f: { yearId: string; typeId?: string | null; classIds?: string[] | null; examId?: string | null },
): Promise<number> {
  const r = await c.query<{ id: string }>(
    `UPDATE exam_subjects es
        SET max_marks = m.max_marks, pass_marks = m.pass_marks, grade_scale_id = m.grade_scale_id, is_elective = m.is_optional
       FROM exams e, exam_type_subjects m
      WHERE e.id = es.exam_id AND e.academic_year_id = $1 AND e.deleted_at IS NULL AND NOT e.marks_locked
        AND ($2::bigint IS NULL OR e.exam_type_id = $2::bigint)
        AND ($3::bigint[] IS NULL OR es.class_id = ANY($3::bigint[]))
        AND ($4::bigint IS NULL OR e.id = $4::bigint)
        AND m.academic_year_id = e.academic_year_id AND m.exam_type_id = e.exam_type_id
        AND m.class_id = es.class_id AND m.subject_id = es.subject_id
        AND NOT EXISTS (SELECT 1 FROM mark_entries me WHERE me.exam_subject_id = es.id)
        AND NOT EXISTS (SELECT 1 FROM mark_part_entries mp JOIN exam_subject_parts p ON p.id = mp.part_id
                         WHERE p.exam_subject_id = es.id)
        AND (es.max_marks, es.pass_marks, es.grade_scale_id, es.is_elective)
            IS DISTINCT FROM (m.max_marks, m.pass_marks, m.grade_scale_id, m.is_optional)
      RETURNING es.id::text`,
    [f.yearId, f.typeId ?? null, f.classIds ?? null, f.examId ?? null],
  );
  if (r.rows.length)
    await c.query(
      `SELECT app.fit_parts_to_max(id), app.apply_class_parts(id) FROM exam_subjects WHERE id = ANY($1::bigint[])`,
      [r.rows.map((x) => x.id)],
    );
  return r.rows.length;
}

/**
 * A new exam's classes (or classes added to it) take their papers from the master of the exam's type:
 * every subject of the class's list, for a class with no subject in the exam yet.
 */
export async function fillExamFromSubjectMarks(c: PoolClient, examId: string): Promise<number> {
  const r = await c.query<{ id: string }>(
    `INSERT INTO exam_subjects (school_id, exam_id, class_id, subject_id, max_marks, pass_marks, is_elective, grade_scale_id)
     SELECT app.current_school_id(), e.id, ec.class_id, m.subject_id, m.max_marks, m.pass_marks, m.is_optional, m.grade_scale_id
       FROM exams e JOIN exam_classes ec ON ec.exam_id = e.id
       JOIN exam_type_subjects m ON m.academic_year_id = e.academic_year_id AND m.exam_type_id = e.exam_type_id
                                AND m.class_id = ec.class_id
      WHERE e.id = $1 AND 'marks' = ANY(e.areas)
        AND NOT EXISTS (SELECT 1 FROM exam_subjects x WHERE x.exam_id = e.id AND x.class_id = ec.class_id)
     ON CONFLICT (exam_id, class_id, subject_id) DO NOTHING
     RETURNING id::text`,
    [examId],
  );
  if (r.rows.length)
    await c.query(
      `SELECT app.apply_class_parts(id) FROM exam_subjects WHERE id = ANY($1::bigint[])`,
      [r.rows.map((x) => x.id)],
    );
  return r.rows.length;
}
