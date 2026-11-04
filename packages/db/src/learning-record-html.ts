/**
 * The learning record on A4 (docs/design/73 part 3): whole A4 pages, each framed with the pupil's name at
 * the top — the cover (the school, the photo, "My name is …" boxes), the subjects' skills with a grade
 * column per term and the subject's remarks beside them, the co-scholastic areas, the health / attendance /
 * participation / teachers' words / signatures page, and the evaluation key. The school's own pictures
 * (template assets) print in their places. Any indicator set prints: its areas are grouped onto pages,
 * an area never split.
 */
import type {
  ReportCardData,
  ReportCardHpc,
  ReportCardHpcItem,
  ReportCardTerm,
} from './report-card-data';

/** the options of a learning-record section (a subset of ReportCardSection, kept here to avoid a cycle) */
export interface LrSection {
  type: string;
  title?: string;
  /** cover: the line under the title */
  caption?: string;
  /** subjects / co-scholastic: these areas (names; "English" also finds "… · English") */
  areas?: string[];
  /** the term columns' names (default Term I, Term II …) */
  termLabels?: string[];
  /** subjects / co-scholastic: the note at the foot of the page */
  note?: string;
  /** subjects: the remarks column (default on) */
  remarks?: boolean;
  /** record: the signing roles (principal, coordinator, class_teacher …) */
  roles?: string[];
}

/** the picture slots a school may fill (docs/design/73) */
export const LR_ART_SLOTS = [
  'cover_art',
  'cover_corner',
  'logo_2',
  'scholastic',
  'co_scholastic',
  'record',
] as const;
export type LrArt = Partial<Record<(typeof LR_ART_SLOTS)[number], string | null>>;

const esc = (v: unknown): string =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
const img = (src: string | null | undefined, cls: string, alt = '') =>
  src ? `<img class="${cls}" src="${src}" alt="${esc(alt)}" />` : '';

