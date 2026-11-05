/**
 * The classic card (docs/design/74): one A4 page of ruled boxes, as the school's old Term 1 card for
 * VI-VIII — the header with a logo on each side, the pupil in "label : value" columns, the term's
 * marks (its parts, the marks obtained and the grade) or one exam's marks (the periodic test slip),
 * the co-scholastic grades beside health and attendance, discipline, the class teacher's remark,
 * place and date, the signatures with their images and the seal, and the grading key as a table.
 */
import type { ReportCardData } from './report-card-data';

/** the options of a classic section (a subset of ReportCardSection, kept here to avoid a cycle) */
export interface ClSection {
  type: string;
  title?: string;
  /** cl_header: the release's name as the title (an exam card: "PERIODIC TEST 1") */
  releaseTitle?: boolean;
  /** cl_term_marks: the term printed (its code; default the release's term, else the first) */
  terms?: string[];
  /** cl_term_marks: the term's heading (default TERM-1 from T1) */
  termLabel?: string;
  /** cl_term_marks: decimals of the parts (default 2) */
  decimals?: number;
  /** cl_co_health: the line after the title (default "[on a 3-point [A-C] Grading Scale]") */
  note?: string;
  /** cl_co_health, cl_discipline: the discipline area (default Discipline) */
  areas?: string[];
  /** cl_sign: the signing roles (the seal follows them) */
  roles?: string[];
}

/** the pictures a classic card prints (docs/design/73's slots): the emblem on the right */
export interface ClArt {
  logo_2?: string | null;
}

export const CL_SECTION_TYPES = [
  'cl_header',
  'cl_student',
  'cl_term_marks',
  'cl_exam_marks',
  'cl_co_health',
  'cl_discipline',
  'cl_remark',
  'cl_sign',
  'cl_grade_key',
] as const;

export const isClassicCard = (sections: Array<{ type: string }>): boolean =>
  sections.some((s) => s.type.startsWith('cl_'));

const esc = (v: unknown): string =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
const img = (src: string | null | undefined, alt = '') =>
  src ? `<img src="${src}" alt="${esc(alt)}" />` : '';
