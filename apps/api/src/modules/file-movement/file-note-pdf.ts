import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

export interface NoteSheet {
  school: string;
  address: string;
  number: string;
  subject: string;
  status: string;
  createdBy: string;
  designation: string | null;
  createdAt: string;
  closedAt: string | null;
  /** The note as plain lines (see htmlToLines). */
  lines: NoteLine[];
  attachments: string[];
  trail: Array<{ level: string; who: string; decision: string; when: string; remark: string }>;
  generated: string;
}
export interface NoteLine {
  text: string;
  kind: 'p' | 'h' | 'li' | 'quote' | 'row' | 'gap';
}

const W = 595.28; // A4 portrait
const H = 841.89;
const M = 44;
const NAVY = rgb(0, 0.149, 0.365);
const INK = rgb(0.043, 0.122, 0.227);
const MUTED = rgb(0.357, 0.4, 0.463);
const LINE = rgb(0.86, 0.88, 0.92);
const latin = (s: string) => s.replace(/[‐-―]/g, '-').replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');

/** The note's HTML (already sanitised) as the lines of a printed sheet. */
export function htmlToLines(html: string): NoteLine[] {
  const out: NoteLine[] = [];
  const text = (s: string) =>
    s
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();
  const block = /<(h[1-6]|p|li|blockquote|tr|div)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  let any = false;
  let n = 0;
  let ordered = false;
  const lists = [...html.matchAll(/<(ol|ul)\b/gi)].map((x) => ({
    at: x.index ?? 0,
    ol: x[1]!.toLowerCase() === 'ol',
  }));
  while ((m = block.exec(html))) {
    any = true;
    const tag = m[1]!.toLowerCase();
    if (tag === 'tr') {
      const cells = [...m[2]!.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) =>
        text(c[1]!),
      );
      if (cells.some(Boolean)) out.push({ text: cells.join('   |   '), kind: 'row' });
      continue;
    }
    // a paragraph that only wraps other blocks is read through its children
    if (
      (tag === 'div' || tag === 'blockquote' || tag === 'li') &&
      /<(p|ul|ol|table|div)\b/i.test(m[2]!)
    ) {
      block.lastIndex = m.index + m[0].indexOf('>') + 1;
      continue;
    }
    const t = text(m[2]!);
    if (!t) continue;
    if (tag === 'li') {
      const list = [...lists].reverse().find((l) => l.at < m!.index);
      if (list?.ol !== ordered || !list) n = 0;
      ordered = list?.ol ?? false;
      n += 1;
      for (const [i, part] of t.split('\n').entries())
        out.push({ text: `${i ? '   ' : ordered ? `${String(n)}. ` : '-  '}${part}`, kind: 'li' });
    } else {
      for (const part of t.split('\n'))
        out.push({
          text: part,
          kind: tag.startsWith('h') ? 'h' : tag === 'blockquote' ? 'quote' : 'p',
        });
      out.push({ text: '', kind: 'gap' });
    }
  }
  if (!any) for (const part of text(html).split('\n')) out.push({ text: part, kind: 'p' });
  return out;
}

function wrap(font: PDFFont, s: string, size: number, width: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of latin(s).split(/\s+/).filter(Boolean)) {
    let w = word;
    while (font.widthOfTextAtSize(w, size) > width && w.length > 1) {
      let cut = w.length - 1;
      while (cut > 1 && font.widthOfTextAtSize(w.slice(0, cut), size) > width) cut -= 1;
      if (line) out.push(line);
      out.push(w.slice(0, cut));
      line = '';
      w = w.slice(cut);
    }
    const next = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) <= width) line = next;
    else {
      out.push(line);
      line = w;
    }
  }
  if (line) out.push(line);
  return out.length ? out : [''];
}

/**
 * The note sheet of a file: the school's head, the file number and subject, who raised it, the note, the
 * list of attachments and the approval trail (level, approver, decision, date and time, remark).
 */
