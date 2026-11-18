import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from 'pdf-lib';
import { drawLetterhead, embedLogo } from '../../common/pdf/letterhead';
import { drawSignBoxes, type SignBox } from '../purchase/purchase-doc-sign';
import type { ResultCharts } from './board-reports';
import type { ReportHead } from './board-reports-file';

/**
 * The Result Analysis graphs as a PDF (docs/design/88), drawn by EduPro (no worker, no browser): the letterhead,
 * the pass % over the years, each subject's grades as 100% bars, the marks, and every subject's grades across
 * the years two a page — each chart with its numbers table — and the signature boxes. A4 upright.
 */

const W = 595.28;
const H = 841.89;
const M = 36;
const FOOT = M + 18;
const hex = (h: string): RGB =>
  rgb(
    parseInt(h.slice(1, 3), 16) / 255,
    parseInt(h.slice(3, 5), 16) / 255,
    parseInt(h.slice(5, 7), 16) / 255,
  );
// the design system's chart colours (packages/ui tokens): the soft tones are the full ones at half strength
const soft = (c: RGB): RGB => rgb(0.5 + c.red / 2, 0.5 + c.green / 2, 0.5 + c.blue / 2);
const NAVY = hex('#00265d');
const CYAN = hex('#00a0c6');
const INFO = hex('#007a9b');
const GREEN = hex('#1e8e5a');
const AMBER = hex('#b9770e');
const RED = hex('#c43d3d');
const GREY = hex('#8b96a5');
const INK = hex('#0b1f3a');
const MUTED = hex('#5b6676');
const LINE = hex('#dbe0ea');
const ZEBRA = hex('#f6f8fb');
const HEAD = hex('#eef1fb');
const WHITE = rgb(1, 1, 1);

/** A1 … E1: green, blue and cyan pairs (the second soft), then amber and red, as on screen. */
const GRADE_FILLS = [GREEN, soft(GREEN), NAVY, soft(NAVY), CYAN, soft(CYAN), AMBER, RED];
const GRADE_DARK_TEXT = [false, true, false, true, true, true, true, false];
/** the years, the latest the strongest */
const YEAR_FILLS = [GREY, INFO, CYAN, AMBER, NAVY];
const SERIES_FILLS = [NAVY, CYAN, GREEN];
const MARK_FILLS = [NAVY, CYAN, AMBER];

const latin = (s: string) =>
  s
    .replace(/[‐-―]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/≥/g, '>=')
    .replace(/≤/g, '<=')
    .replace(/…/g, '...')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');
