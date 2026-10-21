import { DomainError } from '../../common/errors/domain-error';

/**
 * The Books page as the Employees list (docs/design/36-library.md, "Register like Employees"): every
 * field of a title or a copy that can be a column, a filter or the sort, each an SQL expression over the
 * level's rows, so a large register is filtered, sorted and paged in the database. The copies level reads
 * `x` (the copy), `t` (its title), `l` (library), `sh` (shelf), `v` (vendor), `m` (material type),
 * `s` (subject), `cl` (class) and `ln` (the open loan); the titles level reads `t`, `m`, `s`, `cl` and
 * `k` (the copies counted).
 */
export type RegisterLevel = 'copy' | 'title';
export type RegisterType = 'text' | 'number' | 'date';

export interface RegisterField {
  key: string;
  label: string;
  section: string;
  type: RegisterType;
  /** The value per level (a level without one does not offer the field). */
  sql: Partial<Record<RegisterLevel, string>>;
  /** Sorted by these instead of the value (an accession number in its natural order). */
  sortSql?: Partial<Record<RegisterLevel, string[]>>;
  /** Where the filter's suggestions come from (loaded with the fields). */
  options?: string;
}

export const REGISTER_SECTIONS = [
  { id: 'book', title: 'The book' },
  { id: 'publication', title: 'Publication' },
  { id: 'copy', title: 'The copy' },
  { id: 'source', title: 'How it came' },
  { id: 'loan', title: 'On loan' },
  { id: 'counts', title: 'Copies of the title' },
];

/** A copy's status as the list says it (the filters take these words). */
export const COPY_STATUS_LABEL: Record<string, string> = {
  available: 'On the shelf',
  issued: 'Issued',
  damaged: 'Damaged',
  lost: 'Lost',
  withdrawn: 'Withdrawn',
  sold: 'Sold',
};
const STATUS_SQL = `CASE x.status::text ${Object.entries(COPY_STATUS_LABEL)
  .map(([k, v]) => `WHEN '${k}' THEN '${v}'`)
  .join(' ')} END`;

const both = (sql: string) => ({ copy: sql, title: sql });
const copy = (sql: string) => ({ copy: sql });
const f = (
  key: string,
  label: string,
  section: string,
  type: RegisterType,
  sql: RegisterField['sql'],
  more: Partial<RegisterField> = {},
): RegisterField => ({ key, label, section, type, sql, ...more });

