import type { ApprovalDetail, DetailConfig } from './approval-source';

/**
 * docs/design/100: reads any kind's record (or its list row) into the app's Details screen — its fields in words, its
 * lists as tables, its longer text as notes, the files it names — leaving out ids, rights and empty values, so every
 * kind shows natively without a page of its own.
 */

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

/** fields never shown: ids, rights, machine words, versions */
const HIDDEN =
  /^(id|.*Id|.*_id|.*Ids|can|canAct|may.*|myTurn|mine|hasForm|edits|version|source|kind|what|tenant.*|school.*|objectKey|object_key|.*Key|token.*|.*Hash|hash|href|url|.*Url|sort.*|position)$/;
const NOTE_KEYS =
  /^(reason|note|notes|remark|remarks|description|message|text|body|comment|comments|purpose|justification|details|decisionNote|cancelReason|answer)$/i;
const FILE_KEY = /^(.*FileId|.*_file_id|fileId|file_id|documentFileId)$/;
const FILE_LIST_KEY = /^(files|attachments|documents|fileIds|file_ids|documentFileIds)$/;

const WORDS: Record<string, string> = {
  at: 'When',
  since: 'Waiting since',
  by: 'By',
  from: 'From',
  to: 'To',
  dayType: 'Day type',
  day_type: 'Day type',
  in_time: 'In',
  out_time: 'Out',
  sourceWords: 'How',
  waitingWith: 'Waiting with',
  appliedAt: 'Applied',
  appliedBy: 'Applied by',
  decidedAt: 'Decided',
  decidedBy: 'Decided by',
  halfDay: 'Half day',
  lossOfPay: 'Loss of pay',
  dayRows: 'Days',
  approval: 'Approval',
};

/** camelCase / snake_case → words, the first a capital */
export function words(key: string, labels?: Record<string, string>): string {
  if (labels?.[key]) return labels[key];
  if (WORDS[key]) return WORDS[key];
  const w = key
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .trim();
  return w.charAt(0).toUpperCase() + w.slice(1);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** a value in words: dates as 13 Nov 2026, times in India, a person or a thing by its name (and code) */
export function valueWords(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'boolean') return v ? 'Yes' : null;
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : null;
  if (typeof v === 'string') {
    if (DAY.test(v))
      return `${Number(v.slice(8, 10))} ${MONTHS[Number(v.slice(5, 7)) - 1]} ${v.slice(0, 4)}`;
    if (STAMP.test(v)) {
      const d = new Date(v);
      if (!Number.isNaN(d.getTime()))
        return new Intl.DateTimeFormat('en-IN', {
          timeZone: 'Asia/Kolkata',
          day: 'numeric',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }).format(d);
    }
    return v;
  }
  if (Array.isArray(v)) {
    const parts = v.map(valueWords).filter((x): x is string => !!x);
    return parts.length ? parts.join(', ') : null;
  }
  if (isObj(v)) {
    const name = valueWords(v.name ?? v.title ?? v.label ?? v.displayName ?? v.display_name);
    const code = valueWords(v.code ?? v.number);
    if (name) return code && code !== name ? `${name} (${code})` : name;
    if (code) return code;
    const parts = Object.entries(v)
      .filter(([k]) => !HIDDEN.test(k))
      .map(([, x]) => (isObj(x) || Array.isArray(x) ? null : valueWords(x)))
      .filter((x): x is string => !!x);
    return parts.length ? parts.join(' · ') : null;
  }
  return String(v);
}

