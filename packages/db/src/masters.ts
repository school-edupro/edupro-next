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
  lookup?: { table: string; column: string; yearScoped?: boolean };
  /** Digits after the decimal point for `number` (0 = integer). */
  scale?: number;
  min?: number;
  max?: number;
  maxLength?: number;
  width?: number;
  /** Offered in the bulk-update control. */
  bulk?: boolean;
  /** `text` stored as TEXT[]: files and the grid show a comma-separated list. */
  array?: boolean;
  help?: string;
}

export type MasterGroup =
  'fees' | 'academics' | 'attendance' | 'transport' | 'exams' | 'communication' | 'system';

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
        cols.push(`${a}.${f.lookup.column}::text AS ${f.key}`);
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
const campusRef: MasterField = {
  key: 'campus_id',
  header: 'Campus code',
  type: 'ref',
  lookup: { table: 'campuses', column: 'code' },
  width: 12,
  help: 'blank = every campus',
};
const time = (key: string, header: string, required = false): MasterField => ({
  key,
  header,
  type: 'text',
  required,
  maxLength: 8,
  width: 8,
  help: 'HH:MM (24-hour)',
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
const SOFT_DELETE = new Set([
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
    fields: [
      code(),
      name(),
      {
        key: 'head_id',
        header: 'Fee head code',
        type: 'ref',
        lookup: { table: 'fee_heads', column: 'code' },
        width: 12,
        help: 'blank = every regular head',
      },
      {
        key: 'percent',
        header: 'Percent',
        type: 'number',
        scale: 2,
        min: 0,
        max: 100,
        width: 8,
        bulk: true,
        help: 'give percent or amount, not both',
      },
      { key: 'amount', header: 'Amount', type: 'number', scale: 2, min: 0, width: 10, bulk: true },
      {
        key: 'applies_to_transport',
        header: 'Applies to transport',
        type: 'boolean',
        width: 8,
        bulk: true,
      },
    ],
    status: STATUS,
    search: ['t.code', 't.name'],
    orderBy: 't.code',
    clone: cloneSql(
      'fee_discounts',
      ['code', 'name', 'head_id', 'percent', 'amount', 'applies_to_transport', 'status'],
      ['code'],
    ),
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
      { key: 'ifsc', header: 'IFSC', type: 'text', maxLength: 11, width: 12 },
      {
        key: 'account_label',
        header: 'Account label',
        type: 'text',
        maxLength: 60,
        width: 16,
        help: 'a nickname, never the account number',
      },
    ],
    status: STATUS,
    search: ['t.code', 't.name', 't.branch', 't.ifsc'],
    orderBy: 't.name',
  }),
  // ---- academics ----
  master({
    id: 'classes',
    title: 'Classes',
    group: 'academics',
    table: 'classes',
    permission: { view: 'academics.class.view', manage: 'academics.class.edit' },
    naturalKey: ['code'],
    conflict: '(school_id, code) WHERE deleted_at IS NULL',
    fields: [code(), name(), order('display_order')],
    status: STATUS,
    search: ['t.code', 't.name'],
    orderBy: 't.display_order, t.code',
  }),
  master({
    id: 'class_sections',
    title: 'Sections',
    group: 'academics',
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
      },
      campusRef,
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
    table: 'subjects',
    permission: { view: 'academics.subject.view', manage: 'academics.subject.manage' },
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
        options: ['scholastic', 'co_scholastic', 'language', 'vocational'],
        width: 14,
        bulk: true,
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
    table: 'timetable_periods',
    permission: { view: 'academics.timetable.view', manage: 'academics.timetable.manage' },
    naturalKey: ['campus_id', 'number'],
    conflict: '(school_id, COALESCE(campus_id, 0), number)',
    fields: [
      { ...campusRef, identity: true },
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
      name('Period name'),
      time('starts_at', 'Starts at', true),
      time('ends_at', 'Ends at', true),
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
    orderBy: 'r1.code NULLS FIRST, t.number',
  }),
  master({
    id: 'holidays',
    title: 'Holidays',
    group: 'academics',
    table: 'holidays',
    permission: { view: 'academics.calendar.view', manage: 'academics.calendar.manage' },
    yearScoped: true,
    naturalKey: ['name', 'starts_on'],
    conflict: '(school_id, academic_year_id, name, starts_on)',
    fields: [
      { ...name('Holiday'), identity: true },
      { key: 'starts_on', header: 'From', type: 'date', required: true, identity: true, width: 12 },
      { key: 'ends_on', header: 'To', type: 'date', required: true, width: 12 },
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
      campusRef,
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
  master({
    id: 'transport_routes',
    title: 'Routes',
    group: 'transport',
    table: 'transport_routes',
    permission: { view: 'transport.route.view', manage: 'transport.route.manage' },
    naturalKey: ['code'],
    conflict: '(school_id, code) WHERE deleted_at IS NULL',
    fields: [
      code(),
      name(),
      { key: 'vehicle_no', header: 'Vehicle no', type: 'text', maxLength: 20, width: 12 },
      { key: 'driver_name', header: 'Driver', type: 'text', maxLength: 80, width: 16 },
      { key: 'driver_mobile', header: 'Driver mobile', type: 'text', maxLength: 15, width: 12 },
      time('late_after', 'Late after'),
      { key: 'alert_boarding', header: 'Boarding alert', type: 'boolean', width: 8, bulk: true },
      { key: 'alert_alighting', header: 'Alighting alert', type: 'boolean', width: 8, bulk: true },
    ],
    status: STATUS,
    search: ['t.code', 't.name', 't.vehicle_no', 't.driver_name'],
    orderBy: 't.code',
  }),
  master({
    id: 'transport_stops',
    title: 'Stops',
    group: 'transport',
    table: 'transport_stops',
    permission: { view: 'transport.route.view', manage: 'transport.route.manage' },
    naturalKey: ['route_id', 'sequence'],
    conflict: '(route_id, sequence)',
    fields: [
      {
        key: 'route_id',
        header: 'Route code',
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
      name('Stop'),
      time('pickup_time', 'Pickup'),
      time('drop_time', 'Drop'),
      { key: 'lat', header: 'Latitude', type: 'number', scale: 6, min: -90, max: 90, width: 10 },
      { key: 'lng', header: 'Longitude', type: 'number', scale: 6, min: -180, max: 180, width: 10 },
      {
        key: 'slab_id',
        header: 'Slab code',
        type: 'ref',
        lookup: { table: 'transport_slabs', column: 'code', yearScoped: true },
        width: 10,
        bulk: true,
      },
    ],
    search: ['r1.code', 't.name'],
    orderBy: 'r1.code, t.sequence',
  }),
  master({
    id: 'transport_vehicles',
    title: 'Vehicles',
    group: 'transport',
    table: 'transport_vehicles',
    permission: { view: 'transport.fleet.view', manage: 'transport.fleet.manage' },
    naturalKey: ['reg_no'],
    conflict: '(school_id, reg_no) WHERE deleted_at IS NULL',
    fields: [
      {
        key: 'reg_no',
        header: 'Registration no',
        type: 'text',
        required: true,
        identity: true,
        maxLength: 20,
        width: 14,
      },
      { key: 'make', header: 'Make', type: 'text', maxLength: 60, width: 14 },
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
      { key: 'insurance_expiry', header: 'Insurance expiry', type: 'date', width: 12 },
      { key: 'fitness_expiry', header: 'Fitness expiry', type: 'date', width: 12 },
      { key: 'permit_expiry', header: 'Permit expiry', type: 'date', width: 12 },
      { key: 'gps_device_id', header: 'GPS device', type: 'text', maxLength: 60, width: 12 },
    ],
    status: STATUS,
    search: ['t.reg_no', 't.make'],
    orderBy: 't.reg_no',
  }),
  master({
    id: 'transport_drivers',
    title: 'Drivers',
    group: 'transport',
    table: 'transport_drivers',
    permission: { view: 'transport.fleet.view', manage: 'transport.fleet.manage' },
    naturalKey: ['name', 'mobile'],
    conflict: "(school_id, name, COALESCE(mobile, '')) WHERE deleted_at IS NULL",
    fields: [
      { ...name('Driver'), identity: true },
      { key: 'mobile', header: 'Mobile', type: 'text', identity: true, maxLength: 15, width: 12 },
      { key: 'licence_no', header: 'Licence no', type: 'text', maxLength: 30, width: 14 },
      { key: 'licence_expiry', header: 'Licence expiry', type: 'date', width: 12 },
    ],
    status: STATUS,
    search: ['t.name', 't.mobile', 't.licence_no'],
    orderBy: 't.name',
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
    title: 'Message templates',
    group: 'communication',
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
    id: 'comms_groups',
    title: 'Groups',
    group: 'communication',
    table: 'comms_groups',
    permission: { view: 'comms.template.view', manage: 'comms.template.manage' },
    naturalKey: ['code'],
    conflict: '(school_id, code) WHERE deleted_at IS NULL',
    fields: [
      code(),
      name(),
      { key: 'description', header: 'Description', type: 'text', maxLength: 200, width: 30 },
    ],
    search: ['t.code', 't.name'],
    orderBy: 't.code',
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
];

export const MASTER_IDS = MASTERS.map((m) => m.id) as [string, ...string[]];

export function masterOrNull(id: string): MasterDefinition | null {
  return MASTERS.find((m) => m.id === id) ?? null;
}
