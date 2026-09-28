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
  | 'signatures';

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
}

export interface ReportCardLayout {
  sections: ReportCardSection[];
  /** printed under the school name */
  subtitle?: string;
}

export const DEFAULT_LAYOUTS: Record<ReportCardData['student']['band'], ReportCardLayout> = {
  primary: {
    subtitle: 'Progress report',
    sections: [
      { type: 'header' },
      { type: 'student', showPhoto: true },
      { type: 'scholastic', showGrades: true, showTotals: false, title: 'Scholastic areas' },
      { type: 'co_scholastic', title: 'Co-scholastic areas and personal qualities' },
      { type: 'attendance' },
      { type: 'health' },
      { type: 'remarks', title: "Class teacher's remarks" },
      { type: 'result', showRank: false },
      { type: 'grade_scale' },
      { type: 'signatures', labels: ['Class teacher', 'Parent', 'Principal'] },
    ],
  },
  middle: {
    subtitle: 'Report card',
    sections: [
      { type: 'header' },
      { type: 'student', showPhoto: true },
      { type: 'scholastic', showGrades: true, showTotals: true, title: 'Scholastic areas' },
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
    subtitle: 'Report card',
    sections: [
      { type: 'header' },
      { type: 'student', showPhoto: true },
      { type: 'scholastic', showGrades: true, showTotals: true, title: 'Scholastic areas' },
      { type: 'co_scholastic', title: 'Co-scholastic areas' },
      { type: 'attendance' },
      { type: 'remarks' },
      { type: 'result', showRank: true },
      { type: 'grade_scale' },
      { type: 'signatures', labels: ['Class teacher', 'Parent', 'Principal'] },
    ],
  },
  senior: {
    subtitle: 'Report card',
    sections: [
      { type: 'header' },
      { type: 'student', showPhoto: false },
      { type: 'scholastic', showGrades: true, showTotals: true, title: 'Scholastic areas' },
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
            `<td class="num">${c.exempt ? 'EX' : c.absent ? 'AB' : esc(c.marks ?? '')}</td>${grades ? `<td class="ctr">${esc(c.grade ?? '')}</td>` : ''}`,
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

function coScholastic(d: ReportCardData, s: ReportCardSection): string {
  if (d.indicators.length === 0) return '';
  const head = d.exams.map((e) => `<th class="ctr">${esc(e.code)}</th>`).join('');
  const rows = d.indicators
    .map(
      (a) =>
        `<tr><td colspan="${d.exams.length + 1}" style="font-weight:600;background:#E6EEF8">${esc(a.area)}</td></tr>` +
        a.items
          .map(
            (i) =>
              `<tr><td>${esc(i.name)}</td>${i.grades.map((g) => `<td class="ctr">${esc(g ?? '')}</td>`).join('')}</tr>`,
          )
          .join(''),
    )
    .join('');
  return `<h2>${esc(s.title ?? 'Co-scholastic areas')}</h2><table><thead><tr><th>Area</th>${head}</tr></thead><tbody>${rows}</tbody></table>`;
}

function attendance(d: ReportCardData, s: ReportCardSection): string {
  if (d.attendance.length === 0) return '';
  return `<h2>${esc(s.title ?? 'Attendance')}</h2><table><thead><tr><th>Exam</th><th class="num">Days present</th><th class="num">Working days</th><th class="num">%</th></tr></thead><tbody>${d.attendance
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
  return `<div class="scale">${d.gradeScale.map((g) => `<span><strong>${esc(g.grade)}</strong> ${esc(g.minPct.replace(/\.00$/, ''))}–${esc(g.maxPct)}%${g.remark ? ` ${esc(g.remark)}` : ''}</span>`).join('')}</div>`;
}

function signatures(s: ReportCardSection): string {
  const labels = s.labels?.length ? s.labels : ['Class teacher', 'Parent', 'Principal'];
  return `<div class="sign">${labels.map((l) => `<div>${esc(l)}</div>`).join('')}</div>`;
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
        return scholastic(d, s);
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
        return signatures(s);
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
