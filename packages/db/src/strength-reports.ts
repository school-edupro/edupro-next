import type { PoolClient } from 'pg';
import { PROFILE_LIST_DEFAULTS } from './student-fields';

/**
 * Student strength reports (2026-10-02): class-wise strength with fee concessions, category (caste)
 * with F / M / T, one concession's count per class, and age as on a date with F / M / T. One builder
 * serves the screen, the Excel and the PDF, so the three always agree.
 */
export type StrengthReportId = 'classwise' | 'category' | 'discount' | 'age';
export const STRENGTH_REPORTS: ReadonlyArray<{ id: StrengthReportId; title: string }> = [
  { id: 'classwise', title: 'Class-wise student report' },
  { id: 'category', title: 'Class-wise category report' },
  { id: 'discount', title: 'Discount-wise student summary' },
  { id: 'age', title: 'Class-wise age report' },
];

export interface StrengthParams {
  report: StrengthReportId;
  academicYearId: string;
  classIds?: string[];
  sectionIds?: string[];
  /** section rows (with class subtotals), one row per class, or class + stream for XI–XII */
  groupBy: 'section' | 'class' | 'class_stream';
  includeLeft?: boolean;
  showEmpty?: boolean;
  /** age report: the date ages are counted on (YYYY-MM-DD) */
  asOn?: string;
  /** discount report: the concession counted */
  discountId?: string;
}

export interface StrengthColumn {
  key: string;
  label: string;
  /** a two-row header: columns sharing a group sit under one heading (F / M / T) */
  group?: string;
}
export interface StrengthRow {
  label: string;
  kind: 'row' | 'subtotal' | 'total';
  values: Record<string, number>;
  /** what the row covers, so a count can open the students behind it */
  scope: { classId?: string; classSectionId?: string; stream?: string | null };
}
export interface StrengthTable {
  report: StrengthReportId;
  title: string;
  subtitle: string;
  columns: StrengthColumn[];
  rows: StrengthRow[];
  meta: { academicYear: string; asOn: string | null; filters: string[]; students: number };
}

interface Base {
  student_id: string;
  name: string;
  admission_no: string;
  gender: string;
  category: string | null;
  dob: string | null;
  stream: string | null;
  class_id: string;
  class_code: string;
  class_order: number;
  class_section_id: string;
  section: string;
  roll_no: number | null;
  enrol_status: string;
  discount_id: string | null;
  discount_name: string | null;
}

/** XI / XII stream as in the school's registers: SC, COM, HUM. */
export function streamCode(stream: string | null): string | null {
  const s = (stream ?? '').trim().toLowerCase();
  if (!s || s === 'not applicable') return null;
  if (s.startsWith('science')) return 'SC';
  if (s.startsWith('commerce')) return 'COM';
  if (s.startsWith('humanities') || s.startsWith('arts')) return 'HUM';
  return s.slice(0, 3).toUpperCase();
}

const STREAM_RANK: Record<string, number> = { SC: 1, COM: 2, HUM: 3 };

const AGE_BUCKETS = ['<5', ...Array.from({ length: 18 }, (_, i) => String(i + 5)), '>22'];

function ageOn(dob: string | null, asOn: string): number | null {
  if (!dob) return null;
  const [y, m, d] = dob.split('-').map(Number) as [number, number, number];
  const [ay, am, ad] = asOn.split('-').map(Number) as [number, number, number];
  let age = ay - y;
  if (am < m || (am === m && ad < d)) age -= 1;
  return age;
}

const ageBucket = (age: number) => (age < 5 ? '<5' : age > 22 ? '>22' : String(age));
const g3 = (gender: string) => (gender === 'female' ? 'F' : gender === 'male' ? 'M' : 'O');

async function base(c: PoolClient, p: StrengthParams): Promise<Base[]> {
  const r = await c.query<Base>(
    `SELECT s.id::text AS student_id, s.display_name AS name, s.admission_no, s.gender::text, s.category,
            to_char(s.dob, 'YYYY-MM-DD') AS dob, s.profile->>'stream' AS stream,
            k.id::text AS class_id, k.code AS class_code, k.display_order AS class_order,
            cs.id::text AS class_section_id, cs.name AS section, e.roll_no, e.status::text AS enrol_status,
            fd.id::text AS discount_id, fd.name AS discount_name
       FROM enrolments e
       JOIN students s ON s.id = e.student_id AND s.deleted_at IS NULL
       JOIN class_sections cs ON cs.id = e.class_section_id
       JOIN classes k ON k.id = cs.class_id
       LEFT JOIN student_fee_profiles fp ON fp.student_id = s.id AND fp.academic_year_id = e.academic_year_id
       LEFT JOIN fee_discounts fd ON fd.id = fp.discount_id
      WHERE e.academic_year_id = $1
        AND (e.status = 'active' OR ($2 AND e.status IN ('withdrawn', 'transferred', 'left')))
        AND ($3::bigint[] IS NULL OR k.id = ANY($3::bigint[]))
        AND ($4::bigint[] IS NULL OR cs.id = ANY($4::bigint[]))
      ORDER BY k.display_order, k.code, cs.name, e.roll_no NULLS LAST, s.display_name`,
    [
      p.academicYearId,
      Boolean(p.includeLeft),
      p.classIds?.length ? p.classIds : null,
      p.sectionIds?.length ? p.sectionIds : null,
    ],
  );
  return r.rows;
}

