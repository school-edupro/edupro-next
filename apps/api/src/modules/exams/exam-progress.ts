import type { PoolClient } from '@edupro/db';

/**
 * How far an exam has got (docs/design/66), worked out from the data, never set by hand: a class is in
 * set-up until it has subjects (or an indicator set), in marks entry until every student taking a
 * subject has a mark or a code, in verification until every section's subjects are verified, then at
 * results; the exam is "released" once a published report card release includes it. The exam's stage
 * is its least advanced class's.
 */
export type ExamStage = 'setup' | 'entry' | 'verification' | 'results' | 'released';
export const STAGES: ExamStage[] = ['setup', 'entry', 'verification', 'results', 'released'];

export interface Done {
  /** what there is to do (e.g. students × items) */
  expected: number;
  entered: number;
}
export interface ClassProgress {
  classId: string;
  classCode: string;
  sections: number;
  students: number;
  subjects: number;
  /** section × subject with students taking it; takers = students × subjects they take */
  marks: { slots: number; takers: number; entered: number; submitted: number; verified: number };
  /** null: the class has no indicator / progress card set in the exam */
  indicators: Done | null;
  /** remarks by category (the categories for the class); null: none */
  remarks: Done | null;
  /** students with a general remark, exam attendance, a health record, a worked-out result */
  generalRemarks: number;
  attendance: number;
  health: number;
  results: number;
  computedAt: string | null;
  stage: ExamStage;
}
export interface ExamProgress {
  /** the areas the exam takes (docs/design/66) */
  areas: string[];
  stage: ExamStage;
  released: boolean;
  classes: ClassProgress[];
  totals: {
    students: number;
    subjects: number;
    marks: ClassProgress['marks'];
    indicators: Done;
    remarks: Done;
    generalRemarks: number;
    attendance: number;
    health: number;
    results: number;
  };
}

/** A class's stage; only the areas the exam takes count (an exam of remarks alone is never in set-up). */
const classStage = (k: Omit<ClassProgress, 'stage'>, areas: string[]): ExamStage => {
  const marks = areas.includes('marks');
  const ind = areas.includes('indicators');
  const subjects = marks && k.subjects > 0;
  if (!subjects && !(ind && k.indicators) && (marks || ind)) return 'setup';
  if (subjects && k.marks.entered < k.marks.takers) return 'entry';
  if (!subjects && k.indicators && k.indicators.entered < k.indicators.expected) return 'entry';
  if (subjects && k.marks.verified < k.marks.slots) return 'verification';
  return 'results';
};

