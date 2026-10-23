import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from 'pdf-lib';

/** What the application PDF shows (docs/design/34-recruitment.md, part 7). */
export interface ApplicationPdfInput {
  school: { name: string; address: string | null; contact: string | null };
  logo: { contentType: string; bytes: Buffer } | null;
  photo: { contentType: string; bytes: Buffer } | null;
  number: string;
  received: string;
  post: string;
  postLine: string | null;
  sections: Array<{ title: string; rows: Array<[string, string]> }>;
  lists: Array<{ title: string; columns: string[]; rows: string[][] }>;
  interests: string[];
  documents: Array<[string, string]>;
  declaration: string;
  /** labels for other uses of the same layout (the admission registration form) */
  kicker?: string;
  numberLabel?: string;
  receivedLabel?: string;
}

const A4: [number, number] = [595.28, 841.89];
const M = 40;
const NAVY = rgb(0, 0.149, 0.365);
const CYAN = rgb(0, 0.604, 0.816);
const INK = rgb(0.043, 0.122, 0.227);
const MUTED = rgb(0.357, 0.4, 0.463);
const LINE = rgb(0.851, 0.878, 0.918);
const BAND = rgb(0.933, 0.957, 0.984);

/** The built-in PDF fonts carry Latin letters only: anything else prints as "?" rather than failing. */
const latin = (s: string) =>
  s
    .replace(/₹/g, 'Rs ')
    .replace(/[‐-―]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/•/g, '-')
    .replace(/[^\x20-\x7E\xA0-\xFF\n]/g, '?');

function wrap(font: PDFFont, text: string, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of latin(text).split(/\n+/)) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width) line = next;
      else {
        if (line) out.push(line);
        let w = word;
        while (font.widthOfTextAtSize(w, size) > width && w.length > 1) {
          let cut = w.length - 1;
          while (cut > 1 && font.widthOfTextAtSize(w.slice(0, cut), size) > width) cut -= 1;
          out.push(w.slice(0, cut));
          w = w.slice(cut);
        }
        line = w;
      }
    }
    if (line) out.push(line);
  }
  return out.length ? out : [''];
}

async function image(pdf: PDFDocument, f: { contentType: string; bytes: Buffer } | null) {
  if (!f) return null;
  try {
    if (f.contentType === 'image/png') return await pdf.embedPng(new Uint8Array(f.bytes));
    if (f.contentType === 'image/jpeg') return await pdf.embedJpg(new Uint8Array(f.bytes));
  } catch {
    // a broken image is left out rather than failing the document
  }
  return null;
}

/** An image fitted into a box, kept in proportion. */
function fit(img: PDFImage, w: number, h: number) {
  const s = Math.min(w / img.width, h / img.height);
  return { width: img.width * s, height: img.height * s };
}

/**
 * The application as submitted, on A4: the school's letterhead, the post and the application number,
 * the candidate's photo, every answer section by section, the lists (qualifications, experience,
 * training, children, references) as tables, the interests, the documents given and the declaration;
 * a footer with the number and the page on every page.
 */