/** 54.00 → 54, 157.60 → 157.6 */
const plain = (v: string | number | null | undefined): string => {
  if (v === null || v === undefined || v === '') return '';
  const n = Number(v);
  return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : String(v);
};
const titleCase = (v: string) =>
  v.toLowerCase().replace(/(^|[\s(-])([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase());

export const CL_CSS = `
  .page:has(.cl) { padding: 8mm 7mm !important; }
  .cl { border: 1px solid #3C9D4E; font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 10pt; line-height: 1.25; }
  .cl * { box-sizing: border-box; }
  .rc .cl tr:nth-child(even) td { background: transparent; }
  .cl-head { display: flex; align-items: center; gap: 4mm; padding: 2mm 3mm; border-bottom: 1px solid #3C9D4E; }
  .cl-head .lg { width: 24mm; height: 22mm; display: flex; align-items: center; justify-content: center; flex: none; }
  .cl-head .lg img { max-width: 100%; max-height: 100%; object-fit: contain; }
  .cl-head .sc { flex: 1; text-align: center; color: #1E8A3C; }
  .cl-head .n { font-size: 17pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.01em; }
  .cl-head .a { font-size: 11pt; text-transform: uppercase; }
  .cl-head .f { font-size: 9pt; }
  .cl-title { text-align: center; font-weight: 700; font-size: 12.5pt; padding: 2mm 0 1.5mm; line-height: 1.2; }
  .cl-pupil { display: grid; grid-template-columns: 1.45fr 1fr; padding: 0 2mm 1.5mm; }
  .cl-kv { display: grid; grid-template-columns: 32mm 5mm 1fr; font-size: 10.5pt; line-height: 1.65; }
  .cl-kv .k { font-weight: 700; }
  .cl-kv .v { text-transform: uppercase; }
  .cl-sep { height: 2.2mm; border-top: 1px solid #3C9D4E; }
  .rc .cl table.cl-t { width: 100%; border-collapse: collapse; margin: 0; table-layout: fixed; }
  .rc .cl .cl-t th, .rc .cl .cl-t td { border: 1px solid #3C9D4E; padding: 1mm 1.6mm; font-size: 10.5pt; height: 7.6mm;
    vertical-align: middle; color: #111; }
  .rc .cl .cl-t th { background: #E9E9E9; font-weight: 700; text-align: center; text-transform: none; letter-spacing: 0; }
  .rc .cl .cl-t th.l, .rc .cl .cl-t td.l { text-align: left; }
  .rc .cl .cl-t td.c { text-align: center; }
  .rc .cl .cl-t td.u, .rc .cl .cl-t th.u { text-transform: uppercase; }
  .cl-t tr > :first-child { border-left: 0 !important; }
  .cl-t tr > :last-child { border-right: 0 !important; }
  .rc .cl .cl-side td.gap { border-top: 0; border-bottom: 0; padding: 0; background: #fff; }
  .rc .cl .cl-rem td { height: auto; min-height: 14mm; vertical-align: top; padding: 1.6mm 1.6mm 2.4mm; white-space: pre-line; }
  .cl-pd { display: flex; justify-content: space-between; padding: 1.6mm 1.6mm 0; font-size: 10.5pt; }
  .cl-pd b { margin-right: 2mm; }
  .cl-sign { display: grid; grid-template-columns: repeat(var(--n), 1fr); align-items: end; padding: 0 1.6mm 1.4mm; }
  .cl-sign > div { text-align: center; font-weight: 700; font-size: 10.5pt; }
  .cl-sign .im { height: 15mm; display: flex; align-items: flex-end; justify-content: center; }
  .cl-sign .im img { max-height: 15mm; max-width: 30mm; object-fit: contain; }
  .cl-sign .stamp img { max-height: 17mm; max-width: 22mm; }
  .rc .cl .cl-key td, .rc .cl .cl-key th { height: 6.6mm; font-size: 10pt; }
  .rc .cl .cl-key th { background: #fff; font-weight: 400; text-align: left; }
`;

/** the term card's term: the release's, else the first worked out */
function termOf(d: ReportCardData, s: ClSection) {
  const all = d.termResults ?? [];
  const want = s.terms?.[0] ?? d.release.termCode;
  return all.find((t) => t.term === want) ?? all[0] ?? null;
}

/** the period a section speaks of: TERM 1 for T1, else the release's name (PERIODIC TEST 1) */
function periodOf(d: ReportCardData, dash = false): string {
  const m = /^T(\d+)$/i.exec(d.release.termCode);
  if (m) return `TERM${dash ? '-' : ' '}${m[1]!}`;
  return d.release.name.toUpperCase();
}

/** 2026-27 → 2026-2027 */
const session = (y: string) => {
  const m = /^(\d{2})(\d{2})-(\d{2})$/.exec(y);
  return m ? `${m[1]!}${m[2]!}-${m[1]!}${m[3]!}` : y;
};

export function clHeader(d: ReportCardData, s: ClSection, art: ClArt = {}): string {
  const board = d.school.board ?? 'CBSE';
  const aff = d.school.affiliationNo
    ? `Affiliated to ${esc(board)}${board === 'CBSE' ? ', Delhi' : ''}, Affiliation No. ${esc(d.school.affiliationNo)}`
    : '';
  const title = s.releaseTitle ? d.release.name.toUpperCase() : (s.title ?? 'REPORT CARD');
  return `<div class="cl-head">
    <div class="lg">${img(d.school.logoDataUri, 'Logo')}</div>
    <div class="sc"><div class="n">${esc(d.school.name)}</div>${d.school.address ? `<div class="a">( ${esc(d.school.address)} )</div>` : ''}${aff ? `<div class="f">${aff}</div>` : ''}</div>
    <div class="lg">${img(art.logo_2, 'Emblem')}</div>
  </div><div class="cl-title">ACADEMIC SESSION: ${esc(session(d.release.academicYear))}<br />${esc(title)}</div>`;
}

export function clStudent(d: ReportCardData): string {
  const kv = (k: string, v: unknown) =>
    `<span class="k">${esc(k)}</span><span>:</span><span class="v">${esc(v ?? '')}</span>`;
  const st = d.student;
  return `<div class="cl-pupil"><div class="cl-kv">${kv("Student's Name", st.name)}${kv("Father's Name", st.father)}${kv("Mother's Name", st.mother)}</div><div class="cl-kv">${kv('Admission No.', st.admissionNo)}${kv('Roll No.', st.rollNo ?? '')}${kv('Class / Section', `${st.classCode}-${st.section}`)}</div></div>`;
}

/** the term's marks: its parts (Periodic test (15) …), the marks obtained and the grade */
export function clTermMarks(d: ReportCardData, s: ClSection): string {
  const t = termOf(d, s);
  if (!t)
    return `<div class="cl-sep"></div><table class="cl-t"><tbody><tr><td class="l">The term results are not worked out yet.</td></tr></tbody></table>`;
  const parts = t.columns.filter((c) => !c.total);
  const total = t.columns.find((c) => c.total);
  const maxes = [...new Set(t.subjects.map((x) => x.max).filter((x) => x > 0))];
  const label = s.termLabel ?? periodOf(d, true);
  const marks = maxes.length === 1 ? ` (${plain(maxes[0])} Marks)` : '';
  const dec = s.decimals ?? 2;
  const cell = (v: { v: number | null; code?: string } | null | undefined, fixed: boolean) =>
    !v
      ? ''
      : v.code && (v.v === null || v.v === 0)
        ? esc(v.code)
        : v.v === null
          ? ''
          : fixed
            ? v.v.toFixed(dec)
            : plain(v.v);
  const head = (l: string) => esc(l).replace(/\s*\((\d+(?:\.\d+)?)\)$/, '<br />($1)');
  const rows = t.subjects
    .map(
      (x) =>
        `<tr><td class="l u">${esc(x.name)}${x.kind === 'additional' ? ' (ADDITIONAL)' : ''}</td>${parts
          .map((c) => `<td class="c">${cell(x.values[c.key], true)}</td>`)
          .join(
            '',
          )}<td class="c">${total ? cell(x.values[total.key] ?? { v: x.total }, false) : plain(x.total)}</td><td class="c">${esc(x.grade ?? '')}</td></tr>`,
    )
    .join('');
  const width = Math.max(24, 100 - 15 * (parts.length + 2));
  return `<div class="cl-sep"></div><table class="cl-t"><colgroup><col style="width:${width}%" />${parts.map(() => '<col />').join('')}<col /><col style="width:10%" /></colgroup><thead>
    <tr><th class="l">SCHOLASTIC AREAS</th><th colspan="${parts.length + 2}">${esc(label)}${esc(marks)}</th></tr>
    <tr><th>SUBJECT NAME</th>${parts.map((c) => `<th>${head(c.label)}</th>`).join('')}<th>${head(total?.label ?? `Marks Obtained${maxes.length === 1 ? ` (${plain(maxes[0])})` : ''}`)}</th><th>GRADE</th></tr>
  </thead><tbody>${rows}</tbody></table>`;
}

/** one exam's marks (the periodic test slip): maximum, obtained, grade; the total and % under them */
export function clExamMarks(d: ReportCardData, s: ClSection): string {
  const e = d.exams[0];
  const cellText = (c: ReportCardData['subjects'][number]['cells'][number]) =>
    c.code
      ? esc(c.code)
      : Number(c.max) === 0
        ? esc(c.grade ?? '')
        : c.exempt
          ? 'EX'
          : c.absent
            ? 'AB'
            : esc(plain(c.marks));
  const foot = (span: number) => `
    <tr><td class="l"><b>TOTAL</b></td><td class="c" colspan="${String(span)}"><b>${esc(plain(d.term.total))} / ${esc(plain(d.term.maxTotal))}</b></td><td class="c"><b>${esc(d.term.grade ?? '')}</b></td></tr>
    <tr><td class="l"><b>PERCENTAGE</b></td><td class="c" colspan="${String(span + 1)}"><b>${d.term.pct ? `${esc(plain(d.term.pct))}%` : ''}</b></td></tr>`;
  const name = (r: ReportCardData['subjects'][number]) =>
    `<td class="l u">${esc(r.name)}${r.kind === 'additional' ? ' (ADDITIONAL)' : ''}</td>`;
  if (d.exams.length > 1) {
    // several tests on one card: each test's marks and grade, then the total
    const head1 = d.exams
      .map((x) => `<th colspan="2">${esc(x.code)} (${esc(plain(x.maxTotal))})</th>`)
      .join('');
    const head2 = d.exams.map(() => '<th>Marks</th><th>GRADE</th>').join('');
    const body = d.subjects
      .map(
        (r) =>
          `<tr>${name(r)}${r.cells.map((c) => `<td class="c">${cellText(c)}</td><td class="c">${esc(c.grade ?? '')}</td>`).join('')}<td class="c">${esc(plain(r.total))} / ${esc(plain(r.maxTotal))}</td><td class="c">${esc(r.grade ?? '')}</td></tr>`,
      )
      .join('');
    return `<div class="cl-sep"></div><table class="cl-t"><colgroup><col style="width:28%" /></colgroup><thead>
    <tr><th class="l" rowspan="2">SUBJECT NAME</th>${head1}<th colspan="2">TOTAL</th></tr>
    <tr>${head2}<th>Marks</th><th>GRADE</th></tr>
  </thead><tbody>${body}${foot(d.exams.length * 2)}</tbody></table>`;
  }
  const rows = d.subjects
    .map((r) => {
      const c = r.cells[0];
      if (!c) return '';
      return `<tr>${name(r)}<td class="c">${Number(c.max) === 0 ? '—' : esc(plain(c.max))}</td><td class="c">${cellText(c)}</td><td class="c">${esc(c.grade ?? '')}</td></tr>`;
    })
    .join('');
  const title = s.title ?? (e ? e.name.toUpperCase() : d.release.name.toUpperCase());
  return `<div class="cl-sep"></div><table class="cl-t"><colgroup><col style="width:46%" /><col /><col /><col style="width:14%" /></colgroup><thead>
    <tr><th class="l">SCHOLASTIC AREAS</th><th colspan="3">${esc(title)}</th></tr>
    <tr><th>SUBJECT NAME</th><th>Maximum Marks</th><th>Marks Obtained</th><th>GRADE</th></tr>
  </thead><tbody>${rows}
    <tr><td class="l"><b>TOTAL</b></td><td class="c"><b>${esc(plain(d.term.maxTotal))}</b></td><td class="c"><b>${esc(plain(d.term.total))}</b></td><td class="c"><b>${esc(d.term.grade ?? '')}</b></td></tr>
    <tr><td class="l"><b>PERCENTAGE</b></td><td class="c" colspan="3"><b>${d.term.pct ? `${esc(plain(d.term.pct))}%` : ''}</b></td></tr>
  </tbody></table>`;
}

const isDiscipline = (s: ClSection) => {
  const names = (s.areas?.length ? s.areas : ['Discipline']).map((x) => x.toLowerCase());
  return (area: string, item?: string) =>
    names.includes(area.toLowerCase()) || (!!item && names.includes(item.toLowerCase()));
};
/** an item's grade in the card's period: the last exam that has one */
const lastGrade = (grades: Array<string | null>) =>
  [...grades].reverse().find((g) => g !== null && g !== '') ?? '';

/** the co-scholastic grades on the left; health and attendance on the right (one table: the rows meet) */
export function clCoHealth(d: ReportCardData, s: ClSection): string {
  const disc = isDiscipline(s);
  const items = d.indicators.flatMap((a) =>
    disc(a.area) ? [] : a.items.filter((i) => !disc('', i.name)),
  );
  const att = [...d.attendance].reverse().find((a) => a.total > 0) ?? null;
  const right = [
    `<td class="l">Height (cm)</td><td class="c">${esc(plain(d.health?.heightCm))}</td>`,
    `<td class="l">Weight (kg)</td><td class="c">${esc(plain(d.health?.weightKg))}</td>`,
    `<th colspan="2">Attendance</th>`,
    `<td class="l">No. of Working Days</td><td class="c">${att ? att.total : ''}</td>`,
    `<td class="l">No. of Days Attended</td><td class="c">${att ? att.present : ''}</td>`,
    `<td class="l">% of Attendance</td><td class="c">${att ? `${((att.present / att.total) * 100).toFixed(1)}%` : ''}</td>`,
  ];
  const left = items.map(
    (i) => `<td class="l u">${esc(i.name)}</td><td class="c">${esc(lastGrade(i.grades))}</td>`,
  );
  const blank = '<td>&nbsp;</td><td></td>';
  const n = Math.max(left.length, right.length);
  const title = `${esc(s.title ?? `CO-SCHOLASTIC AREAS: ${periodOf(d)}`)}<br />${esc(s.note ?? '[on a 3-point [A-C] Grading Scale]')}`;
  const rows = Array.from(
    { length: n },
    (_, i) => `<tr>${left[i] ?? blank}<td class="gap"></td>${right[i] ?? blank}</tr>`,
  ).join('');
  return `<div class="cl-sep"></div><table class="cl-t cl-side"><colgroup><col style="width:38%" /><col style="width:10%" /><col style="width:1.4%" /><col /><col style="width:13%" /></colgroup><thead><tr><th class="l">${title}</th><th>GRADE</th><td class="gap"></td><th colspan="2">Health Status</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/** discipline: one row with its grade */
export function clDiscipline(d: ReportCardData, s: ClSection): string {
  const disc = isDiscipline(s);
  const items = d.indicators.flatMap((a) =>
    a.items.filter((i) => disc(a.area) || disc('', i.name)),
  );
  if (!items.length) return '';
  const rows = items
    .map(
      (i) =>
        `<tr><td class="l u">${esc(i.name)} (ON A 3-POINT[A-C] GRADING SCALE)</td><td class="c">${esc(lastGrade(i.grades))}</td></tr>`,
    )
    .join('');
  return `<div class="cl-sep"></div><table class="cl-t"><colgroup><col /><col style="width:20%" /></colgroup><thead><tr><th></th><th>GRADE</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/** the class teacher's remark: the general remark of the period's last exam, then the categories' words */
export function clRemark(d: ReportCardData, s: ClSection): string {
  const order = d.exams.map((e) => e.code);
  const general =
    [...d.remarks].sort((a, b) => order.indexOf(a.exam) - order.indexOf(b.exam)).pop()?.remark ??
    null;
  const lines = [general, ...(d.remarkItems ?? []).map((x) => x.text)]
    .filter((x): x is string => !!x && x.trim() !== '')
    .slice(0, 4);
  const who = d.classTeacher ? ` : ( ${esc(d.classTeacher.toUpperCase())} )` : '';
  return `<div class="cl-sep"></div><table class="cl-t cl-rem"><thead><tr><th class="l">${esc(s.title ?? "CLASS TEACHER'S REMARK")}${who}</th></tr></thead><tbody><tr><td class="l">${lines.map(esc).join('\n') || '&nbsp;'}</td></tr></tbody></table>`;
}

const ROLE_NAMES: Record<string, string> = {
  parent: 'Parent',
  class_teacher: 'Class Teacher',
  coordinator: 'Coordinator',
  vice_principal: 'Vice Principal',
  principal: 'Principal',
  headmistress: 'Headmistress',
  exam_incharge: 'Exam In-charge',
};

/** dd-mm-yyyy */
const dmy = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]!}-${m[2]!}-${m[1]!}` : iso;
};

/** place and date, the signatures with their images, the seal */
export function clSign(d: ReportCardData, s: ClSection): string {
  const roles = s.roles?.length
    ? s.roles
    : ['parent', 'class_teacher', 'coordinator', 'vice_principal', 'principal'];
  const sig = (role: string) => (d.signatures ?? []).find((g) => g.role === role);
  const cells = roles.map(
    (r) =>
      `<div><div class="im">${img(sig(r)?.dataUri)}</div>${esc(ROLE_NAMES[r] ?? titleCase(r.replace(/_/g, ' ')))}</div>`,
  );
  cells.push(
    `<div><div class="im stamp">${img(sig('seal')?.dataUri, 'School seal')}</div>School Seal</div>`,
  );
  return `<div class="cl-sep"></div><div class="cl-pd"><span><b>PLACE:</b>${esc((d.school.city ?? '').toUpperCase())}</span><span><b>DATE:</b>${esc(dmy(d.today))}</span></div>
    <div class="cl-sign" style="--n:${String(cells.length)}">${cells.join('')}</div>`;
}

/** the grading key: the scale's bands as marks ranges over their grades */
export function clGradeKey(d: ReportCardData, s: ClSection): string {
  const bands = [...d.gradeScale].sort((a, b) => Number(b.minPct) - Number(a.minPct));
  if (!bands.length) return '';
  const n = (v: string) => Math.round(Number(v) * 100) / 100;
  const range = (g: (typeof bands)[number], i: number) =>
    i === bands.length - 1
      ? `${String(Math.floor(n(g.maxPct)))} & Below`
      : `${String(n(g.minPct))}-${String(Math.floor(n(g.maxPct)))}`;
  const last = bands.length - 1;
  const grade = (g: (typeof bands)[number], i: number) =>
    i === last && g.remark ? `${g.grade} (${titleCase(g.remark)})` : g.grade;
  const span = (i: number) => (i === last ? ' colspan="2"' : '');
  const each = `${String(Math.round(((100 - 13 - 24) / Math.max(1, last)) * 100) / 100)}%`;
  return `<table class="cl-t cl-key"><colgroup><col style="width:13%" />${bands.map((_, i) => (i === last ? '<col style="width:12%" /><col style="width:12%" />' : `<col style="width:${each}" />`)).join('')}</colgroup><thead><tr><th colspan="${String(bands.length + 2)}"><b>${esc(s.title ?? 'Grading Scale For Scholastic Areas')} :</b> Grades are awarded on an ${String(bands.length)}-point grading scale as follows</th></tr></thead><tbody>
    <tr><td class="l">Marks Range</td>${bands.map((g, i) => `<td class="c"${span(i)}>${esc(range(g, i))}</td>`).join('')}</tr>
    <tr><td class="l">GRADE</td>${bands.map((g, i) => `<td class="c"${span(i)}>${esc(grade(g, i))}</td>`).join('')}</tr>
  </tbody></table>`;
}

/** a classic section by type ('' for another) */
export function clSection(d: ReportCardData, s: ClSection, art: ClArt = {}): string {
  switch (s.type) {
    case 'cl_header':
      return clHeader(d, s, art);
    case 'cl_student':
      return clStudent(d);
    case 'cl_term_marks':
      return clTermMarks(d, s);
    case 'cl_exam_marks':
      return clExamMarks(d, s);
    case 'cl_co_health':
      return clCoHealth(d, s);
    case 'cl_discipline':
      return clDiscipline(d, s);
    case 'cl_remark':
      return clRemark(d, s);
    case 'cl_sign':
      return clSign(d, s);
    case 'cl_grade_key':
      return clGradeKey(d, s);
    default:
      return '';
  }
}