export const LR_CSS = `
  .page:has(.lr-page) { padding: 0 !important; }
  .lr-page { width: 210mm; height: 296mm; box-sizing: border-box; position: relative; overflow: hidden;
    break-after: page; page-break-after: always; font-family: "Source Sans 3", "Segoe UI", Arial, sans-serif; color: #1F2933; }
  .rc:last-child .lr-page:last-child { break-after: auto; page-break-after: auto; }
  /* the older card styles (striped rows, small underlined headings) do not apply on these pages */
  .rc .lr-page tr:nth-child(even) td { background: transparent; }
  .rc .lr-page td { vertical-align: middle; }
  .rc .lr-page h2, .rc .lr-page h3 { text-transform: none; letter-spacing: 0; border-bottom: 0; padding-bottom: 0; }
  .rc .lr-page h2.lr-title { font-size: 19pt; color: #102A43; margin: 0 0 3mm; }
  .lr-who { position: absolute; top: 2.2mm; right: 8mm; font-size: 7.5pt; letter-spacing: 0.06em; text-transform: uppercase; color: #3E4C59; }
  .lr-frame { position: absolute; inset: 7mm 7mm 7mm 7mm; border: 3px double #323F4B; padding: 5mm 6mm; display: flex; flex-direction: column; }
  .lr-title { font-family: Poppins, "Segoe UI", Arial, sans-serif; font-size: 19pt; font-weight: 700; color: #102A43; margin: 0 0 3mm; }
  .lr-t { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 10.5pt; }
  .lr-t th { background: #3C9D4E; color: #fff; font-family: Poppins, Arial, sans-serif; font-weight: 600; font-size: 8pt;
    letter-spacing: 0.04em; text-transform: uppercase; padding: 1.6mm 1.4mm; border: 1px solid #2F7D3E; text-align: center; }
  .lr-t td { box-sizing: border-box; border: 1px solid #52606D; padding: 0.8mm 1.8mm; height: 7.6mm; vertical-align: middle; line-height: 1.25; }
  .lr-t td.g { text-align: center; font-weight: 700; font-size: 11pt; }
  .lr-t td.g.text { font-weight: 400; font-size: 8pt; text-align: left; }
  .lr-t tr.grp td.n { font-weight: 700; text-transform: uppercase; font-size: 10pt; letter-spacing: 0.02em; }
  .rc .lr-t td.side { background: #3C9D4E; color: #fff; padding: 0; width: 9mm; text-align: center; border-color: #2F7D3E; }
  .lr-t td.side span { writing-mode: vertical-rl; transform: rotate(180deg); font-family: Poppins, Arial, sans-serif;
    font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; white-space: nowrap; display: inline-block; }
  .rc .lr-t tr.gap td { background: #3C9D4E; height: 4mm; padding: 0; border-color: #2F7D3E; }
  .lr-t td.rem { vertical-align: top; padding: 0; }
  .lr-rem { display: flex; flex-direction: column; height: 100%; min-height: 100%; }
  .lr-rem .h { background: #3C9D4E; color: #fff; font-family: Poppins, Arial, sans-serif; font-weight: 600; font-size: 7.5pt;
    letter-spacing: 0.05em; text-transform: uppercase; text-align: center; padding: 1.4mm; }
  .lr-rem .t { flex: 1; padding: 1.6mm 2mm; font-size: 9.5pt; line-height: 1.35; }
  .lr-rem .tag { background: #3C9D4E; color: #fff; font-family: Poppins, Arial, sans-serif; font-weight: 600; font-size: 7.5pt;
    letter-spacing: 0.05em; text-align: center; padding: 1.2mm; }
  .lr-foot { margin-top: auto; display: flex; align-items: flex-end; gap: 6mm; }
  .lr-note { font-size: 8.5pt; line-height: 1.4; margin: 0; flex: 1; }
  .lr-note strong { font-weight: 700; }
  .lr-foot img { max-height: 38mm; max-width: 70mm; object-fit: contain; }
  .lr-co { display: flex; gap: 5mm; flex: 1; min-height: 0; }
  .lr-co .tbl { flex: 1; }
  .lr-co .art { width: 42mm; display: flex; flex-direction: column; justify-content: space-around; }
  .lr-co .art img { width: 100%; max-height: 210mm; object-fit: contain; }
  /* the cover */
  .lr-cover { background: linear-gradient(180deg, #C7D8F2 0%, #B9C9EE 45%, #A895D8 100%); }
  .lr-cover .lr-frame { border-color: #3E4C59; background: transparent; }
  .lr-cover .top { display: flex; align-items: flex-start; justify-content: space-between; gap: 4mm; }
  .lr-cover .top img { width: 26mm; height: 26mm; object-fit: contain; }
  .lr-cover .top .ph { width: 26mm; }
  .lr-cover .school { text-align: center; flex: 1; font-family: Poppins, Arial, sans-serif; color: #102A43; }
  .lr-cover .school .n { font-size: 22pt; font-weight: 700; line-height: 1.15; }
  .lr-cover .school .l { font-size: 13pt; font-weight: 600; line-height: 1.35; }
  .lr-cover .school .s { font-size: 11pt; font-weight: 600; }
  .lr-cover .school .ti { font-size: 15pt; font-weight: 600; margin-top: 2mm; }
  .lr-cover .school .ca { font-size: 15pt; font-weight: 700; }
  .lr-cover .mid { display: flex; justify-content: space-between; align-items: flex-start; margin-top: 4mm; }
  .lr-cover .corner { width: 38mm; height: 38mm; object-fit: contain; }
  .lr-cover .photo { width: 40mm; height: 50mm; border: 3mm solid #9C6B3E; border-radius: 4mm; background: #fff; object-fit: cover; box-shadow: 0 0 0 1px #3E4C59; }
  .lr-cover .boxes { display: flex; flex-direction: column; gap: 7mm; margin-top: 4mm; }
  .lr-cover .box { align-self: flex-start; min-width: 80mm; max-width: 125mm; background: #FDCB84; border: 1px solid #3E4C59;
    border-radius: 3mm; padding: 4mm 5mm; font-family: Poppins, Arial, sans-serif; font-size: 12.5pt; font-weight: 600; color: #102A43; }
  .lr-cover .box b { font-weight: 700; margin-left: 2mm; }
  .lr-cover .art { position: absolute; left: 0; right: 0; bottom: 0; height: 95mm; display: flex; align-items: flex-end; justify-content: center; }
  .lr-cover .art img { width: 100%; height: 100%; object-fit: cover; object-position: bottom; }
  /* the record page */
  .lr-rec .row { display: flex; gap: 6mm; align-items: center; }
  .lr-rec .kv { display: grid; grid-template-columns: 34mm 34mm 34mm; gap: 3mm; }
  .lr-rec .lab, .lr-tagbox { background: #3C9D4E; color: #fff; font-family: Poppins, Arial, sans-serif; font-weight: 600; font-size: 9pt;
    border-radius: 1.5mm; padding: 2.4mm 3mm; border: 1px solid #2F7D3E; }
  .lr-rec .val { border: 1px solid #323F4B; text-align: center; font-weight: 700; font-size: 11pt; padding: 2.2mm; min-height: 6mm; }
  .lr-rec .art img { max-width: 48mm; max-height: 44mm; object-fit: contain; }
  .rc .lr-rec h3 { font-family: Poppins, Arial, sans-serif; font-size: 16pt; font-weight: 700; margin: 5mm 0 2mm; color: #102A43; }
  .lr-rec .two { display: grid; grid-template-columns: 1fr 1fr; gap: 6mm; }
  .lr-rec .tbox { border: 1.5px solid #1F2933; min-height: 36mm; padding: 2mm 3mm; font-size: 9.5pt; line-height: 1.4; display: flex; flex-direction: column; }
  .lr-rec .tbox .t { flex: 1; white-space: pre-line; }
  .lr-rec .tbox .lr-tagbox { align-self: flex-end; font-size: 8pt; padding: 1.4mm 4mm; }
  .lr-rec .say { display: grid; grid-template-columns: 9mm 1fr; gap: 3mm; margin-bottom: 3mm; }
  .lr-rec .say .side { background: #3C9D4E; color: #fff; border-radius: 1.5mm; display: flex; align-items: center; justify-content: center; }
  .lr-rec .say .side span { writing-mode: vertical-rl; transform: rotate(180deg); font-family: Poppins, Arial, sans-serif; font-weight: 600; font-size: 8pt; }
  .lr-rec .say .tbox { min-height: 17mm; }
  .lr-rec .say .by { text-align: right; font-weight: 700; font-size: 9pt; margin-top: 1mm; }
  .lr-rec .prom { display: grid; grid-template-columns: 50mm 1fr; gap: 4mm; align-items: center; margin-top: 2mm; }
  .lr-rec table.sig { width: 100%; border-collapse: collapse; table-layout: fixed; margin-top: 2mm; }
  .lr-rec table.sig td { border: 1px solid #323F4B; height: 14mm; text-align: center; vertical-align: bottom; font-size: 8.5pt; font-weight: 700; padding: 1mm; }
  .rc .lr-rec table.sig td.term { width: 9mm; background: #3C9D4E; color: #fff; padding: 0; vertical-align: middle; }
  .lr-rec table.sig td.term span { writing-mode: vertical-rl; transform: rotate(180deg); font-size: 7pt; font-family: Poppins, Arial, sans-serif; }
  .lr-rec table.sig td img { max-height: 9mm; max-width: 40mm; display: block; margin: 0 auto 0.5mm; }
  .rc .lr-rec table.sig tr.lab td { height: auto; background: #3C9D4E; color: #fff; border-color: #2F7D3E; font-family: Poppins, Arial, sans-serif; font-weight: 600; padding: 1.4mm; }
  .lr-rec .parent { display: flex; align-items: center; gap: 6mm; margin-top: 3mm; font-weight: 700; font-size: 10pt; }
  .lr-rec .parent .line { flex: 1; display: flex; gap: 6mm; }
  .lr-rec .parent .line span { flex: 1; border-bottom: 1px solid #1F2933; }
  /* the evaluation key */
  .lr-key .logos { display: flex; justify-content: space-around; margin: 14mm 0 10mm; }
  .lr-key .logos img { width: 30mm; height: 30mm; object-fit: contain; }
  .rc .lr-key h2 { text-align: center; font-family: Poppins, Arial, sans-serif; font-size: 22pt; margin: 0; color: #102A43; text-transform: uppercase; letter-spacing: 0.02em; }
  .lr-key .sub { text-align: center; font-family: Poppins, Arial, sans-serif; font-weight: 600; font-size: 11pt; margin: 1mm 0 8mm; }
  .lr-key table { width: 80%; margin: 0 auto; border-collapse: collapse; font-size: 15pt; }
  .lr-key td { border: 1px solid #52606D; padding: 4mm 3mm; }
  .lr-key td.gr { width: 12%; }
  .lr-key td.rg { width: 32%; }
  .lr-key .lr-scales { width: 80%; margin: 4mm auto 0; font-size: 10pt; line-height: 1.4; }
`;

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI'];
const shortName = (area: string) => (area.includes('·') ? area.split('·').pop()!.trim() : area);
const sameArea = (a: string, want: string) => {
  const x = a.trim().toLowerCase();
  const w = want.trim().toLowerCase();
  return x === w || shortName(x) === w;
};