function fit(font: PDFFont, text: string, size: number, width: number): string {
  let out = latin(text);
  if (font.widthOfTextAtSize(out, size) <= width) return out;
  while (out.length > 1 && font.widthOfTextAtSize(`${out}...`, size) > width)
    out = out.slice(0, -1);
  return `${out}...`;
}
function lines(font: PDFFont, text: string, size: number, width: number, max: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of latin(text).split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (!line || font.widthOfTextAtSize(next, size) <= width) line = next;
    else {
      out.push(line);
      line = word;
    }
  }
  if (line) out.push(line);
  return out.length > max
    ? [...out.slice(0, max - 1), fit(font, out.slice(max - 1).join(' '), size, width)]
    : out;
}
/** 34.29 → "34.3", 50 → "50" */
const num = (v: number) => {
  const r = Math.round(v * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
};
const pctText = (v: number) => `${num(v)}%`;
/** a round top for a % axis and its steps: 10 by 5s, 30 by 10s, 75 by 25s … */
const niceAxis = (v: number) => {
  const step = v <= 20 ? 5 : v <= 50 ? 10 : 25;
  const max = Math.min(100, Math.max(step * 2, Math.ceil(v / step) * step));
  const ticks: number[] = [];
  for (let t = 0; t <= max; t += step) ticks.push(t);
  return { max, ticks };
};

export interface ChartsPdfLabels {
  /** what the paper is, on the letterhead */
  title: string;
  passTitle: string;
  passHelp: string;
  gradesTitle: string;
  gradesHelp: string;
  marksTitle: string;
  marksHelp: string;
  yearsTitle: (subject: string) => string;
  yearsHelp: string;
  footnote: string;
}

export const CHARTS_LABELS: ChartsPdfLabels = {
  title: 'Result analysis - graphs',
  passTitle: 'Pass % over the years',
  passHelp: 'The share of those who appeared whose CBSE result is PASS, a year.',
  gradesTitle: 'Grades by subject',
  gradesHelp:
    "Each subject's students at each grade, as a share of those who appeared (the labels are rounded; the table has the counts).",
  marksTitle: 'Marks by subject',
  marksHelp: "Each subject's highest, average and lowest marks.",
  yearsTitle: (s) => `${s}: grades across the years`,
  yearsHelp: 'The share of those who appeared at each grade, a year.',
  footnote:
    'Grades follow Set-up (counted from the marks, or as printed on the result). Shares are of those who appeared in the subject.',
};

export async function resultChartsPdf(
  ch: ResultCharts,
  head: ReportHead,
  opts: { code?: string | null | undefined } = {},
  L: ChartsPdfLabels = CHARTS_LABELS,
): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${head.title} - graphs`);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await embedLogo(pdf, head.logo);
  const pages: PDFPage[] = [];
  let page = pdf.addPage([W, H]);
  let y = 0;
  const width = W - 2 * M;

  const text = (
    s: string,
    x: number,
    at: number,
    o: {
      size?: number;
      font?: PDFFont;
      color?: RGB;
      align?: 'left' | 'right' | 'center';
      max?: number;
    } = {},
  ) => {
    const size = o.size ?? 8;
    const font = o.font ?? regular;
    const t = o.max ? fit(font, s, size, o.max) : latin(s);
    const w = font.widthOfTextAtSize(t, size);
    page.drawText(t, {
      x: o.align === 'right' ? x - w : o.align === 'center' ? x - w / 2 : x,
      y: at,
      size,
      font,
      color: o.color ?? INK,
    });
  };
  const first = () => {
    pages.push(page);
    y = drawLetterhead(page, { regular, bold }, logo, {
      school: head.school,
      address: head.address,
      title: L.title,
      details: `Made ${head.generatedOn}`,
      margin: 28,
    });
    for (const line of [head.title, head.scope]) {
      text(line, M, y, { size: 9, color: MUTED, max: width });
      y -= 13;
    }
    y -= 4;
  };
  const fresh = () => {
    page = pdf.addPage([W, H]);
    pages.push(page);
    text(`${head.school} · ${head.title}`, M, H - M, {
      size: 9,
      font: bold,
      color: NAVY,
      max: width,
    });
    page.drawLine({
      start: { x: M, y: H - M - 6 },
      end: { x: W - M, y: H - M - 6 },
      thickness: 0.6,
      color: LINE,
    });
    y = H - M - 24;
  };
  const need = (h: number) => {
    if (y - h < FOOT) fresh();
  };
  const section = (title: string, help: string) => {
    need(60);
    text(title, M, y, { size: 11.5, font: bold, color: NAVY, max: width });
    y -= 13;
    for (const l of lines(regular, help, 8, width, 2)) {
      text(l, M, y, { size: 8, color: MUTED });
      y -= 10;
    }
    y -= 4;
  };
  const legend = (items: Array<{ label: string; fill: RGB }>) => {
    let x = M;
    for (const it of items) {
      const w = regular.widthOfTextAtSize(latin(it.label), 7.5) + 20;
      if (x + w > W - M) {
        x = M;
        y -= 11;
      }
      page.drawRectangle({ x, y: y - 1, width: 8, height: 8, color: it.fill });
      text(it.label, x + 11, y, { size: 7.5 });
      x += w;
    }
    y -= 14;
  };
  /** a small numbers table: a header row, zebra rows, the header again on a new page */
  const table = (
    cols: Array<{ label: string; width: number; right?: boolean }>,
    rows: string[][],
  ) => {
    const ROW = 12;
    const FS = 7;
    const sum = cols.reduce((a, c) => a + c.width, 0);
    const ws = cols.map((c) => (width * c.width) / sum);
    const row = (cells: string[], font: PDFFont, fill?: RGB) => {
      if (fill) page.drawRectangle({ x: M, y: y - 3, width, height: ROW, color: fill });
      let x = M;
      cols.forEach((c, i) => {
        const s = fit(font, cells[i] ?? '', FS, ws[i]! - 6);
        text(s, c.right ? x + ws[i]! - 3 : x + 3, y, {
          size: FS,
          font,
          align: c.right ? 'right' : 'left',
        });
        x += ws[i]!;
      });
      y -= ROW;
    };
    need(ROW * Math.min(rows.length + 1, 4) + 4);
    row(
      cols.map((c) => c.label),
      bold,
      HEAD,
    );
    rows.forEach((r, i) => {
      if (y - ROW < FOOT) {
        fresh();
        row(
          cols.map((c) => c.label),
          bold,
          HEAD,
        );
      }
      row(r, regular, i % 2 === 1 ? ZEBRA : undefined);
    });
    y -= 8;
  };
  /** the grid lines and % labels of a vertical axis from `base` up `h`, over `left`…W-M */
  const yAxis = (
    left: number,
    base: number,
    h: number,
    max: number,
    ticks: number[],
    suffix: string,
    lo = 0,
  ) => {
    for (const v of ticks) {
      const yy = base + (h * (v - lo)) / (max - lo);
      page.drawLine({
        start: { x: left, y: yy },
        end: { x: W - M, y: yy },
        thickness: 0.4,
        color: LINE,
      });
      text(`${num(v)}${suffix}`, left - 4, yy - 2.5, { size: 6.5, color: MUTED, align: 'right' });
    }
  };

  first();

  // 1. pass % over the years: a line a series, the value over each point
  section(L.passTitle, L.passHelp);
  {
    const t = ch.passTrend;
    legend(t.series.map((s, i) => ({ label: s.label, fill: SERIES_FILLS[i] ?? NAVY })));
    const CH = 130;
    need(CH + 36);
    const left = M + 28;
    const base = y - CH - 12;
    // the axis starts under the lowest pass % (in tens), so close years stay apart; its start is labelled
    const seen = t.series.flatMap((s) => s.values).filter((v): v is number => v !== null);
    const lo = Math.max(0, Math.min(90, Math.floor((Math.min(100, ...seen) - 5) / 10) * 10));
    const ticks: number[] = [];
    const tick = 100 - lo <= 20 ? 5 : 100 - lo <= 50 ? 10 : 25;
    for (let v = lo; v <= 100; v += tick) ticks.push(v);
    yAxis(left, base, CH, 100, ticks, '%', lo);
    const n = t.labels.length;
    const step = (W - M - left - 20) / Math.max(1, n - 1);
    const xOf = (i: number) => (n === 1 ? (left + W - M) / 2 : left + 10 + i * step);
    t.series.forEach((s, k) => {
      const color = SERIES_FILLS[k] ?? NAVY;
      let prev: { x: number; y: number } | null = null;
      s.values.forEach((v, i) => {
        if (v === null) {
          prev = null;
          return;
        }
        const pt = { x: xOf(i), y: base + (CH * (v - lo)) / (100 - lo) };
        if (prev) page.drawLine({ start: prev, end: pt, thickness: 1.6, color });
        page.drawCircle({ x: pt.x, y: pt.y, size: 2.6, color });
        // the labels of the series take turns above and under the points, so close values stay readable
        text(pctText(v), pt.x, pt.y + (k === 1 ? -10 : k === 2 ? 13 : 5), {
          size: 6.5,
          color,
          align: 'center',
        });
        prev = pt;
      });
    });
    t.labels.forEach((l, i) => text(l, xOf(i), base - 11, { size: 7, align: 'center' }));
    y = base - 24;
    table(
      [
        { label: 'Year', width: 2 },
        ...t.series.map((s) => ({ label: `${s.label} %`, width: 1.4, right: true })),
      ],
      t.labels.map((l, i) => [
        l,
        ...t.series.map((s) => (s.values[i] === null ? '-' : pctText(s.values[i]!))),
      ]),
    );
  }

  const gradeCols = ch.grades.map((g) => ({ label: g, width: 1.25, right: true }));
  const cellOf = (n: number, p: number) => `${String(n)} (${pctText(p)})`;

  // 2. grades by subject: a 100% bar a subject, the share on each part wide enough to carry it
  section(L.gradesTitle, L.gradesHelp);
  {
    legend(ch.grades.map((g, i) => ({ label: g, fill: GRADE_FILLS[i]! })));
    const LABEL = 150;
    const left = M + LABEL;
    const span = W - M - left;
    const ROW = 17;
    const BAR = 12;
    const axis = () => {
      for (const v of [0, 25, 50, 75, 100]) {
        const x = left + (span * v) / 100;
        text(`${String(v)}%`, x, y, {
          size: 6.5,
          color: MUTED,
          align: v === 100 ? 'right' : v ? 'center' : 'left',
        });
      }
      y -= 10;
    };
    need(ROW * 2 + 12);
    axis();
    for (const s of ch.gradeSpread) {
      if (y - ROW < FOOT) {
        fresh();
        legend(ch.grades.map((g, i) => ({ label: g, fill: GRADE_FILLS[i]! })));
        axis();
      }
      text(`${s.code} ${s.name}`, M, y - BAR + 3.5, { size: 7.5, max: LABEL - 8 });
      if (!s.appeared)
        page.drawRectangle({
          x: left,
          y: y - BAR,
          width: span,
          height: BAR,
          borderColor: LINE,
          borderWidth: 0.5,
        });
      let x = left;
      s.pct.forEach((p, i) => {
        const w = (span * p) / 100;
        if (w <= 0) return;
        page.drawRectangle({ x, y: y - BAR, width: w, height: BAR, color: GRADE_FILLS[i]! });
        const label = `${String(Math.round(p))}%`;
        if (w >= bold.widthOfTextAtSize(label, 6.5) + 4)
          text(label, x + w / 2, y - BAR + 3.5, {
            size: 6.5,
            font: bold,
            color: GRADE_DARK_TEXT[i] ? INK : WHITE,
            align: 'center',
          });
        x += w;
      });
      y -= ROW;
    }
    y -= 6;
    table(
      [
        { label: 'Subject', width: 3.2 },
        { label: 'Appeared', width: 1.1, right: true },
        ...gradeCols,
      ],
      ch.gradeSpread.map((s) => [
        `${s.code} ${s.name}`,
        String(s.appeared),
        ...s.counts.map((n, i) => cellOf(n, s.pct[i] ?? 0)),
      ]),
    );
  }

  // 3. marks by subject: three bars a subject (highest, average, lowest), the marks at the end of each
  section(L.marksTitle, L.marksHelp);
  {
    const names = ['Highest', 'Average', 'Lowest'];
    legend(names.map((label, i) => ({ label, fill: MARK_FILLS[i]! })));
    const LABEL = 150;
    const left = M + LABEL;
    const span = W - M - left - 24;
    const max = Math.max(100, ...ch.marks.flatMap((m) => m.values));
    const BAR = 4.6;
    const ROW = 3 * (BAR + 1) + 7;
    for (const m of ch.marks) {
      if (y - ROW < FOOT) fresh();
      text(`${m.code} ${m.name}`, M, y - (3 * (BAR + 1)) / 2 - 2, { size: 7.5, max: LABEL - 8 });
      m.values.forEach((v, i) => {
        const yy = y - (i + 1) * (BAR + 1);
        const w = (span * v) / max;
        if (w > 0)
          page.drawRectangle({ x: left, y: yy, width: w, height: BAR, color: MARK_FILLS[i]! });
        text(num(v), left + w + 3, yy + 0.4, { size: 5.8, color: MUTED });
      });
      page.drawLine({
        start: { x: left, y: y + 1 },
        end: { x: left, y: y - 3 * (BAR + 1) - 1 },
        thickness: 0.5,
        color: LINE,
      });
      y -= ROW;
    }
    y -= 12;
    table(
      [
        { label: 'Subject', width: 3.2 },
        ...names.map((label) => ({ label, width: 1.2, right: true })),
      ],
      ch.marks.map((m) => [`${m.code} ${m.name}`, ...m.values.map(num)]),
    );
  }

  // 4. every subject's grades across the years: two subjects a page, the years side by side at each grade
  if (ch.subjectYears.length) {
    fresh();
    ch.subjectYears.forEach((s, n) => {
      if (n > 0 && n % 2 === 0) fresh();
      else if (n % 2 === 1) y -= 10;
      const years = s.series;
      const fills = years.map(
        (_, i) => YEAR_FILLS[(YEAR_FILLS.length - years.length + i) % YEAR_FILLS.length]!,
      );
      text(L.yearsTitle(`${s.code} ${s.name}`), M, y, {
        size: 11,
        font: bold,
        color: NAVY,
        max: width,
      });
      y -= 12;
      text(L.yearsHelp, M, y, { size: 7.5, color: MUTED, max: width });
      y -= 12;
      legend(
        years.map((yr, i) => ({
          label: `${yr.label} (${String(yr.appeared)} appeared)`,
          fill: fills[i]!,
        })),
      );
      const CH = 150;
      const left = M + 28;
      const base = y - CH;
      const { max, ticks } = niceAxis(Math.max(0, ...years.flatMap((yr) => yr.pct)));
      yAxis(left, base, CH, max, ticks, '%');
      const step = (W - M - left) / ch.grades.length;
      const group = step * 0.8;
      const bar = group / Math.max(1, years.length);
      ch.grades.forEach((g, gi) => {
        const x0 = left + gi * step + (step - group) / 2;
        years.forEach((yr, k) => {
          const p = yr.pct[gi] ?? 0;
          const h = (CH * p) / max;
          if (h > 0)
            page.drawRectangle({
              x: x0 + k * bar,
              y: base,
              width: bar - 0.8,
              height: h,
              color: fills[k]!,
            });
          if (bar >= 13 && p > 0)
            text(num(p), x0 + k * bar + bar / 2, base + h + 2, {
              size: 5.8,
              color: MUTED,
              align: 'center',
            });
        });
        text(g, x0 + group / 2, base - 10, { size: 7.5, font: bold, align: 'center' });
      });
      y = base - 22;
      table(
        [{ label: 'Year', width: 2 }, { label: 'Appeared', width: 1.1, right: true }, ...gradeCols],
        years.map((yr) => [
          yr.label,
          String(yr.appeared),
          ...yr.counts.map((c, i) => cellOf(c, yr.pct[i] ?? 0)),
        ]),
      );
    });
  }

  // the closing note and the signature boxes
  need(40);
  for (const l of lines(regular, L.footnote, 7.5, width, 3)) {
    text(l, M, y, { size: 7.5, color: MUTED });
    y -= 10;
  }
  const signs: SignBox[] = [
    {
      as: 'Prepared by',
      name: head.by,
      code: null,
      designation: null,
      when: head.generatedOn,
      signature: null,
    },
    { as: 'Checked by', name: null, code: null, designation: null, when: null, signature: null },
    { as: 'Principal', name: null, code: null, designation: null, when: null, signature: null },
  ];
  if (y - 118 < FOOT) fresh();
  y -= 16;
  await drawSignBoxes(pdf, page, { regular, bold }, signs, { x: M, y, width });

  pages.forEach((p, i) =>
    p.drawText(
      latin(
        `Page ${String(i + 1)} of ${String(pages.length)}${opts.code ? ` · subject ${opts.code}` : ''}`,
      ),
      {
        x: M,
        y: 18,
        size: 8,
        font: regular,
        color: MUTED,
      },
    ),
  );
  return Buffer.from(await pdf.save());
}
