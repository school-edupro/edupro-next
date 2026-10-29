/**
 * Report-card renderer (Sprint 17). A template is a JSON layout — an ordered list of sections with
 * options — rendered against ReportCardData with the design-system print styles; a school may also
 * supply its own HTML body (the Mustache subset of the document engine) which then replaces the
 * layout renderer while keeping the page frame. Batch rendering concatenates one page per pupil.
 */
import { documentHtml, renderTemplate } from './template-engine';
import type { ReportCardData } from './report-card-data';

export type ReportCardSectionType =
  | 'header'
  | 'student'
  | 'scholastic'
  | 'co_scholastic'
  | 'attendance'
  | 'health'
  | 'remarks'
  | 'result'
  | 'grade_scale'
  | 'signatures'
  | 'hpc_descriptors'
  // docs/design/65 part 4 (the DPS Noida cards)
  | 'term_marks'
  | 'cover'
  | 'participation'
  | 'promotion'
  | 'seal'
  | 'evaluation_key'
  | 'page_break';

export interface ReportCardSection {
  type: ReportCardSectionType;
  title?: string;
  /** scholastic: show a grade column per exam */
  showGrades?: boolean;
  /** scholastic: show the term total / % / grade columns */
  showTotals?: boolean;
  /** result: show the rank */
  showRank?: boolean;
  /** student: show the photo */
  showPhoto?: boolean;
  /** signatures: labels */
  labels?: string[];
  /**
   * scholastic (Sprint 18): 'marks' = one column per exam (default); 'cce' = marks and grade per exam
   * with the term total; 'components' = columns built from exams and scaled (internal assessment +
   * annual, or theory / practical), totalled and graded.
   */
  mode?: 'marks' | 'cce' | 'components';
  columns?: Array<{
    label: string;
    examCodes: string[];
    agg?: 'sum' | 'avg' | 'best';
    scale: number;
  }>;
  /** hpc_descriptors: grade → descriptor text */
  descriptors?: Record<string, string>;
  /** term_marks: the terms printed side by side (codes; none: every term worked out) */
  terms?: string[];
  /** term_marks: grades only (the primary learning record) */
  gradesOnly?: boolean;
  /** signatures: by role, with the image and name set up (principal, coordinator, class_teacher ...) */
  roles?: string[];
  /** co_scholastic: these indicator areas only (Discipline, Participation ...) */
  areas?: string[];
  /** co_scholastic, attendance: these exams' columns only (by code) */
  examCodes?: string[];
}

export interface ReportCardLayout {
  sections: ReportCardSection[];
  /** printed under the school name */
  subtitle?: string;
}

export const DEFAULT_LAYOUTS: Record<ReportCardData['student']['band'], ReportCardLayout> = {
  pre_primary: {
    subtitle: 'Holistic progress card (pre-primary)',
    sections: [
      { type: 'header' },
      { type: 'student', showPhoto: true },
      { type: 'scholastic', showGrades: true, showTotals: false, title: 'Scholastic areas' },
      { type: 'hpc_descriptors', title: 'Co-scholastic areas and personal qualities' },
      { type: 'attendance' },
      { type: 'health' },
      { type: 'remarks', title: "Class teacher's remarks" },
      { type: 'result', showRank: false },
      { type: 'grade_scale' },
      { type: 'signatures', labels: ['Class teacher', 'Parent', 'Principal'] },
    ],
  },
  primary: {
    subtitle: 'Holistic progress card',
    sections: [
      { type: 'header' },
      { type: 'student', showPhoto: true },
      { type: 'scholastic', showGrades: true, showTotals: false, title: 'Scholastic areas' },
      { type: 'hpc_descriptors', title: 'Co-scholastic areas and personal qualities' },
      { type: 'attendance' },
      { type: 'health' },
      { type: 'remarks', title: "Class teacher's remarks" },
      { type: 'result', showRank: false },
      { type: 'grade_scale' },
      { type: 'signatures', labels: ['Class teacher', 'Parent', 'Principal'] },
    ],
  },
  middle: {
    subtitle: 'Report card (CCE)',
    sections: [
      { type: 'header' },
      { type: 'student', showPhoto: true },
      {
        type: 'scholastic',
        mode: 'cce',
        showGrades: true,
        showTotals: true,
        title: 'Scholastic areas',
      },
      { type: 'co_scholastic', title: 'Co-scholastic areas' },
      { type: 'attendance' },
      { type: 'health' },
      { type: 'remarks' },
      { type: 'result', showRank: true },
      { type: 'grade_scale' },
      { type: 'signatures', labels: ['Class teacher', 'Parent', 'Principal'] },
    ],
  },
  secondary: {
    subtitle: 'Report card (Secondary)',
    sections: [
      { type: 'header' },
      { type: 'student', showPhoto: true },
      {
        type: 'scholastic',
        mode: 'components',
        title: 'Scholastic areas',
        columns: [
          { label: 'Periodic test (10)', examCodes: ['PT1', 'PT2', 'PT3'], agg: 'best', scale: 10 },
          { label: 'Portfolio (5)', examCodes: ['NB', 'PORTFOLIO'], scale: 5 },
          { label: 'Subject enrichment (5)', examCodes: ['SE'], scale: 5 },
          {
            label: 'Annual exam (80)',
            examCodes: ['ANNUAL', 'FINAL', 'HY'],
            agg: 'best',
            scale: 80,
          },
        ],
      },
      { type: 'co_scholastic', title: 'Co-scholastic areas' },
      { type: 'attendance' },
      { type: 'remarks' },
      { type: 'result', showRank: true },
      { type: 'grade_scale' },
      { type: 'signatures', labels: ['Class teacher', 'Parent', 'Principal'] },
    ],
  },
  senior: {
    subtitle: 'Report card (Senior Secondary)',
    sections: [
      { type: 'header' },
      { type: 'student', showPhoto: false },
      {
        type: 'scholastic',
        mode: 'components',
        title: 'Scholastic areas',
        columns: [
          {
            label: 'Theory (70)',
            examCodes: ['ANNUAL', 'FINAL', 'HY', 'THEORY'],
            agg: 'best',
            scale: 70,
          },
          {
            label: 'Practical / IA (30)',
            examCodes: ['PRACTICAL', 'IA', 'PT1', 'PT2'],
            agg: 'best',
            scale: 30,
          },
        ],
      },
      { type: 'attendance' },
      { type: 'remarks' },
      { type: 'result', showRank: true },
      { type: 'grade_scale' },
      { type: 'signatures', labels: ['Class teacher', 'Parent', 'Principal'] },
    ],
  },
};

