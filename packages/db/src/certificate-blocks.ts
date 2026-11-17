/**
 * The blocks a certificate template places with {{{blocks.name}}} (docs/design/87, phase B): the letterhead (the logo
 * left; the school's name, address, contacts, affiliation centred), the signature boxes (each with the signature image
 * from the employee record when it prints, the name, "Emp. ID · designation" and, for whoever issued it, the date and
 * time), the DUPLICATE mark of a copy, the QR that checks it (phase D) and the foot line. Made by EduPro from the
 * certificate's frozen data, so every value in them is escaped here.
 */

export interface CertificateSign {
  /** the box's caption: Prepared by, Checked by, Principal … */
  title: string;
  name?: string | null;
  empId?: string | null;
  designation?: string | null;
  /** "Issued on 14-11-2026 09:40 AM" for whoever acted */
  at?: string | null;
  /** the signature image (a stored file; the renderer loads it) */
  fileId?: string | null;
}

export interface CertificateBlockAssets {
  /** the school's logo as a data URI */
  logo?: string | null;
  /** stored file id → data URI (the signature images) */
  images?: Record<string, string>;
  /** the QR of the public check (phase D): an SVG or a data URI, and the address it opens */
  qr?: { image: string; url: string } | null;
}

const esc = (v: unknown): string =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/**
 * The word across a paper that is not a valid issued certificate (17 Nov 2026), on screen and on paper: CANCELLED (a
 * cancelled certificate, with the day), PENDING (a request still with its approvers, its fee or the office), REJECTED
 * (a request rejected or withdrawn), NOT ISSUED (any other paper before issue: the Issue page's preview, a layout's).
 */
export type CertificateMark = 'CANCELLED' | 'PENDING' | 'REJECTED' | 'NOT ISSUED';

/**
 * The mark's CSS, kept apart so a paper that does not carry the blocks (a certificate from the achievement module, an
 * old TC printed from its template) carries it too. Fixed, so a paper of two pages has it on each; inside a host (one
 * page of a batch PDF) it stays on that page. The template's own CSS cannot hide it: it comes last.
 */
export const CERTIFICATE_MARK_CSS = `
.eb-mark { position: fixed; top: 0; left: 0; right: 0; bottom: 0; display: flex !important; flex-direction: column; align-items: center; justify-content: center; pointer-events: none; z-index: 2147483000 !important; transform: rotate(-30deg); visibility: visible !important; opacity: 1 !important; }
.eb-mark__word { font-family: Arial, sans-serif; font-size: 70pt; font-weight: 800; letter-spacing: 0.06em; white-space: nowrap; color: rgba(180, 35, 24, 0.2); border: 5pt solid rgba(180, 35, 24, 0.2); border-radius: 4mm; padding: 1mm 7mm; line-height: 1.1; }
.eb-mark__note { font-family: Arial, sans-serif; font-size: 15pt; font-weight: 700; color: rgba(180, 35, 24, 0.35); margin-top: 3mm; white-space: nowrap; }
.eb-mark-host { position: relative; }
.eb-mark-host > .eb-mark { position: absolute; }
`;

/** The mark's HTML ('' for a valid issued certificate); `note` is a short line under the word ("Cancelled on …"). */
export function certificateMarkHtml(
  mark: CertificateMark | null | undefined,
  note?: string | null,
): string {
  if (!mark) return '';
  return `<div class="eb-mark" aria-hidden="true" data-mark="${esc(mark)}"><div class="eb-mark__word">${esc(mark)}</div>${
    note ? `<div class="eb-mark__note">${esc(note)}</div>` : ''
  }</div>`;
}

/** "2026-11-17" → "17-11-2026" (the note under CANCELLED). */
export function markDate(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}

/** The CSS every certificate carries for its blocks (the template's own CSS comes after and may change it). */
export const CERTIFICATE_BLOCK_CSS = `
.eb-head { display: flex; align-items: center; gap: 6mm; border-bottom: 2px solid #0b1f3a; padding-bottom: 4mm; }
.eb-head__logo { width: 24mm; flex: none; }
.eb-head__logo img { max-width: 24mm; max-height: 24mm; }
.eb-head__t { flex: 1; text-align: center; }
.eb-head__name { font-family: Poppins, Arial, sans-serif; font-size: 18pt; font-weight: 700; color: #0b1f3a; }
.eb-head__sub { font-size: 9pt; color: #4b5563; margin-top: 1mm; }
.eb-head__pad { width: 24mm; flex: none; }
.eb-signs { display: flex; justify-content: space-between; gap: 6mm; margin-top: 14mm; font-size: 9pt; page-break-inside: avoid; }
.eb-sign { flex: 1; text-align: center; }
.eb-sign__img { height: 16mm; display: flex; align-items: flex-end; justify-content: center; }
.eb-sign__img img { max-height: 15mm; max-width: 45mm; }
.eb-sign__line { border-top: 1px solid #0b1f3a; padding-top: 1.5mm; font-weight: 700; }
.eb-sign__who { color: #374151; margin-top: 0.5mm; }
.eb-dup { position: absolute; top: 40%; left: 0; right: 0; text-align: center; font-size: 60pt; color: rgba(180, 35, 24, 0.08); transform: rotate(-24deg); font-weight: 700; pointer-events: none; }
.eb-dup__line { text-align: center; font-weight: 700; color: #b42318; letter-spacing: 0.2em; margin: 2mm 0; }
.eb-qr { display: flex; align-items: center; gap: 3mm; font-size: 8pt; color: #4b5563; }
.eb-qr__img { width: 22mm; height: 22mm; }
.eb-qr__img svg, .eb-qr__img img { width: 22mm; height: 22mm; }
.eb-foot { margin-top: 5mm; font-size: 8pt; color: #4b5563; display: flex; justify-content: space-between; gap: 4mm; align-items: flex-end; }
`;

