import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from 'pdf-lib';
import { drawLetterhead, embedLogo, type LetterheadLogo } from '../../common/pdf/letterhead';

/**
 * The student profile as a PDF made at once by the API (the parent and student portals and the phone app; it
 * used to wait for the background workers): the school's letterhead, the student's, father's and mother's photos
 * with the key facts, every section of the profile with the fields the portal shows, the documents on file, a
 * declaration and signature lines, and "Page x of y" at the foot. The content is the workers' printout's
 * (apps/workers/src/renderers/student-profile.ts).
 */
export interface ProfilePaper {
  school: { name: string; address: string | null };
  /** the affiliation and the contact line under the address */
  extra: string | null;
  logo: LetterheadLogo | null;
  /** Student Profile · Parent copy */
  title: string;
  /** Downloaded from the portal 19-11-2026 06:15 PM · Profile 80% complete */
  details: string;
  name: string;
  facts: Array<[string, string]>;
  photos: {
    student: LetterheadLogo | null;
    father: LetterheadLogo | null;
    mother: LetterheadLogo | null;
  };
  father: { name: string; mobile: string };
  mother: { name: string; mobile: string };
  sections: Array<{ title: string; rows: Array<[string, string]> }>;
  documents: Array<{ label: string; status: string; verified: boolean }>;
  remarks: string;
  /** the foot's left line: school · Student profile A1234 */
  foot: string;
}

const A4: [number, number] = [595.28, 841.89];
const M = 30;
const W = A4[0] - 2 * M;
const NAVY = rgb(0, 0.149, 0.365);
const CYAN = rgb(0, 0.627, 0.776);
const INK = rgb(0.122, 0.161, 0.2);
const MUTED = rgb(0.322, 0.376, 0.427);
const BORDER = rgb(0.851, 0.886, 0.925);
const RULE = rgb(0.933, 0.949, 0.965);
const PANEL = rgb(0.961, 0.969, 0.98);

const latin = (s: string) =>
  s
    .replace(/₹/g, 'Rs ')
    .replace(/[‐-―]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, '...')
    .replace(/[^\x20-\x7E\xA0-\xFF\n]/g, '?');

/** The text broken into lines that fit [width]; a word longer than the line is cut. */
function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of latin(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width) {
        line = next;
        continue;
      }
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
    out.push(line);
  }
  return out.length ? out : [''];
}

