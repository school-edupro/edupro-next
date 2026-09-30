import type { PoolClient } from 'pg';
import { PROFILE_FIELDS, PROFILE_SECTIONS, type ProfileField } from './student-fields';
import { parseDate, type ProfileValue } from './student-profile';
import { readStudentProfiles } from './student-profile-store';

/**
 * Report builder (student 360 profile): a saved report is a list of columns (with the header text the
 * user wants), filters, a sort and page options. Rows come from the profile catalogue plus a few
 * record, fee and transport columns; filters and sort run on the resolved values so every field can be
 * used, whatever its storage.
 */

export const REPORT_DATASETS = ['student_profile'] as const;
export type ReportDataset = (typeof REPORT_DATASETS)[number];

export type ReportFilterOp =
  | 'eq'
  | 'neq'
  | 'in'
  | 'not_in'
  | 'contains'
  | 'starts'
  | 'empty'
  | 'not_empty'
  | 'between'
  | 'gte'
  | 'lte';
export const REPORT_FILTER_OPS: readonly ReportFilterOp[] = [
  'eq',
  'neq',
  'in',
  'not_in',
  'contains',
  'starts',
  'empty',
  'not_empty',
  'between',
  'gte',
  'lte',
];

export interface ReportColumn {
  key: string;
  /** The header shown in Excel and PDF; the field label when empty. */
  label?: string | null;
  /** Excel column width in characters. */
  width?: number | null;
}
export interface ReportFilter {
  key: string;
  op: ReportFilterOp;
  values?: string[];
}
export interface ReportSort {
  key: string;
  dir: 'asc' | 'desc';
}
export interface ReportOptions {
  paper: 'A4' | 'A3';
  orientation: 'auto' | 'portrait' | 'landscape';
  /** Academic year of the rows; the working year when empty. */
  academicYearId?: string | null;
  /** Include students whose record is inactive (left, withdrawn). */
  includeInactive?: boolean;
  /** Free search over admission no, name and family mobiles (the student list's search box). */
  search?: string | null;
}
export interface ReportSpec {
  columns: ReportColumn[];
  filters: ReportFilter[];
  sort: ReportSort[];
  options: ReportOptions;
}

export interface ReportFieldDef {
  key: string;
  label: string;
  section: string;
  type: 'text' | 'number' | 'date';
  /** List code for filter suggestions. */
  list?: string | null;
  sensitive?: boolean;
}

/** PDF pages hold this many columns; Excel has no limit. */
export const PDF_COLUMN_LIMIT: Record<ReportOptions['paper'], number> = { A4: 15, A3: 25 };
export const REPORT_MAX_ROWS = 20000;

const EXTRA_FIELDS: ReportFieldDef[] = [
  { key: 'full_name', label: 'Student Full Name', section: 'student', type: 'text' },
  { key: 'class_section', label: 'Class-Section', section: 'academic', type: 'text' },
  { key: 'student_status', label: 'Student Status', section: 'record', type: 'text' },
  { key: 'enrolment_status', label: 'Enrolment Status', section: 'record', type: 'text' },
  { key: 'profile_completeness', label: 'Profile Complete (%)', section: 'record', type: 'number' },
  { key: 'fee_group', label: 'Fee Group', section: 'fees_transport', type: 'text' },
  { key: 'student_type', label: 'New / Old Student', section: 'fees_transport', type: 'text' },
  { key: 'fee_discount', label: 'Fee Discount', section: 'fees_transport', type: 'text' },
  { key: 'transport_route', label: 'Transport Route', section: 'fees_transport', type: 'text' },
  { key: 'transport_stop', label: 'Transport Stop', section: 'fees_transport', type: 'text' },
];

export const REPORT_SECTIONS: ReadonlyArray<{ id: string; title: string }> = [
  ...PROFILE_SECTIONS,
  { id: 'fees_transport', title: 'Fees and transport' },
  { id: 'record', title: 'Record' },
];

const fieldType = (f: ProfileField): ReportFieldDef['type'] =>
  f.type === 'date'
    ? 'date'
    : f.type === 'number' || (f.type === 'auto' && f.key === 'age') || f.key === 'roll_no'
      ? 'number'
      : 'text';

