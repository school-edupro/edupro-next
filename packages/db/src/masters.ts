/**
 * Master-data registry. One definition per master gives every master the same treatment: a paged,
 * filterable grid; Excel / CSV / PDF export through the export pipeline (each master is also a
 * dataset); an Excel / CSV upload template; bulk upload with a dry run and a commit (upsert on the
 * natural key); bulk update of one field on many rows; and, for year-bound masters, a clone from one
 * academic year to the next.
 *
 * Every master keeps its own table, permissions and school_id row-level security: the queries below
 * run under the caller's tenant context, so a school only ever sees and writes its own masters.
 * Bound parameters only.
 */
import { PROFILE_LIST_DEFAULTS } from './student-fields';
import type { DatasetColumn, DatasetDefinition, DatasetQuery } from './datasets';

export type MasterFieldType = 'text' | 'number' | 'date' | 'boolean' | 'select' | 'ref';

export interface MasterField {
  /** Column of the master's table (and the key in rows, templates and uploads). */
  key: string;
  header: string;
  type: MasterFieldType;
  required?: boolean;
  /** Part of the natural key: identifies the row on upload and can never change through the grid. */
  identity?: boolean;
  /** Not accepted from the grid or uploads (derived or system-owned). */
  readOnly?: boolean;
  /** Allowed values for `select`. */
  options?: readonly string[];
  /** For `ref`: the value in files and on screen is `lookup.column` of `lookup.table` (e.g. a class code); the stored value is its id. */
  lookup?: {
    table: string;
    column: string;
    yearScoped?: boolean;
    /** The column that names the row for people (default `name`): shown beside the value in drop-downs. */
    labelColumn?: string;
    /** The grid and the exports show "value · label" (a crew code alone says little). */
    showLabel?: boolean;
    /** Shown and typed by the name with the value after it, "English (ENG)": the grid, the form and the Excel list. Uploads take that, the name alone or the code alone. */
    nameFirst?: boolean;
    /** A fixed condition on the lookup table (alias `t`) that narrows the options, e.g. drivers only. */
    filter?: string;
    /** The option list is narrowed by a parent lookup (cities by state → country): `column` on the lookup table, `valueColumn` on the parent table. */
    parent?: { table: string; column: string; valueColumn: string; label: string };
  };
  /** Digits after the decimal point for `number` (0 = integer). */
  scale?: number;
  min?: number;
  max?: number;
  maxLength?: number;
  /** Regular expression (anchored) a `text` value must match; `patternHelp` explains it. */
  pattern?: string;
  patternHelp?: string;
  /** The kind of text box: the browser checks an email or a link and shows the right keyboard. */
  input?: 'email' | 'tel' | 'url';
  /** This date may not be before that other date field of the row (a "to" after its "from"). */
  notBefore?: string;
  /** This value must come after that other field of the row (a period ends after it starts). */
  after?: string;
  /** A ref to the master's own table may not point at the row itself (a subject is not part of itself). */
  notSelf?: boolean;
  /** `lat`: the form shows a map to search a place and drop the pin (fills this field and `lng`). */
  widget?: 'map';
  width?: number;
  /** Offered in the bulk-update control. */
  bulk?: boolean;
  /** `text` stored as TEXT[]: files and the grid show a comma-separated list. */
  array?: boolean;
  help?: string;
}

export type MasterGroup =
  | 'fees'
  | 'academics'
  | 'attendance'
  | 'transport'
  | 'exams'
  | 'communication'
  | 'library'
  | 'system';

/**
 * The key fields the edit form may change: every one where the definition says so (`rekey`), and on the
 * transport set-up the ones picked from a list (the route of a stop). A typed code never changes: uploads
 * and the history match on it.
 */
export function editableKeys(def: Pick<MasterDefinition, 'rekey' | 'group' | 'fields'>): string[] {
  return def.fields
    .filter(
      (f) =>
        f.identity &&
        (def.rekey === true ||
          (def.group === 'transport' && (f.type === 'ref' || f.type === 'select'))),
    )
    .map((f) => f.key);
}

export interface MasterDefinition {
  id: string;
  title: string;
  group: MasterGroup;
  table: string;
  permission: { view: string; manage: string };
  /** Rows carry academic_year_id: the grid, uploads and the clone work within the working year. */
  yearScoped?: boolean;
  /** Natural key columns (after ref resolution), e.g. ['code'] or ['class_id', 'sequence']. */
  naturalKey: string[];
  /** The ON CONFLICT target that matches the table's unique index for the natural key. */
  conflict: string;
  /** The edit form may change the key columns too (a mapping moved to another route, bus or trip): the row is updated by its id. */
  rekey?: boolean;
  fields: MasterField[];
  /** Soft status column, when the master has one (rows are never deleted through the grid). */
  status?: { column: string; values: readonly string[] };
  /** Columns the grid searches with `q`. */
  search: string[];
  /** SELECT for the grid and the export: must return id::text plus every field key (refs as their lookup value). */
  list: (p: MasterListParams) => DatasetQuery;
  /** Year-to-year clone (year-scoped masters only): copies rows of `fromYearId` into `toYearId`, skipping existing keys. */
  clone?: (fromYearId: string, toYearId: string) => DatasetQuery;
  maxRows?: number;
  /** Short guidance shown on the upload card. */
  uploadHelp?: string;
  /** Also a tab of these setup pages (transport slabs: a fee master the transport office fills too). */
  alsoIn?: MasterGroup[];
  /** Position among the tabs of its setup page (lower first; the default keeps the registry order). */
  order?: number;
  /** A row opens its own screen: the path with `{id}` (a route's stops and pupils, a vehicle's log). */
  detail?: { path: string; label: string };
  /**
   * Not listed on its setup page because a dedicated screen owns the data (communication templates:
   * the Template master); the grid stays reachable from that screen for Excel import and export.
   */
  hidden?: boolean;
}

export interface MasterListParams {
  q: string | null;
  status: string | null;
  academicYearId: string | null;
  /** Free filters keyed by field: equality on the stored column. */
  filters: Record<string, string>;
}

export const MASTER_GROUPS: Record<MasterGroup, { title: string; kicker: string }> = {
  fees: { title: 'Fees setup', kicker: 'Fees' },
  academics: { title: 'Academics setup', kicker: 'Academics' },
  attendance: { title: 'Attendance setup', kicker: 'Attendance' },
  transport: { title: 'Transport setup', kicker: 'Transport' },
  exams: { title: 'Exams setup', kicker: 'Exams' },
  communication: { title: 'Communication setup', kicker: 'Communication' },
  library: { title: 'Library catalogue', kicker: 'Library' },
  system: { title: 'System setup', kicker: 'System' },
};

/** Columns a master shows: its fields (refs by their lookup value), then the status. */
export function masterColumns(def: MasterDefinition): DatasetColumn[] {
  const cols: DatasetColumn[] = def.fields.map((f) => ({
    key: f.key,
    header: f.header,
    type:
      f.type === 'number'
        ? 'number'
        : f.type === 'date'
          ? 'date'
          : f.type === 'boolean'
            ? 'text'
            : 'text',
    width: f.width ?? (f.type === 'number' || f.type === 'date' ? 12 : 20),
  }));
  if (def.status) cols.push({ key: def.status.column, header: 'Status', width: 10 });
  return cols;
}

/** Every master is a dataset, so exports (xlsx, csv, pdf) need nothing master-specific. */
export function masterToDataset(def: MasterDefinition): DatasetDefinition {
  return {
    id: `master_${def.id}`,
    title: def.title,
    permission: def.permission.view,
    maxRows: def.maxRows ?? 20_000,
    columns: masterColumns(def),
    query: (params) =>
      def.list({
        q: typeof params.q === 'string' && params.q.trim() ? params.q.trim() : null,
        status: typeof params.status === 'string' && params.status ? params.status : null,
        academicYearId:
          typeof params.academicYearId === 'string' && params.academicYearId
            ? params.academicYearId
            : null,
        filters:
          params.filters && typeof params.filters === 'object'
            ? (params.filters as Record<string, string>)
            : {},
      }),
  };
}

/** The value columns an upload or the grid may write (identity columns included, read-only ones excluded). */
export function writableFields(def: MasterDefinition): MasterField[] {
  return def.fields.filter((f) => !f.readOnly);
}

/** Stored column for a field: refs store `<key>` as given (the definition names the id column as the key). */
export const storedColumn = (f: MasterField): string => f.key;

