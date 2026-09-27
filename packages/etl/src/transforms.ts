/**
 * Pure transforms from the mapping catalogue (docs/data/01-type-mapping-mysql-to-postgres.md).
 * Each returns a Result so rejects are explicit. No I/O here.
 */
import { ok, reject, type Result } from './reject';

const clean = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v)
    .trim()
    .replace(/\s{2,}/g, ' ');
  return s === '' ? null : s;
};

/** Trimmed text; empty becomes null. */
export function text(v: unknown): string | null {
  return clean(v);
}

/** Legacy 'Active'/'1'/'Yes'/... to 'active' | 'inactive'. */
export function normaliseStatus(v: unknown): Result<'active' | 'inactive' | null> {
  const s = clean(v);
  if (s === null) return ok(null);
  const n = s.toLowerCase();
  if (['1', 'active', 'yes', 'y', 'true', 'enabled'].includes(n)) return ok('active');
  if (['0', 'inactive', 'no', 'n', 'false', 'disabled'].includes(n)) return ok('inactive');
  return reject('status.unknown', v);
}

export function yesNoToBoolean(v: unknown): Result<boolean | null> {
  const r = normaliseStatus(v);
  if (r.kind === 'reject') return r;
  return ok(r.value === null ? null : r.value === 'active');
}

/**
 * Legacy year strings to the canonical academic year code 'YYYY-YY'.
 * '2025' -> '2025-26', '2025-26' -> '2025-26', '2025-2026' -> '2025-26', '25-26' -> '2025-26'.
 */
export function normaliseYearCode(v: unknown): Result<string> {
  const s = clean(v);
  if (s === null) return reject('year.empty', v, true);
  let m = /^(\d{4})$/.exec(s);
  if (m) {
    const start = Number(m[1]);
    return ok(`${start}-${String((start + 1) % 100).padStart(2, '0')}`);
  }
  m = /^(\d{4})\s*[-/]\s*(\d{2}|\d{4})$/.exec(s);
  if (m) {
    const start = Number(m[1]);
    const endRaw = m[2]!;
    const end = endRaw.length === 4 ? Number(endRaw) % 100 : Number(endRaw);
    if (end !== (start + 1) % 100) return reject('year.non_consecutive', v, true);
    return ok(`${start}-${String(end).padStart(2, '0')}`);
  }
  m = /^(\d{2})\s*[-/]\s*(\d{2})$/.exec(s);
  if (m) {
    const start = 2000 + Number(m[1]);
    const end = Number(m[2]);
    if (end !== (start + 1) % 100) return reject('year.non_consecutive', v, true);
    return ok(`${start}-${String(end).padStart(2, '0')}`);
  }
  return reject('year.unparseable', v, true);
}

/** 'VI-A' -> { classCode: 'VI', section: 'A' }; 'XI-Sci-A' -> { classCode: 'XI-Sci', section: 'A' }; 'VI' -> section null. */
export function splitLegacySection(
  v: unknown,
): Result<{ classCode: string; section: string | null }> {
  const s = clean(v);
  if (s === null) return reject('class.empty', v, true);
  const idx = s.lastIndexOf('-');
  if (idx <= 0 || idx === s.length - 1) return ok({ classCode: s.toUpperCase(), section: null });
  const classCode = s.slice(0, idx).trim();
  const section = s.slice(idx + 1).trim();
  if (!/^[A-Za-z0-9]{1,4}$/.test(section)) return ok({ classCode: s.toUpperCase(), section: null });
  return ok({ classCode: classCode.toUpperCase(), section: section.toUpperCase() });
}

/** First valid Indian mobile number (10 digits starting 6-9), with +91, 0 and separators removed. */
export function normaliseMobile(v: unknown): Result<string | null> {
  const s = clean(v);
  if (s === null) return ok(null);
  const candidates = s.split(/[,;/|]/).map((c) => c.replace(/\D/g, ''));
  for (let d of candidates) {
    if (d.startsWith('91') && d.length === 12) d = d.slice(2);
    if (d.startsWith('0') && d.length === 11) d = d.slice(1);
    if (/^[6-9]\d{9}$/.test(d)) return ok(d);
  }
  return reject('mobile.invalid', v);
}

export function normaliseEmail(v: unknown): Result<string | null> {
  const s = clean(v);
  if (s === null) return ok(null);
  const e = s.toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return reject('email.invalid', v);
  return ok(e);
}

/**
 * Legacy dates in 'yyyy-mm-dd', 'dd/mm/yyyy', 'dd-mm-yyyy', 'dd.mm.yyyy' or 'yyyy-mm-dd hh:mm:ss' to ISO date.
 * Zero dates and empties become null. Ambiguous day/month is read day-first (Indian convention).
 */
export function normaliseDate(v: unknown): Result<string | null> {
  if (v instanceof Date)
    return Number.isNaN(v.getTime()) ? reject('date.invalid', v) : ok(v.toISOString().slice(0, 10));
  const s = clean(v);
  if (s === null || s.startsWith('0000-00-00') || s === '0') return ok(null);
  let y: number, mo: number, d: number;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T].*)?$/.exec(s);
  if (m) {
    [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  } else {
    m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
    if (!m) return reject('date.unparseable', v);
    [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1900 || y > 2100)
    return reject('date.out_of_range', v);
  const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const check = new Date(`${iso}T00:00:00Z`);
  if (check.getUTCMonth() + 1 !== mo || check.getUTCDate() !== d) return reject('date.invalid', v);
  return ok(iso);
}

/** Naive IST datetime ('yyyy-mm-dd hh:mm:ss') to ISO UTC. */
export function istToUtc(v: unknown): Result<string | null> {
  const s = clean(v);
  if (s === null || s.startsWith('0000-00-00')) return ok(null);
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (!m) return reject('datetime.unparseable', v);
  const utc = Date.UTC(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6] ?? '0'),
  );
  const shifted = new Date(utc - (5 * 60 + 30) * 60 * 1000);
  if (Number.isNaN(shifted.getTime())) return reject('datetime.invalid', v);
  return ok(shifted.toISOString());
}

