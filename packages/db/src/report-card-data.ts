/**
 * Report-card data assembly (Sprint 17). One shape for every band: the pupil, the term's exams with
 * marks and grades per subject, totals and rank per exam, the co-scholastic indicators, remarks,
 * exam attendance, health, and the fee-defaulter flag the visibility rule reads. Runs under the
 * caller's tenant context (RLS); bound parameters only.
 */
import type { PoolClient } from 'pg';

export type ClassBand = 'pre_primary' | 'primary' | 'middle' | 'secondary' | 'senior';

export interface ReportCardSubjectRow {
  code: string;
  name: string;
  /** one cell per exam of the term, in the term's exam order */
  cells: Array<{
    marks: string | null;
    max: string;
    grade: string | null;
    absent: boolean;
    exempt: boolean;
    /** a marks code in place of marks (ML, NA, OD, ...; docs/design/65) */
    code?: string | null;
  }>;
  /** term aggregate across the exams (sum of marks / sum of max) */
  total: string | null;
  maxTotal: string;
  pct: string | null;
  grade: string | null;
}

export interface ReportCardData {
  school: {
    name: string;
    shortName: string | null;
    affiliationNo: string | null;
    address: string;
    phone: string | null;
    logoDataUri: string | null;
  };
  release: { termCode: string; name: string; academicYear: string };
  student: {
    id: string;
    name: string;
    admissionNo: string;
    rollNo: number | null;
    className: string;
    classCode: string;
    /** the class (a release may choose a template per class, docs/design/65) */
    classId?: string;
    section: string;
    band: ClassBand;
    dob: string | null;
    gender: string;
    house: string | null;
    father: string | null;
    mother: string | null;
    photoObjectKey: string | null;
    photoContentType: string | null;
    photoDataUri: string | null;
  };
  exams: Array<{
    id: string;
    code: string;
    name: string;
    maxTotal: string;
    total: string | null;
    pct: string | null;
    grade: string | null;
    rankInSection: number | null;
    rankInClass: number | null;
    result: string | null;
  }>;
  subjects: ReportCardSubjectRow[];
  term: {
    total: string | null;
    maxTotal: string;
    pct: string | null;
    grade: string | null;
    result: 'pass' | 'fail' | 'incomplete';
    rank: number | null;
  };
  gradeScale: Array<{ grade: string; minPct: string; maxPct: string; remark: string | null }>;
  indicators: Array<{
    area: string;
    items: Array<{ code: string; name: string; grades: Array<string | null> }>;
  }>;
  remarks: Array<{ exam: string; remark: string }>;
  attendance: Array<{ exam: string; present: number; total: number; pct: string }>;
  health: {
    heightCm: string | null;
    weightKg: string | null;
    bmi: string | null;
    bloodGroup: string | null;
    recordedOn: string | null;
  } | null;
  fees: { balance: string; defaulter: boolean };
  today: string;
  /**
   * docs/design/65 part 4: the student's term results made by the locked result schemes (each term's
   * printed columns per subject), signatures by role (images filled by the renderer), the class
   * teacher, the marks codes for the evaluation key, what the student took part in, promoted to.
   */
  termResults?: ReportCardTermResult[];
  signatures?: Array<{
    role: string;
    label: string;
    personName: string | null;
    objectKey: string | null;
    contentType: string | null;
    dataUri: string | null;
  }>;
  classTeacher?: string | null;
  codes?: Array<{ code: string; name: string }>;
  participation?: string | null;
  promotedTo?: string | null;
  /** docs/design/65 part 5: the Holistic Progress Card (a class whose set in the term is an HPC) */
  hpc?: ReportCardHpc | null;
}

export interface ReportCardHpcItem {
  code: string;
  name: string;
  kind: 'level' | 'text';
  description: string | null;
  /** the level per HPC exam of the term (ReportCardHpc.exams) */
  levels: Array<string | null>;
  /** the last written observation */
  note: string | null;
  /** what the last level means for this item */
  descriptor: string | null;
  children: ReportCardHpcItem[];
}

export interface ReportCardHpc {
  /** the term's exams with the HPC, in order (codes) */
  exams: string[];
  levels: string[];
  levelWords: Record<string, string>;
  areas: Array<{ area: string; items: ReportCardHpcItem[] }>;
  feedback: { self: string | null; parent: string | null; teacher: string | null };
  /** up to six photos, images filled by the renderer */
  portfolio: Array<{
    caption: string | null;
    indicator: string | null;
    objectKey: string | null;
    contentType: string | null;
    dataUri: string | null;
  }>;
}