const blankTerm = (code: string, filled: boolean): ReportCardTerm => ({
  code,
  name: code,
  filled,
  remark: null,
  participation: null,
  promotedTo: null,
  attendance: null,
  health: null,
  items: [],
});
/** how many terms the card shows at least (the shared card: Term I and Term II, later ones blank) */
let minTerms = 2;
/**
 * The card's terms: the data's (docs/design/73), or each exam of the HPC as a filled term; at least two
 * (Term I and Term II, or as many as the layout names), the ones whose exam is not made yet blank.
 */
function termsOf(h: ReportCardHpc): ReportCardTerm[] {
  const list = h.terms?.length ? [...h.terms] : h.exams.map((code) => blankTerm(code, true));
  while (list.length < minTerms) list.push(blankTerm(`T${String(list.length + 1)}`, false));
  return list;
}
const levelAt = (h: ReportCardHpc, i: ReportCardHpcItem, t: number) =>
  h.terms?.length ? (i.termLevels?.[t] ?? null) : (i.levels[t] ?? null);
/** the layout's term names set how many terms show at least (none: two) */
export function lrMinTerms(sections: LrSection[]) {
  minTerms = Math.max(2, ...sections.map((s) => s.termLabels?.length ?? 0));
}
const noteAt = (h: ReportCardHpc, i: ReportCardHpcItem, t: number) =>
  h.terms?.length ? (i.termNotes?.[t] ?? null) : t === i.levels.length - 1 ? i.note : null;