/** The row a student belongs to, with its label, order and scope. */
function rowKey(p: StrengthParams, b: Base) {
  const stream = streamCode(b.stream);
  if (p.groupBy === 'section')
    return {
      key: `s:${b.class_section_id}`,
      label: `${b.class_code}-${b.section}`,
      order: [b.class_order, b.class_code, b.section] as const,
      parent: `c:${b.class_id}`,
      parentLabel: `${b.class_code} TOTAL`,
      scope: { classId: b.class_id, classSectionId: b.class_section_id },
    };
  if (p.groupBy === 'class_stream' && stream)
    return {
      key: `cs:${b.class_id}:${stream}`,
      label: `${b.class_code}-${stream}`,
      // registers list Science, Commerce, Humanities in that order
      order: [b.class_order, b.class_code, `${String(STREAM_RANK[stream] ?? 9)}${stream}`] as const,
      parent: null,
      parentLabel: null,
      scope: { classId: b.class_id, stream: b.stream },
    };
  return {
    key: `c:${b.class_id}`,
    label: b.class_code,
    order: [b.class_order, b.class_code, ''] as const,
    parent: null,
    parentLabel: null,
    scope: { classId: b.class_id },
  };
}

/** The school's category list (falls back to the defaults). */
async function categories(c: PoolClient): Promise<string[]> {
  const listed = await c.query<{ value: string }>(
    `SELECT value FROM profile_lists WHERE list_code = 'Category' AND status = 'active' ORDER BY sort_order, value`,
  );
  return listed.rows.length
    ? listed.rows.map((x) => x.value)
    : [...(PROFILE_LIST_DEFAULTS.Category ?? [])];
}
/** Older registers write short codes; they count under the list's own value. */
const CATEGORY_ALIASES: Record<string, string> = {
  gen: 'General',
  general: 'General',
  'obc-ncl': 'OBC (Non-Creamy Layer)',
  'obc ncl': 'OBC (Non-Creamy Layer)',
  'obc (ncl)': 'OBC (Non-Creamy Layer)',
};
/** A student's category column: the list value it matches, a known short code, or its own value. */
const categoryOf = (cats: string[]) => (v: string | null) => {
  const raw = (v ?? '').trim();
  if (!raw) return 'Not given';
  const hit = cats.find((x) => x.toLowerCase() === raw.toLowerCase());
  if (hit) return hit;
  const alias = CATEGORY_ALIASES[raw.toLowerCase()];
  return alias && cats.includes(alias) ? alias : raw.toUpperCase();
};