export const REGISTER_FIELDS: RegisterField[] = [
  f('title', 'Title', 'book', 'text', both('t.title')),
  f('subtitle', 'Subtitle', 'book', 'text', both('t.subtitle')),
  f('authors', 'Authors', 'book', 'text', both('t.author')),
  f(
    'others',
    'Editors and others',
    'book',
    'text',
    both(`(SELECT string_agg(ta.role || ': ' || a.name, '; ' ORDER BY ta.position)
             FROM library_title_authors ta JOIN library_authors a ON a.id = ta.author_id
            WHERE ta.title_id = t.id AND ta.role <> 'Author')`),
  ),
  f('catalogue_code', 'Catalogue code', 'book', 'text', both('t.code')),
  f('material', 'Material type', 'book', 'text', both('m.name'), { options: 'material' }),
  f('subject', 'Subject', 'book', 'text', both('s.name::text'), { options: 'subject' }),
  f('sub_subject', 'Sub-subject', 'book', 'text', both('t.sub_subject')),
  f('call_no', 'Call number', 'book', 'text', both('t.call_no')),
  f('for_class', 'For class', 'book', 'text', both('cl.name'), { options: 'class' }),
  f('keywords', 'Keywords', 'book', 'text', both(`array_to_string(t.keywords, ', ')`)),
  f(
    'reference_only',
    'Reference only',
    'book',
    'text',
    both(`CASE WHEN t.is_reference OR NOT COALESCE(m.issuable, true) THEN 'Yes' ELSE 'No' END`),
    { options: 'yesno' },
  ),
  f('title_notes', 'Notes', 'book', 'text', both('t.notes')),
  f('publisher', 'Publisher', 'publication', 'text', both('t.publisher')),
  f('place', 'Place of publication', 'publication', 'text', both('t.publication_place')),
  f('year', 'Year', 'publication', 'number', both('t.year')),
  f('edition', 'Edition', 'publication', 'text', both('t.edition')),
  f('volume', 'Volume', 'publication', 'text', both('t.volume')),
  f('pages', 'Pages', 'publication', 'number', both('t.pages')),
  f('isbn', 'ISBN', 'publication', 'text', both('t.isbn')),
  f('language', 'Language', 'publication', 'text', both('t.language'), { options: 'language' }),
  f('printed_price', 'Price as printed (₹)', 'publication', 'number', both('t.price')),
  f('accession_no', 'Accession no.', 'copy', 'text', copy('x.accession_no'), {
    sortSql: {
      copy: [
        `regexp_replace(x.accession_no, '[0-9]+$', '')`,
        `NULLIF(substring(x.accession_no FROM '[0-9]+$'), '')::numeric`,
        'x.accession_no',
      ],
    },
  }),
  f(
    'former_nos',
    'Former accession nos.',
    'copy',
    'text',
    copy(`(SELECT string_agg(h.old_no, ', ' ORDER BY h.changed_at, h.id) FROM library_accession_changes h
            WHERE h.copy_id = x.id AND upper(h.old_no) <> upper(x.accession_no))`),
  ),
  f('library', 'Library', 'copy', 'text', copy('l.name'), { options: 'library' }),
  f('shelf', 'Shelf', 'copy', 'text', copy('sh.code'), { options: 'shelf' }),
  f('rack', 'Rack', 'copy', 'text', copy('x.rack')),
  f('barcode', 'Barcode', 'copy', 'text', copy('x.barcode')),
  f('copy_status', 'Status', 'copy', 'text', copy(STATUS_SQL), { options: 'status' }),
  f('status_on', 'Status date', 'copy', 'date', copy('x.status_on')),
  f('status_reason', 'Status reason', 'copy', 'text', copy('x.status_reason')),
  f('last_checked', 'Last stock check', 'copy', 'date', copy('x.last_verified_on')),
  f('remarks', 'Remarks', 'copy', 'text', copy('x.remarks')),
  f('accessioned_on', 'Date of accession', 'source', 'date', copy('x.accessioned_on')),
  f('acquisition', 'Purchase or donation', 'source', 'text', copy('x.acquisition'), {
    options: 'acquisition',
  }),
  f('vendor', 'Vendor', 'source', 'text', copy('v.name'), { options: 'vendor' }),
  f('donor', 'Donated by', 'source', 'text', copy('x.donor')),
  f('bill_no', 'Bill no.', 'source', 'text', copy('x.bill_no')),
  f('bill_date', 'Bill date', 'source', 'date', copy('x.bill_date')),
  f('po_no', 'Purchase order no.', 'source', 'text', copy('x.po_no')),
  f('copy_price', 'Copy price (₹)', 'source', 'number', copy('COALESCE(x.price, t.price)')),
  f('issued_to', 'Issued to', 'loan', 'text', copy('ln.borrower')),
  f('borrower_no', 'Admission or employee no.', 'loan', 'text', copy('ln.borrower_ref')),
  f(
    'borrower_type',
    'Borrower is',
    'loan',
    'text',
    copy(`CASE ln.kind WHEN 'student' THEN 'Student' WHEN 'employee' THEN 'Staff' END`),
    { options: 'borrower' },
  ),
  f('issued_on', 'Issued on', 'loan', 'date', copy('ln.issued_on')),
  f('due_on', 'Due on', 'loan', 'date', copy('ln.due_on')),
  f(
    'days_overdue',
    'Days overdue',
    'loan',
    'number',
    copy('CASE WHEN ln.due_on < CURRENT_DATE THEN CURRENT_DATE - ln.due_on END'),
  ),
  f('times_issued', 'Times issued', 'loan', 'number', {
    copy: '(SELECT count(*) FROM library_loans z WHERE z.copy_id = x.id)',
    title:
      '(SELECT count(*) FROM library_loans z JOIN library_copies zc ON zc.id = z.copy_id WHERE zc.title_id = t.id)',
  }),
  f('copies', 'Copies', 'counts', 'number', { title: 'k.copies' }),
  f('on_shelf', 'On the shelf', 'counts', 'number', { title: 'k.available' }),
  f('issued', 'Issued', 'counts', 'number', { title: 'k.issued' }),
  f('lost', 'Lost', 'counts', 'number', { title: 'k.lost' }),
  f('damaged', 'Damaged', 'counts', 'number', { title: 'k.damaged' }),
  f('withdrawn', 'Withdrawn', 'counts', 'number', { title: 'k.withdrawn' }),
  f('value', 'Value of the copies (₹)', 'counts', 'number', { title: 'k.value' }),
];