const termLabel = (s: LrSection, terms: ReportCardTerm[], t: number) =>
  s.termLabels?.[t] ?? (terms.length <= ROMAN.length ? `Term ${ROMAN[t]!}` : terms[t]!.name);

/** the page frame: the pupil's name at the top, the double border */
function page(d: ReportCardData, inner: string, cls = ''): string {
  return `<section class="lr-page ${cls}"><div class="lr-who">${esc(d.student.name)}&nbsp;&nbsp;${esc(d.student.admissionNo)}</div><div class="lr-frame">${inner}</div></section>`;
}

const fmtDate = (iso: string | null) => {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]!}-${m[2]!}-${m[1]!}` : iso;
};

export function lrCover(d: ReportCardData, s: LrSection, art: LrArt): string {
  const st = d.student;
  const box = (k: string, v: string | number | null | undefined) =>
    `<div class="box">${esc(k)}<b>${esc(v ?? '')}</b></div>`;
  const inner = `<div class="top">${d.school.logoDataUri ? img(d.school.logoDataUri, 'logo', 'School logo') : '<span class="ph"></span>'}
    <div class="school"><div class="n">${esc(d.school.name)}</div>${d.school.address ? `<div class="l">${esc(d.school.address)}</div>` : ''}<div class="l">Session ${esc(d.release.academicYear)}</div>${d.school.affiliationNo ? `<div class="s">Affiliation No. ${esc(d.school.affiliationNo)}</div>` : ''}<div class="ti">${esc(s.title ?? 'Learning curve')}</div>${s.caption === '' ? '' : `<div class="ca">${esc(s.caption ?? '(Progress record)')}</div>`}</div>
    ${art.logo_2 ? img(art.logo_2, 'logo', 'Emblem') : '<span class="ph"></span>'}</div>
    <div class="mid">${art.cover_corner ? img(art.cover_corner, 'corner') : '<span></span>'}${st.photoDataUri ? img(st.photoDataUri, 'photo', 'Photo') : '<span class="photo"></span>'}</div>
    <div class="boxes">${box('My name is', st.name)}${box('My admission number is', st.admissionNo)}${st.rollNo ? box('My roll number is', st.rollNo) : ''}${box('I am a shining star of', `${st.classCode}-${st.section}`)}${st.dob ? box('I was born on', fmtDate(st.dob)) : ''}</div>`;
  return `<section class="lr-page lr-cover"><div class="lr-frame">${inner}</div>${art.cover_art ? `<div class="art">${img(art.cover_art, '')}</div>` : ''}</section>`;
}

/** the rows of an area: its goals / skill groups as headings, their skills under them */
function areaRows(a: { area: string; items: ReportCardHpcItem[] }) {
  const rows: Array<{ item: ReportCardHpcItem; group: boolean }> = [];
  for (const i of a.items) {
    if (i.children.length) {
      rows.push({ item: i, group: true });
      for (const ch of i.children) rows.push({ item: ch, group: false });
    } else rows.push({ item: i, group: false });
  }
  return rows;
}
/** how tall an area prints (in rows of ~7.4 mm): the names wrap at about 34 characters */
/** the skill column's width (mm) beside the term columns and the remarks */
const nameMm = (terms: number, remarks: boolean) =>
  196 - 9 - terms * (terms > 2 ? 19 : 25) - (remarks ? 58 : 0);
/** a row's height in rows of 7.6 mm: its name wraps at the column's width (about 1.95 mm a letter) */
const rowUnits = (name: string, mm: number) => {
  const lines = Math.max(1, Math.ceil(name.length / Math.max(10, Math.floor(mm / 1.95))));
  return Math.max(1, (lines * 4.6 + 1.6) / 7.6);
};
function areaUnits(a: { area: string; items: ReportCardHpcItem[] }, remarks: boolean, mm: number) {
  const rows = areaRows(a);
  const u = rows.reduce((n, r) => n + rowUnits(r.item.name, mm), 0);
  return Math.max(u, remarks && rows.length >= 3 ? 4 : 1) + 0.6;
}
/** rows of 7.6 mm a page holds under the title, the head and the note */
const CAPACITY = 31;

/** the areas onto pages, each area whole (one longer than a page has a page of its own) */
export function lrPages<T extends { area: string; items: ReportCardHpcItem[] }>(
  areas: T[],
  remarks: boolean,
  capacity = CAPACITY,
  terms = 2,
): T[][] {
  const mm = nameMm(terms, remarks);
  const pages: T[][] = [];
  let cur: T[] = [];
  let used = 0;
  for (const a of areas) {
    const u = areaUnits(a, remarks, mm);
    if (cur.length && used + u > capacity) {
      pages.push(cur);
      cur = [];
      used = 0;
    }
    cur.push(a);
    used += u;
  }
  if (cur.length) pages.push(cur);
  return pages;
}

/** an area's remarks per term: the category of the subject named like the area (English, … · English) */
function remarksOf(area: string, terms: ReportCardTerm[]): Array<string | null> {
  const keys = [area, shortName(area)].map((x) => x.trim().toLowerCase());
  return terms.map((t) => {
    const hit = t.items.filter((x) =>
      [x.subject, x.subjectCode, x.category].some(
        (v) => v && keys.includes(v.trim().toLowerCase()),
      ),
    );
    return hit.length ? hit.map((x) => x.text).join(' ') : null;
  });
}

function areaTable(
  d: ReportCardData,
  h: ReportCardHpc,
  s: LrSection,
  areas: Array<{ area: string; items: ReportCardHpcItem[] }>,
  withRemarks: boolean,
): string {
  const terms = termsOf(h);
  const tc = terms.length;
  const cols = 2 + tc + (withRemarks ? 1 : 0);
  const head = `<thead><tr><th class="side" style="width:9mm"></th><th></th>${terms.map((_, t) => `<th style="width:${tc > 2 ? 19 : 25}mm">${esc(termLabel(s, terms, t))}${withRemarks ? ' grade' : ''}</th>`).join('')}${withRemarks ? '<th style="width:58mm">Remarks</th>' : ''}</tr></thead>`;
  const body = areas
    .map((a, ai) => {
      const rows = areaRows(a);
      const units = rows.reduce((n, r) => n + rowUnits(r.item.name, nameMm(tc, withRemarks)), 0);
      const full = shortName(a.area);
      // the side label fits the area's height (about 2.8 mm a letter at 10 pt); too long: its initials
      const room = units * 7.6;
      const words = full.split(/\s+/).filter(Boolean);
      const label =
        full.length * 2.8 > room && words.length > 1
          ? words.map((w) => w[0]!.toUpperCase()).join('')
          : full;
      const pt = Math.max(6, Math.min(10.5, (10 * room) / Math.max(1, label.length * 2.8)));
      const rem = withRemarks ? remarksOf(a.area, terms) : [];
      // the remarks block beside an area of three rows or more (a smaller one: its remark only, if any)
      const block = rows.length >= 3;
      const remCell = !withRemarks
        ? ''
        : block
          ? `<td class="rem" rowspan="${rows.length}"><div class="lr-rem"><div class="h">${esc(full)} remarks</div>${terms.map((_, t) => `<div class="t">${esc(rem[t] ?? '')}</div><div class="tag">${esc(termLabel(s, terms, t))}</div>`).join('')}</div></td>`
          : `<td class="rem" rowspan="${rows.length}"><div class="lr-rem">${rem.some(Boolean) ? `<div class="t">${esc(rem.filter(Boolean).join(' '))}</div>` : ''}</div></td>`;
      const trs = rows.map((r, ri) => {
        const side =
          ri === 0
            ? `<td class="side" rowspan="${rows.length}"><span style="font-size:${pt.toFixed(1)}pt">${esc(label)}</span></td>`
            : '';
        const cells = terms
          .map((_, t) => {
            if (r.group) return '<td class="g"></td>';
            if (r.item.kind === 'text')
              return `<td class="g text">${esc(noteAt(h, r.item, t) ?? '')}</td>`;
            const l = levelAt(h, r.item, t);
            return `<td class="g">${l ? esc(l) : terms[t]!.filled ? '–' : ''}</td>`;
          })
          .join('');
        return `<tr class="${r.group ? 'grp' : ''}">${side}<td class="n">${esc(r.item.name)}</td>${cells}${ri === 0 ? remCell : ''}</tr>`;
      });
      return (ai > 0 ? `<tr class="gap"><td colspan="${cols}"></td></tr>` : '') + trs.join('');
    })
    .join('');
  return `<table class="lr-t">${head}<tbody>${body}</tbody></table>`;
}

/** the subjects' pages (or the given areas'), the remarks column beside them */
export function lrSubjects(
  d: ReportCardData,
  s: LrSection,
  art: LrArt,
  areas: Array<{ area: string; items: ReportCardHpcItem[] }>,
): string {
  const h = d.hpc;
  if (!h || !areas.length) return '';
  const withRemarks = s.remarks !== false;
  const note =
    s.note ??
    'The above grades are based on classroom observation and oral testing by the teachers. Please refer to the evaluation key at the end of this record.';
  return lrPages(areas, withRemarks, CAPACITY, termsOf(h).length)
    .map((list) =>
      page(
        d,
        `<h2 class="lr-title">${esc(s.title ?? 'Scholastic area')}</h2>${areaTable(d, h, s, list, withRemarks)}<div class="lr-foot"><p class="lr-note"><strong>NOTE:</strong> ${esc(note)}</p>${img(art.scholastic, '')}</div>`,
      ),
    )
    .join('');
}

export function lrCoScholastic(
  d: ReportCardData,
  s: LrSection,
  art: LrArt,
  areas: Array<{ area: string; items: ReportCardHpcItem[] }>,
): string {
  const h = d.hpc;
  if (!h || !areas.length) return '';
  const note =
    s.note ??
    'For the grades awarded, please refer to the evaluation key at the end of this record.';
  return lrPages(areas, false, CAPACITY - 1, termsOf(h).length)
    .map((list) =>
      page(
        d,
        `<h2 class="lr-title">${esc(s.title ?? 'Co-scholastic area')}</h2><div class="lr-co"><div class="tbl">${areaTable(d, h, s, list, false)}</div>${art.co_scholastic ? `<div class="art">${img(art.co_scholastic, '')}</div>` : ''}</div><div class="lr-foot"><p class="lr-note"><strong>NOTE:</strong> ${esc(note)}</p></div>`,
      ),
    )
    .join('');
}

export function lrRecord(d: ReportCardData, s: LrSection, art: LrArt): string {
  const h = d.hpc;
  const terms = h ? termsOf(h) : [];
  if (!terms.length) return '';
  const label = (t: number) => termLabel(s, terms, t);
  const vals = (pick: (t: ReportCardTerm) => string) =>
    terms.map((t) => `<div class="val">${t.filled ? esc(pick(t)) : ''}</div>`).join('');
  const num = (v: string | null) =>
    v === null ? '' : v.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
  const kv = `<div class="kv" style="grid-template-columns: 34mm repeat(${terms.length}, 30mm)">
      <div class="lab">Height (cm)</div>${vals((t) => num(t.health?.heightCm ?? null))}
      <div class="lab">Weight (kg)</div>${vals((t) => num(t.health?.weightKg ?? null))}
      <div class="lab">Attendance</div>${vals((t) => (t.attendance ? `${t.attendance.present} / ${t.attendance.total}` : ''))}
      <span></span>${terms.map((_, t) => `<div class="lr-tagbox" style="text-align:center">${esc(label(t))}</div>`).join('')}
    </div>`;
  const participated = `<h3>I participated in …</h3><div class="two" style="grid-template-columns: repeat(${Math.min(terms.length, 2)}, 1fr)">${terms
    .slice(0, 2)
    .map(
      (t, i) =>
        `<div class="tbox"><div class="t">${t.filled ? esc(t.participation ?? '') : ''}</div><div class="lr-tagbox">${esc(label(i))}</div></div>`,
    )
    .join('')}</div>`;
  const teachers = (
    d.classTeachers?.length ? d.classTeachers : d.classTeacher ? [d.classTeacher] : []
  ).join(', ');
  const says = `<h3>My teachers say …</h3>${terms
    .map(
      (t, i) =>
        `<div class="say"><div class="side"><span>${esc(label(i))}</span></div><div class="tbox"><div class="t">${t.filled ? esc(t.remark ?? '') : ''}</div>${t.filled && t.remark && teachers ? `<div class="by">– ${esc(teachers)}</div>` : ''}</div></div>`,
    )
    .join('')}`;
  const promoted =
    [...terms].reverse().find((t) => t.filled && t.promotedTo)?.promotedTo ?? d.promotedTo ?? '';
  const roles = s.roles?.length ? s.roles : ['principal', 'coordinator', 'class_teacher'];
  const NAMES: Record<string, string> = {
    principal: 'Principal',
    vice_principal: 'Vice principal',
    headmistress: 'Headmistress',
    coordinator: 'Co-ordinator',
    class_teacher: 'Class teachers',
    exam_incharge: 'Exam in-charge',
  };
  const sigRows = terms
    .map((t, i) => {
      const cells = roles
        .map((role) => {
          if (!t.filled) return '<td></td>';
          const g = (d.signatures ?? []).find((x) => x.role === role);
          const who = g?.personName ?? (role === 'class_teacher' ? teachers : '');
          return `<td>${g?.dataUri ? `<img src="${g.dataUri}" alt="" />` : ''}${esc(who)}</td>`;
        })
        .join('');
      return `<tr><td class="term"><span>${esc(label(i))}</span></td>${cells}</tr>`;
    })
    .join('');
  const labels = roles
    .map((role) => {
      const g = (d.signatures ?? []).find((x) => x.role === role);
      return `<td>${esc(g?.label ?? NAMES[role] ?? role)}</td>`;
    })
    .join('');
  const inner = `<h2 class="lr-title">${esc(s.title ?? 'Health record & attendance')}</h2>
    <div class="row">${art.record ? `<div class="art">${img(art.record, '')}</div>` : ''}${kv}</div>
    ${participated}${says}
    <div class="prom"><div class="lab">Promoted to</div><div class="val" style="text-align:left">${esc(promoted)}</div></div>
    <div class="lab" style="display:inline-block;margin-top:3mm">Signatures</div>
    <table class="sig"><tbody>${sigRows}<tr class="lab"><td class="term" style="background:#3C9D4E"></td>${labels}</tr></tbody></table>
    <div class="parent"><span class="lab">Parent's signature</span><div class="line">${terms.map((_, i) => `<strong>${esc(label(i))}</strong><span></span>`).join('')}</div></div>`;
  return page(d, inner, 'lr-rec');
}