export const REPORT_CARD_CSS = `
  .rc { font-family: "Source Sans 3", "Segoe UI", Arial, sans-serif; color: #1F2933; font-size: 10.5px; }
  .rc h1 { font-family: Poppins, "Segoe UI", Arial, sans-serif; font-size: 18px; color: #00265D; margin: 0; letter-spacing: 0.01em; }
  .rc h2 { font-family: Poppins, "Segoe UI", Arial, sans-serif; font-size: 11.5px; color: #00265D; margin: 10px 0 4px; text-transform: uppercase; letter-spacing: 0.06em; border-bottom: 2px solid #00265D; padding-bottom: 2px; }
  .rc .head { display: flex; align-items: center; gap: 12px; border-bottom: 3px solid #00265D; padding-bottom: 6px; }
  .rc .head .logo { width: 54px; height: 54px; border-radius: 6px; background: #E6EEF8; display: flex; align-items: center; justify-content: center; color: #00265D; font-weight: 700; overflow: hidden; }
  .rc .head .logo img { width: 100%; height: 100%; object-fit: contain; }
  .rc .head .meta { color: #52606D; font-size: 9.5px; }
  .rc .head .title { margin-left: auto; text-align: right; }
  .rc .head .title .term { font-family: Poppins, Arial, sans-serif; font-size: 13px; color: #007A94; font-weight: 600; }
  .rc .pupil { display: grid; grid-template-columns: 1fr 1fr 1fr 64px; gap: 4px 12px; margin-top: 8px; }
  .rc .pupil .k { color: #52606D; font-size: 9px; text-transform: uppercase; letter-spacing: 0.04em; }
  .rc .pupil .v { font-weight: 600; }
  .rc .pupil .photo { grid-row: span 3; width: 60px; height: 72px; border: 1px solid #CBD2D9; border-radius: 4px; object-fit: cover; background: #F5F7FA; }
  .rc table { width: 100%; border-collapse: collapse; margin-top: 2px; }
  .rc th { background: #00265D; color: #fff; text-align: left; padding: 4px 6px; font-weight: 600; font-size: 9.5px; }
  .rc td { border-bottom: 1px solid #E4E7EB; padding: 3px 6px; vertical-align: top; }
  .rc tr:nth-child(even) td { background: #F5F7FA; }
  .rc .num { text-align: right; font-variant-numeric: tabular-nums; }
  .rc .ctr { text-align: center; }
  .rc .tot td { font-weight: 700; background: #E6EEF8 !important; }
  .rc .result { display: flex; gap: 16px; align-items: stretch; margin-top: 8px; }
  .rc .tile { flex: 1; border: 1px solid #CBD2D9; border-radius: 6px; padding: 6px 8px; }
  .rc .tile .k { color: #52606D; font-size: 9px; text-transform: uppercase; letter-spacing: 0.04em; }
  .rc .tile .v { font-family: Poppins, Arial, sans-serif; font-size: 15px; font-weight: 600; color: #00265D; }
  .rc .pass { color: #146B43; } .rc .fail { color: #9B2C2C; }
  .rc .remark { border: 1px solid #CBD2D9; border-radius: 6px; padding: 6px 8px; min-height: 28px; }
  .rc .sign { display: flex; justify-content: space-between; margin-top: 28px; }
  .rc .sign div { width: 30%; border-top: 1px solid #1F2933; text-align: center; padding-top: 4px; color: #52606D; font-size: 9.5px; }
  .rc .scale { display: flex; flex-wrap: wrap; gap: 4px 10px; color: #52606D; font-size: 9px; margin-top: 4px; }
  .rc .withheld { border: 2px dashed #9B2C2C; color: #9B2C2C; padding: 12px; text-align: center; font-weight: 600; margin-top: 12px; }
  .page-break { page-break-after: always; break-after: page; }
  .rc .cover { text-align: center; padding: 48px 24px; }
  .rc .cover h1 { font-size: 22px; margin: 8px 0; }
  .rc .cover .term { font-size: 15px; font-weight: 600; margin-bottom: 20px; }
  .rc .cover img.big, .rc .cover .big { width: 120px; height: 150px; object-fit: cover; border: 1px solid #CBD2D9; margin: 12px auto; display: block; }
  .rc .cover .name { font-size: 18px; font-weight: 700; margin-top: 10px; }
  .rc .sign img { max-height: 36px; max-width: 120px; display: block; margin: 0 auto 2px; }
  .rc .sign .who { display: block; color: #1F2933; font-size: 9px; }
  .rc .seal { width: 90px; height: 90px; border: 1px dashed #9AA5B1; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: #9AA5B1; font-size: 9px; margin: 8px 0 0 auto; }
  .rc img.seal { border: 0; object-fit: contain; }
  .rc .key { color: #52606D; font-size: 9px; margin-top: 4px; }
`;