export interface ReportCardTermResult {
  term: string;
  name: string;
  columns: Array<{ key: string; label: string; total: boolean }>;
  subjects: Array<{
    code: string;
    name: string;
    kind: string;
    values: Record<string, { v: number | null; max: number; code?: string } | null>;
    total: number | null;
    max: number;
    grade: string | null;
    status: string;
  }>;
  total: number | null;
  max: number;
  pct: number | null;
  grade: string | null;
  division: string | null;
  result: string;
  rankInSection: number | null;
  rankInClass: number | null;
}

const fmt = (n: number) => n.toFixed(2);
const localDate = (d: Date | string | null): string | null => {
  if (!d) return null;
  if (typeof d === 'string') return d.slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * Band from the class row, else from its order (1-5 primary, 6-8 middle, 9-10 secondary, 11-12 senior);
 * pre-primary (Nursery, KG, Balvatika) only when the class says so (docs/design/65).
 */
export function bandFor(band: string | null, displayOrder: number): ClassBand {
  if (
    band === 'pre_primary' ||
    band === 'primary' ||
    band === 'middle' ||
    band === 'secondary' ||
    band === 'senior'
  )
    return band;
  if (displayOrder <= 5) return 'primary';
  if (displayOrder <= 8) return 'middle';
  if (displayOrder <= 10) return 'secondary';
  return 'senior';
}

function gradeFor(
  pct: number | null,
  scale: Array<{ grade: string; minPct: string; maxPct: string }>,
): string | null {
  if (pct === null) return null;
  const hit = scale.find((b) => pct >= Number(b.minPct) && pct <= Number(b.maxPct));
  return hit?.grade ?? null;
}

export async function loadReportCardData(
  c: PoolClient,
  input: {
    studentId: string;
    examIds: string[];
    termCode: string;
    termName: string;
    defaulterMin: number;
  },
): Promise<ReportCardData> {
  const sc = await c.query<{
    name: string;
    short_name: string | null;
    affiliation_no: string | null;
    address: Record<string, string>;
    contact: Record<string, string>;
  }>(
    `SELECT name, short_name, affiliation_no, address, contact FROM schools WHERE id = app.current_school_id()`,
  );
  const school = sc.rows[0]!;
  const st = await c.query<{
    id: string;
    name: string;
    admission_no: string;
    roll_no: number | null;
    class_id: string;
    class_code: string;
    class_name: string;
    display_order: number;
    band: string | null;
    section: string;
    dob: Date | null;
    gender: string;
    house: string | null;
    father: string | null;
    mother: string | null;
    object_key: string | null;
    content_type: string | null;
    year_code: string;
  }>(
    `SELECT s.id::text, s.display_name AS name, s.admission_no, e.roll_no, k.id::text AS class_id, k.code AS class_code, k.name AS class_name,
            k.display_order, k.band::text, cs.name AS section, s.dob, s.gender::text, s.house,
            (SELECT g.display_name FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id WHERE sg.student_id = s.id AND sg.relation = 'father' LIMIT 1) AS father,
            (SELECT g.display_name FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id WHERE sg.student_id = s.id AND sg.relation = 'mother' LIMIT 1) AS mother,
            f.object_key, f.content_type, y.code AS year_code
       FROM students s
       JOIN enrolments e ON e.student_id = s.id AND e.academic_year_id = app.current_academic_year_id() AND e.status = 'active'
       JOIN class_sections cs ON cs.id = e.class_section_id
       JOIN classes k ON k.id = cs.class_id
       JOIN academic_years y ON y.id = e.academic_year_id
       LEFT JOIN files f ON f.id = s.photo_file_id AND f.deleted_at IS NULL
      WHERE s.id = $1 AND s.deleted_at IS NULL`,
    [input.studentId],
  );
  const s = st.rows[0];
  if (!s) throw new Error(`student ${input.studentId} is not enrolled in the working year`);
  const band = bandFor(s.band, s.display_order);

  // the term's exams in the release order, restricted to those set for this class
  const ex = await c.query<{
    id: string;
    code: string;
    name: string;
    grade_scale_id: string | null;
  }>(
    `SELECT e.id::text, e.code, e.name, ec.grade_scale_id::text
       FROM exams e JOIN exam_classes ec ON ec.exam_id = e.id AND ec.class_id = $2
      WHERE e.id = ANY($1::bigint[]) AND e.deleted_at IS NULL
      ORDER BY array_position($1::bigint[], e.id)`,
    [input.examIds, s.class_id],
  );
  const exams = ex.rows;
  const scaleId = exams.find((e) => e.grade_scale_id)?.grade_scale_id ?? null;
  const scale = scaleId
    ? (
        await c.query<{ grade: string; min_pct: string; max_pct: string; remark: string | null }>(
          `SELECT grade, min_pct::text, max_pct::text, remark FROM grade_bands WHERE scale_id = $1 ORDER BY min_pct DESC`,
          [scaleId],
        )
      ).rows.map((b) => ({
        grade: b.grade,
        minPct: b.min_pct,
        maxPct: b.max_pct,
        remark: b.remark,
      }))
    : [];

  // subjects × exams
  const subj = await c.query<{
    exam_id: string;
    subject_code: string;
    subject_name: string;
    display_order: number;
    max_marks: string;
    marks: string | null;
    absent: boolean | null;
    exempt: boolean | null;
    code: string | null;
    entered_grade: string | null;
  }>(
    `SELECT es.exam_id::text, sub.code AS subject_code, sub.name AS subject_name, sub.display_order, es.max_marks::text,
            m.marks::text, m.absent, m.exempt, m.code, m.grade AS entered_grade
       FROM exam_subjects es JOIN subjects sub ON sub.id = es.subject_id
       LEFT JOIN mark_entries m ON m.exam_subject_id = es.id AND m.student_id = $3
      WHERE es.exam_id = ANY($1::bigint[]) AND es.class_id = $2
      ORDER BY sub.display_order, sub.code`,
    [input.examIds, s.class_id, input.studentId],
  );
  const bySubject = new Map<
    string,
    ReportCardSubjectRow & {
      order: number;
      cellsByExam: Map<string, ReportCardSubjectRow['cells'][number]>;
    }
  >();
  for (const r of subj.rows) {
    let row = bySubject.get(r.subject_code);
    if (!row) {
      row = {
        code: r.subject_code,
        name: r.subject_name,
        order: r.display_order,
        cells: [],
        cellsByExam: new Map(),
        total: null,
        maxTotal: '0.00',
        pct: null,
        grade: null,
      };
      bySubject.set(r.subject_code, row);
    }
    const marks = r.absent ? '0.00' : r.marks;
    // a grade-only subject (maximum 0) and a code other than AB stay out of the totals
    const out = r.exempt === true || Number(r.max_marks) === 0 || (!!r.code && r.code !== 'AB');
    const pct = marks !== null && !out ? (Number(marks) / Number(r.max_marks)) * 100 : null;
    row.cellsByExam.set(r.exam_id, {
      marks,
      max: r.max_marks,
      grade: r.entered_grade ?? gradeFor(pct, scale),
      absent: r.absent === true,
      exempt: out,
      code: r.code && r.code !== 'AB' && r.code !== 'EX' ? r.code : null,
    });
  }
  const subjects: ReportCardSubjectRow[] = [...bySubject.values()]
    .sort((a, b) => a.order - b.order || a.code.localeCompare(b.code))
    .map((row) => {
      const cells = exams.map(
        (e) =>
          row.cellsByExam.get(e.id) ?? {
            marks: null,
            max: '0.00',
            grade: null,
            absent: false,
            exempt: false,
          },
      );
      let sum = 0;
      let max = 0;
      let any = false;
      for (const cell of cells) {
        if (cell.exempt) continue;
        max += Number(cell.max);
        if (cell.marks !== null) {
          sum += Number(cell.marks);
          any = true;
        }
      }
      const pct = any && max > 0 ? (sum / max) * 100 : null;
      return {
        code: row.code,
        name: row.name,
        cells,
        total: any ? fmt(sum) : null,
        maxTotal: fmt(max),
        pct: pct === null ? null : fmt(pct),
        grade: gradeFor(pct, scale),
      };
    });

  // per-exam results (computed) for totals and ranks
  const res = await c.query<{
    exam_id: string;
    total: string;
    max_total: string;
    pct: string | null;
    grade: string | null;
    rank_in_section: number | null;
    rank_in_class: number | null;
    result: string;
  }>(
    `SELECT exam_id::text, total::text, max_total::text, pct::text, grade, rank_in_section, rank_in_class, result
       FROM exam_results WHERE exam_id = ANY($1::bigint[]) AND student_id = $2`,
    [input.examIds, input.studentId],
  );
  const resultByExam = new Map(res.rows.map((r) => [r.exam_id, r]));
  const examRows = exams.map((e) => {
    const r = resultByExam.get(e.id);
    return {
      id: e.id,
      code: e.code,
      name: e.name,
      maxTotal:
        r?.max_total ??
        fmt(subjects.reduce((a, srow) => a + Number(srow.cells[exams.indexOf(e)]?.max ?? 0), 0)),
      total: r?.total ?? null,
      pct: r?.pct ?? null,
      grade: r?.grade ?? null,
      rankInSection: r?.rank_in_section ?? null,
      rankInClass: r?.rank_in_class ?? null,
      result: r?.result ?? null,
    };
  });
  const termTotal = subjects.reduce((a, r) => a + Number(r.total ?? 0), 0);
  const termMax = subjects.reduce((a, r) => a + Number(r.maxTotal), 0);
  const complete =
    examRows.length > 0 && examRows.every((e) => e.result && e.result !== 'incomplete');
  const termPct = complete && termMax > 0 ? (termTotal / termMax) * 100 : null;
  const anyFail = examRows.some((e) => e.result === 'fail');
  // term rank: rank on the last exam of the term (the one families read), when computed
  const last = examRows[examRows.length - 1];

  // indicators of the term's exams, grouped by area (grade per exam)
  const ind = await c.query<{
    exam_id: string;
    area: string | null;
    code: string;
    name: string;
    sort_order: number;
    grade: string | null;
  }>(
    `SELECT es.exam_id::text, i.area, i.code, i.name, i.sort_order, ie.grade
       FROM exam_indicator_sets es JOIN indicators i ON i.set_id = es.set_id
       LEFT JOIN indicator_entries ie ON ie.exam_id = es.exam_id AND ie.indicator_id = i.id AND ie.student_id = $3
      WHERE es.exam_id = ANY($1::bigint[]) AND es.class_id = $2
        AND NOT EXISTS (SELECT 1 FROM indicators ch WHERE ch.parent_id = i.id)
      ORDER BY i.area NULLS LAST, i.sort_order, i.code`,
    [input.examIds, s.class_id, input.studentId],
  );
  const areas = new Map<
    string,
    Map<string, { code: string; name: string; grades: Array<string | null> }>
  >();
  for (const r of ind.rows) {
    const area = r.area ?? 'Co-scholastic';
    if (!areas.has(area)) areas.set(area, new Map());
    const items = areas.get(area)!;
    if (!items.has(r.code))
      items.set(r.code, { code: r.code, name: r.name, grades: exams.map(() => null) });
    const idx = exams.findIndex((e) => e.id === r.exam_id);
    if (idx >= 0) items.get(r.code)!.grades[idx] = r.grade;
  }

  const rem = await c.query<{ exam: string; remark: string }>(
    `SELECT e.code AS exam, r.remark FROM exam_remarks r JOIN exams e ON e.id = r.exam_id
      WHERE r.exam_id = ANY($1::bigint[]) AND r.student_id = $2 ORDER BY array_position($1::bigint[], r.exam_id)`,
    [input.examIds, input.studentId],
  );
  const att = await c.query<{ exam: string; days_present: number; days_total: number }>(
    `SELECT e.code AS exam, a.days_present, a.days_total FROM exam_attendance a JOIN exams e ON e.id = a.exam_id
      WHERE a.exam_id = ANY($1::bigint[]) AND a.student_id = $2 ORDER BY array_position($1::bigint[], a.exam_id)`,
    [input.examIds, input.studentId],
  );
  const hr = await c.query<{
    height_cm: string | null;
    weight_kg: string | null;
    bmi: string | null;
    blood_group: string | null;
    recorded_on: Date;
  }>(
    `SELECT height_cm::text, weight_kg::text, bmi::text, blood_group, recorded_on FROM health_records
      WHERE student_id = $1 ORDER BY (exam_id = ANY($2::bigint[])) DESC, recorded_on DESC LIMIT 1`,
    [input.studentId, input.examIds],
  );
  // docs/design/65 part 4: term results, signatures, the class teacher, codes, participation
  const tr = await c.query<{
    term_code: string;
    name: string;
    def: { columns: Array<{ key: string; label: string; hidden?: boolean; total?: boolean }> };
    subjects: ReportCardTermResult['subjects'];
    total: string | null;
    max_total: string;
    pct: string | null;
    grade: string | null;
    division: string | null;
    result: string;
    rank_in_section: number | null;
    rank_in_class: number | null;
  }>(
    `SELECT t.term_code, m.name, m.def, t.subjects, t.total::text, t.max_total::text, t.pct::text, t.grade, t.division, t.result,
            t.rank_in_section, t.rank_in_class
       FROM term_results t JOIN mark_schemes m ON m.id = t.scheme_id AND m.status = 'locked' AND m.deleted_at IS NULL
      WHERE t.student_id = $1 AND t.academic_year_id = app.current_academic_year_id()
      ORDER BY t.term_code`,
    [input.studentId],
  );
  const sig = await c.query<{
    role: string;
    label: string;
    person_name: string | null;
    object_key: string | null;
    content_type: string | null;
  }>(
    `SELECT DISTINCT ON (x.role) x.role, x.label, x.person_name, f.object_key, f.content_type
       FROM report_card_signatures x LEFT JOIN files f ON f.id = x.file_id AND f.deleted_at IS NULL
      WHERE x.status = 'active' AND (cardinality(x.class_ids) = 0 OR $1::bigint = ANY(x.class_ids))
      ORDER BY x.role, (cardinality(x.class_ids) > 0) DESC, x.sort_order, x.id`,
    [s.class_id],
  );
  const ct = await c.query<{ name: string }>(
    `SELECT concat_ws(' ', em.first_name, em.last_name) AS name
       FROM enrolments en JOIN teacher_assignments ta ON ta.class_section_id = en.class_section_id AND ta.kind = 'class_teacher'
                         AND ta.valid_to IS NULL AND ta.academic_year_id = en.academic_year_id
       JOIN employees em ON em.id = ta.employee_id
      WHERE en.student_id = $1 AND en.academic_year_id = app.current_academic_year_id() AND en.status = 'active'
      ORDER BY ta.id LIMIT 1`,
    [input.studentId],
  );
  const mc = await c.query<{ code: string; name: string }>(
    `SELECT code, name FROM mark_codes WHERE status = 'active' ORDER BY sort_order, code`,
  );
  const extra = await c.query<{ participation: string | null; promoted_to: string | null }>(
    `SELECT r.participation, r.promoted_to FROM exam_remarks r
      WHERE r.exam_id = ANY($1::bigint[]) AND r.student_id = $2
      ORDER BY array_position($1::bigint[], r.exam_id) DESC`,
    [input.examIds, input.studentId],
  );
  const num = (v: string | null) => (v === null ? null : Number(v));
  const fee = await c.query<{ balance: string }>(
    `SELECT COALESCE(sum(balance), 0)::text AS balance FROM mart.fee_dues WHERE student_id = $1 AND academic_year_id = app.current_academic_year_id() AND due_on <= CURRENT_DATE`,
    [input.studentId],
  );
  const balance = Number(fee.rows[0]?.balance ?? 0);
  const addr = school.address ?? {};
  return {
    school: {
      name: school.name,
      shortName: school.short_name,
      affiliationNo: school.affiliation_no,
      address: [addr.line1, addr.line2, addr.city, addr.state, addr.pincode]
        .filter(Boolean)
        .join(', '),
      phone: school.contact?.phone ?? null,
      logoDataUri: null,
    },
    release: { termCode: input.termCode, name: input.termName, academicYear: s.year_code },
    student: {
      id: s.id,
      name: s.name,
      admissionNo: s.admission_no,
      rollNo: s.roll_no,
      className: s.class_name,
      classCode: s.class_code,
      classId: s.class_id,
      section: s.section,
      band,
      dob: localDate(s.dob),
      gender: s.gender,
      house: s.house,
      father: s.father,
      mother: s.mother,
      photoObjectKey: s.object_key,
      photoContentType: s.content_type,
      photoDataUri: null,
    },
    exams: examRows,
    subjects,
    term: {
      total: complete ? fmt(termTotal) : null,
      maxTotal: fmt(termMax),
      pct: termPct === null ? null : fmt(termPct),
      grade: gradeFor(termPct, scale),
      result: !complete ? 'incomplete' : anyFail ? 'fail' : 'pass',
      rank: last?.rankInSection ?? null,
    },
    gradeScale: scale,
    indicators: [...areas.entries()].map(([area, items]) => ({ area, items: [...items.values()] })),
    remarks: rem.rows,
    attendance: att.rows.map((a) => ({
      exam: a.exam,
      present: a.days_present,
      total: a.days_total,
      pct: fmt((a.days_present / a.days_total) * 100),
    })),
    health: hr.rows[0]
      ? {
          heightCm: hr.rows[0].height_cm,
          weightKg: hr.rows[0].weight_kg,
          bmi: hr.rows[0].bmi,
          bloodGroup: hr.rows[0].blood_group,
          recordedOn: localDate(hr.rows[0].recorded_on),
        }
      : null,
    termResults: tr.rows.map((t) => ({
      term: t.term_code,
      name: t.name,
      columns: t.def.columns
        .filter((x) => !x.hidden)
        .map((x) => ({ key: x.key, label: x.label, total: Boolean(x.total) })),
      // additional subjects printed last
      subjects: [...t.subjects].sort(
        (a, b) => Number(a.kind === 'additional') - Number(b.kind === 'additional'),
      ),
      total: num(t.total),
      max: Number(t.max_total),
      pct: num(t.pct),
      grade: t.grade,
      division: t.division,
      result: t.result,
      rankInSection: t.rank_in_section,
      rankInClass: t.rank_in_class,
    })),
    signatures: sig.rows.map((x) => ({
      role: x.role,
      label: x.label,
      personName: x.person_name,
      objectKey: x.object_key,
      contentType: x.content_type,
      dataUri: null,
    })),
    classTeacher: ct.rows[0]?.name ?? null,
    codes: mc.rows,
    participation: extra.rows.find((x) => x.participation)?.participation ?? null,
    promotedTo: extra.rows.find((x) => x.promoted_to)?.promoted_to ?? null,
    hpc: await loadHpc(c, input.examIds, s.class_id, input.studentId),
    fees: { balance: fmt(balance), defaulter: balance > input.defaulterMin },
    today: localDate(new Date())!,
  };
}

/** docs/design/65 part 5: the HPC of the term's exams whose class set is one (the last exam's set). */
async function loadHpc(
  c: PoolClient,
  examIds: string[],
  classId: string,
  studentId: string,
): Promise<ReportCardHpc | null> {
  const sets = await c.query<{
    exam_id: string;
    code: string;
    set_id: string;
    grades: string[];
    level_words: Record<string, string>;
  }>(
    `SELECT es.exam_id::text, e.code, s.id::text AS set_id, s.grades, s.level_words
       FROM exam_indicator_sets es JOIN indicator_sets s ON s.id = es.set_id AND s.kind = 'hpc' AND s.deleted_at IS NULL
       JOIN exams e ON e.id = es.exam_id
      WHERE es.exam_id = ANY($1::bigint[]) AND es.class_id = $2
      ORDER BY array_position($1::bigint[], es.exam_id)`,
    [examIds, classId],
  );
  if (!sets.rows.length) return null;
  const last = sets.rows[sets.rows.length - 1]!;
  const hpcExams = sets.rows.map((x) => x.exam_id);
  const items = await c.query<{
    id: string;
    code: string;
    name: string;
    area: string | null;
    parent_id: string | null;
    kind: 'level' | 'text';
    description: string | null;
    descriptors: Record<string, string>;
  }>(
    `SELECT id::text, code, name, area, parent_id::text, kind, description, descriptors FROM indicators
      WHERE set_id = $1 ORDER BY sort_order, code`,
    [last.set_id],
  );
  // entries by the item's code (an exam may use another copy of the set)
  const ent = await c.query<{
    exam_id: string;
    code: string;
    grade: string | null;
    note: string | null;
  }>(
    `SELECT ie.exam_id::text, i.code, ie.grade, ie.note FROM indicator_entries ie JOIN indicators i ON i.id = ie.indicator_id
      WHERE ie.exam_id = ANY($1::bigint[]) AND ie.student_id = $2`,
    [hpcExams, studentId],
  );
  const node = (i: (typeof items.rows)[number]): ReportCardHpcItem => {
    const levels = hpcExams.map(
      (ex) => ent.rows.find((e) => e.exam_id === ex && e.code === i.code)?.grade ?? null,
    );
    const notes = hpcExams
      .map((ex) => ent.rows.find((e) => e.exam_id === ex && e.code === i.code)?.note ?? null)
      .filter(Boolean);
    const lastLevel = [...levels].reverse().find((l) => l) ?? null;
    return {
      code: i.code,
      name: i.name,
      kind: i.kind,
      description: i.description,
      levels,
      note: (notes[notes.length - 1] as string | undefined) ?? null,
      descriptor: lastLevel ? (i.descriptors?.[lastLevel] ?? null) : null,
      children: items.rows.filter((ch) => ch.parent_id === i.id).map(node),
    };
  };
  const areas = new Map<string, ReportCardHpcItem[]>();
  for (const i of items.rows.filter((x) => !x.parent_id)) {
    const area = i.area ?? 'Progress';
    if (!areas.has(area)) areas.set(area, []);
    areas.get(area)!.push(node(i));
  }
  const fb = await c.query<{ kind: 'self' | 'parent' | 'teacher'; text: string }>(
    `SELECT DISTINCT ON (kind) kind, text FROM hpc_feedback WHERE exam_id = ANY($1::bigint[]) AND student_id = $2
      ORDER BY kind, array_position($1::bigint[], exam_id) DESC`,
    [hpcExams, studentId],
  );
  const pf = await c.query<{
    caption: string | null;
    indicator: string | null;
    object_key: string | null;
    content_type: string | null;
  }>(
    `SELECT p.caption, i.name AS indicator, f.object_key, f.content_type
       FROM portfolio_items p JOIN files f ON f.id = p.file_id AND f.deleted_at IS NULL
       LEFT JOIN indicators i ON i.id = p.indicator_id
      WHERE p.exam_id = ANY($1::bigint[]) AND p.student_id = $2 AND p.deleted_at IS NULL
      ORDER BY p.created_at DESC LIMIT 6`,
    [hpcExams, studentId],
  );
  return {
    exams: sets.rows.map((x) => x.code),
    levels: last.grades,
    levelWords: last.level_words ?? {},
    areas: [...areas.entries()].map(([area, list]) => ({ area, items: list })),
    feedback: {
      self: fb.rows.find((x) => x.kind === 'self')?.text ?? null,
      parent: fb.rows.find((x) => x.kind === 'parent')?.text ?? null,
      teacher: fb.rows.find((x) => x.kind === 'teacher')?.text ?? null,
    },
    portfolio: pf.rows.reverse().map((x) => ({
      caption: x.caption,
      indicator: x.indicator,
      objectKey: x.object_key,
      contentType: x.content_type,
      dataUri: null,
    })),
  };
}

/** Preview data when no pupil is chosen (the designer). */
export function sampleReportCardData(band: ClassBand = 'primary'): ReportCardData {
  const exams = [
    {
      id: '1',
      code: 'PT1',
      name: 'Periodic Test 1',
      maxTotal: '120.00',
      total: '92.50',
      pct: '77.08',
      grade: 'B1',
      rankInSection: 1,
      rankInClass: 1,
      result: 'pass',
    },
    {
      id: '2',
      code: 'HY',
      name: 'Half Yearly',
      maxTotal: '240.00',
      total: '186.00',
      pct: '77.50',
      grade: 'B1',
      rankInSection: 2,
      rankInClass: 3,
      result: 'pass',
    },
  ];
  const subject = (code: string, name: string, m1: string, m2: string) => ({
    code,
    name,
    cells: [
      { marks: m1, max: '40.00', grade: 'B1', absent: false, exempt: false },
      { marks: m2, max: '80.00', grade: 'B1', absent: false, exempt: false },
    ],
    total: fmt(Number(m1) + Number(m2)),
    maxTotal: '120.00',
    pct: fmt(((Number(m1) + Number(m2)) / 120) * 100),
    grade: 'B1',
  });
  return {
    school: {
      name: 'Alpha Public School',
      shortName: 'APS',
      affiliationNo: '2130001',
      address: 'Sector 30, Noida, Uttar Pradesh, 201301',
      phone: '0120-4000000',
      logoDataUri: null,
    },
    release: { termCode: 'T1', name: 'Term 1 (2026-27)', academicYear: '2026-27' },
    student: {
      id: '0',
      name: 'Aarav Sharma',
      admissionNo: 'A2481',
      rollNo: 1,
      className: 'Class VI',
      classCode: 'VI',
      section: 'A',
      band,
      dob: '2014-06-12',
      gender: 'male',
      house: 'Red',
      father: 'Suresh Sharma',
      mother: 'Anita Sharma',
      photoObjectKey: null,
      photoContentType: null,
      photoDataUri: null,
    },
    exams,
    subjects: [
      subject('ENG', 'English', '27.50', '62.00'),
      subject('HIN', 'Hindi', '30.00', '58.00'),
      subject('MAT', 'Mathematics', '35.00', '66.00'),
    ],
    term: {
      total: '278.50',
      maxTotal: '360.00',
      pct: '77.36',
      grade: 'B1',
      result: 'pass',
      rank: 2,
    },
    gradeScale: [
      { grade: 'A1', minPct: '91.00', maxPct: '100.00', remark: 'Outstanding' },
      { grade: 'A2', minPct: '81.00', maxPct: '90.99', remark: 'Excellent' },
      { grade: 'B1', minPct: '71.00', maxPct: '80.99', remark: 'Very good' },
      { grade: 'B2', minPct: '61.00', maxPct: '70.99', remark: 'Good' },
      { grade: 'C1', minPct: '51.00', maxPct: '60.99', remark: 'Fair' },
      { grade: 'C2', minPct: '41.00', maxPct: '50.99', remark: 'Average' },
      { grade: 'D', minPct: '33.00', maxPct: '40.99', remark: 'Below average' },
      { grade: 'E', minPct: '0.00', maxPct: '32.99', remark: 'Needs improvement' },
    ],
    indicators: [
      {
        area: 'Work education',
        items: [{ code: 'WE', name: 'Work education', grades: ['A', 'A'] }],
      },
      { area: 'Art', items: [{ code: 'ART', name: 'Art education', grades: ['B', 'A'] }] },
      {
        area: 'Health',
        items: [{ code: 'HPE', name: 'Health and physical education', grades: ['A', 'A'] }],
      },
      { area: 'Discipline', items: [{ code: 'DIS', name: 'Discipline', grades: ['A', 'A'] }] },
    ],
    remarks: [
      {
        exam: 'HY',
        remark: 'Attentive in class and consistent in homework; needs practice in geometry.',
      },
    ],
    attendance: [
      { exam: 'PT1', present: 58, total: 60, pct: '96.67' },
      { exam: 'HY', present: 112, total: 118, pct: '94.92' },
    ],
    health: {
      heightCm: '142.0',
      weightKg: '36.50',
      bmi: '18.11',
      bloodGroup: 'B+',
      recordedOn: '2026-09-15',
    },
    fees: { balance: '0.00', defaulter: false },
    today: '2026-09-28',
    // the DPS Noida cards' parts (docs/design/65 part 4): two terms of a VI-VIII scheme, signatures
    termResults: ['T1', 'T2'].map((term, i) => {
      const cols = [
        { key: 'PT', label: 'Periodic test (15)', total: false },
        { key: 'SE', label: 'Subject enrichment (5)', total: false },
        { key: 'TERM', label: term === 'T1' ? 'Half-yearly (80)' : 'Yearly (80)', total: false },
        { key: 'TOT', label: 'Marks obtained (100)', total: true },
      ];
      const row = (code: string, name: string, pt: number, se: number, ex: number) => ({
        code,
        name,
        kind: 'compulsory',
        values: {
          PT: { v: pt, max: 15 },
          SE: { v: se, max: 5 },
          TERM: { v: ex, max: 80 },
          TOT: { v: Math.round(pt + se + ex), max: 100 },
        },
        total: Math.round(pt + se + ex),
        max: 100,
        grade: pt + se + ex >= 81 ? 'A2' : 'B1',
        status: 'pass',
      });
      const subjects = [
        row('ENG', 'English', 12.75 + i, 4.5, 62 + i * 4),
        row('MAT', 'Mathematics', 14, 5, 70 - i * 2),
      ];
      const total = subjects.reduce((a, x) => a + (x.total ?? 0), 0);
      return {
        term,
        name: term === 'T1' ? 'Term 1' : 'Term 2',
        columns: cols,
        subjects,
        total,
        max: 200,
        pct: total / 2,
        grade: 'A2',
        division: 'First',
        result: 'pass',
        rankInSection: 3 - i,
        rankInClass: 5 - i,
      };
    }),
    signatures: [
      {
        role: 'class_teacher',
        label: 'Class teacher',
        personName: null,
        objectKey: null,
        contentType: null,
        dataUri: null,
      },
      {
        role: 'principal',
        label: 'Principal',
        personName: null,
        objectKey: null,
        contentType: null,
        dataUri: null,
      },
    ],
    classTeacher: 'Meera Joshi',
    codes: [
      { code: 'AB', name: 'Absent' },
      { code: 'ML', name: 'Medical leave' },
    ],
    participation: 'Inter-house debate, science exhibition',
    promotedTo: band === 'senior' ? null : 'Class VIII',
    hpc: band === 'pre_primary' || band === 'primary' ? sampleHpc() : null,
  };
}

function sampleHpc(): ReportCardHpc {
  const item = (
    code: string,
    name: string,
    levels: Array<string | null>,
    descriptor: string | null = null,
  ): ReportCardHpcItem => ({
    code,
    name,
    kind: 'level',
    description: null,
    levels,
    note: null,
    descriptor,
    children: [],
  });
  return {
    exams: ['T1', 'T2'],
    levels: ['Beginner', 'Progressing', 'Proficient'],
    levelWords: { Beginner: 'Stream', Progressing: 'Mountain', Proficient: 'Sky' },
    areas: [
      {
        area: 'Physical development',
        items: [
          {
            ...item('PD3', 'Has a fit and flexible body', [null, null]),
            children: [
              item('PD3A', 'Runs, jumps, climbs and balances with control', [
                'Progressing',
                'Proficient',
              ]),
              item(
                'PD3B',
                'Uses the fingers with control',
                ['Beginner', 'Progressing'],
                'Holds a crayon; tears paper with help',
              ),
            ],
          },
        ],
      },
      {
        area: 'Language and literacy',
        items: [
          {
            ...item('LL1', 'Talks and listens well', [null, null]),
            children: [
              item('LL1A', 'Listens and answers; speaks in full sentences', [
                'Progressing',
                'Progressing',
              ]),
              {
                ...item('LL1N', 'What the teacher noticed', [null, null]),
                kind: 'text',
                note: 'Retells a story in her own words with joy',
              },
            ],
          },
        ],
      },
    ],
    feedback: {
      self: 'I like drawing and playing with my friends. I can count to fifty.',
      parent: 'She reads picture books at home every evening.',
      teacher: 'A cheerful learner who helps her friends.',
    },
    portfolio: [
      {
        caption: 'My drawing of a tree',
        indicator: null,
        objectKey: null,
        contentType: null,
        dataUri: null,
      },
    ],
  };
}