export async function fileNotePdf(n: NoteSheet): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${n.number} · ${n.subject}`);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const italic = await pdf.embedFont(StandardFonts.HelveticaOblique);
  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0;
  const add = () => {
    page = pdf.addPage([W, H]);
    pages.push(page);
    page.drawRectangle({ x: 0, y: H - 64, width: W, height: 64, color: NAVY });
    page.drawText(latin(n.school).slice(0, 70), {
      x: M,
      y: H - 30,
      size: 15,
      font: bold,
      color: rgb(1, 1, 1),
    });
    if (n.address)
      page.drawText(latin(n.address).slice(0, 110), {
        x: M,
        y: H - 48,
        size: 8.5,
        font: regular,
        color: rgb(1, 1, 1),
      });
    y = H - 88;
  };
  const need = (h: number) => {
    if (y - h < M + 24) add();
  };
  const para = (
    s: string,
    font: PDFFont,
    size: number,
    color = INK,
    indent = 0,
    lead = size + 4,
  ) => {
    for (const l of wrap(font, s, size, W - 2 * M - indent)) {
      need(lead);
      page.drawText(l, { x: M + indent, y, size, font, color });
      y -= lead;
    }
  };
  add();
  page.drawText('FILE NOTE FOR APPROVAL', { x: M, y, size: 9, font: bold, color: MUTED });
  const right = `${n.number} · ${n.status}`;
  page.drawText(latin(right), {
    x: W - M - bold.widthOfTextAtSize(latin(right), 10),
    y,
    size: 10,
    font: bold,
    color: NAVY,
  });
  y -= 20;
  para(n.subject, bold, 14, INK, 0, 18);
  y -= 2;
  para(
    `Raised by ${n.createdBy}${n.designation ? ` (${n.designation})` : ''} on ${n.createdAt}${n.closedAt ? ` · closed on ${n.closedAt}` : ''}`,
    regular,
    9.5,
    MUTED,
  );
  y -= 4;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1, color: LINE });
  y -= 18;
  for (const l of n.lines) {
    if (l.kind === 'gap') {
      y -= 5;
      continue;
    }
    if (l.kind === 'h') para(l.text, bold, 12, INK, 0, 17);
    else if (l.kind === 'li') para(l.text, regular, 10.5, INK, 12);
    else if (l.kind === 'quote') para(l.text, italic, 10.5, MUTED, 14);
    else if (l.kind === 'row') para(l.text, regular, 10, INK, 4);
    else para(l.text, regular, 10.5);
  }
  y -= 8;
  if (n.attachments.length) {
    need(40);
    page.drawText('Attachments', { x: M, y, size: 10.5, font: bold, color: INK });
    y -= 16;
    n.attachments.forEach((a, i) => para(`${String(i + 1)}. ${a}`, regular, 10, INK, 8));
    y -= 8;
  }
  need(70);
  page.drawText('Approval trail', { x: M, y, size: 10.5, font: bold, color: INK });
  y -= 16;
  const cols = [
    { label: 'Level', w: 46 },
    { label: 'Approver', w: 140 },
    { label: 'Decision', w: 70 },
    { label: 'Date and time', w: 92 },
    { label: 'Remark', w: W - 2 * M - 348 },
  ];
  const head = () => {
    page.drawRectangle({ x: M, y: y - 5, width: W - 2 * M, height: 17, color: LINE });
    let x = M + 4;
    for (const c of cols) {
      page.drawText(c.label, { x, y, size: 8.5, font: bold, color: INK });
      x += c.w;
    }
    y -= 18;
  };
  head();
  for (const t of n.trail) {
    const cells = [t.level, t.who, t.decision, t.when, t.remark].map((v, i) =>
      wrap(regular, v || '-', 8.5, cols[i]!.w - 8),
    );
    const rows = Math.max(...cells.map((c) => c.length));
    if (y - rows * 11 < M + 24) {
      add();
      head();
    }
    let x = M + 4;
    cells.forEach((c, i) => {
      c.forEach((l, k) =>
        page.drawText(l, { x, y: y - k * 11, size: 8.5, font: regular, color: INK }),
      );
      x += cols[i]!.w;
    });
    y -= rows * 11 + 5;
    page.drawLine({
      start: { x: M, y: y + 6 },
      end: { x: W - M, y: y + 6 },
      thickness: 0.5,
      color: LINE,
    });
  }
  pages.forEach((p, i) =>
    p.drawText(
      latin(
        `${n.number} · ${n.generated} · Page ${String(i + 1)} of ${String(pages.length)} · A computer-generated record of approvals made in EduPro`,
      ),
      { x: M, y: 22, size: 7.5, font: regular, color: MUTED },
    ),
  );
  return Buffer.from(await pdf.save());
}