const esc = (v: unknown): string =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function header(d: ReportCardData, layout: ReportCardLayout): string {
  const logo = d.school.logoDataUri
    ? `<img src="${d.school.logoDataUri}" alt="" />`
    : esc(d.school.shortName ?? d.school.name.slice(0, 3));
  return `<div class="head">
    <div class="logo">${logo}</div>
    <div><h1>${esc(d.school.name)}</h1><div class="meta">${esc(d.school.address)}${d.school.affiliationNo ? ` · Affiliation ${esc(d.school.affiliationNo)}` : ''}${d.school.phone ? ` · ${esc(d.school.phone)}` : ''}</div></div>
    <div class="title"><div class="term">${esc(d.release.name)}</div><div class="meta">${esc(layout.subtitle ?? 'Report card')} · ${esc(d.release.academicYear)}</div></div>
  </div>`;
}

function student(d: ReportCardData, s: ReportCardSection): string {
  const kv = (k: string, v: unknown) =>
    `<div><div class="k">${esc(k)}</div><div class="v">${esc(v ?? '—')}</div></div>`;
  const photo =
    s.showPhoto !== false
      ? d.student.photoDataUri
        ? `<img class="photo" src="${d.student.photoDataUri}" alt="" />`
        : '<div class="photo"></div>'
      : '';
  return `<div class="pupil">
    ${kv("Pupil's name", d.student.name)}${kv('Admission no', d.student.admissionNo)}${kv('Class', `${d.student.classCode}-${d.student.section}${d.student.rollNo ? ` · Roll ${d.student.rollNo}` : ''}`)}${photo}
    ${kv("Father's name", d.student.father)}${kv("Mother's name", d.student.mother)}${kv('Date of birth', d.student.dob)}
    ${kv('House', d.student.house)}${kv('Academic year', d.release.academicYear)}${kv('Term', d.release.termCode)}
  </div>`;
}

function scholastic(d: ReportCardData, s: ReportCardSection): string {
  const grades = s.showGrades !== false;
  const totals = s.showTotals !== false;
  const head = d.exams
    .map(
      (e) =>
        `<th class="num">${esc(e.code)} (${esc(e.maxTotal.replace(/\.00$/, ''))})</th>${grades ? '<th class="ctr">Gr</th>' : ''}`,
    )
    .join('');
  const rows = d.subjects
    .map((r) => {
      const cells = r.cells
        .map(
          (c) =>
            `<td class="num">${c.code ? esc(c.code) : Number(c.max) === 0 ? esc(c.grade ?? '') : c.exempt ? 'EX' : c.absent ? 'AB' : esc(c.marks ?? '')}</td>${grades ? `<td class="ctr">${esc(c.grade ?? '')}</td>` : ''}`,
        )
        .join('');
      return `<tr><td>${esc(r.name)}</td>${cells}${totals ? `<td class="num">${esc(r.total ?? '')} / ${esc(r.maxTotal)}</td><td class="num">${esc(r.pct ?? '')}</td><td class="ctr">${esc(r.grade ?? '')}</td>` : ''}</tr>`;
    })
    .join('');
  const totRow = totals
    ? `<tr class="tot"><td>Total</td>${d.exams.map((e) => `<td class="num">${esc(e.total ?? '')}</td>${grades ? `<td class="ctr">${esc(e.grade ?? '')}</td>` : ''}`).join('')}<td class="num">${esc(d.term.total ?? '')} / ${esc(d.term.maxTotal)}</td><td class="num">${esc(d.term.pct ?? '')}</td><td class="ctr">${esc(d.term.grade ?? '')}</td></tr>`
    : '';
  return `<h2>${esc(s.title ?? 'Scholastic areas')}</h2><table><thead><tr><th>Subject</th>${head}${totals ? '<th class="num">Term total</th><th class="num">%</th><th class="ctr">Grade</th>' : ''}</tr></thead><tbody>${rows}${totRow}</tbody></table>`;
}