export const STUDENT_REPORT_FIELDS: ReportFieldDef[] = [
  ...PROFILE_FIELDS.map((f) => ({
    key: f.key,
    label: f.label,
    section: f.section,
    type: fieldType(f),
    list: f.list ?? null,
    sensitive: f.sensitive ?? false,
  })),
  ...EXTRA_FIELDS,
];
export const STUDENT_REPORT_FIELD_BY_KEY: ReadonlyMap<string, ReportFieldDef> = new Map(
  STUDENT_REPORT_FIELDS.map((f) => [f.key, f]),
);

/** Structural checks; returns human messages (empty when the spec is usable). */
export function validateReportSpec(spec: ReportSpec, format?: 'xlsx' | 'pdf'): string[] {
  const errors: string[] = [];
  if (!spec.columns.length) errors.push('Choose at least one column');
  if (spec.columns.length > 250) errors.push('At most 250 columns');
  const seen = new Set<string>();
  for (const c of spec.columns) {
    if (!STUDENT_REPORT_FIELD_BY_KEY.has(c.key)) errors.push(`Unknown column ${c.key}`);
    if (seen.has(c.key)) errors.push(`Column ${c.key} is chosen twice`);
    seen.add(c.key);
    if (c.label && c.label.length > 80)
      errors.push(`Header for ${c.key} is longer than 80 characters`);
  }
  for (const f of spec.filters) {
    const def = STUDENT_REPORT_FIELD_BY_KEY.get(f.key);
    if (!def) errors.push(`Unknown filter field ${f.key}`);
    if (!REPORT_FILTER_OPS.includes(f.op)) errors.push(`Unknown filter operator ${f.op}`);
    const n = f.values?.filter((v) => v.trim() !== '').length ?? 0;
    if (['eq', 'neq', 'contains', 'starts', 'gte', 'lte'].includes(f.op) && n < 1)
      errors.push(`Filter on ${def?.label ?? f.key} needs a value`);
    if (['in', 'not_in'].includes(f.op) && n < 1)
      errors.push(`Filter on ${def?.label ?? f.key} needs at least one value`);
    if (f.op === 'between' && n < 2)
      errors.push(`Filter on ${def?.label ?? f.key} needs a from and a to value`);
  }
  for (const s of spec.sort)
    if (!STUDENT_REPORT_FIELD_BY_KEY.has(s.key)) errors.push(`Unknown sort field ${s.key}`);
  if (format === 'pdf' && spec.columns.length > PDF_COLUMN_LIMIT[spec.options.paper])
    errors.push(
      `A PDF on ${spec.options.paper} holds at most ${String(PDF_COLUMN_LIMIT[spec.options.paper])} columns; choose fewer columns, A3 paper, or Excel`,
    );
  return errors;
}

export type ReportRow = Record<string, ProfileValue>;

/**
 * Loads one row per student enrolled in the year (optionally only some sections), with every
 * catalogue value plus the record, fee and transport columns.
 */