/** Columns of each report, and how one student adds to them. */
async function shape(
  c: PoolClient,
  p: StrengthParams,
  rows: Base[],
): Promise<{
  columns: StrengthColumn[];
  add: (values: Record<string, number>, b: Base) => void;
  extraTitle: string;
}> {
  if (p.report === 'classwise') {
    const d = await c.query<{ id: string; name: string }>(
      `SELECT id::text, name FROM fee_discounts WHERE academic_year_id = $1 AND status = 'active' ORDER BY name`,
      [p.academicYearId],
    );
    const discounts = d.rows;
    for (const b of rows)
      if (b.discount_id && !discounts.some((x) => x.id === b.discount_id))
        discounts.push({ id: b.discount_id, name: b.discount_name ?? 'Discount' });
    return {
      columns: [
        { key: 'T', label: 'Total' },
        { key: 'M', label: 'Male' },
        { key: 'F', label: 'Female' },
        ...discounts.map((x) => ({ key: `d:${x.id}`, label: x.name })),
        { key: 'd:none', label: 'General' },
      ],
      add: (v, b) => {
        v.T = (v.T ?? 0) + 1;
        const g = g3(b.gender);
        if (g !== 'O') v[g] = (v[g] ?? 0) + 1;
        const k = b.discount_id ? `d:${b.discount_id}` : 'd:none';
        v[k] = (v[k] ?? 0) + 1;
      },
      extraTitle: '',
    };
  }
  if (p.report === 'category') {
    const cats = await categories(c);
    const catOf = categoryOf(cats);
    // values on file outside the list (e.g. EWS kept as a category) get their own column
    for (const extra of [...new Set(rows.map((b) => catOf(b.category)))].sort())
      if (!cats.includes(extra) && extra !== 'Not given') cats.push(extra);
    if (rows.some((b) => !b.category?.trim())) cats.push('Not given');
    const groups = [...cats, 'TOTAL'];
    return {
      columns: groups.flatMap((gname) =>
        ['F', 'M', 'T'].map((x) => ({ key: `${gname}|${x}`, label: x, group: gname })),
      ),
      add: (v, b) => {
        const cat = catOf(b.category);
        const g = g3(b.gender);
        for (const gname of [cat, 'TOTAL']) {
          if (g !== 'O') v[`${gname}|${g}`] = (v[`${gname}|${g}`] ?? 0) + 1;
          v[`${gname}|T`] = (v[`${gname}|T`] ?? 0) + 1;
        }
      },
      extraTitle: '',
    };
  }
  if (p.report === 'discount') {
    const d = await c.query<{ name: string }>(`SELECT name FROM fee_discounts WHERE id = $1`, [
      p.discountId ?? null,
    ]);
    return {
      columns: [
        { key: 'M', label: 'Male' },
        { key: 'F', label: 'Female' },
        { key: 'T', label: 'Student count' },
      ],
      add: (v, b) => {
        v.T = (v.T ?? 0) + 1;
        const g = g3(b.gender);
        if (g !== 'O') v[g] = (v[g] ?? 0) + 1;
      },
      extraTitle: d.rows[0] ? `Discount: ${d.rows[0].name}` : 'Discount',
    };
  }
  // age
  const asOn = p.asOn!;
  const buckets = [...AGE_BUCKETS];
  if (rows.some((b) => !b.dob)) buckets.push('DOB not given');
  return {
    columns: [...buckets, 'TOTAL'].flatMap((gname) =>
      ['F', 'M', 'T'].map((x) => ({ key: `${gname}|${x}`, label: x, group: gname })),
    ),
    add: (v, b) => {
      const age = ageOn(b.dob, asOn);
      const bucket = age === null ? 'DOB not given' : ageBucket(age);
      const g = g3(b.gender);
      for (const gname of [bucket, 'TOTAL']) {
        if (g !== 'O') v[`${gname}|${g}`] = (v[`${gname}|${g}`] ?? 0) + 1;
        v[`${gname}|T`] = (v[`${gname}|T`] ?? 0) + 1;
      }
    },
    extraTitle: `As on ${asOn.split('-').reverse().join('-')}`,
  };
}