/** Sprint 18: scaled component columns (PT best-of, portfolio, annual; or theory / practical). */
function scholasticComponents(d: ReportCardData, s: ReportCardSection): string {
  const cols = s.columns ?? [];
  const idx = (code: string) => d.exams.findIndex((e) => e.code === code);
  const scaled = (
    r: ReportCardData['subjects'][number],
    col: (typeof cols)[number],
  ): number | null => {
    const vals: number[] = [];
    for (const code of col.examCodes) {
      const i = idx(code);
      const c = i >= 0 ? r.cells[i] : undefined;
      if (!c || c.exempt || c.marks === null || Number(c.max) === 0) continue;
      vals.push((Number(c.marks) / Number(c.max)) * col.scale);
    }
    if (vals.length === 0) return null;
    const agg = col.agg ?? 'sum';
    const v =
      agg === 'best'
        ? Math.max(...vals)
        : agg === 'avg'
          ? vals.reduce((a, b) => a + b, 0) / vals.length
          : Math.min(
              col.scale,
              vals.reduce((a, b) => a + b, 0),
            );
    return Math.round(v * 100) / 100;
  };
  const head = cols.map((c) => `<th class="num">${esc(c.label)}</th>`).join('');
  const rows = d.subjects
    .map((r) => {
      const values = cols.map((c) => scaled(r, c));
      const present = values
        .map((v, i) => (v === null ? null : { v, max: cols[i]!.scale }))
        .filter((x): x is { v: number; max: number } => x !== null);
      const total = present.reduce((a, x) => a + x.v, 0);
      const max = present.reduce((a, x) => a + x.max, 0);
      const pct = max > 0 && present.length ? (total / max) * 100 : null;
      const grade =
        pct === null
          ? null
          : (d.gradeScale.find((b) => pct >= Number(b.minPct) && pct <= Number(b.maxPct))?.grade ??
            null);
      return `<tr><td>${esc(r.name)}</td>${values.map((v) => `<td class="num">${v === null ? '' : esc(v.toFixed(v % 1 ? 1 : 0))}</td>`).join('')}<td class="num">${present.length ? `${esc(total.toFixed(1))} / ${max}` : ''}</td><td class="ctr">${esc(grade ?? '')}</td></tr>`;
    })
    .join('');
  return `<h2>${esc(s.title ?? 'Scholastic areas')}</h2><table><thead><tr><th>Subject</th>${head}<th class="num">Total</th><th class="ctr">Grade</th></tr></thead><tbody>${rows}</tbody></table>`;
}

const DEFAULT_DESCRIPTORS: Record<string, string> = {
  A: 'Exceeds expectations',
  B: 'Meets expectations',
  C: 'Approaching expectations',
  D: 'Needs support',
  E: 'Needs support',
};

/** Sprint 18 (HPC): indicator grades read as descriptors, per area. */
function hpcDescriptors(d: ReportCardData, s: ReportCardSection): string {
  if (d.indicators.length === 0) return '';
  const map = { ...DEFAULT_DESCRIPTORS, ...(s.descriptors ?? {}) };
  const last = d.exams.length - 1;
  const rows = d.indicators
    .map((a) => {
      const items = a.items
        .map((i) => {
          const g = i.grades[last] ?? i.grades.find((x) => x !== null) ?? null;
          return `<tr><td>${esc(i.name)}</td><td class="ctr">${esc(g ?? '')}</td><td>${esc(g ? (map[g] ?? '') : '')}</td></tr>`;
        })
        .join('');
      return `<tr><td colspan="3" style="font-weight:600;background:#E6EEF8">${esc(a.area)}</td></tr>${items}`;
    })
    .join('');
  const legend = Object.entries(map)
    .filter(([g]) => d.indicators.some((a) => a.items.some((i) => i.grades.includes(g))))
    .map(([g, t]) => `<span><strong>${esc(g)}</strong> ${esc(t)}</span>`)
    .join('');
  return `<h2>${esc(s.title ?? 'Holistic progress')}</h2><table><thead><tr><th>Area</th><th class="ctr">Grade</th><th>What it means</th></tr></thead><tbody>${rows}</tbody></table><div class="scale">${legend}</div>`;
}

