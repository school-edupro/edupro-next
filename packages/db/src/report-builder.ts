import type { PoolClient } from 'pg';
import { PROFILE_FIELDS, PROFILE_SECTIONS, type ProfileField } from './student-fields';
import { parseDate, type ProfileValue } from './student-profile';
import { readStudentProfiles } from './student-profile-store';
import {
  EMPLOYEE_REPORT_FIELDS,
  EMPLOYEE_REPORT_SECTIONS,
  EMPLOYEE_SEARCH_KEYS,
} from './employee-report';
import {
  ADMISSION_REPORT_FIELDS,
  ADMISSION_REPORT_SECTIONS,
  ADMISSION_SEARCH_KEYS,
} from './admission-report';

/**
 * Report builder (student 360 profile): a saved report is a list of columns (with the header text the
 * user wants), filters, a sort and page options. Rows come from the profile catalogue plus a few
 * record, fee and transport columns; filters and sort run on the resolved values so every field can be
 * used, whatever its storage.
 */

export const REPORT_DATASETS = ['student_profile', 'employee_profile', 'admissions'] as const;
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
  /** Detailed layout: fields with the same group number stack in one column (1–20). */
  group?: number | null;
  /** Shown with a yellow highlight on screen and in the exports. */
  highlight?: boolean;
  /** Excluded: kept in the report's design but left out of the screen and the exports. */
  hidden?: boolean;
}
export interface ReportFilter {
  key: string;
  op: ReportFilterOp;
  values?: string[];
  /** Asked each time the report is downloaded; with no value given it is left out. */
  ask?: boolean;
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
  /** Whose rows: students (the default) or employees. */
  dataset?: ReportDataset;
  columns: ReportColumn[];
  filters: ReportFilter[];
  sort: ReportSort[];
  options: ReportOptions;
  /** 'table' (one field per column) or 'detailed' (stacked fields per column, like an office register). */
  layout?: 'table' | 'detailed';
  /** Detailed layout: an optional heading per group number. */
  groupLabels?: Record<string, string>;
}

/**
 * The office-register template: class, then the student, the father, the mother and the address and
 * contacts, each as one stacked column.
 */
export const DETAILED_TEMPLATE: ReportColumn[] = [
  ['class_section', 1],
  ['full_name', 2],
  ['admission_no', 2],
  ['dob', 2],
  ['admitted_on', 2],
  ['gender', 2],
  ['category', 2],
  ['aadhaar_no', 2],
  ['father_name', 3],
  ['father_education', 3],
  ['father_designation', 3],
  ['father_organisation', 3],
  ['father_office_address_line_1', 3],
  ['father_mobile', 3],
  ['father_aadhaar_no', 3],
  ['mother_name', 4],
  ['mother_education', 4],
  ['mother_designation', 4],
  ['mother_organisation', 4],
  ['mother_office_address_line_1', 4],
  ['mother_mobile', 4],
  ['mother_aadhaar_no', 4],
  ['residential_address_line_1', 5],
  ['sms_mobile', 5],
  ['alternate_mobile', 5],
  ['primary_email', 5],
].map(([key, group]) => ({ key: key as string, group: group as number }));

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

const EMPLOYEE_REPORT_FIELD_BY_KEY: ReadonlyMap<string, ReportFieldDef> = new Map(
  EMPLOYEE_REPORT_FIELDS.map((f) => [f.key, f]),
);
const ADMISSION_REPORT_FIELD_BY_KEY: ReadonlyMap<string, ReportFieldDef> = new Map(
  ADMISSION_REPORT_FIELDS.map((f) => [f.key, f]),
);
/** A dataset's fields, sections and search keys. */
export function reportDataset(dataset: ReportDataset | undefined = 'student_profile') {
  if (dataset === 'admissions')
    return {
      fields: ADMISSION_REPORT_FIELDS,
      byKey: ADMISSION_REPORT_FIELD_BY_KEY,
      sections: ADMISSION_REPORT_SECTIONS,
      search: ADMISSION_SEARCH_KEYS,
    };
  return dataset === 'employee_profile'
    ? {
        fields: EMPLOYEE_REPORT_FIELDS,
        byKey: EMPLOYEE_REPORT_FIELD_BY_KEY,
        sections: EMPLOYEE_REPORT_SECTIONS,
        search: EMPLOYEE_SEARCH_KEYS,
      }
    : {
        fields: STUDENT_REPORT_FIELDS,
        byKey: STUDENT_REPORT_FIELD_BY_KEY,
        sections: REPORT_SECTIONS,
        search: STUDENT_SEARCH_KEYS,
      };
}