/** reads a record (or a list row) into the Details screen's parts */
export function readRecord(
  record: unknown,
  head: { title: string; subtitle: string | null },
  config: DetailConfig = {},
): ApprovalDetail {
  const out: ApprovalDetail = {
    title: head.title,
    subtitle: head.subtitle,
    status: null,
    facts: [],
    notes: [],
    tables: [],
    files: [],
  };
  if (!isObj(record)) return out;
  const hide = new Set(config.hide ?? []);
  const label = (k: string) => words(k, config.labels);
  const fileSeen = new Set<string>();
  const addFile = (lbl: string, id: unknown) => {
    const fileId = id === null || id === undefined ? '' : String(id);
    if (/^\d{1,18}$/.test(fileId) && !fileSeen.has(fileId)) {
      fileSeen.add(fileId);
      out.files.push({ label: lbl, fileId });
    }
  };
  const visit = (o: Obj, prefix: string, depth: number) => {
    for (const [k, v] of Object.entries(o)) {
      if (hide.has(k)) continue;
      if (FILE_KEY.test(k)) {
        addFile(label(k.replace(/_?[Ff]ile_?[Ii]d$/, '') || 'File'), v);
        continue;
      }
      if (FILE_LIST_KEY.test(k) && Array.isArray(v)) {
        v.forEach((f, i) => {
          // a document with files of its own (a registration's birth certificate …)
          if (isObj(f) && Array.isArray(f.files)) {
            const doc = valueWords(f.label ?? f.name) ?? label(k);
            (f.files as unknown[]).forEach((g, j) => {
              if (isObj(g))
                addFile(
                  `${doc} · ${valueWords(g.name ?? g.fileName) ?? String(j + 1)}`,
                  g.id ?? g.fileId,
                );
              else addFile(`${doc} ${String(j + 1)}`, g);
            });
          } else if (isObj(f))
            addFile(
              valueWords(f.name ?? f.fileName ?? f.original_name) ?? `${label(k)} ${String(i + 1)}`,
              f.id ?? f.fileId,
            );
          else addFile(`${label(k)} ${String(i + 1)}`, f);
        });
        continue;
      }
      // a form's answers: sections of label and value (a registration), a table each
      if (Array.isArray(v) && v.length && v.every((x) => isObj(x) && Array.isArray(x.items))) {
        for (const sec of v as Obj[]) {
          const rows = (sec.items as unknown[])
            .filter(isObj)
            .map((it) => [valueWords(it.label ?? it.key) ?? '', valueWords(it.value) ?? ''])
            .filter(([, w]) => w !== '');
          if (rows.length)
            out.tables.push({
              title: valueWords(sec.title) ?? label(k),
              columns: ['Field', 'Answer'],
              rows,
            });
        }
        continue;
      }
      if (HIDDEN.test(k)) continue;
      if ((k === 'status' || k === 'statusWords' || k === 'statusLabel') && depth === 0) {
        const w = valueWords(v);
        if (w && (k !== 'status' || !out.status)) out.status = w;
        continue;
      }
      if (Array.isArray(v)) {
        if (v.length && v.every(isObj)) {
          // a column a field the rows have (not an id, a right, a file or a list of its own)
          const cols = [
            ...new Set(
              (v as Obj[]).flatMap((r) =>
                Object.keys(r).filter(
                  (c) => !HIDDEN.test(c) && !FILE_KEY.test(c) && !Array.isArray(r[c]),
                ),
              ),
            ),
          ].slice(0, 8);
          const cells = (v as Obj[]).map((r) => cols.map((c) => valueWords(r[c]) ?? ''));
          const keep = cols.map((_, i) => cells.some((r) => r[i] !== ''));
          if (keep.some(Boolean))
            out.tables.push({
              title: label(prefix ? `${prefix}_${k}` : k),
              columns: cols.filter((_, i) => keep[i]).map((c) => label(c)),
              rows: cells.map((r) => r.filter((_, i) => keep[i])),
            });
          for (const r of v as Obj[])
            for (const [c, x] of Object.entries(r)) if (FILE_KEY.test(c)) addFile(label(k), x);
        } else {
          const w = valueWords(v);
          if (w) out.facts.push({ label: label(k), value: w });
        }
        continue;
      }
      if (isObj(v)) {
        const named = v.name ?? v.title ?? v.label ?? v.code ?? v.number;
        if (named !== undefined && named !== null) {
          const w = valueWords(v);
          if (w) out.facts.push({ label: label(k), value: w });
        } else if (depth < 1) visit(v, k, depth + 1);
        continue;
      }
      const w = valueWords(v);
      if (!w) continue;
      if (typeof v === 'string' && (NOTE_KEYS.test(k) || v.length > 80))
        out.notes.push({ label: label(k), text: v });
      else
        out.facts.push({
          label: prefix && depth > 0 ? `${label(prefix)} · ${label(k)}` : label(k),
          value: w,
        });
    }
  };
  visit(record, '', 0);
  return out;
}

/** the list answer's row for an item: the first object anywhere in it whose id is the item's */
export function findRow(answer: unknown, id: string): Obj | null {
  const seen = new Set<unknown>();
  const walk = (v: unknown): Obj | null => {
    if (!v || typeof v !== 'object' || seen.has(v)) return null;
    seen.add(v);
    if (Array.isArray(v)) {
      for (const x of v) {
        const r = walk(x);
        if (r) return r;
      }
      return null;
    }
    const o = v as Obj;
    if (o.id !== undefined && String(o.id) === id) return o;
    for (const x of Object.values(o)) {
      const r = walk(x);
      if (r) return r;
    }
    return null;
  };
  return walk(answer);
}