function coScholastic(d: ReportCardData, s: ReportCardSection): string {
  // docs/design/65 part 4: some areas only (Discipline), some exams' columns only (the term exams)
  const areas = d.indicators.filter((a) => !s.areas?.length || s.areas.includes(a.area));
  if (areas.length === 0) return '';
  const cols = d.exams
    .map((e, i) => ({ e, i }))
    .filter((x) => !s.examCodes?.length || s.examCodes.includes(x.e.code));
  const head = cols.map(({ e }) => `<th class="ctr">${esc(e.code)}</th>`).join('');
  const rows = areas
    .map(
      (a) =>
        `<tr><td colspan="${cols.length + 1}" style="font-weight:600;background:#E6EEF8">${esc(a.area)}</td></tr>` +
        a.items
          .map(
            (i) =>
              `<tr><td>${esc(i.name)}</td>${cols.map(({ i: k }) => `<td class="ctr">${esc(i.grades[k] ?? '')}</td>`).join('')}</tr>`,
          )
          .join(''),
    )
    .join('');
  return `<h2>${esc(s.title ?? 'Co-scholastic areas')}</h2><table><thead><tr><th>Area</th>${head}</tr></thead><tbody>${rows}</tbody></table>`;
}

function attendance(d: ReportCardData, s: ReportCardSection): string {
  const rows = d.attendance.filter((a) => !s.examCodes?.length || s.examCodes.includes(a.exam));
  if (rows.length === 0) return '';
  return `<h2>${esc(s.title ?? 'Attendance')}</h2><table><thead><tr><th>Exam</th><th class="num">Days present</th><th class="num">Working days</th><th class="num">%</th></tr></thead><tbody>${rows
    .map(
      (a) =>
        `<tr><td>${esc(a.exam)}</td><td class="num">${a.present}</td><td class="num">${a.total}</td><td class="num">${esc(a.pct)}</td></tr>`,
    )
    .join('')}</tbody></table>`;
}

function health(d: ReportCardData, s: ReportCardSection): string {
  if (!d.health) return '';
  const h = d.health;
  return `<h2>${esc(s.title ?? 'Health')}</h2><table><thead><tr><th>Height (cm)</th><th>Weight (kg)</th><th>BMI</th><th>Blood group</th><th>Recorded on</th></tr></thead><tbody><tr><td>${esc(h.heightCm ?? '')}</td><td>${esc(h.weightKg ?? '')}</td><td>${esc(h.bmi ?? '')}</td><td>${esc(h.bloodGroup ?? '')}</td><td>${esc(h.recordedOn ?? '')}</td></tr></tbody></table>`;
}

function remarks(d: ReportCardData, s: ReportCardSection): string {
  const text =
    d.remarks.map((r) => `<div><strong>${esc(r.exam)}:</strong> ${esc(r.remark)}</div>`).join('') ||
    '&nbsp;';
  return `<h2>${esc(s.title ?? 'Remarks')}</h2><div class="remark">${text}</div>`;
}

function result(d: ReportCardData, s: ReportCardSection): string {
  const tile = (k: string, v: string, cls = '') =>
    `<div class="tile"><div class="k">${esc(k)}</div><div class="v ${cls}">${v}</div></div>`;
  const res =
    d.term.result === 'pass'
      ? 'PASS'
      : d.term.result === 'fail'
        ? 'NEEDS IMPROVEMENT'
        : 'INCOMPLETE';
  return `<div class="result">${tile('Term total', `${esc(d.term.total ?? '—')} / ${esc(d.term.maxTotal)}`)}${tile('Percentage', d.term.pct ? `${esc(d.term.pct)}%` : '—')}${tile('Grade', esc(d.term.grade ?? '—'))}${s.showRank !== false && d.term.rank ? tile('Rank in section', String(d.term.rank)) : ''}${tile('Result', esc(res), d.term.result === 'pass' ? 'pass' : d.term.result === 'fail' ? 'fail' : '')}</div>`;
}

function gradeScale(d: ReportCardData): string {
  if (d.gradeScale.length === 0) return '';
  return `<div class="scale">${d.gradeScale.map((g) => `<span><strong>${esc(g.grade)}</strong> ${esc(g.minPct.replace(/\.00$/, ''))}–${esc(g.maxPct.replace(/\.00$/, ''))}%${g.remark ? ` ${esc(g.remark)}` : ''}</span>`).join('')}</div>`;
}

function signatures(s: ReportCardSection, d?: ReportCardData): string {
  // docs/design/65 part 4: by role, with the image and the name set up; a role not set up prints its name
  if (s.roles?.length && d) {
    const NAMES: Record<string, string> = {
      principal: 'Principal',
      vice_principal: 'Vice principal',
      headmistress: 'Headmistress',
      coordinator: 'Coordinator',
      class_teacher: 'Class teacher',
      exam_incharge: 'Exam in-charge',
      parent: 'Parent',
    };
    const cells = s.roles.map((role) => {
      const x = (d.signatures ?? []).find((g) => g.role === role);
      const who = x?.personName ?? (role === 'class_teacher' ? (d.classTeacher ?? null) : null);
      return `<div>${x?.dataUri ? `<img src="${x.dataUri}" alt="" />` : ''}${esc(x?.label ?? NAMES[role] ?? role)}${who ? `<span class="who">${esc(who)}</span>` : ''}</div>`;
    });
    return `<div class="sign">${cells.join('')}</div>`;
  }
  const labels = s.labels?.length ? s.labels : ['Class teacher', 'Parent', 'Principal'];
  return `<div class="sign">${labels.map((l) => `<div>${esc(l)}</div>`).join('')}</div>`;
}