/** Structural checks; returns human messages (empty when the spec is usable). */
export function validateReportSpec(spec: ReportSpec, format?: 'xlsx' | 'pdf'): string[] {
  const byKey = reportDataset(spec.dataset).byKey;
  const errors: string[] = [];
  if (!spec.columns.length) errors.push('Choose at least one column');
  if (spec.columns.length > 250) errors.push('At most 250 columns');
  const seen = new Set<string>();
  for (const c of spec.columns) {
    if (!byKey.has(c.key)) errors.push(`Unknown column ${c.key}`);
    if (seen.has(c.key)) errors.push(`Column ${c.key} is chosen twice`);
    seen.add(c.key);
    if (c.label && c.label.length > 80)
      errors.push(`Header for ${c.key} is longer than 80 characters`);
  }
  for (const f of spec.filters) {
    const def = byKey.get(f.key);
    if (!def) errors.push(`Unknown filter field ${f.key}`);
    if (!REPORT_FILTER_OPS.includes(f.op)) errors.push(`Unknown filter operator ${f.op}`);
    const n = f.values?.filter((v) => v.trim() !== '').length ?? 0;
    if (f.ask && n === 0) continue;
    if (['eq', 'neq', 'contains', 'starts', 'gte', 'lte'].includes(f.op) && n < 1)
      errors.push(`Filter on ${def?.label ?? f.key} needs a value`);
    if (['in', 'not_in'].includes(f.op) && n < 1)
      errors.push(`Filter on ${def?.label ?? f.key} needs at least one value`);
    if (f.op === 'between' && n < 2)
      errors.push(`Filter on ${def?.label ?? f.key} needs a from and a to value`);
  }
  for (const s of spec.sort) if (!byKey.has(s.key)) errors.push(`Unknown sort field ${s.key}`);
  for (const c of spec.columns)
    if (
      c.group !== undefined &&
      c.group !== null &&
      (!Number.isInteger(c.group) || c.group < 1 || c.group > 20)
    )
      errors.push(`Column ${c.key}: the stack number must be 1 to 20`);
  if (!spec.columns.some((c) => !c.hidden))
    errors.push('Every column is excluded; keep at least one');
  const pdfColumns =
    spec.layout === 'detailed'
      ? reportGroups(spec).length + 1
      : spec.columns.filter((c) => !c.hidden).length;
  if (format === 'pdf' && pdfColumns > PDF_COLUMN_LIMIT[spec.options.paper])
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
const STUDENT_SEARCH_KEYS = [
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
export function applyReportSearch(
  rows: ReportRow[],
  search?: string | null,
  dataset: ReportDataset = 'student_profile',
): ReportRow[] {
  const q = (search ?? '').trim().toLowerCase();
  if (!q) return rows;
  const keys = reportDataset(dataset).search;
  return rows.filter((r) =>
    keys.some((k) =>
      String(r[k] ?? '')
        .toLowerCase()
        .includes(q),
    ),
  );
}

export function applyReportFilters(
  rows: ReportRow[],
  filters: ReportFilter[],
  dataset: ReportDataset = 'student_profile',
): ReportRow[] {
  if (!filters.length) return rows;
  const byKey = reportDataset(dataset).byKey;
  return rows.filter((row) =>
    filters.every((f) => {
      const def = byKey.get(f.key);
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

export function sortReportRows(
  rows: ReportRow[],
  sort: ReportSort[],
  dataset: ReportDataset = 'student_profile',
): ReportRow[] {
  if (!sort.length) return rows;
  const byKey = reportDataset(dataset).byKey;
  const collator = new Intl.Collator('en-IN', { numeric: true, sensitivity: 'base' });
  return [...rows].sort((a, b) => {
    for (const s of sort) {
      const def = byKey.get(s.key);
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
export function describeReportFilters(
  filters: ReportFilter[],
  dataset: ReportDataset = 'student_profile',
): string[] {
  const byKey = reportDataset(dataset).byKey;
  return filters.map((f) => {
    const def = byKey.get(f.key);
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
  columns: Array<{
    key: string;
    header: string;
    type: ReportFieldDef['type'];
    width: number;
    highlight: boolean;
  }>;
  rows: ReportRow[];
  total: number;
  filtersText: string[];
  layout: 'table' | 'detailed';
  /** Detailed layout: the stacked columns in order (keys of `columns`). */
  groups: Array<{ label: string | null; keys: string[] }>;
  /** Fields left out of this run (excluded), by header, for the report's note line. */
  excluded: string[];
  highlighted: string[];
}

/**
 * The stacked columns of a detailed report: shown fields with the same group number share a column,
 * in the order the group first appears; a field without a number has a column of its own.
 */
export function reportGroups(spec: ReportSpec): Array<{ label: string | null; keys: string[] }> {
  const out: Array<{ id: string; label: string | null; keys: string[] }> = [];
  for (const c of spec.columns) {
    if (c.hidden) continue;
    const id = c.group ? `g${String(c.group)}` : `k:${c.key}`;
    let g = out.find((x) => x.id === id);
    if (!g) {
      g = {
        id,
        label: c.group ? spec.groupLabels?.[String(c.group)]?.trim() || null : null,
        keys: [],
      };
      out.push(g);
    }
    g.keys.push(c.key);
  }
  return out.map(({ label, keys }) => ({ label, keys }));
}

/** True when a filter has what its condition needs (a value, two for between, none for empty). */
function filterHasValue(f: ReportFilter): boolean {
  if (f.op === 'empty' || f.op === 'not_empty') return true;
  const n = (f.values ?? []).filter((v) => v.trim() !== '').length;
  return f.op === 'between' ? n >= 2 : n >= 1;
}

/** The filters that apply to a run: an "ask when running" filter left without a value is skipped. */
export function activeReportFilters(filters: ReportFilter[]): ReportFilter[] {
  return filters.filter((f) => !f.ask || filterHasValue(f));
}

/** Filters, search and status given when a saved report is downloaded (the list's view, or the form). */
export interface ReportRuntime {
  filters?: ReportFilter[];
  search?: string | null;
  includeInactive?: boolean;
}

/**
 * A saved report run with run-time filters: both apply, except that a run-time filter on a field
 * replaces the report's own filters on that field (so "Class VI-A" chosen now beats the class saved).
 * The search and the status given now win too. The saved report itself does not change.
 */
export function withRuntimeFilters(spec: ReportSpec, runtime?: ReportRuntime | null): ReportSpec {
  if (!runtime) return { ...spec, filters: activeReportFilters(spec.filters) };
  const given = (runtime.filters ?? [])
    .filter(filterHasValue)
    .map(({ key, op, values }) => ({ key, op, values }));
  const keys = new Set(given.map((f) => f.key));
  return {
    ...spec,
    filters: [...activeReportFilters(spec.filters).filter((f) => !keys.has(f.key)), ...given],
    options: {
      ...spec.options,
      search: runtime.search?.trim() ? runtime.search.trim() : (spec.options.search ?? null),
      includeInactive: runtime.includeInactive ?? spec.options.includeInactive,
    },
  };
}

/** Filters, sorts and projects loaded rows onto the chosen columns and headers. */
export function shapeReport(rows: ReportRow[], spec: ReportSpec): ReportResult {
  const ds = spec.dataset ?? 'student_profile';
  const filters = activeReportFilters(spec.filters);
  const byKey = reportDataset(ds).byKey;
  const filtered = sortReportRows(
    applyReportFilters(applyReportSearch(rows, spec.options.search, ds), filters, ds),
    spec.sort,
    ds,
  );
  const columns = spec.columns
    .filter((c) => !c.hidden)
    .map((c) => {
      const def = byKey.get(c.key)!;
      const header = c.label?.trim() || def.label;
      return {
        key: c.key,
        header,
        type: def.type,
        width: c.width ?? Math.min(Math.max(header.length + 2, def.type === 'date' ? 12 : 10), 40),
        highlight: Boolean(c.highlight),
      };
    });
  const headerOf = (c: ReportColumn) => c.label?.trim() || byKey.get(c.key)?.label || c.key;
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
      ? [`Search "${spec.options.search.trim()}"`, ...describeReportFilters(filters, ds)]
      : describeReportFilters(filters, ds),
    layout: spec.layout === 'detailed' ? 'detailed' : 'table',
    groups: spec.layout === 'detailed' ? reportGroups(spec) : [],
    excluded: spec.columns.filter((c) => c.hidden).map(headerOf),
    highlighted: columns.filter((c) => c.highlight).map((c) => c.header),
  };
}

export { text as reportCellText };