/**
 * Upsert statement for one validated row: INSERT ... ON CONFLICT (natural key) DO UPDATE on the
 * non-identity columns. The row object holds stored values (refs already resolved to ids).
 */
export function upsertSql(
  def: MasterDefinition,
  keys: string[],
): DatasetQuery & { keys: string[] } {
  const cols = ['school_id', ...(def.yearScoped ? ['academic_year_id'] : []), ...keys];
  const values = [
    'app.current_school_id()',
    ...(def.yearScoped ? ['$' + String(keys.length + 1) + '::bigint'] : []),
    ...keys.map((_, i) => `$${i + 1}`),
  ];
  const identity = new Set([...def.naturalKey, 'school_id', 'academic_year_id']);
  const updates = keys.filter((k) => !identity.has(k)).map((k) => `${k} = EXCLUDED.${k}`);
  const set = updates.length ? updates.join(', ') : `${keys[0]} = EXCLUDED.${keys[0]}`;
  return {
    keys,
    // eslint-disable-next-line no-restricted-syntax -- table and column names come from the registry definitions; values are bound
    text: `INSERT INTO ${def.table} (${cols.join(', ')}) VALUES (${values.join(', ')})
           ON CONFLICT ${def.conflict} DO UPDATE SET ${set}
           RETURNING id::text, (xmax = 0) AS inserted`,
    values: [],
  };
}

// ---- list builder ---------------------------------------------------------------------------------
interface ListSpec {
  table: string;
  fields: MasterField[];
  yearScoped?: boolean;
  softDelete?: boolean;
  status?: string;
  search: string[];
  orderBy: string;
}

/**
 * The grid / export SELECT for a master: fields as columns, refs joined to show their lookup value,
 * arrays flattened, filters bound. Refs get aliases r1, r2 ...; the table is `t`.
 */
function buildList(spec: ListSpec): (p: MasterListParams) => DatasetQuery {
  return (p) => {
    const values: unknown[] = [];
    const bind = (v: unknown) => {
      values.push(v);
      return `$${values.length}`;
    };
    const joins: string[] = [];
    const cols = ['t.id::text'];
    spec.fields.forEach((f, i) => {
      if (f.type === 'ref' && f.lookup) {
        const a = `r${i + 1}`;
        // eslint-disable-next-line no-restricted-syntax -- table and column names come from the registry definitions; values are bound
        joins.push(`LEFT JOIN ${f.lookup.table} ${a} ON ${a}.id = t.${f.key}`);
        const label = `${a}.${f.lookup.labelColumn ?? 'name'}::text`;
        cols.push(
          f.lookup.nameFirst
            ? `CASE WHEN ${a}.id IS NULL THEN NULL ELSE ${label} || ' (' || ${a}.${f.lookup.column}::text || ')' END AS ${f.key}`
            : f.lookup.showLabel
              ? `concat_ws(' · ', ${a}.${f.lookup.column}::text, ${label}) AS ${f.key}`
              : `${a}.${f.lookup.column}::text AS ${f.key}`,
        );
      } else if (f.array) cols.push(`array_to_string(t.${f.key}, ',') AS ${f.key}`);
      else if (f.type === 'date') cols.push(`t.${f.key}::text AS ${f.key}`);
      else cols.push(`t.${f.key}::text AS ${f.key}`);
    });
    if (spec.status) cols.push(`t.${spec.status}::text AS ${spec.status}`);
    const where: string[] = [];
    if (spec.softDelete) where.push('t.deleted_at IS NULL');
    if (spec.yearScoped) {
      const y = bind(p.academicYearId);
      where.push(`(${y}::bigint IS NULL OR t.academic_year_id = ${y}::bigint)`);
    }
    if (spec.status && p.status) where.push(`t.${spec.status}::text = ${bind(p.status)}`);
    if (p.q) {
      const q = bind(`%${p.q}%`);
      where.push(`(${spec.search.map((c) => `${c}::text ILIKE ${q}`).join(' OR ')})`);
    }
    for (const [k, v] of Object.entries(p.filters)) {
      const f = spec.fields.find((x) => x.key === k);
      if (!f || v === '' || v === undefined) continue;
      where.push(`t.${f.key}::text = ${bind(String(v))}`);
    }
    return {
      // eslint-disable-next-line no-restricted-syntax -- table and column names come from the registry definitions; values are bound
      text: `SELECT ${cols.join(', ')} FROM ${spec.table} t ${joins.join(' ')}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY ${spec.orderBy}`,
      values,
    };
  };
}

const STATUS = { column: 'status', values: ['active', 'inactive'] as const };
const code = (header = 'Code'): MasterField => ({
  key: 'code',
  header,
  type: 'text',
  required: true,
  identity: true,
  maxLength: 40,
  width: 12,
});
const name = (header = 'Name'): MasterField => ({
  key: 'name',
  header,
  type: 'text',
  required: true,
  maxLength: 120,
  width: 28,
});
const order = (key = 'sort_order', header = 'Order'): MasterField => ({
  key,
  header,
  type: 'number',
  scale: 0,
  min: 0,
  max: 9999,
  width: 8,
  bulk: true,
});
const classRef = (key: string, header: string, identity = false): MasterField => ({
  key,
  header,
  type: 'ref',
  lookup: { table: 'classes', column: 'code' },
  identity,
  required: identity,
  width: 10,
});
const time = (key: string, header: string, required = false): MasterField => ({
  key,
  header,
  type: 'text',
  required,
  maxLength: 8,
  width: 8,
  pattern: '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$',
  patternHelp: 'a time like 07:30 (24-hour)',
  help: 'HH:MM (24-hour)',
});

/** A person's name: letters of any script, spaces, dots, apostrophes and hyphens. */
const PERSON = "^[A-Za-z\\u0900-\\u097F][A-Za-z\\u0900-\\u097F .'\\-]+$";
/** A code people type and read: capital letters, digits, hyphen, slash or underscore. */
const tcode = (header = 'Code'): MasterField => ({
  ...code(header),
  maxLength: 20,
  pattern: '^[A-Z0-9][A-Z0-9\\/_\\-]*$',
  patternHelp: 'capital letters and digits (hyphen, slash or underscore allowed), without spaces',
});
/** Academics set-up: a code is letters and digits (hyphen, slash, dot or underscore allowed), no spaces. */
const acode = (header = 'Code'): MasterField => ({
  ...code(header),
  maxLength: 20,
  pattern: '^[A-Za-z0-9][A-Za-z0-9\\/_.\\-]*$',
  patternHelp: 'letters and digits (hyphen, slash, dot or underscore allowed), without spaces',
});
/** A name people read: starts with a letter or a digit and is not only signs. */
const aname = (header = 'Name', maxLength = 120): MasterField => ({
  ...name(header),
  maxLength,
  pattern: "^[A-Za-z0-9\\u0900-\\u097F][A-Za-z0-9\\u0900-\\u097F .,&'()\\/+\\-]*$",
  patternHelp: "a name that starts with a letter or a digit (. , & ' ( ) / + - allowed)",
});
const mobile = (key = 'mobile', header = 'Mobile'): MasterField => ({
  key,
  header,
  type: 'text',
  input: 'tel',
  maxLength: 10,
  width: 12,
  pattern: '^[6-9][0-9]{9}$',
  patternHelp: 'a 10-digit mobile number',
});
const url = (key: string, header: string): MasterField => ({
  key,
  header,
  type: 'text',
  input: 'url',
  maxLength: 300,
  width: 28,
  pattern: '^https?://[^\\s]+$',
  patternHelp: 'a link that starts with http:// or https://',
});
/** One of the crew with that role, on the route-vehicle mapping. */
const crew = (key: string, header: string, role: string, required = false): MasterField => ({
  key,
  header,
  type: 'ref',
  lookup: {
    table: 'transport_drivers',
    column: 'code',
    showLabel: true,
    // eslint-disable-next-line no-restricted-syntax -- the role is one of three constants above
    filter: `t.role = '${role}' AND t.status = 'active'`,
  },
  required,
  width: 22,
});

const master = (
  d: Omit<MasterDefinition, 'list' | 'search'> & { search: string[]; orderBy: string },
): MasterDefinition => ({
  ...d,
  list: buildList({
    table: d.table,
    fields: d.fields,
    yearScoped: d.yearScoped,
    softDelete: SOFT_DELETE.has(d.table),
    status: d.status?.column,
    search: d.search,
    orderBy: d.orderBy,
  }),
});