const fmtV = (c: { v: number | null; code?: string } | null | undefined): string =>
  !c ? '' : c.code && (c.v === null || c.v === 0) ? c.code : c.v === null ? '' : String(c.v);

/** docs/design/65 part 4: the terms' marks side by side, from the result schemes (no cumulative column). */
function termMarks(d: ReportCardData, s: ReportCardSection): string {
  const terms = (d.termResults ?? []).filter((t) => !s.terms?.length || s.terms.includes(t.term));
  const title = `<h2>${esc(s.title ?? 'Scholastic areas')}</h2>`;
  if (!terms.length)
    return `${title}<div class="remark">The term results are not worked out yet.</div>`;
  const subjects: Array<{ code: string; name: string; kind: string }> = [];
  for (const t of terms)
    for (const x of t.subjects)
      if (!subjects.some((y) => y.code === x.code))
        subjects.push({ code: x.code, name: x.name, kind: x.kind });
  const cols = (t: (typeof terms)[number]) => (s.gradesOnly ? [] : t.columns);
  const head1 = terms
    .map((t) => `<th class="ctr" colspan="${cols(t).length + 1}">${esc(t.name)}</th>`)
    .join('');
  const head2 = terms
    .map(
      (t) =>
        `${cols(t)
          .map((c) => `<th class="num">${esc(c.label)}</th>`)
          .join('')}<th class="ctr">Grade</th>`,
    )
    .join('');
  const body = subjects
    .map((sub) => {
      const cells = terms
        .map((t) => {
          const x = t.subjects.find((y) => y.code === sub.code);
          return `${cols(t)
            .map((c) => `<td class="num">${esc(fmtV(x?.values[c.key]))}</td>`)
            .join('')}<td class="ctr">${esc(x?.grade ?? '')}</td>`;
        })
        .join('');
      return `<tr><td>${esc(sub.name)}${sub.kind === 'additional' ? ' <span class="meta">(additional)</span>' : ''}</td>${cells}</tr>`;
    })
    .join('');
  const line = (label: string, v: (t: (typeof terms)[number]) => string) =>
    `<tr class="tot"><td>${esc(label)}</td>${terms.map((t) => `<td class="num" colspan="${cols(t).length + 1}">${esc(v(t))}</td>`).join('')}</tr>`;
  const foot = s.gradesOnly
    ? ''
    : line('Total', (t) => `${t.total ?? '-'} / ${t.max}`) +
      line('Percentage', (t) => (t.pct === null ? '-' : `${t.pct}%`)) +
      line('Grade', (t) => t.grade ?? '-') +
      (s.showRank === false
        ? ''
        : line('Rank in section', (t) => (t.rankInSection ? String(t.rankInSection) : '-')));
  return `${title}<table><thead><tr><th rowspan="2">Subject</th>${head1}</tr><tr>${head2}</tr></thead><tbody>${body}${foot}</tbody></table>`;
}

const RESULT_WORDS: Record<string, string> = {
  pass: 'PASS',
  compartment: 'COMPARTMENT',
  fail: 'NEEDS IMPROVEMENT',
  absent: 'ABSENT',
  incomplete: 'INCOMPLETE',
};

/** The learning record's cover: the school, the year, the photo and the student (then a page break). */
function cover(d: ReportCardData, s: ReportCardSection): string {
  const logo = d.school.logoDataUri
    ? `<img src="${d.school.logoDataUri}" alt="" style="max-height:60px" />`
    : '';
  const photo = d.student.photoDataUri
    ? `<img class="big" src="${d.student.photoDataUri}" alt="" />`
    : '<div class="big"></div>';
  return `<div class="cover">${logo}<h1>${esc(d.school.name)}</h1><div class="meta">${esc(d.school.address)}</div><div class="term">${esc(s.title ?? 'Learning record')} · ${esc(d.release.academicYear)}</div>${photo}<div class="name">${esc(d.student.name)}</div><div>Class ${esc(d.student.classCode)}-${esc(d.student.section)}${d.student.rollNo ? ` · Roll ${d.student.rollNo}` : ''} · Admission no ${esc(d.student.admissionNo)}</div></div><div class="page-break"></div>`;
}

function participation(d: ReportCardData, s: ReportCardSection): string {
  return `<h2>${esc(s.title ?? 'I participated in')}</h2><div class="remark">${d.participation ? esc(d.participation) : '&nbsp;'}</div>`;
}

