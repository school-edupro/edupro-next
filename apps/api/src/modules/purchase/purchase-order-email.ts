import { emailLayout } from '../comms/email-html';
import type { OrderPdfData } from './purchase-order-pdf';

/**
 * The e-mail that takes a Purchase Order to the vendor (docs/design/83, "As built — the PO e-mail"):
 * the school's logo and name on top; the wording the school edits on Communication → Templates, its
 * {{variables}} filled in; {{order_summary}} becomes a box of the order (number, date, delivery, ship
 * to, bill to, quotation, payment, the total) and {{items}} a table of the lines (the first 25, then
 * "more in the attached PO") with the totals; a footer naming where to write. A template without the
 * two boxes (edited before they existed) gets them after its first paragraph.
 */

const MAX_LINES = 25;
const esc = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
const money = (n: number) =>
  `&#8377;${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const qty = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 3 });

const CELL = 'padding:7px 10px;border-bottom:1px solid #e4e7eb;vertical-align:top';
const HEAD = 'padding:7px 10px;background:#eef2f8;color:#00265d;font-weight:bold;text-align:left';

function summaryBox(d: OrderPdfData): string {
  const rows: Array<[string, string]> = [
    ['PO number', esc(d.number)],
    ['PO date', esc(d.date)],
    ['Deliver by', esc(d.deliveryDate ?? 'As agreed')],
    [
      'Deliver to',
      `${esc(d.shipTo.name)}${d.shipTo.address ? `<br>${esc(d.shipTo.address)}` : ''}${
        d.shipTo.contactName || d.shipTo.contactPhone
          ? `<br>${esc([d.shipTo.contactName, d.shipTo.contactPhone].filter(Boolean).join(', '))}`
          : ''
      }`,
    ],
    ['Bill to', `${esc(d.billTo.name)}${d.billTo.gstin ? `<br>GSTIN ${esc(d.billTo.gstin)}` : ''}`],
    ...(d.quoteRef ? ([['Your quotation', esc(d.quoteRef)]] as Array<[string, string]>) : []),
    ...(d.paymentText ? ([['Payment', esc(d.paymentText)]] as Array<[string, string]>) : []),
    ...(d.freightTerms ? ([['Freight', esc(d.freightTerms)]] as Array<[string, string]>) : []),
    ['Total (with GST)', `<strong>${money(d.totals.total)}</strong>`],
  ];
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #d9e0ea;border-radius:6px;border-collapse:separate;margin:4px 0 16px;font-size:14px">
<tr><td colspan="2" style="${HEAD};border-radius:6px 6px 0 0">${esc(d.title)} ${esc(d.number)}</td></tr>
${rows
  .map(
    ([k, v]) =>
      `<tr><td style="${CELL};color:#52606d;width:34%">${k}</td><td style="${CELL}">${v}</td></tr>`,
  )
  .join('\n')}
</table>`;
}

function itemsTable(d: OrderPdfData): string {
  const shown = d.lines.slice(0, MAX_LINES);
  const right = `${CELL};text-align:right;white-space:nowrap`;
  const gst = d.lines.reduce((a, l) => a + l.gst, 0);
  const before = d.lines.reduce((a, l) => a + l.taxable, 0);
  const charges = d.charges.reduce((a, c) => a + c.total, 0);
  const foot = (k: string, v: string, strong = false) =>
    `<tr><td colspan="5" style="${right}${strong ? ';font-weight:bold' : ''}">${k}</td><td style="${right}${strong ? ';font-weight:bold' : ''}">${v}</td></tr>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #d9e0ea;border-collapse:collapse;margin:0 0 16px;font-size:13px">
<tr><th style="${HEAD}">#</th><th style="${HEAD}">Item</th><th style="${HEAD};text-align:right">Qty</th><th style="${HEAD}">Unit</th><th style="${HEAD};text-align:right">Rate</th><th style="${HEAD};text-align:right">Amount</th></tr>
${shown
  .map(
    (l, i) =>
      `<tr><td style="${CELL}">${String(i + 1)}</td><td style="${CELL}">${esc(l.description)}${
        l.code || l.make || l.model
          ? `<br><span style="color:#52606d;font-size:12px">${esc(
              [l.code, l.make ? `Make: ${l.make}` : null, l.model ? `Model: ${l.model}` : null]
                .filter(Boolean)
                .join(' · '),
            )}</span>`
          : ''
      }</td><td style="${right}">${qty(l.quantity)}</td><td style="${CELL}">${esc(l.uom)}</td><td style="${right}">${money(l.rate)}${
        l.discountPct
          ? `<br><span style="color:#52606d;font-size:12px">less ${String(l.discountPct)}%</span>`
          : ''
      }</td><td style="${right}">${money(l.taxable)}</td></tr>`,
  )
  .join('\n')}
${
  d.lines.length > shown.length
    ? `<tr><td colspan="6" style="${CELL};color:#52606d">… and ${String(d.lines.length - shown.length)} more lines in the attached PO</td></tr>`
    : ''
}
${foot('Before GST', money(before))}
${foot('GST', money(gst))}
${d.charges.length ? foot('Freight and other charges (with GST)', money(charges)) : ''}
${foot('Total', money(d.totals.total), true)}
</table>`;
}

export function orderEmailHtml(x: {
  /** the template's wording, with {{variables}} */
  body: string;
  vars: Record<string, string>;
  d: OrderPdfData;
  /** the logo travelling inline with the e-mail (cid) */
  logoCid: string | null;
  /** where the vendor writes back */
  replyTo: string | null;
}): string {
  const fill = (text: string) =>
    Object.entries(x.vars).reduce((t, [k, v]) => t.replaceAll(`{{${k}}}`, esc(v)), esc(text));
  const boxes: Record<string, string> = {
    '{{order_summary}}': summaryBox(x.d),
    '{{items}}': itemsTable(x.d),
  };
  const paras = x.body.split(/\n{2,}/).map((p) => p.trim());
  if (!paras.some((p) => p in boxes)) paras.splice(1, 0, '{{order_summary}}', '{{items}}');
  const inner = paras
    .map((p) => {
      if (p in boxes) return boxes[p];
      const lines = p
        .split('\n')
        .map((l) => fill(l.trim()))
        .filter((l) => l !== '');
      return lines.length ? `<p style="margin:0 0 12px">${lines.join('<br>')}</p>` : '';
    })
    .join('\n');
  const address = x.d.school.address ? esc(x.d.school.address) : null;
  return emailLayout(esc(x.d.school.name), inner, {
    ...(x.logoCid ? { logoCid: x.logoCid } : {}),
    ...(address ? { subtitle: address } : {}),
    footer: x.replyTo
      ? `Questions about this order? Write to <a href="mailto:${esc(x.replyTo)}">${esc(x.replyTo)}</a> or reply to this e-mail. Sent by ${esc(x.d.school.name)} through EduPro.`
      : `Sent by ${esc(x.d.school.name)} through EduPro.`,
  });
}
