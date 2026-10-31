import ExcelJS from 'exceljs';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage } from 'pdf-lib';

/**
 * The students' subject mapping as the legacy "Define Student Subject Mapping" export (docs/design/67):
 * the school's letterhead (logo, name, the title, the classes, the session, when it was made), then a
 * row per student: admission no, class, name, stream and Subject-1, Option(Y/N), Subject-2, … with every
 * cell ruled. Excel and an A4 landscape PDF of the same.
 */
export interface MappingSheet {
  school: string;
  title: string;
  /** under the title: Classes: VI-A · Session: 2026-27 · Generated on: … */
  lines: string[];
  logo: { contentType: string; bytes: Buffer } | null;
  slots: number;
  rows: Array<{
    admissionNo: string;
    className: string;
    name: string;
    stream: string;
    /** per slot: the subject (upper case) and Y / N ('' when the slot is empty) */
    cells: Array<{ subject: string; option: string }>;
  }>;
}

const INK = rgb(0.1, 0.1, 0.12);
const RULE = rgb(0.15, 0.15, 0.18);
const HEAD_BG = rgb(0.9, 0.91, 0.93);

const latin = (s: string) => s.replace(/[‐-―]/g, '-').replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');
function fit(font: PDFFont, text: string, size: number, width: number): string {
  let s = latin(text);
  if (font.widthOfTextAtSize(s, size) <= width) return s;
  while (s.length > 1 && font.widthOfTextAtSize(`${s}..`, size) > width) s = s.slice(0, -1);
  return `${s}..`;
}

/** A cell's text in up to two lines of the width (words kept whole where they fit). */
function wrap(font: PDFFont, text: string, size: number, width: number): string[] {
  const words = latin(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) <= width) cur = next;
    else {
      if (cur) lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length <= 2) return lines.map((l) => fit(font, l, size, width));
  return [fit(font, lines[0]!, size, width), fit(font, lines.slice(1).join(' '), size, width)];
}