export async function loadStudentReportRows(
  c: PoolClient,
  opts: {
    academicYearId: string;
    sectionIds: string[] | null;
    includeInactive: boolean;
    showSensitive: boolean;
  },
): Promise<ReportRow[]> {
  const ids = await c.query<{
    id: string;
    status: string;
    enrolment_status: string;
    photo_file_id: string | null;
    profile_completeness: number;
    class_code: string;
    section: string;
    fee_group: string | null;
    student_type: string | null;
    fee_discount: string | null;
    route: string | null;
    stop: string | null;
  }>(
    `SELECT s.id::text, s.status::text, e.status::text AS enrolment_status, s.photo_file_id::text, s.profile_completeness, c.code AS class_code, cs.name AS section,
            fp.fee_group, fp.student_type, fd.name AS fee_discount,
            CASE WHEN r.id IS NULL THEN NULL ELSE r.code || ' ' || r.name END AS route,
            COALESCE(ts.name, ra.stop_name) AS stop
       FROM enrolments e
       JOIN students s ON s.id = e.student_id AND s.deleted_at IS NULL
       JOIN class_sections cs ON cs.id = e.class_section_id
       JOIN classes c ON c.id = cs.class_id
       LEFT JOIN student_fee_profiles fp ON fp.student_id = s.id AND fp.academic_year_id = e.academic_year_id
       LEFT JOIN fee_discounts fd ON fd.id = fp.discount_id
       LEFT JOIN student_route_assignments ra ON ra.student_id = s.id AND ra.academic_year_id = e.academic_year_id
       LEFT JOIN transport_routes r ON r.id = ra.route_id
       LEFT JOIN transport_stops ts ON ts.id = ra.stop_id
      WHERE e.academic_year_id = $1
        AND ($2::bigint[] IS NULL OR e.class_section_id = ANY($2::bigint[]))
        AND ($3::boolean OR (s.status = 'active' AND e.status = 'active'))
      ORDER BY c.code, cs.name, e.roll_no NULLS LAST, s.display_name
      LIMIT $4`,
    [opts.academicYearId, opts.sectionIds, opts.includeInactive, REPORT_MAX_ROWS],
  );
  const rows: ReportRow[] = [];
  const extras = new Map(ids.rows.map((x) => [x.id, x]));
  const all = ids.rows.map((x) => x.id);
  for (let i = 0; i < all.length; i += 1000) {
    const chunk = all.slice(i, i + 1000);
    const snaps = await readStudentProfiles(c, chunk, {
      academicYearId: opts.academicYearId,
      showSensitive: opts.showSensitive,
    });
    for (const id of chunk) {
      const snap = snaps.get(id);
      const x = extras.get(id)!;
      if (!snap) continue;
      rows.push({
        ...snap.values,
        full_name: [snap.values.first_name, snap.values.middle_name, snap.values.last_name]
          .filter(Boolean)
          .join(' '),
        class_section: `${x.class_code}-${x.section}`,
        student_status: x.status === 'active' ? 'Active' : 'Inactive',
        enrolment_status: x.enrolment_status.charAt(0).toUpperCase() + x.enrolment_status.slice(1),
        __id: id,
        __photo: x.photo_file_id,
        profile_completeness: x.profile_completeness,
        fee_group: x.fee_group,
        student_type: x.student_type === 'new' ? 'New' : x.student_type === 'old' ? 'Old' : null,
        fee_discount: x.fee_discount,
        transport_route: x.route,
        transport_stop: x.stop,
      });
    }
  }
  return rows;
}