export async function studentProfilePdf(d: ProfilePaper): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(latin(`Student profile ${d.name}`));
  pdf.setAuthor(latin(d.school.name));
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await embedLogo(pdf, d.logo);
  const [studentPhoto, fatherPhoto, motherPhoto] = await Promise.all([
    embedLogo(pdf, d.photos.student),
    embedLogo(pdf, d.photos.father),
    embedLogo(pdf, d.photos.mother),
  ]);
  let page: PDFPage = pdf.addPage(A4);
  let y = 0;
  const text = (
    s: string,
    x: number,
    yy: number,
    o: { size?: number; f?: PDFFont; color?: ReturnType<typeof rgb>; right?: number } = {},
  ) => {
    const size = o.size ?? 8.5;
    const f = o.f ?? font;
    const t = latin(s);
    const xx = o.right !== undefined ? o.right - f.widthOfTextAtSize(t, size) : x;
    page.drawText(t, { x: xx, y: yy, size, font: f, color: o.color ?? INK });
  };
  const room = (need: number) => {
    if (y - need >= M + 24) return;
    page = pdf.addPage(A4);
    y = A4[1] - M;
  };

  // ---- the letterhead
  y = drawLetterhead(page, { regular: font, bold }, logo, {
    school: d.school.name,
    address: d.school.address,
    extra: d.extra,
    title: d.title,
    details: d.details,
    margin: M,
  });
  page.drawLine({
    start: { x: M, y: y + 4 },
    end: { x: M + W, y: y + 4 },
    thickness: 1.5,
    color: NAVY,
  });
  y -= 8;

  // ---- the photos and the key facts
  const photoBox = (
    img: PDFImage | null,
    x: number,
    top: number,
    w: number,
    h: number,
    caption: string[],
  ) => {
    page.drawRectangle({
      x,
      y: top - h,
      width: w,
      height: h,
      color: PANEL,
      borderColor: CYAN,
      borderWidth: 0.8,
    });
    if (img) {
      const s = Math.min(w / img.width, h / img.height);
      const iw = img.width * s;
      const ih = img.height * s;
      page.drawImage(img, {
        x: x + (w - iw) / 2,
        y: top - h + (h - ih) / 2,
        width: iw,
        height: ih,
      });
    } else {
      text('Photo', x + w / 2 - font.widthOfTextAtSize('Photo', 8) / 2, top - h / 2 - 3, {
        size: 8,
        color: MUTED,
      });
    }
    let cy = top - h - 10;
    caption.forEach((c, i) => {
      if (!c) return;
      const f = i === 0 ? bold : font;
      for (const line of wrap(c, f, 8, w + 10).slice(0, 2)) {
        text(line, x + w / 2 - f.widthOfTextAtSize(line, 8) / 2, cy, { size: 8, f });
        cy -= 9.5;
      }
    });
    return top - cy;
  };
  const top = y;
  const sw = 78;
  const pw = 64;
  const factsX = M + 8 + sw + 12;
  const factsW = W - 16 - sw - 12 - 2 * (pw + 14);
  const used = [
    photoBox(studentPhoto, M + 8, top - 8, sw, sw * 1.25, ['Student']),
    photoBox(fatherPhoto, M + W - 8 - 2 * pw - 14, top - 8, pw, pw * 1.25, [
      'Father',
      d.father.name,
      d.father.mobile,
    ]),
    photoBox(motherPhoto, M + W - 8 - pw, top - 8, pw, pw * 1.25, [
      'Mother',
      d.mother.name,
      d.mother.mobile,
    ]),
  ];
  let fy = top - 8 - 12;
  for (const line of wrap(d.name, bold, 13, factsW).slice(0, 2)) {
    text(line, factsX, fy, { size: 13, f: bold, color: NAVY });
    fy -= 15;
  }
  fy -= 2;
  const colW = (factsW - 10) / 2;
  d.facts.forEach(([k, v], i) => {
    const cx = factsX + (i % 2) * (colW + 10);
    const cy = fy - Math.floor(i / 2) * 13;
    text(k, cx, cy, { size: 7.5, color: MUTED });
    // a long value (an admission number, a date with the age) gets a smaller size before it is cut
    const fit = colW - font.widthOfTextAtSize(latin(k), 7.5) - 6;
    const size = [8, 7.5, 7, 6.5].find((z) => bold.widthOfTextAtSize(latin(v), z) <= fit) ?? 6.5;
    text(wrap(v, bold, size, fit)[0] ?? '', cx, cy, { size, f: bold, right: cx + colW });
    page.drawLine({
      start: { x: cx, y: cy - 3 },
      end: { x: cx + colW, y: cy - 3 },
      thickness: 0.4,
      color: BORDER,
    });
  });
  const factsH = top - (fy - Math.ceil(d.facts.length / 2) * 13) + 4;
  const blockH = Math.max(factsH, ...used.map((u) => u + 8)) + 6;
  page.drawRectangle({
    x: M,
    y: top - blockH,
    width: W,
    height: blockH,
    borderColor: BORDER,
    borderWidth: 0.8,
  });
  y = top - blockH - 12;

  // ---- every section: a heading bar, then label and value two to a row
  const heading = (title: string) => {
    room(34);
    page.drawRectangle({ x: M, y: y - 14, width: W, height: 15, color: NAVY });
    text(title, M + 6, y - 10, { size: 9, f: bold, color: rgb(1, 1, 1) });
    y -= 20;
  };
  const half = (W - 12) / 2;
  for (const s of d.sections) {
    heading(s.title);
    for (let i = 0; i < s.rows.length; i += 2) {
      const pair = s.rows.slice(i, i + 2);
      const cells = pair.map(([k, v]) => {
        const lw = Math.min(font.widthOfTextAtSize(latin(k), 7.5) + 8, half * 0.5);
        return {
          k: wrap(k, font, 7.5, lw - 6),
          v: wrap(v || ' ', bold, 8, half - lw - 2),
          lw,
        };
      });
      const lines = Math.max(...cells.map((c) => Math.max(c.k.length, c.v.length)));
      const h = lines * 10 + 4;
      room(h + 4);
      cells.forEach((c, j) => {
        const cx = M + j * (half + 12);
        c.k.forEach((t, n) => text(t, cx + 2, y - 8 - n * 10, { size: 7.5, color: MUTED }));
        c.v.forEach((t, n) =>
          text(t, cx, y - 8 - n * 10, { size: 8, f: bold, right: cx + half - 2 }),
        );
        page.drawLine({
          start: { x: cx, y: y - h },
          end: { x: cx + half, y: y - h },
          thickness: 0.5,
          color: RULE,
        });
      });
      y -= h + 2;
    }
    y -= 6;
  }

  // ---- the documents on file
  heading('Documents');
  const cols = [M + 4, M + W * 0.55, M + W * 0.8];
  ['Document', 'Status', 'Verified'].forEach((h, i) =>
    text(h, cols[i]!, y - 8, { size: 8, f: bold, color: MUTED }),
  );
  y -= 13;
  for (const doc of d.documents) {
    room(14);
    text(doc.label, cols[0]!, y - 8);
    text(doc.status, cols[1]!, y - 8);
    text(doc.verified ? 'Checked' : '', cols[2]!, y - 8);
    page.drawLine({
      start: { x: M, y: y - 12 },
      end: { x: M + W, y: y - 12 },
      thickness: 0.5,
      color: RULE,
    });
    y -= 14;
  }
  if (d.remarks) {
    y -= 4;
    for (const line of wrap(`Remarks: ${d.remarks}`, font, 8.5, W)) {
      room(12);
      text(line, M, y - 8);
      y -= 11;
    }
  }

  // ---- the declaration and the signatures
  room(80);
  y -= 10;
  for (const line of wrap(
    'I confirm that the details above are correct. I will inform the school of any change.',
    font,
    9,
    W,
  )) {
    text(line, M, y - 8, { size: 9 });
    y -= 12;
  }
  y -= 34;
  const sigW = (W - 2 * 24) / 3;
  ['Signature of parent / guardian', 'Class teacher', 'Principal'].forEach((label, i) => {
    const x = M + i * (sigW + 24);
    page.drawLine({ start: { x, y }, end: { x: x + sigW, y }, thickness: 0.7, color: MUTED });
    text(label, x + sigW / 2 - font.widthOfTextAtSize(label, 8) / 2, y - 11, {
      size: 8,
      color: MUTED,
    });
  });

  // ---- the foot of every page
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    const foot = latin(d.foot);
    p.drawText(foot, { x: M, y: 16, size: 7.5, font, color: MUTED });
    const n = `Page ${String(i + 1)} of ${String(pages.length)}`;
    p.drawText(n, {
      x: M + W - font.widthOfTextAtSize(n, 7.5),
      y: 16,
      size: 7.5,
      font,
      color: MUTED,
    });
  });
  return Buffer.from(await pdf.save());
}