export async function mappingXlsx(m: MappingSheet): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Subject mapping', {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  const head = [
    'ADMISSION_NUMBER',
    'CLASS_NAME',
    'STUDENT_NAME',
    'STREAM',
    ...Array.from({ length: m.slots }, (_, k) => [
      `SUBJECT-${String(k + 1)}`,
      'OPTION(Y/N)',
    ]).flat(),
  ];
  const last = head.length;
  // the letterhead: logo on the left, the lines centred over the table
  const top = [m.school, m.title, ...m.lines];
  top.forEach((text, i) => {
    const row = ws.getRow(i + 1);
    row.getCell(1).value = text;
    ws.mergeCells(i + 1, 1, i + 1, last);
    row.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
    row.getCell(1).font = { bold: i < 2, size: i === 0 ? 14 : i === 1 ? 12 : 10 };
    row.height = i === 0 ? 22 : 16;
  });
  if (m.logo && /^image\/(png|jpeg)$/.test(m.logo.contentType)) {
    const id = wb.addImage({
      buffer: m.logo.bytes as unknown as ExcelJS.Buffer,
      extension: m.logo.contentType === 'image/png' ? 'png' : 'jpeg',
    });
    ws.addImage(id, { tl: { col: 0.1, row: 0.1 }, ext: { width: 64, height: 64 } });
  }
  const headRow = ws.getRow(top.length + 2);
  head.forEach((h, i) => {
    const c = headRow.getCell(i + 1);
    c.value = h;
    c.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 9 };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF000000' } };
    c.alignment = { horizontal: 'center', vertical: 'middle' };
  });
  const thin = { style: 'thin' as const, color: { argb: 'FF333333' } };
  m.rows.forEach((r, n) => {
    const row = ws.getRow(top.length + 3 + n);
    const values = [
      r.admissionNo,
      r.className,
      r.name.toUpperCase(),
      r.stream.toUpperCase(),
      ...r.cells.flatMap((c) => [c.subject, c.option]),
    ];
    values.forEach((v, i) => {
      const c = row.getCell(i + 1);
      c.value = v;
      c.font = { size: 9 };
      c.border = { top: thin, left: thin, bottom: thin, right: thin };
    });
    row.getCell(1).numFmt = '@';
  });
  headRow.eachCell((c) => {
    c.border = { top: thin, left: thin, bottom: thin, right: thin };
  });
  ws.getColumn(1).width = 18;
  ws.getColumn(2).width = 12;
  ws.getColumn(3).width = 28;
  ws.getColumn(4).width = 14;
  for (let k = 0; k < m.slots; k += 1) {
    ws.getColumn(5 + 2 * k).width = 24;
    ws.getColumn(6 + 2 * k).width = 12;
  }
  ws.views = [{ state: 'frozen', xSplit: 3, ySplit: top.length + 2 }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function mappingPdf(m: MappingSheet): Promise<Buffer> {
  const W = 841.89;
  const H = 595.28;
  const M = 28;
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${m.title} · ${m.lines[0] ?? ''}`);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let logo: PDFImage | null = null;
  if (m.logo && /^image\/(png|jpeg)$/.test(m.logo.contentType)) {
    try {
      logo =
        m.logo.contentType === 'image/png'
          ? await pdf.embedPng(new Uint8Array(m.logo.bytes))
          : await pdf.embedJpg(new Uint8Array(m.logo.bytes));
    } catch {
      logo = null;
    }
  }
  const head = [
    'ADMISSION',
    'CLASS',
    'NAME',
    'STREAM',
    ...Array.from({ length: m.slots }, (_, k) => [`SUBJECT-${String(k + 1)}`, 'OPT(Y/N)']).flat(),
  ];
  // shares of the width: the subjects wider than their Y / N
  const share = head.map((h, i) =>
    i === 0
      ? 1.6
      : i === 1
        ? 1.0
        : i === 2
          ? 2.4
          : i === 3
            ? 1.3
            : h.startsWith('SUBJECT')
              ? 2.6
              : 1.25,
  );
  const sum = share.reduce((a, b) => a + b, 0);
  const widths = share.map((s) => ((W - 2 * M) * s) / sum);
  const FS = head.length > 16 ? 5.6 : 6.5;
  const LEAD = FS + 1.5;
  let page = pdf.addPage([W, H]);
  let y = 0;
  let pageNo = 0;
  const rule = (x1: number, y1: number, x2: number, y2: number) =>
    page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 0.5, color: RULE });
  // a row as tall as its longest cell (one or two lines)
  const row = (cells: string[], font: PDFFont, shade: boolean) => {
    const lines = cells.map((t, i) => wrap(font, t, FS, widths[i]! - 4));
    const ROW = 4 + Math.max(1, ...lines.map((l) => l.length)) * LEAD;
    if (shade)
      page.drawRectangle({ x: M, y: y - ROW, width: W - 2 * M, height: ROW, color: HEAD_BG });
    let x = M;
    lines.forEach((ls, i) => {
      ls.forEach((s, k) =>
        page.drawText(s, {
          x: shade ? x + (widths[i]! - font.widthOfTextAtSize(s, FS)) / 2 : x + 2,
          y: y - 2 - FS - k * LEAD + 1,
          size: FS,
          font,
          color: INK,
        }),
      );
      rule(x, y, x, y - ROW);
      x += widths[i]!;
    });
    rule(x, y, x, y - ROW);
    rule(M, y, W - M, y);
    rule(M, y - ROW, W - M, y - ROW);
    y -= ROW;
  };
  const letterhead = () => {
    pageNo += 1;
    let top = H - M;
    if (logo) {
      const h = 52;
      const w = (logo.width / logo.height) * h;
      page.drawImage(logo, { x: M, y: top - h, width: Math.min(w, 180), height: h });
    }
    const centre = (text: string, font: PDFFont, size: number) => {
      const s = fit(font, text, size, W - 2 * M - 200);
      page.drawText(s, {
        x: (W - font.widthOfTextAtSize(s, size)) / 2,
        y: top - size,
        size,
        font,
        color: INK,
      });
      top -= size + 5;
    };
    centre(m.school.toUpperCase(), bold, 13);
    centre(m.title, bold, 10.5);
    for (const l of m.lines) centre(l, regular, 8);
    y = Math.min(top, H - M - 58) - 10;
    row(head, bold, true);
  };
  const footer = () => {
    const s = `Page ${String(pageNo)}`;
    page.drawText(s, {
      x: W - M - regular.widthOfTextAtSize(s, 7),
      y: M / 2,
      size: 7,
      font: regular,
      color: INK,
    });
  };
  letterhead();
  for (const r of m.rows) {
    if (y - 2 * LEAD - 4 < M) {
      footer();
      page = pdf.addPage([W, H]);
      letterhead();
    }
    row(
      [
        r.admissionNo,
        r.className,
        r.name.toUpperCase(),
        r.stream.toUpperCase(),
        ...r.cells.flatMap((c) => [c.subject, c.option]),
      ],
      regular,
      false,
    );
  }
  footer();
  return Buffer.from(await pdf.save());
}

/**
 * The legacy "Student Subject Mapping Report" of a class (docs/design/67): the letterhead in a ruled
 * box (logo in its own cell; the school, the title, the session and when it was made), then each
 * section under "Section: VI-A" with S.No, Subject and Student Count. Excel and an A4 landscape PDF.
 */
export interface CountsReport {
  school: string;
  /** Student Subject Mapping Report | Class-VI */
  title: string;
  /** Session: 2026-27 | Generated on: … */
  line: string;
  logo: { contentType: string; bytes: Buffer } | null;
  sections: Array<{
    code: string;
    /** students whose subjects are not saved yet (not counted) */
    notSet: number;
    rows: Array<{ subject: string; count: number }>;
  }>;
}

const ACCENT = rgb(0.17, 0.2, 0.42);

export async function countsReportPdf(r: CountsReport): Promise<Buffer> {
  const W = 841.89;
  const H = 595.28;
  const M = 36;
  const pdf = await PDFDocument.create();
  pdf.setTitle(r.title);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let logo: PDFImage | null = null;
  if (r.logo && /^image\/(png|jpeg)$/.test(r.logo.contentType)) {
    try {
      logo =
        r.logo.contentType === 'image/png'
          ? await pdf.embedPng(new Uint8Array(r.logo.bytes))
          : await pdf.embedJpg(new Uint8Array(r.logo.bytes));
    } catch {
      logo = null;
    }
  }
  const FS = 9;
  const ROW = 19;
  const cols = [0.08, 0.72, 0.2].map((f) => f * (W - 2 * M));
  let page = pdf.addPage([W, H]);
  let y = 0;
  let pageNo = 0;
  const line = (x1: number, y1: number, x2: number, y2: number, t = 0.7) =>
    page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: t, color: RULE });
  const box = (x: number, top: number, w: number, h: number) => {
    line(x, top, x + w, top);
    line(x, top - h, x + w, top - h);
    line(x, top, x, top - h);
    line(x + w, top, x + w, top - h);
  };
  const footer = () => {
    const s = `${String(pageNo)}`;
    page.drawText(s, {
      x: W - M - regular.widthOfTextAtSize(s, 7),
      y: M / 2,
      size: 7,
      font: regular,
      color: INK,
    });
  };
  const letterhead = () => {
    pageNo += 1;
    const top = H - M;
    const h = 68;
    const logoW = (W - 2 * M) * 0.15;
    box(M, top, W - 2 * M, h);
    line(M + logoW, top, M + logoW, top - h);
    if (logo) {
      // fitted inside its cell, centred
      let lh = h - 14;
      let lw = (logo.width / logo.height) * lh;
      if (lw > logoW - 12) {
        lw = logoW - 12;
        lh = (lw / logo.width) * logo.height;
      }
      page.drawImage(logo, {
        x: M + (logoW - lw) / 2,
        y: top - h + (h - lh) / 2,
        width: lw,
        height: lh,
      });
    }
    const cx = M + logoW + (W - 2 * M - logoW) / 2;
    const centre = (text: string, font: PDFFont, size: number, yy: number) => {
      const s = fit(font, text, size, W - 2 * M - logoW - 20);
      page.drawText(s, {
        x: cx - font.widthOfTextAtSize(s, size) / 2,
        y: yy,
        size,
        font,
        color: INK,
      });
    };
    centre(r.school, bold, 15, top - 22);
    centre(r.title, bold, 10.5, top - 40);
    centre(r.line, regular, 8.5, top - 56);
    y = top - h - 22;
  };
  const tableHead = () => {
    let x = M;
    ['S.No', 'Subject', 'Student Count'].forEach((h, i) => {
      const w = cols[i]!;
      page.drawText(h, {
        x: i === 1 ? x + 5 : x + (w - bold.widthOfTextAtSize(h, FS)) / 2,
        y: y - ROW + 6,
        size: FS,
        font: bold,
        color: INK,
      });
      line(x, y, x, y - ROW);
      x += w;
    });
    line(x, y, x, y - ROW);
    line(M, y, W - M, y);
    line(M, y - ROW, W - M, y - ROW);
    y -= ROW;
  };
  const fresh = () => {
    footer();
    page = pdf.addPage([W, H]);
    letterhead();
  };
  letterhead();
  for (const sec of r.sections) {
    // the heading, and at least two rows with it
    if (y - 28 - 3 * ROW < M) fresh();
    page.drawRectangle({ x: M, y: y - 12, width: 3, height: 13, color: ACCENT });
    const t = `Section: ${sec.code}`;
    page.drawText(t, {
      x: (W - bold.widthOfTextAtSize(t, 10.5)) / 2,
      y: y - 10,
      size: 10.5,
      font: bold,
      color: ACCENT,
    });
    y -= 28;
    if (sec.rows.length) tableHead();
    sec.rows.forEach((row, n) => {
      if (y - ROW < M) {
        fresh();
        tableHead();
      }
      let x = M;
      const cells = [String(n + 1), row.subject, String(row.count)];
      cells.forEach((text, i) => {
        const w = cols[i]!;
        const s = fit(regular, text, FS, w - 10);
        page.drawText(s, {
          x: i === 1 ? x + 5 : x + (w - regular.widthOfTextAtSize(s, FS)) / 2,
          y: y - ROW + 6,
          size: FS,
          font: regular,
          color: INK,
        });
        line(x, y, x, y - ROW);
        x += w;
      });
      line(x, y, x, y - ROW);
      line(M, y - ROW, W - M, y - ROW);
      y -= ROW;
    });
    if (sec.notSet) {
      if (y - ROW < M) fresh();
      page.drawText(
        `Not set yet: ${String(sec.notSet)} student${sec.notSet === 1 ? '' : 's'} (not counted above; their subjects are not saved)`,
        { x: M + 5, y: y - 13, size: 8, font: regular, color: INK },
      );
      y -= ROW;
    }
    if (!sec.rows.length && !sec.notSet) {
      page.drawText('No student in the section.', {
        x: M + 5,
        y: y - 13,
        size: FS,
        font: regular,
        color: INK,
      });
      y -= ROW;
    }
    y -= 14;
  }
  footer();
  return Buffer.from(await pdf.save());
}

export async function countsReportXlsx(r: CountsReport): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Subject mapping report', {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  ws.getColumn(1).width = 10;
  ws.getColumn(2).width = 48;
  ws.getColumn(3).width = 18;
  const thin = { style: 'thin' as const, color: { argb: 'FF333333' } };
  const all = { top: thin, left: thin, bottom: thin, right: thin };
  // the letterhead: the logo in A1:A3, the lines in B:C
  [r.school, r.title, r.line].forEach((text, i) => {
    const row = ws.getRow(i + 1);
    row.getCell(2).value = text;
    ws.mergeCells(i + 1, 2, i + 1, 3);
    row.getCell(2).alignment = { horizontal: 'center', vertical: 'middle' };
    row.getCell(2).font = { bold: i < 2, size: i === 0 ? 15 : i === 1 ? 11 : 9 };
    row.height = i === 0 ? 24 : 18;
  });
  ws.mergeCells(1, 1, 3, 1);
  for (let i = 1; i <= 3; i += 1)
    for (let k = 1; k <= 3; k += 1) ws.getRow(i).getCell(k).border = all;
  if (r.logo && /^image\/(png|jpeg)$/.test(r.logo.contentType)) {
    const id = wb.addImage({
      buffer: r.logo.bytes as unknown as ExcelJS.Buffer,
      extension: r.logo.contentType === 'image/png' ? 'png' : 'jpeg',
    });
    ws.addImage(id, { tl: { col: 0.15, row: 0.15 }, ext: { width: 52, height: 52 } });
  }
  let n = 5;
  for (const sec of r.sections) {
    const h = ws.getRow(n);
    h.getCell(1).value = `Section: ${sec.code}`;
    ws.mergeCells(n, 1, n, 3);
    h.getCell(1).alignment = { horizontal: 'center' };
    h.getCell(1).font = { bold: true, size: 11, color: { argb: 'FF2B3369' } };
    n += 1;
    if (sec.rows.length) {
      const th = ws.getRow(n);
      ['S.No', 'Subject', 'Student Count'].forEach((t, i) => {
        const c = th.getCell(i + 1);
        c.value = t;
        c.font = { bold: true };
        c.border = all;
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDEFF3' } };
        c.alignment = { horizontal: i === 1 ? 'left' : 'center' };
      });
      n += 1;
    }
    sec.rows.forEach((row, i) => {
      const tr = ws.getRow(n);
      [i + 1, row.subject, row.count].forEach((v, k) => {
        const c = tr.getCell(k + 1);
        c.value = v;
        c.border = all;
        c.alignment = { horizontal: k === 1 ? 'left' : 'center' };
      });
      n += 1;
    });
    if (sec.notSet) {
      ws.getRow(n).getCell(1).value =
        `Not set yet: ${String(sec.notSet)} student${sec.notSet === 1 ? '' : 's'} (not counted above; their subjects are not saved)`;
      ws.mergeCells(n, 1, n, 3);
      ws.getRow(n).getCell(1).font = { italic: true, size: 9 };
      n += 1;
    }
    n += 1;
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