/** The final result and the class the student is promoted to. */
function promotion(d: ReportCardData, s: ReportCardSection): string {
  const last = (d.termResults ?? [])[(d.termResults ?? []).length - 1];
  const res = last
    ? (RESULT_WORDS[last.result] ?? last.result)
    : d.term.result === 'pass'
      ? 'PASS'
      : '';
  const tile = (k: string, v: string) =>
    `<div class="tile"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>`;
  return `${s.title ? `<h2>${esc(s.title)}</h2>` : ''}<div class="result">${res ? tile('Result', res) : ''}${last?.division ? tile('Division', last.division) : ''}${d.promotedTo ? tile('Promoted to', d.promotedTo) : ''}</div>`;
}

function seal(d: ReportCardData): string {
  const x = (d.signatures ?? []).find((g) => g.role === 'seal');
  return x?.dataUri
    ? `<img class="seal" src="${x.dataUri}" alt="School seal" />`
    : '<div class="seal">School seal</div>';
}

/** The evaluation key: the grades, the marks codes and how the term's marks are made. */
function evaluationKey(d: ReportCardData, s: ReportCardSection): string {
  const t = (d.termResults ?? [])[0];
  const how = t
    ? t.columns
        .filter((c) => !c.total)
        .map((c) => c.label)
        .join(' + ')
    : '';
  const total = t?.columns.find((c) => c.total)?.label;
  return `<h2>${esc(s.title ?? 'Evaluation key')}</h2>${gradeScale(d)}${how ? `<div class="key">${esc(how)}${total ? ` = ${esc(total)}` : ''}</div>` : ''}${(d.codes ?? []).length ? `<div class="key">${(d.codes ?? []).map((c) => `${esc(c.code)} ${esc(c.name)}`).join(' · ')}</div>` : ''}`;
}

/** One pupil's card body (no page frame). */
export function reportCardBody(
  d: ReportCardData,
  layout: ReportCardLayout,
  opts: { withheld?: string | null } = {},
): string {
  if (opts.withheld) {
    return `<div class="rc">${header(d, layout)}${student(d, { type: 'student', showPhoto: false })}<div class="withheld">${esc(opts.withheld)}</div></div>`;
  }
  const parts = layout.sections.map((s) => {
    switch (s.type) {
      case 'header':
        return header(d, layout);
      case 'student':
        return student(d, s);
      case 'scholastic':
        return s.mode === 'components' ? scholasticComponents(d, s) : scholastic(d, s);
      case 'hpc_descriptors':
        return hpcDescriptors(d, s);
      case 'co_scholastic':
        return coScholastic(d, s);
      case 'attendance':
        return attendance(d, s);
      case 'health':
        return health(d, s);
      case 'remarks':
        return remarks(d, s);
      case 'result':
        return result(d, s);
      case 'grade_scale':
        return gradeScale(d);
      case 'signatures':
        return signatures(s, d);
      case 'term_marks':
        return termMarks(d, s);
      case 'cover':
        return cover(d, s);
      case 'participation':
        return participation(d, s);
      case 'promotion':
        return promotion(d, s);
      case 'seal':
        return seal(d);
      case 'evaluation_key':
        return evaluationKey(d, s);
      case 'page_break':
        return '<div class="page-break"></div>';
      default:
        return '';
    }
  });
  return `<div class="rc">${parts.join('\n')}</div>`;
}

export interface ReportCardTemplateLike {
  layout: ReportCardLayout | Record<string, unknown>;
  bodyHtml: string | null;
  stylesCss: string;
  pageWidth: string;
  pageHeight: string;
}

export function layoutOf(
  t: ReportCardTemplateLike,
  band: ReportCardData['student']['band'],
): ReportCardLayout {
  const l = t.layout as Partial<ReportCardLayout>;
  return Array.isArray(l?.sections) && l.sections.length > 0
    ? (l as ReportCardLayout)
    : DEFAULT_LAYOUTS[band];
}

/** A full printable document: one page per pupil, page breaks between. */
export function reportCardDocument(
  t: ReportCardTemplateLike,
  pupils: Array<{ data: ReportCardData; withheld?: string | null }>,
): string {
  const bodies = pupils.map(({ data, withheld }, i) => {
    const body =
      t.bodyHtml && !withheld
        ? renderTemplate(t.bodyHtml, data as unknown as Record<string, unknown>)
        : reportCardBody(data, layoutOf(t, data.student.band), { withheld });
    return i < pupils.length - 1 ? `${body}<div class="page-break"></div>` : body;
  });
  return documentHtml({
    body: bodies.join('\n'),
    css: `${REPORT_CARD_CSS}\n${t.stylesCss}`,
    pageWidth: t.pageWidth,
    pageHeight: t.pageHeight,
  });
}

/**
 * The DPS Noida report cards (docs/design/65 part 4) as layouts on this engine; installed as templates
 * (codes dps_*) and chosen per class on a release (IX and X differ in the same band).
 */