export const fieldsOf = (level: RegisterLevel) => REGISTER_FIELDS.filter((x) => x.sql[level]);
const byKey = (level: RegisterLevel) => new Map(fieldsOf(level).map((x) => [x.key, x]));

/** The first column of each level (it always shows and leads the sort). */
export const PRIMARY: Record<RegisterLevel, string> = { copy: 'accession_no', title: 'title' };

const TITLE_JOINS = `LEFT JOIN library_material_types m ON m.id = t.material_type_id
  LEFT JOIN library_subjects s ON s.id = t.subject_id
  LEFT JOIN classes cl ON cl.id = t.class_id`;
/** The rows of a level, before the filters. */
export const REGISTER_FROM: Record<RegisterLevel, string> = {
  // eslint-disable-next-line no-restricted-syntax -- fixed fragments of the register catalogue; values are bound
  copy: `library_copies x
    JOIN library_titles t ON t.id = x.title_id
    JOIN library_libraries l ON l.id = x.library_id
    LEFT JOIN library_shelves sh ON sh.id = x.shelf_id
    LEFT JOIN library_vendors v ON v.id = x.vendor_id
    ${TITLE_JOINS}
    LEFT JOIN LATERAL (
      SELECT lo.borrower_kind::text AS kind, COALESCE(st.display_name, e.display_name) AS borrower,
             COALESCE(st.admission_no, e.employee_code) AS borrower_ref, lo.issued_on, lo.due_on
        FROM library_loans lo
        LEFT JOIN students st ON lo.borrower_kind = 'student' AND st.id = lo.borrower_id
        LEFT JOIN employees e ON lo.borrower_kind = 'employee' AND e.id = lo.borrower_id
       WHERE lo.copy_id = x.id AND lo.returned_on IS NULL LIMIT 1) ln ON true`,
  // eslint-disable-next-line no-restricted-syntax -- fixed fragments of the register catalogue; values are bound
  title: `library_titles t
    ${TITLE_JOINS}
    LEFT JOIN LATERAL (
      SELECT count(*) FILTER (WHERE x.status NOT IN ('withdrawn', 'sold'))::int AS copies,
             count(*) FILTER (WHERE x.status = 'available')::int AS available,
             count(*) FILTER (WHERE x.status = 'issued')::int AS issued,
             count(*) FILTER (WHERE x.status = 'lost')::int AS lost,
             count(*) FILTER (WHERE x.status = 'damaged')::int AS damaged,
             count(*) FILTER (WHERE x.status = 'withdrawn')::int AS withdrawn,
             sum(COALESCE(x.price, t.price)) FILTER (WHERE x.status NOT IN ('withdrawn', 'lost', 'sold')) AS value
        FROM library_copies x WHERE x.title_id = t.id) k ON true`,
};

/** The status picks of each level (the list's Status box). */
export const REGISTER_STATUSES: Record<RegisterLevel, Record<string, string | null>> = {
  copy: {
    all: null,
    in_stock: `x.status NOT IN ('withdrawn', 'lost', 'sold')`,
    available: `x.status = 'available'`,
    issued: `x.status = 'issued'`,
    overdue: `x.status = 'issued' AND ln.due_on < CURRENT_DATE`,
    damaged: `x.status = 'damaged'`,
    lost: `x.status = 'lost'`,
    withdrawn: `x.status = 'withdrawn'`,
    sold: `x.status = 'sold'`,
  },
  title: {
    all: null,
    available: 'k.available > 0',
    out: 'k.copies > 0 AND k.available = 0',
    none: 'k.copies = 0',
  },
};

export interface RegisterView {
  columns: Array<{ key: string; label?: string | null }>;
  filters: Array<{ key: string; op: string; values?: string[] }>;
  sort: Array<{ key: string; dir: 'asc' | 'desc' }>;
  search?: string;
  status: string;
}