/** Combine legacy split date and time columns (IST) into ISO UTC. */
export function combineDateTime(date: unknown, time: unknown): Result<string | null> {
  const d = normaliseDate(date);
  if (d.kind === 'reject') return d;
  if (d.value === null) return ok(null);
  const t = clean(time) ?? '00:00:00';
  const tm = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i.exec(t);
  if (!tm) return reject('time.unparseable', time);
  let h = Number(tm[1]);
  const ampm = tm[4]?.toUpperCase();
  if (ampm === 'PM' && h < 12) h += 12;
  if (ampm === 'AM' && h === 12) h = 0;
  return istToUtc(`${d.value} ${String(h).padStart(2, '0')}:${tm[2]}:${tm[3] ?? '00'}`);
}

/** Money as a string with two decimals; strips commas and currency symbols; rounds half up. Blocking reject. */
export function toMoney(v: unknown): Result<string | null> {
  if (v === null || v === undefined) return ok(null);
  const s = String(v)
    .replace(/[₹,\s]|Rs\.?|INR/gi, '')
    .trim();
  if (s === '') return ok(null);
  if (!/^-?\d+(\.\d+)?$/.test(s)) return reject('money.invalid', v, true);
  const n = Number(s);
  const rounded = Math.round((Math.abs(n) + Number.EPSILON) * 100) / 100;
  return ok((n < 0 ? '-' : '') + rounded.toFixed(2));
}

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

/** 'April', 'Apr', 'apr', '4', '04' -> 4 */
export function normaliseMonth(v: unknown): Result<number | null> {
  const s = clean(v);
  if (s === null) return ok(null);
  if (/^\d{1,2}$/.test(s)) {
    const n = Number(s);
    return n >= 1 && n <= 12 ? ok(n) : reject('month.out_of_range', v);
  }
  const idx = MONTHS.findIndex((m) => m.startsWith(s.toLowerCase().slice(0, 3)));
  return idx >= 0 ? ok(idx + 1) : reject('month.unknown', v);
}

/** Upper-cased admission numbers and employee codes; blocking when empty. */
export function normaliseCode(v: unknown): Result<string> {
  const s = clean(v);
  if (s === null) return reject('code.empty', v, true);
  return ok(s.toUpperCase().replace(/\s+/g, ''));
}

/** Repairs the common double-encoded UTF-8 (mojibake) from latin1 tables. */
export function repairMojibake(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  // Repair before trimming: the second byte of a double-encoded character can be a non-breaking space,
  // which String.prototype.trim would remove.
  let s = String(v);
  if (/[ÃÂ][\u0080-¿]/.test(s)) {
    try {
      s = Buffer.from(s, 'latin1').toString('utf8');
    } catch {
      // keep the original text
    }
  }
  return clean(s);
}

/** Legacy 'isTrash' plus last-updated to deleted_at. */
export function trashToDeletedAt(
  isTrash: unknown,
  updatedAt: unknown,
  fallbackIso: string,
): string | null {
  const flag = yesNoToBoolean(isTrash);
  if (flag.kind === 'reject' || !flag.value) return null;
  const when = istToUtc(updatedAt);
  return when.kind === 'ok' && when.value ? when.value : fallbackIso;
}

/** Minimal PHP serialize() reader for arrays of scalars (legacy settings columns). */
export function phpUnserialize(v: unknown): Result<unknown> {
  const s = clean(v);
  if (s === null) return ok(null);
  let i = 0;
  const readUntil = (ch: string): string => {
    const j = s.indexOf(ch, i);
    if (j < 0) throw new Error('bad');
    const out = s.slice(i, j);
    i = j + 1;
    return out;
  };
  const parse = (): unknown => {
    const type = s[i];
    i += 2; // type and ':'
    switch (type) {
      case 'N':
        return null;
      case 'b':
        return readUntil(';') === '1';
      case 'i':
        return Number(readUntil(';'));
      case 'd':
        return Number(readUntil(';'));
      case 's': {
        const len = Number(readUntil(':'));
        i += 1; // opening quote
        const str = s.slice(i, i + len);
        i += len + 2; // closing quote and ';'
        return str;
      }
      case 'a': {
        const count = Number(readUntil(':'));
        i += 1; // '{'
        const entries: Array<[unknown, unknown]> = [];
        for (let k = 0; k < count; k += 1) entries.push([parse(), parse()]);
        i += 1; // '}'
        const isList = entries.every(([key], idx) => key === idx);
        return isList
          ? entries.map(([, val]) => val)
          : Object.fromEntries(entries.map(([k, val]) => [String(k), val]));
      }
      default:
        throw new Error('unsupported');
    }
  };
  try {
    return ok(parse());
  } catch {
    return reject('php.unserialize_failed', v);
  }
}