const SIGN = ['class_teacher', 'coordinator', 'principal'];
export const DPS_NOIDA_TEMPLATES: Array<{
  code: string;
  name: string;
  band: ReportCardData['student']['band'];
  layout: ReportCardLayout;
}> = [
  {
    code: 'dps_i_ii',
    name: 'DPS Noida I-II learning record',
    band: 'primary',
    layout: {
      subtitle: 'Learning record',
      sections: [
        { type: 'cover', title: 'Learning curve' },
        { type: 'header' },
        { type: 'student', showPhoto: false },
        { type: 'hpc_descriptors', title: 'What I learnt' },
        { type: 'co_scholastic', title: 'Co-scholastic areas' },
        { type: 'health' },
        { type: 'attendance' },
        { type: 'participation' },
        { type: 'remarks', title: "Class teacher's remarks" },
        { type: 'promotion' },
        { type: 'signatures', roles: SIGN },
        { type: 'evaluation_key' },
      ],
    },
  },
  {
    code: 'dps_iii_v',
    name: 'DPS Noida III-V learning record',
    band: 'primary',
    layout: {
      subtitle: 'Learning record',
      sections: [
        { type: 'cover', title: 'Learning curve' },
        { type: 'header' },
        { type: 'student', showPhoto: false },
        { type: 'term_marks', title: 'Scholastic areas', gradesOnly: true },
        { type: 'co_scholastic', title: 'Co-scholastic areas' },
        { type: 'page_break' },
        { type: 'health' },
        { type: 'attendance' },
        { type: 'participation' },
        { type: 'remarks', title: "Class teacher's remarks" },
        { type: 'promotion' },
        { type: 'signatures', roles: SIGN },
        { type: 'evaluation_key' },
      ],
    },
  },
  {
    code: 'dps_vi_viii',
    name: 'DPS Noida VI-VIII (Term 1 and Term 2)',
    band: 'middle',
    layout: {
      subtitle: 'Report card',
      sections: [
        { type: 'header' },
        { type: 'student', showPhoto: true },
        { type: 'term_marks', title: 'Scholastic areas', terms: ['T1', 'T2'] },
        { type: 'co_scholastic', title: 'Co-scholastic areas and discipline' },
        { type: 'attendance' },
        { type: 'health' },
        { type: 'remarks', title: "Class teacher's remarks" },
        { type: 'promotion' },
        { type: 'signatures', roles: SIGN },
        { type: 'seal' },
        { type: 'evaluation_key' },
      ],
    },
  },
  {
    code: 'dps_ix',
    name: 'DPS Noida IX',
    band: 'secondary',
    layout: {
      subtitle: 'Report card',
      sections: [
        { type: 'header' },
        { type: 'student', showPhoto: true },
        { type: 'term_marks', title: 'Part 1 · Scholastic areas' },
        { type: 'co_scholastic', title: 'Part 2 · Co-scholastic areas' },
        { type: 'co_scholastic', title: 'Part 3 · Discipline', areas: ['Discipline'] },
        { type: 'participation', title: 'Part 4 · Participation' },
        { type: 'attendance', title: 'Part 5 · Attendance' },
        { type: 'remarks', title: "Class teacher's remarks" },
        { type: 'signatures', roles: SIGN },
        { type: 'seal' },
        { type: 'evaluation_key' },
      ],
    },
  },
  {
    code: 'dps_x',
    name: 'DPS Noida X (pre-term / mid-term)',
    band: 'secondary',
    layout: {
      subtitle: 'Report card',
      sections: [
        { type: 'header' },
        { type: 'student', showPhoto: true },
        { type: 'term_marks', title: 'Scholastic areas' },
        { type: 'co_scholastic', title: 'Co-scholastic areas' },
        { type: 'attendance' },
        { type: 'remarks', title: "Class teacher's remarks" },
        { type: 'signatures', roles: SIGN },
        { type: 'evaluation_key' },
      ],
    },
  },
  {
    code: 'dps_xi',
    name: 'DPS Noida XI',
    band: 'senior',
    layout: {
      subtitle: 'Report card',
      sections: [
        { type: 'header' },
        { type: 'student', showPhoto: true },
        { type: 'term_marks', title: 'Scholastic areas' },
        { type: 'co_scholastic', title: 'Co-scholastic areas' },
        { type: 'attendance' },
        { type: 'remarks', title: "Class teacher's remarks" },
        { type: 'promotion' },
        { type: 'signatures', roles: SIGN },
        { type: 'seal' },
        { type: 'evaluation_key' },
      ],
    },
  },
  {
    code: 'dps_xii',
    name: 'DPS Noida XII (pre-term / mid-term)',
    band: 'senior',
    layout: {
      subtitle: 'Report card',
      sections: [
        { type: 'header' },
        { type: 'student', showPhoto: true },
        { type: 'term_marks', title: 'Scholastic areas' },
        { type: 'attendance' },
        { type: 'remarks', title: "Class teacher's remarks" },
        { type: 'signatures', roles: SIGN },
        { type: 'evaluation_key' },
      ],
    },
  },
];