/** Builds one strength report for the working school (inside a tenant transaction). */
export async function buildStrengthReport(
  c: PoolClient,
  p: StrengthParams,
): Promise<StrengthTable> {
  const all = await base(c, p);
  const rows = p.report === 'discount' ? all.filter((b) => b.discount_id === p.discountId) : all;
  const { columns, add, extraTitle } = await shape(c, p, rows);

  type Acc = StrengthRow & {
    order: readonly [number, string, string];
    parent: string | null;
    parentLabel: string | null;
  };
  const map = new Map<string, Acc>();
  for (const b of rows) {
    const k = rowKey(p, b);
    let acc = map.get(k.key);
    if (!acc) {
      acc = {
        label: k.label,
        kind: 'row',
        values: {},
        scope: k.scope,
        order: k.order,
        parent: k.parent,
        parentLabel: k.parentLabel,
      };
      map.set(k.key, acc);
    }
    add(acc.values, b);
  }
  // empty sections of the chosen classes, as zero rows (the registers show them)
  if (p.groupBy === 'section' && p.showEmpty) {
    const secs = await c.query<{
      id: string;
      name: string;
      class_id: string;
      code: string;
      display_order: number;
    }>(
      `SELECT cs.id::text, cs.name, k.id::text AS class_id, k.code, k.display_order
         FROM class_sections cs JOIN classes k ON k.id = cs.class_id
        WHERE cs.academic_year_id = $1 AND cs.status = 'active'
          AND ($2::bigint[] IS NULL OR k.id = ANY($2::bigint[]))
          AND ($3::bigint[] IS NULL OR cs.id = ANY($3::bigint[]))`,
      [
        p.academicYearId,
        p.classIds?.length ? p.classIds : null,
        p.sectionIds?.length ? p.sectionIds : null,
      ],
    );
    for (const s of secs.rows)
      if (!map.has(`s:${s.id}`))
        map.set(`s:${s.id}`, {
          label: `${s.code}-${s.name}`,
          kind: 'row',
          values: {},
          scope: { classId: s.class_id, classSectionId: s.id },
          order: [s.display_order, s.code, s.name],
          parent: `c:${s.class_id}`,
          parentLabel: `${s.code} TOTAL`,
        });
  }
  const sorted = [...map.values()].sort(
    (a, b) =>
      a.order[0] - b.order[0] ||
      a.order[1].localeCompare(b.order[1]) ||
      a.order[2].localeCompare(b.order[2], undefined, { numeric: true }),
  );
  const sum = (list: StrengthRow[]) => {
    const v: Record<string, number> = {};
    for (const r of list) for (const [k, n] of Object.entries(r.values)) v[k] = (v[k] ?? 0) + n;
    return v;
  };
  const out: StrengthRow[] = [];
  for (let i = 0; i < sorted.length; i += 1) {
    const r = sorted[i]!;
    out.push({ label: r.label, kind: 'row', values: r.values, scope: r.scope });
    const next = sorted[i + 1];
    if (r.parent && (!next || next.parent !== r.parent)) {
      const group = sorted.filter((x) => x.parent === r.parent);
      out.push({
        label: r.parentLabel!,
        kind: 'subtotal',
        values: sum(group),
        scope: { classId: r.scope.classId },
      });
    }
  }
  out.push({ label: 'GRAND TOTAL', kind: 'total', values: sum(sorted), scope: {} });

  const year = await c.query<{ code: string }>(`SELECT code FROM academic_years WHERE id = $1`, [
    p.academicYearId,
  ]);
  const def = STRENGTH_REPORTS.find((x) => x.id === p.report)!;
  const filters: string[] = [];
  if (p.classIds?.length || p.sectionIds?.length) {
    const labels = [
      ...new Set(
        all.map((b) => (p.sectionIds?.length ? `${b.class_code}-${b.section}` : b.class_code)),
      ),
    ];
    filters.push(`${p.sectionIds?.length ? 'Sections' : 'Classes'}: ${labels.join(', ') || '—'}`);
  }
  filters.push(
    `Grouped by ${p.groupBy === 'section' ? 'section' : p.groupBy === 'class' ? 'class' : 'class and stream'}`,
  );
  if (p.includeLeft) filters.push('Includes students who left during the year');
  return {
    report: p.report,
    title: def.title,
    subtitle: [extraTitle, `Session ${year.rows[0]?.code ?? ''}`].filter(Boolean).join(' · '),
    columns,
    rows: out,
    meta: {
      academicYear: year.rows[0]?.code ?? '',
      asOn: p.asOn ?? null,
      filters,
      students: rows.length,
    },
  };
}

/** The students behind one count of a report (row scope + column), for the click-through list. */
export async function strengthStudents(
  c: PoolClient,
  p: StrengthParams,
  scope: StrengthRow['scope'],
  column: string,
): Promise<
  Array<{
    id: string;
    name: string;
    admissionNo: string;
    classSection: string;
    rollNo: number | null;
    gender: string;
    status: string;
  }>
> {
  const all = await base(c, p);
  const inScope = all.filter(
    (b) =>
      (!scope.classId || b.class_id === scope.classId) &&
      (!scope.classSectionId || b.class_section_id === scope.classSectionId) &&
      (scope.stream === undefined || streamCode(b.stream) === streamCode(scope.stream ?? null)),
  );
  const [group, part] = column.includes('|') ? column.split('|') : [null, column];
  const catOf = p.report === 'category' ? categoryOf(await categories(c)) : null;
  const pick = inScope.filter((b) => {
    if (p.report === 'discount' && b.discount_id !== p.discountId) return false;
    const g = g3(b.gender);
    const genderOk = part === 'T' || part === g;
    if (p.report === 'classwise') {
      if (column === 'T') return true;
      if (column === 'M' || column === 'F') return g === column;
      if (column === 'd:none') return !b.discount_id;
      return column === `d:${b.discount_id}`;
    }
    if (p.report === 'discount') return part === 'T' || g === part;
    if (!genderOk || group === null) return false;
    if (group === 'TOTAL') return true;
    if (catOf) return catOf(b.category) === group;
    const age = ageOn(b.dob, p.asOn!);
    return age === null ? group === 'DOB not given' : ageBucket(age) === group;
  });
  return pick.map((b) => ({
    id: b.student_id,
    name: b.name,
    admissionNo: b.admission_no,
    classSection: `${b.class_code}-${b.section}`,
    rollNo: b.roll_no,
    gender: b.gender,
    status: b.enrol_status,
  }));
}
