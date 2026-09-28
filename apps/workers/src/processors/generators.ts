import ExcelJS from 'exceljs';
import type { DatasetColumn } from '@edupro/db';

export type Row = Record<string, unknown>;

export function formatCell(
  value: unknown,
  type: DatasetColumn['type'],
): string | number | Date | null {
  if (value === null || value === undefined) return null;
  if (type === 'json') return JSON.stringify(value);
  if (type === 'number') return typeof value === 'number' ? value : Number(value);
  if (type === 'date' || type === 'datetime')
    return value instanceof Date ? value : new Date(String(value));
  if (value instanceof Date) return value;
  return typeof value === 'string' ? value : String(value);
}

/** Excel workbook with a header row, column widths and typed cells (exceljs). */
export async function toXlsx(
  title: string,
  columns: DatasetColumn[],
  rows: Row[],
  meta: { school: string; generatedAt: Date },
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'EduPro Next';
  workbook.created = meta.generatedAt;
  const sheet = workbook.addWorksheet(title.slice(0, 31) || 'Export', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  sheet.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 16 }));
  sheet.getRow(1).font = { bold: true };
  for (const row of rows) {
    const cells: Record<string, string | number | Date | null> = {};
    for (const c of columns) cells[c.key] = formatCell(row[c.key], c.type);
    sheet.addRow(cells);
  }
  for (const c of columns) {
    if (c.type === 'datetime') sheet.getColumn(c.key).numFmt = 'yyyy-mm-dd hh:mm';
    if (c.type === 'date') sheet.getColumn(c.key).numFmt = 'yyyy-mm-dd';
  }
  const out = await workbook.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}