/** Tables with deleted_at (their unique indexes are partial, so the conflict target says so too). */
export const SOFT_DELETE = new Set([
  'fee_heads',
  'classes',
  'class_sections',
  'subjects',
  'transport_routes',
  'transport_vehicles',
  'transport_drivers',
  'exam_types',
  'grade_scales',
  'indicator_sets',
  'comms_templates',
  'comms_groups',
  'campuses',
]);

/** Year-to-year copy of rows keyed on `keyCols`, with optional per-column expressions for the target. */
const cloneSql =
  (table: string, cols: string[], keyCols: string[], shift: Record<string, string> = {}) =>
  (fromYearId: string, toYearId: string): DatasetQuery => ({
    // eslint-disable-next-line no-restricted-syntax -- table and column names come from the registry definitions; values are bound
    text: `INSERT INTO ${table} (school_id, academic_year_id, ${cols.join(', ')})
           SELECT s.school_id, $2::bigint, ${cols.map((c) => shift[c] ?? `s.${c}`).join(', ')}
             FROM ${table} s
            WHERE s.academic_year_id = $1::bigint
              AND NOT EXISTS (SELECT 1 FROM ${table} d WHERE d.academic_year_id = $2::bigint AND ${keyCols.map((k) => `d.${k} = s.${k}`).join(' AND ')})`,
    values: [fromYearId, toYearId],
  });