const text = (v: ProfileValue): string => (v === null || v === undefined ? '' : String(v));
const cmpValue = (v: ProfileValue, type: ReportFieldDef['type']): string | number | null => {
  if (v === null || v === undefined || v === '') return null;
  if (type === 'number') {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  }
  if (type === 'date') return parseDate(String(v)) ?? String(v);
  return String(v).toLowerCase();
};
const cmpInput = (s: string, type: ReportFieldDef['type']): string | number | null => {
  const t = s.trim();
  if (t === '') return null;
  if (type === 'number') {
    const n = Number(t.replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  if (type === 'date') return parseDate(t) ?? t;
  return t.toLowerCase();
};

/** The search box: admission number, name, or any family mobile containing the text. */
export function applyReportSearch(rows: ReportRow[], search?: string | null): ReportRow[] {
  const q = (search ?? '').trim().toLowerCase();
  if (!q) return rows;
  const keys = [
    'admission_no',
    'full_name',
    'registration_no',
    'sms_mobile',
    'father_mobile',
    'mother_mobile',
    'guardian_mobile',
    'father_name',
    'mother_name',
  ];
  return rows.filter((r) =>
    keys.some((k) =>
      String(r[k] ?? '')
        .toLowerCase()
        .includes(q),
    ),
  );
}

export function applyReportFilters(rows: ReportRow[], filters: ReportFilter[]): ReportRow[] {
  if (!filters.length) return rows;
  return rows.filter((row) =>
    filters.every((f) => {
      const def = STUDENT_REPORT_FIELD_BY_KEY.get(f.key);
      if (!def) return true;
      const v = cmpValue(row[f.key] ?? null, def.type);
      const inputs = (f.values ?? []).map((x) => cmpInput(x, def.type)).filter((x) => x !== null);
      switch (f.op) {
        case 'empty':
          return v === null;
        case 'not_empty':
          return v !== null;
        case 'eq':
          return v !== null && v === inputs[0];
        case 'neq':
          return v !== inputs[0];
        case 'in':
          return v !== null && inputs.includes(v);
        case 'not_in':
          return !inputs.includes(v as never);
        case 'contains':
          return v !== null && String(v).includes(String(inputs[0] ?? ''));
        case 'starts':
          return v !== null && String(v).startsWith(String(inputs[0] ?? ''));
        case 'gte':
          return v !== null && inputs[0] !== undefined && v >= inputs[0];
        case 'lte':
          return v !== null && inputs[0] !== undefined && v <= inputs[0];
        case 'between':
          return v !== null && inputs.length >= 2 && v >= inputs[0]! && v <= inputs[1]!;
        default:
          return true;
      }
    }),
  );
}

export function sortReportRows(rows: ReportRow[], sort: ReportSort[]): ReportRow[] {
  if (!sort.length) return rows;
  const collator = new Intl.Collator('en-IN', { numeric: true, sensitivity: 'base' });
  return [...rows].sort((a, b) => {
    for (const s of sort) {
      const def = STUDENT_REPORT_FIELD_BY_KEY.get(s.key);
      const va = a[s.key] ?? null;
      const vb = b[s.key] ?? null;
      if (va === vb) continue;
      if (va === null) return 1; // empties last
      if (vb === null) return -1;
      const d =
        def?.type === 'number' ? Number(va) - Number(vb) : collator.compare(String(va), String(vb));
      if (d !== 0) return s.dir === 'desc' ? -d : d;
    }
    return 0;
  });
}

const OP_WORDS: Record<ReportFilterOp, string> = {
  eq: 'is',
  neq: 'is not',
  in: 'is one of',
  not_in: 'is none of',
  contains: 'contains',
  starts: 'starts with',
  empty: 'is empty',
  not_empty: 'is filled in',
  between: 'is between',
  gte: 'is on or after / at least',
  lte: 'is on or before / at most',
};

/** Filters in plain words for the report header: "Religion is one of Hindu, Sikh". */
export function describeReportFilters(filters: ReportFilter[]): string[] {
  return filters.map((f) => {
    const def = STUDENT_REPORT_FIELD_BY_KEY.get(f.key);
    const label = def?.label ?? f.key;
    const vals = (f.values ?? []).filter((v) => v.trim() !== '');
    const show = (v: string) => {
      if (def?.type !== 'date') return v;
      const d = parseDate(v);
      return d ? `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}` : v;
    };
    if (f.op === 'empty' || f.op === 'not_empty') return `${label} ${OP_WORDS[f.op]}`;
    if (f.op === 'between')
      return `${label} is between ${show(vals[0] ?? '')} and ${show(vals[1] ?? '')}`;
    if (f.op === 'gte')
      return `${label} ${def?.type === 'date' ? 'is on or after' : 'is at least'} ${show(vals[0] ?? '')}`;
    if (f.op === 'lte')
      return `${label} ${def?.type === 'date' ? 'is on or before' : 'is at most'} ${show(vals[0] ?? '')}`;
    return `${label} ${OP_WORDS[f.op]} ${vals.map(show).join(', ')}`;
  });
}

export interface ReportResult {
  columns: Array<{ key: string; header: string; type: ReportFieldDef['type']; width: number }>;
  rows: ReportRow[];
  total: number;
  filtersText: string[];
}

/** Filters, sorts and projects loaded rows onto the chosen columns and headers. */
export function shapeReport(rows: ReportRow[], spec: ReportSpec): ReportResult {
  const filtered = sortReportRows(
    applyReportFilters(applyReportSearch(rows, spec.options.search), spec.filters),
    spec.sort,
  );
  const columns = spec.columns.map((c) => {
    const def = STUDENT_REPORT_FIELD_BY_KEY.get(c.key)!;
    const header = c.label?.trim() || def.label;
    return {
      key: c.key,
      header,
      type: def.type,
      width: c.width ?? Math.min(Math.max(header.length + 2, def.type === 'date' ? 12 : 10), 40),
    };
  });
  const projected = filtered.map((r) => {
    const o: ReportRow = {};
    for (const col of columns) {
      const v = r[col.key] ?? null;
      o[col.key] =
        col.type === 'date' && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
          ? `${v.slice(8, 10)}-${v.slice(5, 7)}-${v.slice(0, 4)}`
          : v;
    }
    return o;
  });
  return {
    columns,
    rows: projected,
    total: projected.length,
    filtersText: spec.options.search?.trim()
      ? [`Search "${spec.options.search.trim()}"`, ...describeReportFilters(spec.filters)]
      : describeReportFilters(spec.filters),
  };
}

export { text as reportCellText };