export async function applicationPdf(p: ApplicationPdfInput): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(latin(`Application ${p.number} · ${p.post}`));
  pdf.setAuthor(latin(p.school.name));
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await image(pdf, p.logo);
  const photo = await image(pdf, p.photo);
  const W = A4[0] - 2 * M;
  let page: PDFPage = pdf.addPage(A4);
  let y = A4[1] - M;
  const newPage = () => {
    page = pdf.addPage(A4);
    y = A4[1] - M;
  };
  const ensure = (h: number) => {
    if (y - h < M + 24) newPage();
  };
  const text = (
    s: string,
    o: { x: number; size: number; font?: PDFFont; color?: ReturnType<typeof rgb>; width: number },
  ) => {
    const lines = wrap(o.font ?? regular, s, o.size, o.width);
    for (const l of lines) {
      page.drawText(l, { x: o.x, y, size: o.size, font: o.font ?? regular, color: o.color ?? INK });
      y -= o.size * 1.3;
    }
  };

  // the letterhead
  let tx = M;
  if (logo) {
    const d = fit(logo, 130, 52);
    page.drawImage(logo, { x: M, y: y - d.height + 6, ...d });
    tx = M + d.width + 14;
  }
  const top = y;
  text(p.school.name, { x: tx, size: 16, font: bold, color: NAVY, width: A4[0] - M - tx });
  if (p.school.address)
    text(p.school.address, { x: tx, size: 9, color: MUTED, width: A4[0] - M - tx });
  if (p.school.contact)
    text(p.school.contact, { x: tx, size: 9, color: MUTED, width: A4[0] - M - tx });
  y = Math.min(y, top - 52) - 8;
  page.drawRectangle({ x: M, y, width: W, height: 2, color: CYAN });
  y -= 26;

  // the post, the number, the photo
  const photoW = 86;
  const photoH = 106;
  const headTop = y + 12;
  const textW = W - photoW - 16;
  page.drawText(latin(p.kicker ?? 'APPLICATION FOR'), {
    x: M,
    y,
    size: 9,
    font: bold,
    color: CYAN,
  });
  y -= 20;
  text(p.post, { x: M, size: 17, font: bold, color: NAVY, width: textW });
  if (p.postLine) text(p.postLine, { x: M, size: 10, color: MUTED, width: textW });
  y -= 4;
  text(`${p.numberLabel ?? 'Application no.'} ${p.number}`, {
    x: M,
    size: 11,
    font: bold,
    width: textW,
  });
  text(`${p.receivedLabel ?? 'Received'} ${p.received}`, {
    x: M,
    size: 10,
    color: MUTED,
    width: textW,
  });
  const px = A4[0] - M - photoW;
  page.drawRectangle({
    x: px,
    y: headTop - photoH,
    width: photoW,
    height: photoH,
    borderColor: LINE,
    borderWidth: 1,
    color: BAND,
  });
  if (photo) {
    const d = fit(photo, photoW - 6, photoH - 6);
    page.drawImage(photo, {
      x: px + (photoW - d.width) / 2,
      y: headTop - photoH + (photoH - d.height) / 2,
      ...d,
    });
  } else
    page.drawText('Photo', {
      x: px + 28,
      y: headTop - photoH / 2,
      size: 9,
      font: regular,
      color: MUTED,
    });
  y = Math.min(y, headTop - photoH) - 18;

  /** A section's heading, kept on the page with what follows it (`keep`: the room that needs). */
  const heading = (title: string, keep = 40) => {
    ensure(24 + keep);
    page.drawRectangle({ x: M, y: y - 6, width: W, height: 20, color: BAND });
    page.drawText(latin(title), { x: M + 8, y, size: 10.5, font: bold, color: NAVY });
    y -= 24;
  };

  // the answers: two to a line, the label over the value
  const colW = (W - 16) / 2;
  for (const s of p.sections) {
    if (!s.rows.length) continue;
    heading(s.title);
    for (let i = 0; i < s.rows.length; i += 2) {
      const cells = s.rows.slice(i, i + 2).map(([label, value]) => ({
        label: wrap(regular, label, 8, colW),
        value: wrap(bold, value, 10, colW),
      }));
      const h = Math.max(...cells.map((c) => c.label.length * 10.4 + c.value.length * 13)) + 6;
      ensure(h);
      cells.forEach((c, j) => {
        const x = M + j * (colW + 16);
        let cy = y;
        for (const l of c.label) {
          page.drawText(l, { x, y: cy, size: 8, font: regular, color: MUTED });
          cy -= 10.4;
        }
        for (const l of c.value) {
          page.drawText(l, { x, y: cy, size: 10, font: bold, color: INK });
          cy -= 13;
        }
      });
      y -= h;
    }
    y -= 4;
  }

  // the lists as tables (the header again on a new page)
  for (const l of p.lists) {
    if (!l.rows.length) continue;
    heading(l.title, 60);
    const cw = W / l.columns.length;
    const drawHead = () => {
      const hl = l.columns.map((c) => wrap(bold, c, 8, cw - 8));
      const h = Math.max(...hl.map((x) => x.length)) * 10 + 6;
      hl.forEach((lines, j) =>
        lines.forEach((t, k) =>
          page.drawText(t, { x: M + j * cw + 4, y: y - k * 10, size: 8, font: bold, color: MUTED }),
        ),
      );
      y -= h;
      page.drawLine({
        start: { x: M, y: y + 4 },
        end: { x: M + W, y: y + 4 },
        thickness: 0.6,
        color: LINE,
      });
      y -= 6;
    };
    ensure(40);
    drawHead();
    for (const r of l.rows) {
      const cl = r.map((c) => wrap(regular, c || '-', 9, cw - 8));
      const h = Math.max(...cl.map((x) => x.length)) * 11.5 + 6;
      if (y - h < M + 24) {
        newPage();
        drawHead();
      }
      cl.forEach((lines, j) =>
        lines.forEach((t, k) =>
          page.drawText(t, {
            x: M + j * cw + 4,
            y: y - k * 11.5,
            size: 9,
            font: regular,
            color: INK,
          }),
        ),
      );
      y -= h;
      page.drawLine({
        start: { x: M, y: y + 4 },
        end: { x: M + W, y: y + 4 },
        thickness: 0.4,
        color: LINE,
      });
      y -= 4;
    }
    y -= 6;
  }

  if (p.interests.length) {
    heading('Interests');
    ensure(20);
    text(p.interests.join(', '), { x: M, size: 10, width: W });
    y -= 6;
  }
  if (p.documents.length) {
    heading('Documents given');
    for (const [label, state] of p.documents) {
      ensure(16);
      page.drawText(latin(label), { x: M + 4, y, size: 9.5, font: regular, color: INK });
      page.drawText(latin(state), { x: M + W / 2, y, size: 9.5, font: bold, color: INK });
      y -= 14;
    }
    y -= 6;
  }
  heading('Declaration');
  ensure(30);
  text(p.declaration, { x: M, size: 10, width: W });

  // the footer of every page
  const pages = pdf.getPages();
  pages.forEach((pg, i) => {
    pg.drawLine({
      start: { x: M, y: M },
      end: { x: A4[0] - M, y: M },
      thickness: 0.5,
      color: LINE,
    });
    const left = latin(
      `${(p.numberLabel ?? 'Application').replace(/ no\.$/, '')} ${p.number} · ${p.post}`,
    ).slice(0, 90);
    pg.drawText(left, { x: M, y: M - 14, size: 8, font: regular, color: MUTED });
    const right = `Page ${String(i + 1)} of ${String(pages.length)}`;
    pg.drawText(right, {
      x: A4[0] - M - regular.widthOfTextAtSize(right, 8),
      y: M - 14,
      size: 8,
      font: regular,
      color: MUTED,
    });
  });
  return Buffer.from(await pdf.save());
}