const bad = (message: string) => new DomainError('validation-failed', message, { status: 400 });
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The WHERE of a level for a view: the active titles, the status, the search and every filter, each
 * on the field's own expression; the values bound from `args` on.
 */
export function registerWhere(level: RegisterLevel, v: RegisterView, args: unknown[]): string {
  const arg = (x: unknown) => {
    args.push(x);
    return `$${String(args.length)}`;
  };
  const where = [`t.status = 'active'`];
  const status = REGISTER_STATUSES[level][v.status];
  if (status === undefined) throw bad(`Unknown status ${v.status}`);
  if (status) where.push(status);
  const q = v.search?.trim();
  if (q) {
    const p = arg(`%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    const plain = arg(q.replace(/[\s-]/g, '').toUpperCase());
    const onTitle = `t.title ILIKE ${p} OR t.subtitle ILIKE ${p} OR t.author ILIKE ${p} OR t.code ILIKE ${p}
      OR t.call_no ILIKE ${p} OR regexp_replace(COALESCE(t.isbn, ''), '[^0-9X]', '', 'g') = ${plain}`;
    where.push(
      level === 'copy'
        ? // eslint-disable-next-line no-restricted-syntax -- fixed fragments of the register catalogue; values are bound
          `(${onTitle} OR x.accession_no ILIKE ${p} OR upper(x.barcode) = ${plain}
            OR EXISTS (SELECT 1 FROM library_accession_changes h WHERE h.copy_id = x.id AND h.old_no ILIKE ${p}))`
        : // eslint-disable-next-line no-restricted-syntax -- fixed fragments of the register catalogue; values are bound
          `(${onTitle} OR array_to_string(t.keywords, ' ') ILIKE ${p}
            OR EXISTS (SELECT 1 FROM library_copies a WHERE a.title_id = t.id
                        AND (a.accession_no ILIKE ${p} OR upper(a.barcode) = ${plain}
                             OR EXISTS (SELECT 1 FROM library_accession_changes h
                                         WHERE h.copy_id = a.id AND h.old_no ILIKE ${p}))))`,
    );
  }
  const fields = byKey(level);
  for (const flt of v.filters) {
    const fd = fields.get(flt.key);
    if (!fd) throw bad(`Unknown field ${flt.key}`);
    const e = fd.sql[level]!;
    const vals = (flt.values ?? []).map((x) => x.trim()).filter((x) => x !== '');
    // a value as the field's type: a number or a day; text compares without case
    const typed = (x: string) => {
      if (fd.type === 'number') {
        if (!/^-?\d+(\.\d+)?$/.test(x)) throw bad(`${fd.label}: ${x} is not a number`);
        return `${arg(Number(x))}::numeric`;
      }
      if (fd.type === 'date') {
        const d = /^(\d{2})-(\d{2})-(\d{4})$/.exec(x);
        const iso = d ? `${d[3]!}-${d[2]!}-${d[1]!}` : x;
        if (!DAY.test(iso)) throw bad(`${fd.label}: ${x} is not a date`);
        return `${arg(iso)}::date`;
      }
      return `lower(${arg(x)})`;
    };
    const val = fd.type === 'text' ? `lower((${e})::text)` : `(${e})`;
    const need = (n: number) => {
      if (vals.length < n) throw bad(`${fd.label}: give a value`);
    };
    switch (flt.op) {
      case 'empty':
        where.push(`((${e}) IS NULL OR (${e})::text = '')`);
        break;
      case 'not_empty':
        where.push(`((${e}) IS NOT NULL AND (${e})::text <> '')`);
        break;
      case 'eq':
        need(1);
        where.push(`${val} = ${typed(vals[0]!)}`);
        break;
      case 'neq':
        need(1);
        // eslint-disable-next-line no-restricted-syntax -- fixed fragments of the register catalogue; values are bound
        where.push(`(${val} IS DISTINCT FROM ${typed(vals[0]!)})`);
        break;
      case 'in':
        need(1);
        where.push(`${val} IN (${vals.map(typed).join(', ')})`);
        break;
      case 'not_in':
        need(1);
        where.push(`(${val} IS NULL OR ${val} NOT IN (${vals.map(typed).join(', ')}))`);
        break;
      case 'contains':
      case 'starts': {
        need(1);
        const x = vals[0]!.replace(/[\\%_]/g, (c) => `\\${c}`);
        where.push(`(${e})::text ILIKE ${arg(flt.op === 'contains' ? `%${x}%` : `${x}%`)}`);
        break;
      }
      case 'between':
        need(2);
        where.push(`${val} BETWEEN ${typed(vals[0]!)} AND ${typed(vals[1]!)}`);
        break;
      case 'gte':
        need(1);
        where.push(`${val} >= ${typed(vals[0]!)}`);
        break;
      case 'lte':
        need(1);
        where.push(`${val} <= ${typed(vals[0]!)}`);
        break;
      default:
        throw bad(`${fd.label}: unknown condition ${flt.op}`);
    }
  }
  return where.join(' AND ');
}

/** The ORDER BY of a view: the sort picked (natural accession order), then the level's first column. */
export function registerOrder(level: RegisterLevel, v: RegisterView): string {
  const fields = byKey(level);
  const parts: string[] = [];
  const add = (key: string, dir: 'asc' | 'desc') => {
    const fd = fields.get(key);
    if (!fd) throw bad(`Unknown field ${key}`);
    const d = dir === 'desc' ? 'DESC' : 'ASC';
    for (const s of fd.sortSql?.[level] ?? [
      fd.type === 'text' ? `lower((${fd.sql[level]!})::text)` : fd.sql[level]!,
    ])
      parts.push(`${s} ${d} NULLS LAST`);
  };
  for (const s of v.sort) add(s.key, s.dir);
  if (!v.sort.some((s) => s.key === PRIMARY[level])) add(PRIMARY[level], 'asc');
  parts.push(level === 'copy' ? 'x.id' : 't.id');
  return parts.join(', ');
}

/** The SELECT list: the id, the given fields under their keys. */
export function registerSelect(level: RegisterLevel, keys: string[]): string {
  const fields = byKey(level);
  return [
    `${level === 'copy' ? 'x.id' : 't.id'}::text AS "__id"`,
    ...(level === 'copy' ? [`t.id::text AS "__title_id"`, `x.status::text AS "__status"`] : []),
    ...[...new Set(keys)].map((k) => {
      const fd = fields.get(k);
      if (!fd) throw bad(`Unknown field ${k}`);
      const e = fd.sql[level]!;
      return `${fd.type === 'date' ? `(${e})::text` : fd.type === 'number' ? `(${e})::float8` : `(${e})::text`} AS "${k}"`;
    }),
  ].join(', ');
}

const OPS: Record<string, string> = {
  eq: 'is',
  neq: 'is not',
  in: 'is one of',
  not_in: 'is none of',
  contains: 'has',
  starts: 'starts with',
  empty: 'is empty',
  not_empty: 'is filled',
  between: 'between',
  gte: 'from',
  lte: 'up to',
};
const STATUS_WORDS: Record<RegisterLevel, Record<string, string>> = {
  copy: {
    all: 'Every copy',
    in_stock: 'In stock',
    available: 'On the shelf',
    issued: 'Issued',
    overdue: 'Overdue',
    damaged: 'Damaged',
    lost: 'Lost',
    withdrawn: 'Withdrawn',
    sold: 'Sold',
  },
  title: {
    all: 'Every title',
    available: 'A copy on the shelf',
    out: 'Every copy out',
    none: 'No copies',
  },
};

/** A view in words (for the About sheet and the PDF): the status, the search, each filter. */
export function registerViewText(
  level: RegisterLevel,
  v: Pick<RegisterView, 'status' | 'search' | 'filters'>,
): string {
  const fields = byKey(level);
  return [
    STATUS_WORDS[level][v.status] ?? v.status,
    v.search?.trim() ? `search "${v.search.trim()}"` : null,
    ...v.filters.map((x) => {
      const label = fields.get(x.key)?.label ?? x.key;
      const vals = (x.values ?? []).filter(Boolean);
      return `${label} ${OPS[x.op] ?? x.op}${vals.length ? ` ${vals.join(x.op === 'between' ? ' and ' : ', ')}` : ''}`;
    }),
  ]
    .filter(Boolean)
    .join('; ');
}