/** The progress of the exams asked for (one query per kind, every exam at once). */
export async function examProgress(
  c: PoolClient,
  examIds: string[],
): Promise<Map<string, ExamProgress>> {
  const out = new Map<string, ExamProgress>();
  if (!examIds.length) return out;
  const key = (e: string, k: string) => `${e}:${k}`;
  const taken = await c.query<{ id: string; areas: string[] }>(
    `SELECT id::text, areas FROM exams WHERE id = ANY($1::bigint[])`,
    [examIds],
  );
  const areasOf = new Map(taken.rows.map((r) => [r.id, r.areas]));
  // the classes and their active students
  const classes = await c.query<{
    exam_id: string;
    class_id: string;
    code: string;
    sections: number;
    subjects: number;
    set_id: string | null;
  }>(
    `SELECT ec.exam_id::text, ec.class_id::text, k.code,
            (SELECT count(*)::int FROM class_sections cs WHERE cs.class_id = ec.class_id AND cs.academic_year_id = e.academic_year_id
                AND cs.deleted_at IS NULL AND cs.status = 'active') AS sections,
            (SELECT count(*)::int FROM exam_subjects es WHERE es.exam_id = ec.exam_id AND es.class_id = ec.class_id) AS subjects,
            (SELECT x.set_id::text FROM exam_indicator_sets x WHERE x.exam_id = ec.exam_id AND x.class_id = ec.class_id) AS set_id
       FROM exam_classes ec JOIN exams e ON e.id = ec.exam_id JOIN classes k ON k.id = ec.class_id
      WHERE ec.exam_id = ANY($1::bigint[])
      ORDER BY k.display_order, k.code`,
    [examIds],
  );
  const perStudent = await c.query<{
    exam_id: string;
    class_id: string;
    students: number;
    general: number;
    attendance: number;
    health: number;
    results: number;
    remark_items: number;
    computed_at: Date | null;
  }>(
    `WITH st AS (
       SELECT ec.exam_id, ec.class_id, en.student_id
         FROM exam_classes ec JOIN exams e ON e.id = ec.exam_id
         JOIN class_sections cs ON cs.class_id = ec.class_id AND cs.academic_year_id = e.academic_year_id
                               AND cs.deleted_at IS NULL AND cs.status = 'active'
         JOIN enrolments en ON en.class_section_id = cs.id AND en.academic_year_id = e.academic_year_id AND en.status = 'active'
        WHERE ec.exam_id = ANY($1::bigint[]))
     SELECT st.exam_id::text, st.class_id::text, count(*)::int AS students,
            count(*) FILTER (WHERE EXISTS (SELECT 1 FROM exam_remarks r WHERE r.exam_id = st.exam_id AND r.student_id = st.student_id
                                              AND length(btrim(COALESCE(r.remark, ''))) > 0))::int AS general,
            count(*) FILTER (WHERE EXISTS (SELECT 1 FROM exam_attendance a WHERE a.exam_id = st.exam_id AND a.student_id = st.student_id))::int AS attendance,
            count(*) FILTER (WHERE EXISTS (SELECT 1 FROM health_records h WHERE h.exam_id = st.exam_id AND h.student_id = st.student_id))::int AS health,
            count(*) FILTER (WHERE EXISTS (SELECT 1 FROM exam_results x WHERE x.exam_id = st.exam_id AND x.student_id = st.student_id))::int AS results,
            COALESCE(sum((SELECT count(*) FROM exam_remark_items ri WHERE ri.exam_id = st.exam_id AND ri.student_id = st.student_id)), 0)::int AS remark_items,
            (SELECT max(x.computed_at) FROM exam_results x WHERE x.exam_id = st.exam_id AND x.class_id = st.class_id) AS computed_at
       FROM st GROUP BY st.exam_id, st.class_id`,
    [examIds],
  );
  const marks = await c.query<{
    exam_id: string;
    class_id: string;
    slots: number;
    takers: number;
    entered: number;
    submitted: number;
    verified: number;
  }>(
    `SELECT es.exam_id::text, es.class_id::text,
            count(*) FILTER (WHERE t.takers > 0)::int AS slots,
            COALESCE(sum(t.takers), 0)::int AS takers,
            COALESCE(sum(least(t.entered, t.takers)), 0)::int AS entered,
            count(*) FILTER (WHERE t.takers > 0 AND st.status = 'submitted')::int AS submitted,
            count(*) FILTER (WHERE t.takers > 0 AND st.status = 'verified')::int AS verified
       FROM exam_subjects es JOIN exams e ON e.id = es.exam_id
       JOIN class_sections cs ON cs.class_id = es.class_id AND cs.academic_year_id = e.academic_year_id
                             AND cs.deleted_at IS NULL AND cs.status = 'active'
       LEFT JOIN exam_entry_status st ON st.exam_subject_id = es.id AND st.class_section_id = cs.id
       CROSS JOIN LATERAL (
         SELECT count(*)::int AS takers, count(m.student_id)::int AS entered
           FROM enrolments en LEFT JOIN mark_entries m ON m.student_id = en.student_id AND m.exam_subject_id = es.id
          WHERE en.class_section_id = cs.id AND en.academic_year_id = e.academic_year_id AND en.status = 'active'
            AND app.student_exam_subject_kind(en.student_id, es.exam_id, es.subject_id) IS NOT NULL) t
      WHERE es.exam_id = ANY($1::bigint[])
      GROUP BY es.exam_id, es.class_id`,
    [examIds],
  );
  // a set's items that are entered (a heading's are its items)
  const indicators = await c.query<{
    exam_id: string;
    class_id: string;
    items: number;
    entered: number;
  }>(
    `SELECT x.exam_id::text, x.class_id::text,
            (SELECT count(*)::int FROM indicators i WHERE i.set_id = x.set_id
                AND NOT EXISTS (SELECT 1 FROM indicators ch WHERE ch.parent_id = i.id)) AS items,
            (SELECT count(*)::int FROM indicator_entries ie JOIN indicators i ON i.id = ie.indicator_id AND i.set_id = x.set_id
               JOIN enrolments en ON en.student_id = ie.student_id AND en.academic_year_id = e.academic_year_id AND en.status = 'active'
               JOIN class_sections cs ON cs.id = en.class_section_id AND cs.class_id = x.class_id
              WHERE ie.exam_id = x.exam_id) AS entered
       FROM exam_indicator_sets x JOIN exams e ON e.id = x.exam_id
      WHERE x.exam_id = ANY($1::bigint[])`,
    [examIds],
  );
  // the remark categories each class takes (none listed: every class)
  const categories = await c.query<{ class_id: string; n: number }>(
    `SELECT ec.class_id::text, count(rc.id)::int AS n
       FROM (SELECT DISTINCT class_id FROM exam_classes WHERE exam_id = ANY($1::bigint[])) ec
       LEFT JOIN remark_categories rc ON rc.status = 'active'
            AND (cardinality(rc.class_ids) = 0 OR ec.class_id = ANY(rc.class_ids))
      GROUP BY ec.class_id`,
    [examIds],
  );
  const released = await c.query<{ exam_id: string }>(
    `SELECT DISTINCT x::text AS exam_id FROM report_card_releases r, unnest(r.exam_ids) AS x
      WHERE r.status = 'released' AND r.exam_ids && $1::bigint[]`,
    [examIds],
  );

  const ps = new Map(perStudent.rows.map((r) => [key(r.exam_id, r.class_id), r]));
  const mk = new Map(marks.rows.map((r) => [key(r.exam_id, r.class_id), r]));
  const ind = new Map(indicators.rows.map((r) => [key(r.exam_id, r.class_id), r]));
  const cats = new Map(categories.rows.map((r) => [r.class_id, r.n]));
  const releasedIds = new Set(released.rows.map((r) => r.exam_id));
  const byExam = new Map<string, ClassProgress[]>();
  for (const k of classes.rows) {
    const p = ps.get(key(k.exam_id, k.class_id));
    const m = mk.get(key(k.exam_id, k.class_id));
    const i = ind.get(key(k.exam_id, k.class_id));
    const students = p?.students ?? 0;
    const areas = areasOf.get(k.exam_id) ?? [];
    const n = areas.includes('remarks') ? (cats.get(k.class_id) ?? 0) : 0;
    const takesMarks = areas.includes('marks');
    const row: Omit<ClassProgress, 'stage'> = {
      classId: k.class_id,
      classCode: k.code,
      sections: k.sections,
      students,
      subjects: k.subjects,
      marks: {
        slots: takesMarks ? (m?.slots ?? 0) : 0,
        takers: takesMarks ? (m?.takers ?? 0) : 0,
        entered: takesMarks ? (m?.entered ?? 0) : 0,
        submitted: takesMarks ? (m?.submitted ?? 0) : 0,
        verified: takesMarks ? (m?.verified ?? 0) : 0,
      },
      indicators:
        k.set_id && areas.includes('indicators')
          ? { expected: (i?.items ?? 0) * students, entered: i?.entered ?? 0 }
          : null,
      remarks: n ? { expected: n * students, entered: p?.remark_items ?? 0 } : null,
      generalRemarks: p?.general ?? 0,
      attendance: p?.attendance ?? 0,
      health: p?.health ?? 0,
      results: p?.results ?? 0,
      computedAt: p?.computed_at?.toISOString() ?? null,
    };
    const list = byExam.get(k.exam_id) ?? [];
    list.push({ ...row, stage: classStage(row, areas) });
    byExam.set(k.exam_id, list);
  }
  for (const id of examIds) {
    const list = byExam.get(id) ?? [];
    const sum = (f: (k: ClassProgress) => number) => list.reduce((a, k) => a + f(k), 0);
    const isReleased = releasedIds.has(id);
    const least = list.length
      ? STAGES[Math.min(...list.map((k) => STAGES.indexOf(k.stage)))]!
      : ('setup' as const);
    out.set(id, {
      areas: areasOf.get(id) ?? [],
      stage: isReleased && least === 'results' ? 'released' : least,
      released: isReleased,
      classes: list,
      totals: {
        students: sum((k) => k.students),
        subjects: sum((k) => k.subjects),
        marks: {
          slots: sum((k) => k.marks.slots),
          takers: sum((k) => k.marks.takers),
          entered: sum((k) => k.marks.entered),
          submitted: sum((k) => k.marks.submitted),
          verified: sum((k) => k.marks.verified),
        },
        indicators: {
          expected: sum((k) => k.indicators?.expected ?? 0),
          entered: sum((k) => k.indicators?.entered ?? 0),
        },
        remarks: {
          expected: sum((k) => k.remarks?.expected ?? 0),
          entered: sum((k) => k.remarks?.entered ?? 0),
        },
        generalRemarks: sum((k) => k.generalRemarks),
        attendance: sum((k) => k.attendance),
        health: sum((k) => k.health),
        results: sum((k) => k.results),
      },
    });
  }
  return out;
}