/** RFC 4180 CSV with a UTF-8 BOM so Excel on Windows opens Devanagari correctly. */
export function toCsv(columns: DatasetColumn[], rows: Row[]): Buffer {
  const escape = (v: string | number | Date | null): string => {
    if (v === null) return '';
    const s = v instanceof Date ? v.toISOString() : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map((c) => escape(c.header)).join(',')];
  for (const row of rows)
    lines.push(columns.map((c) => escape(formatCell(row[c.key], c.type))).join(','));
  return Buffer.from('﻿' + lines.join('\r\n') + '\r\n', 'utf8');
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Print layout for PDF exports: design-system colours, A4, repeating header row. */
export function toHtml(
  title: string,
  columns: DatasetColumn[],
  rows: Row[],
  meta: { school: string; generatedAt: Date; requestedBy: string | null },
): string {
  const fmt = (v: unknown, type: DatasetColumn['type']): string => {
    const cell = formatCell(v, type);
    if (cell === null) return '';
    if (cell instanceof Date)
      return type === 'date'
        ? cell.toISOString().slice(0, 10)
        : cell.toISOString().replace('T', ' ').slice(0, 16);
    return escapeHtml(String(cell));
  };
  const head = columns
    .map((c) => `<th class="${c.type === 'number' ? 'num' : ''}">${escapeHtml(c.header)}</th>`)
    .join('');
  const body = rows
    .map(
      (r) =>
        `<tr>${columns.map((c) => `<td class="${c.type === 'number' ? 'num' : ''}">${fmt(r[c.key], c.type)}</td>`).join('')}</tr>`,
    )
    .join('\n');
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  @page { size: A4 ${columns.length > 6 ? 'landscape' : 'portrait'}; margin: 14mm 12mm; }
  body { font-family: "Source Sans 3", "Segoe UI", Arial, sans-serif; color: #1F2933; font-size: 10.5px; margin: 0; }
  h1 { font-family: Poppins, "Segoe UI", Arial, sans-serif; font-size: 16px; color: #00265D; margin: 0 0 2px; }
  .meta { color: #52606D; margin-bottom: 10px; }
  table { border-collapse: collapse; width: 100%; }
  thead { display: table-header-group; }
  th { background: #00265D; color: #fff; text-align: left; padding: 5px 6px; font-weight: 600; }
  td { border-bottom: 1px solid #E4E7EB; padding: 4px 6px; vertical-align: top; }
  tr:nth-child(even) td { background: #F5F7FA; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  tfoot td { border: none; color: #52606D; padding-top: 8px; }
</style></head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <div class="meta">${escapeHtml(meta.school)} · generated ${meta.generatedAt.toISOString().replace('T', ' ').slice(0, 16)} UTC${meta.requestedBy ? ` · requested by ${escapeHtml(meta.requestedBy)}` : ''} · ${rows.length} rows</div>
  <table><thead><tr>${head}</tr></thead><tbody>
${body}
  </tbody></table>
</body></html>`;
}

const xmlEscape = (v: unknown): string =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Generic XML: one <row> per record with the dataset's column keys as elements. */
export function toXml(title: string, columns: DatasetColumn[], rows: Row[]): Buffer {
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', `<report title="${xmlEscape(title)}">`];
  for (const r of rows) {
    lines.push('  <row>');
    for (const c of columns) {
      const v = formatCell(r[c.key], c.type);
      lines.push(`    <${c.key}>${xmlEscape(v instanceof Date ? v.toISOString() : v)}</${c.key}>`);
    }
    lines.push('  </row>');
  }
  lines.push('</report>');
  return Buffer.from(lines.join('\n'), 'utf8');
}

export interface TallyOptions {
  company: string;
  cashLedger: string;
  bankLedger: string;
}

const tallyDate = (v: unknown): string => {
  const d = v instanceof Date ? v : new Date(String(v));
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
};

/**
 * Sprint 15: Tally XML import file (ENVELOPE › TALLYMESSAGE › VOUCHER). Rows of the fee_tally_vouchers
 * dataset are grouped by voucher_no: one Receipt voucher debiting the cash or bank ledger for the total
 * and crediting one ledger per fee head line. Party and narration come from the rows.
 */
export function toTallyXml(rows: Row[], options: TallyOptions): Buffer {
  const byVoucher = new Map<string, Row[]>();
  for (const r of rows) {
    const key = String(r.voucher_no ?? '');
    const list = byVoucher.get(key) ?? [];
    list.push(r);
    byVoucher.set(key, list);
  }
  const out: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<ENVELOPE>',
    '  <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>',
    '  <BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME>',
    `    <STATICVARIABLES><SVCURRENTCOMPANY>${xmlEscape(options.company)}</SVCURRENTCOMPANY></STATICVARIABLES>`,
    '  </REQUESTDESC><REQUESTDATA>',
  ];
  for (const [voucherNo, lines] of byVoucher) {
    const first = lines[0]!;
    const total = lines.reduce((acc, l) => acc + Number(l.amount ?? 0), 0);
    const mode = String(first.mode ?? 'cash').toLowerCase();
    const debit = mode === 'cash' ? options.cashLedger : options.bankLedger;
    const date = tallyDate(first.date);
    const narration = [first.narration, first.party, first.bank_name, first.instrument_no]
      .filter((x) => x !== null && x !== undefined && String(x) !== '')
      .join(' | ');
    out.push('    <TALLYMESSAGE xmlns:UDF="TallyUDF">');
    out.push(`      <VOUCHER VCHTYPE="Receipt" ACTION="Create" OBJVIEW="Accounting Voucher View">`);
    out.push(`        <DATE>${date}</DATE>`);
    out.push('        <VOUCHERTYPENAME>Receipt</VOUCHERTYPENAME>');
    out.push(`        <VOUCHERNUMBER>${xmlEscape(voucherNo)}</VOUCHERNUMBER>`);
    out.push(`        <PARTYLEDGERNAME>${xmlEscape(first.party)}</PARTYLEDGERNAME>`);
    out.push(`        <NARRATION>${xmlEscape(narration)}</NARRATION>`);
    out.push('        <ALLLEDGERENTRIES.LIST>');
    out.push(`          <LEDGERNAME>${xmlEscape(debit)}</LEDGERNAME>`);
    out.push('          <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>');
    out.push(`          <AMOUNT>-${total.toFixed(2)}</AMOUNT>`);
    out.push('        </ALLLEDGERENTRIES.LIST>');
    for (const l of lines) {
      out.push('        <ALLLEDGERENTRIES.LIST>');
      out.push(`          <LEDGERNAME>${xmlEscape(l.ledger_name)}</LEDGERNAME>`);
      out.push('          <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>');
      out.push(`          <AMOUNT>${Number(l.amount ?? 0).toFixed(2)}</AMOUNT>`);
      out.push('        </ALLLEDGERENTRIES.LIST>');
    }
    out.push('      </VOUCHER>');
    out.push('    </TALLYMESSAGE>');
  }
  out.push('  </REQUESTDATA></IMPORTDATA></BODY>', '</ENVELOPE>');
  return Buffer.from(out.join('\n'), 'utf8');
}
