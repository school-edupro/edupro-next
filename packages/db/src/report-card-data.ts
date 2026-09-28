/**
 * Report-card data assembly (Sprint 17). One shape for every band: the pupil, the term's exams with
 * marks and grades per subject, totals and rank per exam, the co-scholastic indicators, remarks,
 * exam attendance, health, and the fee-defaulter flag the visibility rule reads. Runs under the
 * caller's tenant context (RLS); bound parameters only.
 */
import type { PoolClient } from 'pg';

export type ClassBand = 'primary' | 'middle' | 'secondary' | 'senior';

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
}

const fmt = (n: number) => n.toFixed(2);
const localDate = (d: Date | string | null): string | null => {
  if (!d) return null;
  if (typeof d === 'string') return d.slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Band from the class row, else from its order (1-5 primary, 6-8 middle, 9-10 secondary, 11-12 senior). */
export function bandFor(band: string | null, displayOrder: number): ClassBand {
  if (band === 'primary' || band === 'middle' || band === 'secondary' || band === 'senior')
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
  }>(
    `SELECT es.exam_id::text, sub.code AS subject_code, sub.name AS subject_name, sub.display_order, es.max_marks::text,
            m.marks::text, m.absent, m.exempt
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
    const pct = marks !== null && !r.exempt ? (Number(marks) / Number(r.max_marks)) * 100 : null;
    row.cellsByExam.set(r.exam_id, {
      marks,
      max: r.max_marks,
      grade: gradeFor(pct, scale),
      absent: r.absent === true,
      exempt: r.exempt === true,
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
    fees: { balance: fmt(balance), defaulter: balance > input.defaulterMin },
    today: localDate(new Date())!,
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
  };
}