/** The signature images a certificate needs (to load before rendering). */
export function certificateImageIds(data: Record<string, unknown>): string[] {
  const signs = Array.isArray(data.signs) ? (data.signs as CertificateSign[]) : [];
  return signs
    .map((s) => s.fileId)
    .filter((x): x is string => typeof x === 'string' && /^\d{1,18}$/.test(x));
}

/** The blocks of one certificate from its data. */
export function certificateBlocks(
  data: Record<string, unknown>,
  assets: CertificateBlockAssets = {},
): Record<string, string> {
  const school = obj(data.school);
  const cert = obj(data.cert);
  const contacts = [school.addressLine, school.phone, school.email]
    .filter(Boolean)
    .map(esc)
    .join(' · ');
  const affiliation = school.affiliationNo
    ? `Affiliation no. ${esc(school.affiliationNo)}${school.board ? ` (${esc(school.board)})` : ''}${
        school.schoolNo ? ` · School no. ${esc(school.schoolNo)}` : ''
      }`
    : school.schoolNo
      ? `School no. ${esc(school.schoolNo)}`
      : '';
  const letterhead = `<div class="eb-head"><div class="eb-head__logo">${
    assets.logo ? `<img src="${esc(assets.logo)}" alt="">` : ''
  }</div><div class="eb-head__t"><div class="eb-head__name">${esc(school.name)}</div>${
    contacts ? `<div class="eb-head__sub">${contacts}</div>` : ''
  }${affiliation ? `<div class="eb-head__sub">${affiliation}</div>` : ''}</div><div class="eb-head__pad"></div></div>`;

  const signs = Array.isArray(data.signs) ? (data.signs as CertificateSign[]) : [];
  const signatures = signs.length
    ? `<div class="eb-signs">${signs
        .map((s) => {
          const img = s.fileId ? assets.images?.[s.fileId] : undefined;
          const who = [
            s.name,
            [s.empId ? `Emp. ID ${s.empId}` : '', s.designation].filter(Boolean).join(' · '),
          ]
            .filter(Boolean)
            .map((x) => `<div class="eb-sign__who">${esc(x)}</div>`)
            .join('');
          return `<div class="eb-sign"><div class="eb-sign__img">${
            img ? `<img src="${esc(img)}" alt="">` : ''
          }</div><div class="eb-sign__line">${esc(s.title)}</div>${who}${
            s.at ? `<div class="eb-sign__who">${esc(s.at)}</div>` : ''
          }</div>`;
        })
        .join('')}</div>`
    : '';

  const duplicate = cert.duplicate
    ? `<div class="eb-dup">DUPLICATE</div><div class="eb-dup__line">DUPLICATE (copy ${esc(cert.copyNo)})</div>`
    : '';

  const qr = assets.qr
    ? `<div class="eb-qr"><div class="eb-qr__img">${
        assets.qr.image.startsWith('<svg')
          ? assets.qr.image
          : `<img src="${esc(assets.qr.image)}" alt="">`
      }</div><div>Scan to check this certificate<br>${esc(assets.qr.url)}</div></div>`
    : '';

  const note = typeof data.footerNote === 'string' && data.footerNote ? esc(data.footerNote) : '';
  // a correction that kept the number (16 Nov 2026): "Revision 2 · corrected on 16-11-2026"
  const rev = Number((cert as { revision?: unknown }).revision ?? 1);
  const revisedOn = (cert as { revisedOn?: unknown }).revisedOn;
  const revised =
    rev > 1
      ? `<br>Revision ${String(rev)}${typeof revisedOn === 'string' && revisedOn ? ` · corrected on ${esc(revisedOn)}` : ''}`
      : '';
  const footer = `<div class="eb-foot"><div>${esc(cert.number)} · issued on ${esc(cert.issuedOn)}${revised}${
    note ? `<br>${note}` : ''
  }</div>${qr}</div>`;

  return { letterhead, signatures, duplicate, qr, footer };
}
