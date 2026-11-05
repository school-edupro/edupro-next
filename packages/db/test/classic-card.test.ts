import { describe, expect, it } from 'vitest';
import {
  clCoHealth,
  clDiscipline,
  clExamMarks,
  clGradeKey,
  clHeader,
  clRemark,
  clSign,
  clStudent,
  clTermMarks,
  isClassicCard,
} from '../src/classic-card-html';
import { sampleReportCardData, type ReportCardData } from '../src/report-card-data';
import {
  CLASSIC_SLIP_LAYOUT,
  CLASSIC_TERM_LAYOUT,
  READY_MADE_TEMPLATES,
  TEST_SLIP_TEMPLATES,
  reportCardDocument,
} from '../src/report-card-html';

/** the visible text of some HTML, spaces squeezed */
const text = (html: string) =>
  html
    .replace(/<br \/>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
/** each row's cells' text */
const rows = (html: string) =>
  [...html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((m) =>
    [...m[1]!.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((c) => text(c[1]!)),
  );

const term = (): ReportCardData => sampleReportCardData('middle');
const slip = (): ReportCardData => {
  const d = term();
  return {
    ...d,
    release: { termCode: 'PT1', name: 'Periodic Test 1', academicYear: '2026-27' },
    exams: d.exams.slice(0, 1),
    subjects: d.subjects.map((r) => ({ ...r, cells: r.cells.slice(0, 1) })),
    term: { ...d.term, total: '92.50', maxTotal: '120.00', pct: '77.08', grade: 'B1' },
  };
};

describe('the classic card (docs/design/74)', () => {
  it('header: the school with its affiliation, a logo each side, the session and the title', () => {
    const d = term();
    const h = clHeader(d, { type: 'cl_header' }, { logo_2: 'data:image/png;base64,AA' });
    expect(text(h)).toBe(
      'Alpha Public School ( Sector 30, Noida, Uttar Pradesh, 201301 ) Affiliated to CBSE, Delhi, Affiliation No. 2130001 ACADEMIC SESSION: 2026-2027 REPORT CARD',
    );
    expect(h).toContain('alt="Emblem"');
    // an exam card: the release's name is the title; no affiliation number, no line
    const s = clHeader(
      { ...slip(), school: { ...d.school, affiliationNo: null } },
      { type: 'cl_header', releaseTitle: true },
    );
    expect(text(s)).toContain('ACADEMIC SESSION: 2026-2027 PERIODIC TEST 1');
    expect(s).not.toContain('Affiliated');
  });

  it('pupil: two columns of label : value', () => {
    expect(text(clStudent(term()))).toBe(
      "Student's Name : Aarav Sharma Father's Name : Suresh Sharma Mother's Name : Anita Sharma Admission No. : A2481 Roll No. : 1 Class / Section : VI-A",
    );
  });

  it("term marks: the term's parts with two decimals, the marks obtained and the grade", () => {
    const r = rows(clTermMarks(term(), { type: 'cl_term_marks' }));
    expect(r[0]).toEqual(['SCHOLASTIC AREAS', 'TERM-1 (100 Marks)']);
    expect(r[1]).toEqual([
      'SUBJECT NAME',
      'Periodic test (15)',
      'Subject enrichment (5)',
      'Half-yearly (80)',
      'Marks obtained (100)',
      'GRADE',
    ]);
    expect(r[2]).toEqual(['English', '12.75', '4.50', '62.00', '79', 'B1']);
    // no total rows; Term 2 on its own
    expect(r).toHaveLength(4);
    // a subject with another maximum: the term is headed by the one most subjects have
    const d = term();
    const t1 = d.termResults![0]!;
    const odd = {
      ...d,
      termResults: [
        {
          ...t1,
          subjects: [...t1.subjects, { ...t1.subjects[0]!, code: 'FR', name: 'French', max: 80 }],
        },
      ],
    };
    expect(rows(clTermMarks(odd, { type: 'cl_term_marks' }))[0]).toEqual([
      'SCHOLASTIC AREAS',
      'TERM-1 (100 Marks)',
    ]);
    const t2 = rows(
      clTermMarks(term(), { type: 'cl_term_marks', terms: ['T2'], termLabel: 'TERM-2' }),
    );
    expect(t2[0]).toEqual(['SCHOLASTIC AREAS', 'TERM-2 (100 Marks)']);
    expect(t2[1]![3]).toBe('Yearly (80)');
    expect(text(clTermMarks({ ...term(), termResults: [] }, { type: 'cl_term_marks' }))).toBe(
      'The term results are not worked out yet.',
    );
  });

  it('exam marks (the slip): maximum, obtained, grade; the total and the percentage', () => {
    const r = rows(clExamMarks(slip(), { type: 'cl_exam_marks' }));
    expect(r[0]).toEqual(['SCHOLASTIC AREAS', 'PERIODIC TEST 1']);
    expect(r[1]).toEqual(['SUBJECT NAME', 'Maximum Marks', 'Marks Obtained', 'GRADE']);
    expect(r[2]).toEqual(['English', '40', '27.5', 'B1']);
    expect(r.at(-2)).toEqual(['TOTAL', '120', '92.5', 'B1']);
    expect(r.at(-1)).toEqual(['PERCENTAGE', '77.08%']);
    // several tests on one card: each one's marks and grade, then the total
    const two = rows(clExamMarks(term(), { type: 'cl_exam_marks' }));
    expect(two[0]).toEqual(['SUBJECT NAME', 'PT1 (120)', 'HY (240)', 'TOTAL']);
    expect(two[2]).toEqual(['English', '27.5', 'B1', '62', 'B1', '89.5 / 120', 'B1']);
    expect(two.at(-2)).toEqual(['TOTAL', '278.5 / 360', 'B1']);
  });

  it('co-scholastic beside health and attendance, the rows meeting; discipline on its own', () => {
    const d = term();
    const r = rows(clCoHealth(d, { type: 'cl_co_health' }));
    expect(r[0]).toEqual([
      'CO-SCHOLASTIC AREAS: TERM 1 [on a 3-point [A-C] Grading Scale]',
      'GRADE',
      '',
      'Health Status',
    ]);
    expect(r[1]).toEqual(['Work education', 'A', '', 'Height (cm)', '142']);
    expect(r[2]).toEqual(['Art education', 'A', '', 'Weight (kg)', '36.5']);
    expect(r[4]).toEqual(['', '', '', 'No. of Working Days', '118']);
    expect(r[6]).toEqual(['', '', '', '% of Attendance', '94.9%']);
    // Discipline is not among them, and every row has its five cells
    expect(r.flat()).not.toContain('Discipline');
    // five cells a row (the Attendance heading spans two)
    expect(r.slice(1).map((x) => x.length)).toEqual([5, 5, 4, 5, 5, 5]);
    expect(rows(clDiscipline(d, { type: 'cl_discipline' }))).toEqual([
      ['', 'GRADE'],
      ['Discipline (ON A 3-POINT[A-C] GRADING SCALE)', 'A'],
    ]);
    // more areas than the right side: the right side takes blank rows
    const many = {
      ...d,
      indicators: [
        {
          area: 'Co-scholastic',
          items: 'ABCDEFGH'
            .split('')
            .map((x) => ({ code: x, name: `Area ${x}`, grades: ['A', null] })),
        },
      ],
    };
    const m = rows(clCoHealth(many, { type: 'cl_co_health' }));
    expect(m).toHaveLength(9);
    expect(m[8]).toEqual(['Area H', 'A', '', '', '']);
  });

  it("the remark: the class teacher's name, the general remark and the categories' words", () => {
    const d = {
      ...term(),
      remarkItems: [
        { code: 'AP', category: 'Academic progress', subject: null, text: 'Reads widely.' },
        { code: 'CD', category: 'Conduct', subject: null, text: 'Helps others.' },
      ],
    };
    const r = rows(clRemark(d, { type: 'cl_remark' }));
    expect(r[0]).toEqual(["CLASS TEACHER'S REMARK : ( MEERA JOSHI )"]);
    expect(clRemark(d, { type: 'cl_remark' })).toContain(
      'needs practice in geometry.\nReads widely.\nHelps others.',
    );
  });

  it('place, date, the six signing places with their images, the seal', () => {
    const d = {
      ...term(),
      signatures: [
        {
          role: 'principal',
          label: 'Principal',
          personName: null,
          objectKey: null,
          contentType: null,
          dataUri: 'data:image/png;base64,PP',
        },
        {
          role: 'seal',
          label: 'Seal',
          personName: null,
          objectKey: null,
          contentType: null,
          dataUri: 'data:image/png;base64,SS',
        },
      ],
    };
    const h = clSign(d, { type: 'cl_sign', roles: CLASSIC_TERM_LAYOUT.sections[6]!.roles });
    expect(text(h)).toBe(
      'PLACE: NOIDA DATE: 28-09-2026 Parent Class Teacher Coordinator Vice Principal Principal School Seal',
    );
    expect(h).toContain('base64,PP');
    expect(h).toContain('alt="School seal"');
    expect(h).toContain('--n:6');
  });

  it("the grading key: the scale's bands as marks ranges over their grades", () => {
    const r = rows(clGradeKey(term(), { type: 'cl_grade_key' }));
    expect(r[0]).toEqual([
      'Grading Scale For Scholastic Areas : Grades are awarded on an 8-point grading scale as follows',
    ]);
    expect(r[1]).toEqual([
      'Marks Range',
      '91-100',
      '81-90',
      '71-80',
      '61-70',
      '51-60',
      '41-50',
      '33-40',
      '32 & Below',
    ]);
    expect(r[2]).toEqual([
      'GRADE',
      'A1',
      'A2',
      'B1',
      'B2',
      'C1',
      'C2',
      'D',
      'E (Needs Improvement)',
    ]);
  });

  it('the designs: the Term 1 card ready-made, the VI-VIII slip classic, the other slips as they were', () => {
    expect(READY_MADE_TEMPLATES.find((t) => t.code === 'rc_vi_viii_t1')).toMatchObject({
      name: 'Report card VI-VIII (Term 1)',
      band: 'middle',
      layout: CLASSIC_TERM_LAYOUT,
    });
    expect(TEST_SLIP_TEMPLATES.find((t) => t.band === 'middle')!.layout).toBe(CLASSIC_SLIP_LAYOUT);
    expect(
      isClassicCard(TEST_SLIP_TEMPLATES.find((t) => t.band === 'primary')!.layout.sections),
    ).toBe(false);
    // one ruled frame per pupil, a page break between two
    const t = {
      layout: CLASSIC_TERM_LAYOUT,
      bodyHtml: null,
      stylesCss: '',
      pageWidth: '210mm',
      pageHeight: '297mm',
    };
    const doc = reportCardDocument(t, [{ data: term() }, { data: term() }]);
    expect(doc.match(/<div class="cl">/g)).toHaveLength(2);
    expect(doc.match(/class="page-break"/g)).toHaveLength(1);
  });
});