// ---- the registry --------------------------------------------------------------------------------
export const MASTERS: MasterDefinition[] = [
  // ---- fees ----
  master({
    id: 'fee_heads',
    title: 'Fee heads',
    group: 'fees',
    table: 'fee_heads',
    permission: { view: 'fees.master.view', manage: 'fees.master.manage' },
    naturalKey: ['code'],
    conflict: '(school_id, code) WHERE deleted_at IS NULL',
    fields: [
      code(),
      name(),
      {
        key: 'kind',
        header: 'Kind',
        type: 'select',
        required: true,
        options: ['regular', 'transport', 'opening_balance', 'late_fee', 'misc'],
        width: 14,
        bulk: true,
      },
      {
        key: 'ledger',
        header: 'Ledger',
        type: 'select',
        required: true,
        options: ['school', 'hostel', 'misc', 'admission'],
        width: 10,
        bulk: true,
      },
      { key: 'is_optional', header: 'Optional', type: 'boolean', width: 8, bulk: true },
      { key: 'refundable', header: 'Refundable', type: 'boolean', width: 8, bulk: true },
      // heads sharing this name print as one line on the bill and the receipt
      { key: 'print_group', header: 'Prints as', type: 'text', maxLength: 80, width: 18 },
      { key: 'tax_certificate', header: 'Tax certificate', type: 'boolean', width: 10, bulk: true },
      order(),
    ],
    status: STATUS,
    search: ['t.code', 't.name'],
    orderBy: 't.sort_order, t.code',
    uploadHelp: 'One row per head; the code identifies it. Kind and ledger use the listed values.',
  }),
  master({
    id: 'fee_periods',
    title: 'Month–instalment mapping',
    group: 'fees',
    table: 'fee_periods',
    permission: { view: 'fees.master.view', manage: 'fees.master.manage' },
    yearScoped: true,
    naturalKey: ['sequence'],
    conflict: '(academic_year_id, sequence)',
    fields: [
      {
        key: 'sequence',
        header: 'Sequence',
        type: 'number',
        scale: 0,
        min: 1,
        max: 12,
        required: true,
        identity: true,
        width: 8,
      },
      name('Month name'),
      {
        key: 'month',
        header: 'Month (1-12)',
        type: 'number',
        scale: 0,
        min: 1,
        max: 12,
        required: true,
        width: 8,
      },
      {
        key: 'year',
        header: 'Year',
        type: 'number',
        scale: 0,
        min: 2000,
        max: 2100,
        required: true,
        width: 8,
      },
      {
        key: 'instalment',
        header: 'Instalment / quarter',
        type: 'number',
        scale: 0,
        min: 1,
        max: 12,
        required: true,
        width: 10,
        bulk: true,
      },
      { key: 'due_on', header: 'Due on', type: 'date', required: true, width: 12, bulk: true },
    ],
    search: ['t.name'],
    orderBy: 't.sequence',
    clone: cloneSql(
      'fee_periods',
      ['sequence', 'name', 'month', 'year', 'instalment', 'due_on'],
      ['sequence'],
      {
        year: 's.year + 1',
        due_on: "(s.due_on + interval '1 year')::date",
      },
    ),
    uploadHelp: 'Twelve rows of the working year: month → instalment (quarter) and due date.',
  }),
  master({
    id: 'transport_slabs',
    title: 'Transport slabs',
    group: 'fees',
    alsoIn: ['transport'],
    order: 50,
    table: 'transport_slabs',
    permission: { view: 'fees.master.view', manage: 'fees.master.manage' },
    yearScoped: true,
    naturalKey: ['code'],
    conflict: '(academic_year_id, code)',
    fields: [
      code(),
      name(),
      { key: 'distance_from_km', header: 'From km', type: 'number', scale: 1, min: 0, width: 8 },
      { key: 'distance_to_km', header: 'To km', type: 'number', scale: 1, min: 0, width: 8 },
      {
        key: 'monthly_amount',
        header: 'Monthly amount',
        type: 'number',
        scale: 2,
        min: 0,
        required: true,
        width: 12,
        bulk: true,
      },
    ],
    search: ['t.code', 't.name'],
    orderBy: 't.distance_from_km NULLS LAST, t.code',
    clone: cloneSql(
      'transport_slabs',
      ['code', 'name', 'distance_from_km', 'distance_to_km', 'monthly_amount'],
      ['code'],
    ),
  }),
  master({
    id: 'fee_discounts',
    title: 'Discounts and concessions',
    group: 'fees',
    table: 'fee_discounts',
    permission: { view: 'fees.master.view', manage: 'fees.master.manage' },
    yearScoped: true,
    naturalKey: ['code'],
    conflict: '(academic_year_id, code)',
    fields: [code(), name()],
    status: STATUS,
    search: ['t.code', 't.name'],
    orderBy: 't.code',
    // the type and its head lines travel to the new year together
    clone: (fromYearId: string, toYearId: string): DatasetQuery => ({
      text: `WITH ins AS (
               INSERT INTO fee_discounts (school_id, academic_year_id, code, name, status)
               SELECT s.school_id, $2::bigint, s.code, s.name, s.status
                 FROM fee_discounts s
                WHERE s.academic_year_id = $1::bigint
                  AND NOT EXISTS (SELECT 1 FROM fee_discounts d WHERE d.academic_year_id = $2::bigint AND d.code = s.code)
               RETURNING id, school_id, code
             ), lines AS (
               INSERT INTO fee_discount_lines (school_id, discount_id, head_id, percent, amount)
               SELECT ins.school_id, ins.id, l.head_id, l.percent, l.amount
                 FROM ins JOIN fee_discounts s ON s.code = ins.code AND s.academic_year_id = $1::bigint
                 JOIN fee_discount_lines l ON l.discount_id = s.id
             )
             SELECT 1 FROM ins`,
      values: [fromYearId, toYearId],
    }),
  }),
  master({
    id: 'banks',
    title: 'Banks',
    group: 'fees',
    table: 'banks',
    permission: { view: 'fees.master.view', manage: 'fees.master.manage' },
    naturalKey: ['code'],
    conflict: '(school_id, code)',
    fields: [
      code(),
      name('Bank name'),
      { key: 'branch', header: 'Branch', type: 'text', maxLength: 120, width: 20 },
      {
        key: 'ifsc',
        header: 'IFSC',
        type: 'text',
        maxLength: 11,
        width: 12,
        pattern: '^[A-Z]{4}0[A-Z0-9]{6}$',
        patternHelp: 'four letters, a zero, six letters or digits (e.g. SBIN0001234)',
      },
      {
        key: 'account_label',
        header: 'Account label',
        type: 'text',
        maxLength: 60,
        width: 16,
        help: 'a nickname, never the account number',
      },
      { key: 'address', header: 'Branch address', type: 'text', maxLength: 300, width: 30 },
    ],
    status: STATUS,
    search: ['t.code', 't.name', 't.branch', 't.ifsc'],
    orderBy: 't.name',
  }),
  master({
    id: 'bank_accounts',
    title: 'School bank accounts',
    group: 'fees',
    table: 'school_bank_accounts',
    permission: { view: 'fees.master.view', manage: 'fees.master.manage' },
    naturalKey: ['account_no'],
    conflict: '(school_id, account_no)',
    fields: [
      {
        key: 'bank_id',
        header: 'Bank code',
        type: 'ref',
        lookup: { table: 'banks', column: 'code' },
        required: true,
        width: 10,
      },
      {
        key: 'account_name',
        header: 'Account name',
        type: 'text',
        required: true,
        maxLength: 120,
        width: 24,
      },
      {
        key: 'account_no',
        header: 'Account number',
        type: 'text',
        required: true,
        identity: true,
        maxLength: 24,
        width: 18,
        pattern: '^[0-9]{9,18}$',
        patternHelp: '9 to 18 digits',
      },
      {
        key: 'ifsc',
        header: 'IFSC',
        type: 'text',
        required: true,
        maxLength: 11,
        width: 12,
        pattern: '^[A-Z]{4}0[A-Z0-9]{6}$',
        patternHelp: 'four letters, a zero, six letters or digits (e.g. SBIN0001234)',
      },
      { key: 'branch', header: 'Branch', type: 'text', maxLength: 120, width: 18 },
      { key: 'address', header: 'Branch address', type: 'text', maxLength: 300, width: 30 },
      {
        key: 'purpose',
        header: 'Purpose',
        type: 'select',
        options: ['school', 'hostel', 'misc', 'admission', 'any'] as const,
        required: true,
        width: 10,
        bulk: true,
      },
      { key: 'is_default', header: 'Default', type: 'boolean', width: 8, bulk: true },
    ],
    status: STATUS,
    search: ['t.account_name', 't.account_no', 't.ifsc', 't.branch'],
    orderBy: 't.is_default DESC, t.account_name',
  }),
  // ---- system: student profile drop-down lists ----
  master({
    id: 'profile_lists',
    title: 'Student profile lists',
    group: 'system',
    table: 'profile_lists',
    permission: { view: 'people.student.view', manage: 'platform.settings.edit' },
    naturalKey: ['list_code', 'value'],
    conflict: '(school_id, list_code, value)',
    fields: [
      {
        key: 'list_code',
        header: 'List',
        type: 'select',
        required: true,
        identity: true,
        options: Object.keys(PROFILE_LIST_DEFAULTS),
        width: 16,
        help: 'Which drop-down this value belongs to (Religion, Occupation, Income …)',
      },
      {
        key: 'value',
        header: 'Value',
        type: 'text',
        required: true,
        identity: true,
        maxLength: 80,
        width: 28,
      },
      { key: 'sort_order', header: 'Order', type: 'number', min: 0, max: 9999, width: 8 },
    ],
    status: STATUS,
    search: ['t.list_code', 't.value'],
    orderBy: 't.list_code, t.sort_order, t.value',
  }),
  // ---- system: geography ----
  master({
    id: 'countries',
    title: 'Countries',
    group: 'system',
    table: 'countries',
    permission: { view: 'platform.school.view', manage: 'platform.settings.edit' },
    naturalKey: ['code'],
    conflict: '(school_id, code)',
    fields: [
      {
        key: 'code',
        header: 'Code',
        type: 'text',
        required: true,
        identity: true,
        maxLength: 2,
        width: 6,
        pattern: '^[A-Z]{2}$',
        patternHelp: 'ISO two-letter code (IN, NP, AE)',
      },
      name('Country'),
      {
        key: 'dial_code',
        header: 'Dial code',
        type: 'text',
        maxLength: 6,
        width: 8,
        pattern: '^\\+[0-9]{1,4}$',
        patternHelp: 'e.g. +91',
      },
    ],
    status: STATUS,
    search: ['t.code', 't.name'],
    orderBy: 't.name',
  }),
  master({
    id: 'states',
    title: 'States',
    group: 'system',
    table: 'states',
    permission: { view: 'platform.school.view', manage: 'platform.settings.edit' },
    naturalKey: ['code'],
    conflict: '(school_id, code)',
    fields: [
      {
        key: 'country_id',
        header: 'Country code',
        type: 'ref',
        lookup: { table: 'countries', column: 'code' },
        required: true,
        width: 8,
      },
      {
        key: 'code',
        header: 'Code',
        type: 'text',
        required: true,
        identity: true,
        maxLength: 3,
        width: 6,
        pattern: '^[A-Z]{2,3}$',
        patternHelp: 'two or three letters (UP, DL, CH)',
      },
      name('State'),
      {
        key: 'gst_code',
        header: 'GST code',
        type: 'text',
        maxLength: 2,
        width: 8,
        pattern: '^[0-9]{2}$',
        patternHelp: 'two digits (09 for Uttar Pradesh)',
      },
    ],
    status: STATUS,
    search: ['t.code', 't.name'],
    orderBy: 't.name',
  }),
  master({
    id: 'cities',
    title: 'Cities',
    group: 'system',
    table: 'cities',
    permission: { view: 'platform.school.view', manage: 'platform.settings.edit' },
    naturalKey: ['state_id', 'name'],
    conflict: '(state_id, name)',
    fields: [
      {
        key: 'state_id',
        header: 'State code',
        type: 'ref',
        lookup: {
          table: 'states',
          column: 'code',
          parent: {
            table: 'countries',
            column: 'country_id',
            valueColumn: 'code',
            label: 'Country',
          },
        },
        required: true,
        identity: true,
        width: 8,
      },
      {
        key: 'name',
        header: 'City',
        type: 'text',
        required: true,
        identity: true,
        maxLength: 80,
        width: 20,
      },
      {
        key: 'pincode',
        header: 'PIN code',
        type: 'text',
        maxLength: 6,
        width: 8,
        pattern: '^[1-9][0-9]{5}$',
        patternHelp: 'six digits',
      },
    ],
    status: STATUS,
    search: ['t.name', 't.pincode'],
    orderBy: 't.name',
  }),
  // ---- academics ----
  master({
    id: 'classes',
    title: 'Classes',
    group: 'academics',
    order: 10,
    uploadHelp:
      'The classes of the school (Nursery, I, II … XII). The sections of a class are on the Sections tab.',
    table: 'classes',
    permission: { view: 'academics.class.view', manage: 'academics.class.edit' },
    naturalKey: ['code'],
    conflict: '(school_id, code) WHERE deleted_at IS NULL',
    fields: [acode('Class code'), aname('Class name', 60), order('display_order')],
    status: STATUS,
    search: ['t.code', 't.name'],
    orderBy: 't.display_order, t.code',
  }),
  master({
    id: 'class_sections',
    title: 'Sections',
    group: 'academics',
    order: 20,
    table: 'class_sections',
    permission: { view: 'academics.class_section.view', manage: 'academics.class_section.create' },
    yearScoped: true,
    naturalKey: ['class_id', 'name'],
    conflict: '(school_id, academic_year_id, class_id, name) WHERE deleted_at IS NULL',
    fields: [
      classRef('class_id', 'Class code', true),
      {
        key: 'name',
        header: 'Section',
        type: 'text',
        required: true,
        identity: true,
        maxLength: 10,
        width: 8,
        pattern: '^[A-Za-z0-9][A-Za-z0-9 \\-]*$',
        patternHelp: 'letters and digits, like A, B or A1',
      },
      {
        key: 'capacity',
        header: 'Capacity',
        type: 'number',
        scale: 0,
        min: 1,
        max: 500,
        width: 8,
        bulk: true,
      },
    ],
    status: STATUS,
    search: ['r1.code', 't.name'],
    orderBy: 'r1.display_order, r1.code, t.name',
    clone: cloneSql(
      'class_sections',
      ['class_id', 'campus_id', 'name', 'capacity', 'status'],
      ['class_id', 'name'],
    ),
  }),
  master({
    id: 'subjects',
    title: 'Subjects',
    group: 'academics',
    order: 30,
    table: 'subjects',
    permission: { view: 'academics.subject.view', manage: 'academics.subject.manage' },
    naturalKey: ['code'],
    conflict: '(school_id, code) WHERE deleted_at IS NULL',
    fields: [
      acode('Subject code'),
      aname('Subject name'),
      {
        key: 'kind',
        header: 'Kind',
        type: 'select',
        required: true,
        options: ['scholastic', 'co_scholastic', 'language', 'vocational'],
        width: 14,
        bulk: true,
      },
      {
        key: 'parent_id',
        header: 'Part of (subject)',
        type: 'ref',
        lookup: { table: 'subjects', column: 'code', labelColumn: 'name', nameFirst: true },
        notSelf: true,
        width: 26,
        bulk: true,
        help: 'For a teaching subject under a report-card subject: PHY, CHE and BIO are part of SCI. Blank for a subject on its own.',
      },
      order('display_order'),
    ],
    status: STATUS,
    search: ['t.code', 't.name'],
    orderBy: 't.display_order, t.code',
  }),
  master({
    id: 'timetable_periods',
    title: 'Timetable periods',
    group: 'academics',
    order: 50,
    table: 'timetable_periods',
    permission: { view: 'academics.timetable.view', manage: 'academics.timetable.manage' },
    naturalKey: ['number'],
    conflict: '(school_id, COALESCE(campus_id, 0), number)',
    fields: [
      {
        key: 'number',
        header: 'Period number',
        type: 'number',
        scale: 0,
        min: 1,
        max: 20,
        required: true,
        identity: true,
        width: 8,
      },
      aname('Period name', 60),
      time('starts_at', 'Starts at', true),
      { ...time('ends_at', 'Ends at', true), after: 'starts_at' },
      {
        key: 'kind',
        header: 'Kind',
        type: 'select',
        required: true,
        options: ['teaching', 'break', 'assembly', 'activity'],
        width: 10,
        bulk: true,
      },
    ],
    search: ['t.name'],
    orderBy: 't.number',
  }),
  master({
    id: 'holidays',
    title: 'Holidays',
    group: 'academics',
    order: 60,
    table: 'holidays',
    permission: { view: 'academics.calendar.view', manage: 'academics.calendar.manage' },
    yearScoped: true,
    naturalKey: ['name', 'starts_on'],
    conflict: '(school_id, academic_year_id, name, starts_on)',
    // a wrong name or date is corrected on the row itself
    rekey: true,
    fields: [
      { ...aname('Holiday'), identity: true },
      { key: 'starts_on', header: 'From', type: 'date', required: true, identity: true, width: 12 },
      {
        key: 'ends_on',
        header: 'To',
        type: 'date',
        required: true,
        width: 12,
        notBefore: 'starts_on',
        help: 'The same as From for a one-day holiday.',
      },
      {
        key: 'kind',
        header: 'Kind',
        type: 'select',
        required: true,
        options: ['holiday', 'vacation', 'working_day'],
        width: 12,
        bulk: true,
      },
      {
        key: 'applies_to',
        header: 'Applies to',
        type: 'select',
        required: true,
        options: ['everyone', 'students', 'employees'],
        width: 12,
        bulk: true,
      },
    ],
    search: ['t.name'],
    orderBy: 't.starts_on',
    clone: cloneSql(
      'holidays',
      ['campus_id', 'name', 'kind', 'starts_on', 'ends_on', 'applies_to'],
      ['name', 'starts_on'],
      {
        starts_on: "(s.starts_on + interval '1 year')::date",
        ends_on: "(s.ends_on + interval '1 year')::date",
      },
    ),
    uploadHelp: 'Dates shift by one year on clone; adjust the festival dates afterwards.',
  }),
  // ---- transport ----
  // The route comes first (everything else hangs on a route), then what a vehicle is, who owns it, the
  // vehicles, the crew, the slabs (a fee master, shown here too), the stoppages, each route's stops, and
  // which vehicle and crew run the route.
  master({
    id: 'transport_vehicle_types',
    title: 'Vehicle types',
    group: 'transport',
    order: 10,
    table: 'transport_vehicle_types',
    permission: { view: 'transport.fleet.view', manage: 'transport.fleet.manage' },
    naturalKey: ['code'],
    conflict: '(school_id, code)',
    fields: [
      tcode(),
      name('Vehicle type'),
      { key: 'seats', header: 'Seats', type: 'number', scale: 0, min: 1, max: 200, width: 8 },
    ],
    status: STATUS,
    search: ['t.code', 't.name'],
    orderBy: 't.name',
  }),
  master({
    id: 'transport_vendors',
    title: 'Vendors',
    group: 'transport',
    order: 20,
    table: 'transport_vendors',
    permission: { view: 'transport.fleet.view', manage: 'transport.fleet.manage' },
    naturalKey: ['code'],
    conflict: '(school_id, code)',
    fields: [
      tcode(),
      name('Vendor'),
      {
        key: 'contact_person',
        header: 'Contact person',
        type: 'text',
        maxLength: 80,
        width: 16,
        pattern: PERSON,
        patternHelp: 'a name in letters (dots, spaces and hyphens allowed)',
      },
      mobile(),
      {
        key: 'email',
        header: 'Email',
        type: 'text',
        input: 'email',
        maxLength: 120,
        width: 22,
        pattern: '^[^@\\s]+@[^@\\s]+\\.[A-Za-z]{2,}$',
        patternHelp: 'an email address like name@example.com',
      },
      { key: 'address', header: 'Address', type: 'text', maxLength: 300, width: 30 },
      {
        key: 'gst_no',
        header: 'GST no',
        type: 'text',
        maxLength: 15,
        width: 16,
        pattern: '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$',
        patternHelp: 'a 15-character GSTIN like 27ABCDE1234F1Z5 (capital letters)',
      },
    ],
    status: STATUS,
    search: ['t.code', 't.name', 't.contact_person', 't.mobile'],
    orderBy: 't.name',
  }),
  master({
    id: 'transport_vehicles',
    title: 'Vehicles',
    group: 'transport',
    order: 30,
    table: 'transport_vehicles',
    permission: { view: 'transport.fleet.view', manage: 'transport.fleet.manage' },
    naturalKey: ['reg_no'],
    conflict: '(school_id, reg_no) WHERE deleted_at IS NULL',
    detail: { path: '/transport/vehicles/{id}', label: 'Daily log' },
    fields: [
      {
        key: 'reg_no',
        header: 'Vehicle no',
        type: 'text',
        required: true,
        identity: true,
        maxLength: 13,
        width: 14,
        pattern: '^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}$|^[0-9]{2}BH[0-9]{4}[A-Z]{1,2}$',
        patternHelp: 'a registration number without spaces, like MH12AB1234 (capital letters)',
      },
      { key: 'name', header: 'Vehicle name', type: 'text', maxLength: 60, width: 16 },
      { key: 'make', header: 'Make', type: 'text', maxLength: 60, width: 14 },
      { key: 'model', header: 'Model', type: 'text', maxLength: 60, width: 14 },
      {
        key: 'vehicle_type_id',
        header: 'Vehicle type',
        type: 'ref',
        lookup: { table: 'transport_vehicle_types', column: 'code' },
        width: 12,
        bulk: true,
      },
      {
        key: 'category',
        header: 'Category',
        type: 'select',
        options: ['School owned', 'Vendor', 'Leased'],
        width: 12,
        bulk: true,
      },
      {
        key: 'vendor_id',
        header: 'Vendor',
        type: 'ref',
        lookup: { table: 'transport_vendors', column: 'code' },
        width: 12,
        bulk: true,
      },
      {
        key: 'capacity',
        header: 'Seats',
        type: 'number',
        scale: 0,
        min: 1,
        max: 200,
        width: 8,
        bulk: true,
      },
      {
        key: 'incharge_id',
        header: 'In-charge (employee)',
        type: 'ref',
        lookup: {
          table: 'employees',
          column: 'employee_code',
          labelColumn: 'display_name',
          showLabel: true,
          filter: "t.status = 'active'",
        },
        width: 22,
        help: 'The employee answerable for this vehicle; the phone number is the one on the employee record.',
      },
      { key: 'registration_date', header: 'Registration date', type: 'date', width: 12 },
      { key: 'insurance_expiry', header: 'Insurance valid till', type: 'date', width: 12 },
      { key: 'fitness_expiry', header: 'Fitness valid till', type: 'date', width: 12 },
      { key: 'permit_expiry', header: 'Permit valid till', type: 'date', width: 12 },
      { key: 'puc_expiry', header: 'PUC valid till', type: 'date', width: 12 },
      { key: 'rc_book', header: 'RC book', type: 'boolean', width: 8 },
      { key: 'ais_device', header: 'AIS device', type: 'boolean', width: 8 },
      {
        key: 'gps_device_id',
        header: 'GPS device id',
        type: 'text',
        maxLength: 60,
        width: 14,
        pattern: '^[A-Za-z0-9_.:\\-]+$',
        patternHelp: 'letters, digits, dot, colon, hyphen or underscore, without spaces',
      },
      url('camera_url', 'Live camera link'),
      url('track_url', 'Track bus link'),
    ],
    status: STATUS,
    search: ['t.reg_no', 't.name', 't.make', 't.model'],
    orderBy: 't.reg_no',
  }),
  master({
    id: 'transport_drivers',
    title: 'Crew',
    group: 'transport',
    order: 40,
    table: 'transport_drivers',
    permission: { view: 'transport.fleet.view', manage: 'transport.fleet.manage' },
    naturalKey: ['code'],
    conflict: '(school_id, code)',
    uploadHelp:
      'Drivers, conductors and attendants (support staff). A driver needs the licence number and its expiry.',
    fields: [
      tcode('Crew code'),
      {
        ...name('Name'),
        pattern: PERSON,
        patternHelp: 'a name in letters (dots, spaces and hyphens allowed)',
      },
      {
        key: 'role',
        header: 'Role',
        type: 'select',
        options: ['driver', 'conductor', 'attendant'],
        required: true,
        width: 10,
        bulk: true,
        help: 'attendant = support staff on the bus (helper, lady attendant).',
      },
      { ...mobile(), required: true },
      { ...mobile('emergency_mobile', 'Emergency mobile') },
      {
        key: 'vendor_id',
        header: 'Vendor',
        type: 'ref',
        lookup: { table: 'transport_vendors', column: 'code' },
        width: 12,
        bulk: true,
        help: 'Blank for the school’s own staff.',
      },
      {
        key: 'employee_id',
        header: 'Employee (if on the rolls)',
        type: 'ref',
        lookup: {
          table: 'employees',
          column: 'employee_code',
          labelColumn: 'display_name',
          showLabel: true,
          filter: "t.status = 'active'",
        },
        width: 22,
      },
      {
        key: 'licence_no',
        header: 'Licence no',
        type: 'text',
        maxLength: 20,
        width: 18,
        pattern: '^[A-Z]{2}[0-9]{2}[ \\-]?[0-9]{11}$',
        patternHelp: 'a driving licence number like MH1220110012345 (capital letters)',
      },
      { key: 'licence_expiry', header: 'Licence valid till', type: 'date', width: 12 },
      {
        key: 'badge_no',
        header: 'Badge no',
        type: 'text',
        maxLength: 20,
        width: 12,
        pattern: '^[A-Za-z0-9\\/\\-]+$',
        patternHelp: 'letters, digits, slash or hyphen',
      },
      { key: 'police_verified', header: 'Police verified', type: 'boolean', width: 8, bulk: true },
      { key: 'police_verified_on', header: 'Verified on', type: 'date', width: 12 },
      { key: 'address', header: 'Address', type: 'text', maxLength: 300, width: 30 },
    ],
    status: STATUS,
    search: ['t.code', 't.name', 't.mobile', 't.licence_no'],
    orderBy: 't.role, t.name',
  }),
  master({
    id: 'transport_stoppages',
    title: 'Stoppages',
    group: 'transport',
    order: 60,
    table: 'transport_stoppages',
    permission: { view: 'transport.route.view', manage: 'transport.route.manage' },
    naturalKey: ['code'],
    conflict: '(school_id, code)',
    uploadHelp:
      'Each stoppage once, with its fee slab. Routes pick their stops from this list (Route stops).',
    fields: [
      tcode(),
      name('Stoppage'),
      { key: 'area', header: 'Area', type: 'text', maxLength: 80, width: 16 },
      {
        key: 'slab_id',
        header: 'Slab',
        type: 'ref',
        lookup: { table: 'transport_slabs', column: 'code', yearScoped: true },
        width: 10,
        bulk: true,
        help: 'The fee slab every pupil of this stoppage is charged at.',
      },
      {
        key: 'radial_km',
        header: 'Radial distance (km)',
        type: 'number',
        scale: 1,
        min: 0,
        max: 200,
        width: 10,
      },
      {
        key: 'route_km',
        header: 'Route distance (km)',
        type: 'number',
        scale: 1,
        min: 0,
        max: 300,
        width: 10,
      },
      {
        key: 'lat',
        header: 'Latitude',
        type: 'number',
        scale: 6,
        min: -90,
        max: 90,
        width: 10,
        widget: 'map',
      },
      { key: 'lng', header: 'Longitude', type: 'number', scale: 6, min: -180, max: 180, width: 10 },
    ],
    status: STATUS,
    search: ['t.code', 't.name', 't.area'],
    orderBy: 't.name',
  }),
  master({
    id: 'transport_routes',
    title: 'Routes',
    group: 'transport',
    order: 5,
    table: 'transport_routes',
    permission: { view: 'transport.route.view', manage: 'transport.route.manage' },
    naturalKey: ['code'],
    conflict: '(school_id, code) WHERE deleted_at IS NULL',
    detail: { path: '/transport/routes/{id}', label: 'Stops and students' },
    uploadHelp:
      'The vehicle and the crew of a route are set under Route and vehicle mapping; its stops under Route stops.',
    fields: [
      tcode(),
      name('Route'),
      time('late_after', 'Late after'),
      { key: 'alert_boarding', header: 'Boarding alert', type: 'boolean', width: 8, bulk: true },
      { key: 'alert_alighting', header: 'Alighting alert', type: 'boolean', width: 8, bulk: true },
    ],
    status: STATUS,
    search: ['t.code', 't.name'],
    orderBy: 't.code',
  }),
  master({
    id: 'transport_stops',
    title: 'Route stops',
    group: 'transport',
    order: 80,
    table: 'transport_stops',
    permission: { view: 'transport.route.view', manage: 'transport.route.manage' },
    naturalKey: ['route_id', 'sequence'],
    conflict: '(route_id, sequence)',
    uploadHelp:
      'Which stoppages a route calls at, in order, with the pick and drop time. The name, slab and place come from the stoppage.',
    fields: [
      {
        key: 'route_id',
        header: 'Route',
        type: 'ref',
        lookup: { table: 'transport_routes', column: 'code' },
        required: true,
        identity: true,
        width: 10,
      },
      {
        key: 'sequence',
        header: 'Stop no',
        type: 'number',
        scale: 0,
        min: 1,
        max: 200,
        required: true,
        identity: true,
        width: 8,
      },
      {
        key: 'stoppage_id',
        header: 'Stoppage',
        type: 'ref',
        lookup: { table: 'transport_stoppages', column: 'code', showLabel: true },
        required: true,
        width: 24,
      },
      time('pickup_time', 'Pick time'),
      time('drop_time', 'Drop time'),
    ],
    search: ['r1.code', 't.name'],
    orderBy: 'r1.code, t.sequence',
  }),
  master({
    id: 'transport_route_vehicles',
    title: 'Route and vehicle mapping',
    group: 'transport',
    order: 90,
    table: 'transport_route_vehicles',
    permission: { view: 'transport.fleet.view', manage: 'transport.fleet.manage' },
    naturalKey: ['route_id', 'vehicle_id', 'shift'],
    conflict: '(route_id, vehicle_id, shift)',
    rekey: true,
    uploadHelp:
      'Which vehicle runs a route (pick trip, drop trip or both) and its crew: driver, conductor and attendant.',
    fields: [
      {
        key: 'route_id',
        header: 'Route',
        type: 'ref',
        lookup: { table: 'transport_routes', column: 'code' },
        required: true,
        identity: true,
        width: 10,
      },
      {
        key: 'vehicle_id',
        header: 'Vehicle no',
        type: 'ref',
        lookup: { table: 'transport_vehicles', column: 'reg_no', labelColumn: 'name' },
        required: true,
        identity: true,
        width: 14,
      },
      {
        key: 'shift',
        header: 'Trip',
        type: 'select',
        options: ['both', 'pick', 'drop'],
        required: true,
        identity: true,
        width: 8,
      },
      crew('driver_id', 'Driver', 'driver', true),
      crew('conductor_id', 'Conductor', 'conductor'),
      crew('attendant_id', 'Attendant (support staff)', 'attendant'),
      {
        key: 'from_date',
        header: 'From',
        type: 'date',
        width: 12,
        help: 'The bus runs the route, and parents can track it, from this date. Leave blank to start now.',
      },
      {
        key: 'to_date',
        header: 'To',
        type: 'date',
        width: 12,
        notBefore: 'from_date',
        help: 'The last date the bus runs the route. Leave blank for no end.',
      },
    ],
    status: STATUS,
    search: ['r1.code', 'r2.reg_no'],
    orderBy: 'r1.code, t.shift',
  }),
  master({
    id: 'class_subjects',
    title: 'Class and subject mapping',
    group: 'academics',
    order: 40,
    table: 'class_subjects',
    permission: { view: 'academics.subject.view', manage: 'academics.subject.manage' },
    yearScoped: true,
    naturalKey: ['class_id', 'subject_id'],
    conflict: '(academic_year_id, class_id, subject_id)',
    uploadHelp:
      'Which subjects a class studies in this session. Teachers are then assigned to these under Teacher assignments; homework and marks follow them.',
    fields: [
      classRef('class_id', 'Class code', true),
      {
        key: 'subject_id',
        header: 'Subject',
        type: 'ref',
        lookup: { table: 'subjects', column: 'code', labelColumn: 'name', nameFirst: true },
        required: true,
        identity: true,
        width: 26,
      },
      { key: 'is_elective', header: 'Elective', type: 'boolean', width: 8 },
      {
        key: 'periods_per_week',
        header: 'Periods a week',
        type: 'number',
        scale: 0,
        min: 0,
        max: 60,
        width: 10,
      },
    ],
    search: ['r1.code', 'r2.code', 'r2.name'],
    orderBy: 'r1.display_order, r1.code, r2.display_order, r2.code',
    clone: cloneSql(
      'class_subjects',
      ['class_id', 'subject_id', 'is_elective', 'periods_per_week'],
      ['class_id', 'subject_id'],
    ),
  }),
  // ---- the school directory the families see ----
  master({
    id: 'school_directory',
    title: 'School directory',
    group: 'academics',
    order: 900,
    table: 'school_directory',
    permission: { view: 'academics.notice.view', manage: 'academics.notice.manage' },
    naturalKey: ['code'],
    conflict: '(school_id, code)',
    uploadHelp:
      'Whom a family may contact, under headings (Office, Fee counter, Transport, Principal’s desk…). Shown in the parent and student portal; only what is typed here is shown.',
    fields: [
      code('Code'),
      { key: 'heading', header: 'Heading', type: 'text', required: true, maxLength: 80, width: 18 },
      name('Name'),
      { key: 'designation', header: 'Designation', type: 'text', maxLength: 120, width: 20 },
      {
        key: 'phone',
        header: 'Phone',
        type: 'text',
        maxLength: 40,
        width: 16,
        pattern: '^[0-9+() \\-]{6,40}$',
        patternHelp: 'a phone number (digits, spaces, + - ( ))',
      },
      {
        key: 'email',
        header: 'E-mail',
        type: 'text',
        maxLength: 160,
        width: 26,
        pattern: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$',
        patternHelp: 'an e-mail address',
      },
      { key: 'timings', header: 'Timings', type: 'text', maxLength: 120, width: 20 },
      { key: 'note', header: 'Note', type: 'text', maxLength: 300, width: 28 },
      order(),
    ],
    status: STATUS,
    search: ['t.code', 't.heading', 't.name', 't.designation'],
    orderBy: 't.sort_order, t.heading, t.name',
  }),
  // ---- attendance ----
  master({
    id: 'leave_types',
    title: 'Leave types',
    group: 'attendance',
    order: 10,
    table: 'leave_types',
    permission: { view: 'attendance.session.view', manage: 'attendance.setup.manage' },
    naturalKey: ['code'],
    conflict: '(school_id, code)',
    uploadHelp:
      'The kinds of leave a family may apply for. A type switched to inactive is no longer offered; leave already applied keeps it.',
    fields: [
      {
        key: 'code',
        header: 'Code',
        type: 'text',
        required: true,
        identity: true,
        maxLength: 30,
        width: 12,
        pattern: '^[a-z][a-z0-9_]{1,29}$',
        patternHelp: 'small letters, digits and _ (for example medical, sports_meet)',
      },
      name('Leave type'),
      {
        key: 'certificate',
        header: 'Certificate needed',
        type: 'select',
        options: ['never', 'long', 'always'],
        required: true,
        width: 14,
        help: 'never; long = only for a long leave (more days than the limit in Attendance set-up); always.',
      },
      {
        key: 'max_days',
        header: 'Most days in one application',
        type: 'number',
        scale: 0,
        min: 1,
        max: 365,
        width: 12,
        help: 'Leave blank for no limit.',
      },
      order(),
    ],
    status: STATUS,
    search: ['t.code', 't.name'],
    orderBy: 't.sort_order, t.name',
  }),
  // ---- exams ----
  master({
    id: 'exam_types',
    title: 'Exam types',
    group: 'exams',
    table: 'exam_types',
    permission: { view: 'exams.master.view', manage: 'exams.master.manage' },
    naturalKey: ['code'],
    conflict: '(school_id, code) WHERE deleted_at IS NULL',
    fields: [
      code(),
      name(),
      {
        key: 'weightage',
        header: 'Weightage %',
        type: 'number',
        scale: 2,
        min: 0,
        max: 100,
        width: 8,
        bulk: true,
      },
      order(),
    ],
    status: STATUS,
    search: ['t.code', 't.name'],
    orderBy: 't.sort_order, t.code',
  }),
  master({
    id: 'grade_scales',
    title: 'Grade scales',
    group: 'exams',
    table: 'grade_scales',
    permission: { view: 'exams.master.view', manage: 'exams.master.manage' },
    naturalKey: ['code'],
    conflict: '(school_id, code) WHERE deleted_at IS NULL',
    fields: [
      code(),
      name(),
      { key: 'description', header: 'Description', type: 'text', maxLength: 200, width: 30 },
    ],
    status: STATUS,
    search: ['t.code', 't.name'],
    orderBy: 't.code',
  }),
  master({
    id: 'grade_bands',
    title: 'Grade bands',
    group: 'exams',
    table: 'grade_bands',
    permission: { view: 'exams.master.view', manage: 'exams.master.manage' },
    naturalKey: ['scale_id', 'grade'],
    conflict: '(scale_id, grade)',
    fields: [
      {
        key: 'scale_id',
        header: 'Scale code',
        type: 'ref',
        lookup: { table: 'grade_scales', column: 'code' },
        required: true,
        identity: true,
        width: 10,
      },
      {
        key: 'grade',
        header: 'Grade',
        type: 'text',
        required: true,
        identity: true,
        maxLength: 10,
        width: 8,
      },
      {
        key: 'min_pct',
        header: 'Min %',
        type: 'number',
        scale: 2,
        min: 0,
        max: 100,
        required: true,
        width: 8,
      },
      {
        key: 'max_pct',
        header: 'Max %',
        type: 'number',
        scale: 2,
        min: 0,
        max: 100,
        required: true,
        width: 8,
      },
      { key: 'points', header: 'Points', type: 'number', scale: 2, min: 0, max: 10, width: 8 },
      { key: 'remark', header: 'Remark', type: 'text', maxLength: 120, width: 24 },
      order(),
    ],
    search: ['r1.code', 't.grade'],
    orderBy: 'r1.code, t.sort_order, t.min_pct DESC',
  }),
  master({
    id: 'indicator_sets',
    title: 'Indicator sets',
    group: 'exams',
    table: 'indicator_sets',
    permission: { view: 'exams.master.view', manage: 'exams.master.manage' },
    naturalKey: ['code'],
    conflict: '(school_id, code) WHERE deleted_at IS NULL',
    fields: [
      code(),
      name(),
      {
        key: 'grades',
        header: 'Grades',
        type: 'text',
        required: true,
        array: true,
        maxLength: 60,
        width: 16,
        help: 'comma separated, e.g. A,B,C',
      },
    ],
    status: STATUS,
    search: ['t.code', 't.name'],
    orderBy: 't.code',
  }),
  master({
    id: 'indicators',
    title: 'Indicators',
    group: 'exams',
    table: 'indicators',
    permission: { view: 'exams.master.view', manage: 'exams.master.manage' },
    naturalKey: ['set_id', 'code'],
    conflict: '(set_id, code)',
    fields: [
      {
        key: 'set_id',
        header: 'Set code',
        type: 'ref',
        lookup: { table: 'indicator_sets', column: 'code' },
        required: true,
        identity: true,
        width: 10,
      },
      code(),
      name(),
      { key: 'area', header: 'Area', type: 'text', maxLength: 60, width: 16, bulk: true },
      order(),
    ],
    search: ['r1.code', 't.code', 't.name'],
    orderBy: 'r1.code, t.sort_order, t.code',
  }),
  master({
    id: 'remark_bank',
    title: 'Remark bank',
    group: 'exams',
    table: 'remark_bank',
    permission: { view: 'exams.master.view', manage: 'exams.master.manage' },
    naturalKey: ['code'],
    conflict: '(school_id, code)',
    fields: [
      code(),
      { key: 'text', header: 'Remark', type: 'text', required: true, maxLength: 600, width: 50 },
      classRef('class_id', 'Class code'),
      order(),
    ],
    status: STATUS,
    search: ['t.code', 't.text'],
    orderBy: 't.sort_order, t.code',
  }),
  // ---- communication ----
  master({
    id: 'comms_templates',
    title: 'Templates (Excel import / export)',
    group: 'communication',
    hidden: true,
    table: 'comms_templates',
    permission: { view: 'comms.template.view', manage: 'comms.template.manage' },
    naturalKey: ['code', 'channel'],
    conflict: '(school_id, code, channel)',
    fields: [
      code(),
      {
        key: 'channel',
        header: 'Channel',
        type: 'select',
        required: true,
        identity: true,
        options: ['sms', 'whatsapp', 'email', 'push'],
        width: 10,
      },
      name(),
      { key: 'subject', header: 'Subject', type: 'text', maxLength: 200, width: 24 },
      {
        key: 'body',
        header: 'Body',
        type: 'text',
        required: true,
        maxLength: 2000,
        width: 50,
        help: 'variables as {{student_name}}',
      },
      { key: 'dlt_template_id', header: 'DLT template id', type: 'text', maxLength: 40, width: 14 },
      { key: 'dlt_entity_id', header: 'DLT entity id', type: 'text', maxLength: 40, width: 14 },
      { key: 'sender_id', header: 'Sender id', type: 'text', maxLength: 80, width: 12 },
      { key: 'is_alert', header: 'Alert', type: 'boolean', width: 6, bulk: true },
    ],
    status: STATUS,
    search: ['t.code', 't.name', 't.body'],
    orderBy: 't.code, t.channel',
  }),
  master({
    id: 'query_categories',
    title: 'Query categories',
    group: 'communication',
    table: 'query_categories',
    permission: { view: 'engagement.query.view', manage: 'platform.settings.edit' },
    naturalKey: ['code'],
    conflict: '(school_id, code)',
    fields: [
      code(),
      name(),
      {
        key: 'route_to',
        header: 'Routed to (role code)',
        type: 'text',
        required: true,
        maxLength: 60,
        width: 16,
        bulk: true,
        help: 'e.g. school_admin, class_teacher, accountant',
      },
      order(),
    ],
    status: STATUS,
    search: ['t.code', 't.name'],
    orderBy: 't.sort_order, t.code',
  }),
  // ---- system ----
  master({
    id: 'campuses',
    title: 'Campuses',
    group: 'system',
    table: 'campuses',
    permission: { view: 'platform.school.view', manage: 'platform.campus.manage' },
    naturalKey: ['code'],
    conflict: '(school_id, code)',
    fields: [code(), name()],
    status: STATUS,
    search: ['t.code', 't.name'],
    orderBy: 't.code',
  }),
  // ---- library (Sprint 17) ----
  master({
    id: 'library_titles',
    title: 'Titles',
    group: 'library',
    table: 'library_titles',
    permission: { view: 'library.catalogue.view', manage: 'library.catalogue.manage' },
    naturalKey: ['code'],
    conflict: '(school_id, code)',
    fields: [
      code('Catalogue code'),
      { key: 'title', header: 'Title', type: 'text', required: true, maxLength: 200, width: 32 },
      { key: 'author', header: 'Author', type: 'text', maxLength: 120, width: 20 },
      { key: 'publisher', header: 'Publisher', type: 'text', maxLength: 120, width: 18 },
      { key: 'edition', header: 'Edition', type: 'text', maxLength: 40, width: 10 },
      { key: 'year', header: 'Year', type: 'number', scale: 0, min: 1500, max: 2100, width: 8 },
      { key: 'isbn', header: 'ISBN', type: 'text', maxLength: 20, width: 14 },
      { key: 'category', header: 'Category', type: 'text', maxLength: 60, width: 14, bulk: true },
      { key: 'language', header: 'Language', type: 'text', maxLength: 30, width: 10, bulk: true },
      { key: 'price', header: 'Price', type: 'number', scale: 2, min: 0, width: 10 },
      { key: 'pages', header: 'Pages', type: 'number', scale: 0, min: 1, max: 5000, width: 8 },
      {
        key: 'location',
        header: 'Rack / shelf',
        type: 'text',
        maxLength: 40,
        width: 12,
        bulk: true,
      },
      { key: 'is_reference', header: 'Reference only', type: 'boolean', width: 8, bulk: true },
    ],
    status: STATUS,
    search: ['t.code', 't.title', 't.author', 't.isbn'],
    orderBy: 't.title',
    uploadHelp:
      'One row per title; copies are accessioned under Library → Circulation or uploaded on the Copies tab.',
  }),
  master({
    id: 'library_copies',
    title: 'Copies (accession register)',
    group: 'library',
    table: 'library_copies',
    permission: { view: 'library.catalogue.view', manage: 'library.catalogue.manage' },
    naturalKey: ['accession_no'],
    conflict: '(school_id, accession_no)',
    fields: [
      {
        key: 'accession_no',
        header: 'Accession no',
        type: 'text',
        required: true,
        identity: true,
        maxLength: 30,
        width: 12,
      },
      {
        key: 'title_id',
        header: 'Catalogue code',
        type: 'ref',
        lookup: { table: 'library_titles', column: 'code' },
        required: true,
        width: 14,
      },
      { key: 'accessioned_on', header: 'Accessioned on', type: 'date', width: 12 },
      { key: 'source', header: 'Source', type: 'text', maxLength: 60, width: 12, bulk: true },
      { key: 'price', header: 'Price', type: 'number', scale: 2, min: 0, width: 10 },
      { key: 'remarks', header: 'Remarks', type: 'text', maxLength: 200, width: 20 },
    ],
    search: ['t.accession_no', 'r2.code'],
    orderBy: 't.accession_no',
  }),
  master({
    id: 'library_digital_items',
    title: 'Digital library',
    group: 'library',
    table: 'library_digital_items',
    permission: { view: 'library.catalogue.view', manage: 'library.catalogue.manage' },
    naturalKey: ['code'],
    conflict: '(school_id, code)',
    fields: [
      code(),
      { key: 'title', header: 'Title', type: 'text', required: true, maxLength: 200, width: 30 },
      { key: 'author', header: 'Author', type: 'text', maxLength: 120, width: 18 },
      {
        key: 'kind',
        header: 'Kind',
        type: 'select',
        required: true,
        options: ['link', 'file'],
        width: 8,
      },
      { key: 'url', header: 'URL', type: 'text', maxLength: 500, width: 30, help: 'for links' },
      { key: 'category', header: 'Category', type: 'text', maxLength: 60, width: 14, bulk: true },
      {
        key: 'audience',
        header: 'Audience',
        type: 'select',
        required: true,
        options: ['everyone', 'students', 'employees'],
        width: 10,
        bulk: true,
      },
      {
        key: 'band',
        header: 'Class band',
        type: 'select',
        options: ['primary', 'middle', 'secondary', 'senior'],
        width: 10,
        bulk: true,
        help: 'blank = every class',
      },
      { key: 'description', header: 'Description', type: 'text', maxLength: 300, width: 30 },
    ],
    status: STATUS,
    search: ['t.code', 't.title', 't.author', 't.category'],
    orderBy: 't.category NULLS LAST, t.title',
  }),
  master({
    id: 'mis_dashboards',
    title: 'MIS dashboards by role',
    group: 'system',
    table: 'mis_dashboards',
    permission: { view: 'platform.school.view', manage: 'platform.settings.edit' },
    naturalKey: ['code'],
    conflict: '(school_id, code)',
    fields: [
      code(),
      name(),
      {
        key: 'roles',
        header: 'Roles',
        type: 'text',
        required: true,
        array: true,
        maxLength: 300,
        width: 30,
        help: 'comma separated role codes',
      },
      order(),
    ],
    status: STATUS,
    search: ['t.code', 't.name'],
    orderBy: 't.sort_order, t.code',
  }),
];

/** Whether a lookup table carries deleted_at (ref resolution filters on it only then). */
export const hasSoftDelete = (table: string): boolean => SOFT_DELETE.has(table);

export const MASTER_IDS = MASTERS.map((m) => m.id) as [string, ...string[]];

export function masterOrNull(id: string): MasterDefinition | null {
  return MASTERS.find((m) => m.id === id) ?? null;
}