export function lrKey(d: ReportCardData, s: LrSection, art: LrArt): string {
  const key = d.hpc?.key?.length
    ? d.hpc.key
    : (d.hpc?.levels ?? []).map((g) => ({
        grade: g,
        words: d.hpc?.levelWords[g] ?? null,
        minPct: null,
        maxPct: null,
      }));
  if (!key.length) return '';
  const range = (k: (typeof key)[number], i: number) => {
    if (k.minPct === null || k.maxPct === null) return '';
    const hi = Math.floor(k.maxPct);
    return i === key.length - 1 && k.minPct <= 0
      ? `${hi} % and below`
      : `${Math.round(k.minPct)} – ${hi} %`;
  };
  const anyRange = key.some((k) => k.minPct !== null);
  const rows = key
    .map(
      (k, i) =>
        `<tr><td class="gr">${esc(k.grade)}</td><td>${esc(k.words ?? '')}</td>${anyRange ? `<td class="rg">${esc(range(k, i))}</td>` : ''}</tr>`,
    )
    .join('');
  const logos =
    d.school.logoDataUri || art.logo_2
      ? `<div class="logos">${img(d.school.logoDataUri, '', 'School logo')}${img(art.logo_2, '', 'Emblem')}</div>`
      : '<div style="height:20mm"></div>';
  // areas rated on levels of their own (observations: Rarely … Always), a line each
  const scales = (d.hpc?.scales ?? [])
    .map(
      (sc) =>
        `<div class="lr-scales"><strong>${esc(sc.areas.join(', '))}:</strong> ${sc.levels.map((l) => esc(l)).join(' · ')}</div>`,
    )
    .join('');
  return page(
    d,
    `${logos}<h2>${esc(s.title ?? 'Evaluation key')}</h2><div class="sub">(Scholastic and co-scholastic areas)</div><table><tbody>${rows}</tbody></table>${scales}`,
    'lr-key',
  );
}

