/** Minimal RFC 4180 parser: quoted fields, doubled quotes, CRLF or LF line ends. Header row required. */
export function parseCsv(text: string): { header: string[]; rows: string[][] } {
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let quoted = false;
  const src = text.startsWith('﻿') ? text.slice(1) : text;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      record.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      record.push(field);
      field = '';
      records.push(record);
      record = [];
    } else field += ch;
  }
  if (field.length > 0 || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  const nonEmpty = records.filter((r) => r.some((v) => v.trim() !== ''));
  const header = (nonEmpty.shift() ?? []).map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  return { header, rows: nonEmpty.map((r) => r.map((v) => v.trim())) };
}