/**
 * Which areas each subjects / co-scholastic section prints: the co-scholastic ones first (those named, or
 * the areas rated on levels of their own or written), then each subjects section its named areas, or
 * every scholastic area not printed yet.
 */
export function lrAreaPlan(
  h: ReportCardHpc | null | undefined,
  sections: LrSection[],
): Map<LrSection, Array<{ area: string; items: ReportCardHpcItem[] }>> {
  const plan = new Map<LrSection, Array<{ area: string; items: ReportCardHpcItem[] }>>();
  if (!h) return plan;
  const all = h.areas;
  const named = (s: LrSection) =>
    (s.areas ?? [])
      .map((w) => all.find((a) => sameArea(a.area, w)))
      .filter((a): a is (typeof all)[number] => Boolean(a));
  const scaled = new Set((h.scales ?? []).flatMap((x) => x.areas));
  const leaves = (a: (typeof all)[number]) =>
    a.items.flatMap((i) => (i.children.length ? i.children : [i]));
  const coSections = sections.filter((s) => s.type === 'lr_co_scholastic');
  const co = new Set<string>();
  for (const s of coSections) {
    const list = named(s).length
      ? named(s)
      : all.filter((a) => scaled.has(a.area) || leaves(a).every((i) => i.kind === 'text'));
    const own = list.filter((a) => !co.has(a.area));
    own.forEach((a) => co.add(a.area));
    plan.set(s, own);
  }
  const printed = new Set<string>(co);
  const subjects = sections.filter((x) => x.type === 'lr_subjects');
  for (const s of subjects) {
    const list = named(s).length ? named(s) : all.filter((a) => !co.has(a.area));
    const own = list.filter((a) => !printed.has(a.area));
    own.forEach((a) => printed.add(a.area));
    plan.set(s, own);
  }
  // an area no section names prints with the last subjects section, in the set's order
  const last = subjects[subjects.length - 1];
  if (last) {
    const rest = all.filter((a) => !printed.has(a.area));
    if (rest.length)
      plan.set(
        last,
        all.filter((a) => (plan.get(last) ?? []).includes(a) || rest.includes(a)),
      );
  }
  return plan;
}

export const isLearningRecord = (sections: Array<{ type: string }>) =>
  sections.some((s) => s.type.startsWith('lr_'));
