import type { PoolClient } from 'pg';

/**
 * The employee's row lists (0175, 0180) as staff see and change them from My profile (0187,
 * docs/design/33-people-dashboards.md): education, languages, work experience and documents. One
 * definition drives the self-service screens, the API checks and the row summaries in approvals.
 */
export type EmployeeListKind = 'education' | 'languages' | 'experience' | 'documents';
export const EMPLOYEE_LIST_KINDS: readonly EmployeeListKind[] = [
  'education',
  'languages',
  'experience',
  'documents',
];
export type EmployeeRowOp = 'add' | 'edit' | 'remove';

export interface EmployeeListColumn {
  key: string;
  label: string;
  type: 'text' | 'year' | 'date' | 'boolean' | 'select' | 'doctype' | 'file';
  /** Drop-down list code (profile lists), for select columns. */
  list?: string;
  required?: boolean;
  max?: number;
}

export interface EmployeeListDef {
  title: string;
  /** Row table; documents live in employee_documents with their own shape. */
  table: 'employee_education' | 'employee_languages' | 'employee_experience' | null;
  /** API key → column, for the three row tables. */
  cols: Record<string, string>;
  columns: EmployeeListColumn[];
  order: string;
  /** What a change of this list usually proves (shown as help on the settings page). */
  proofHint: string;
}

export const EMPLOYEE_LISTS: Record<EmployeeListKind, EmployeeListDef> = {
  education: {
    title: 'Education',
    table: 'employee_education',
    cols: {
      qualification: 'qualification',
      specialisation: 'specialisation',
      institution: 'institution',
      passingYear: 'passing_year',
      score: 'score',
      mode: 'mode',
    },
    columns: [
      {
        key: 'qualification',
        label: 'Qualification',
        type: 'select',
        list: 'Qualification',
        required: true,
        max: 80,
      },
      { key: 'specialisation', label: 'Subject / specialisation', type: 'text', max: 120 },
      { key: 'institution', label: 'Board / university', type: 'text', max: 200 },
      { key: 'passingYear', label: 'Year', type: 'year' },
      { key: 'score', label: 'Marks / grade', type: 'text', max: 20 },
      { key: 'mode', label: 'Mode', type: 'select', list: 'EducationMode', max: 30 },
    ],
    order: 'passing_year DESC NULLS LAST, id',
    proofHint: 'degree or mark sheet',
  },
  languages: {
    title: 'Languages',
    table: 'employee_languages',
    cols: {
      language: 'language',
      canRead: 'can_read',
      canWrite: 'can_write',
      canSpeak: 'can_speak',
    },
    columns: [
      {
        key: 'language',
        label: 'Language',
        type: 'select',
        list: 'Language',
        required: true,
        max: 40,
      },
      { key: 'canRead', label: 'Read', type: 'boolean' },
      { key: 'canWrite', label: 'Write', type: 'boolean' },
      { key: 'canSpeak', label: 'Speak', type: 'boolean' },
    ],
    order: 'language',
    proofHint: 'none',
  },
  experience: {
    title: 'Work experience',
    table: 'employee_experience',
    cols: {
      organisation: 'organisation',
      designation: 'designation',
      fromOn: 'from_on',
      toOn: 'to_on',
      reason: 'reason',
    },
    columns: [
      { key: 'organisation', label: 'Organisation', type: 'text', required: true, max: 200 },
      { key: 'designation', label: 'Designation', type: 'text', max: 120 },
      { key: 'fromOn', label: 'From', type: 'date' },
      { key: 'toOn', label: 'To', type: 'date' },
      { key: 'reason', label: 'Reason for leaving', type: 'text', max: 200 },
    ],
    order: 'from_on DESC NULLS LAST, id',
    proofHint: 'experience or relieving letter',
  },
  documents: {
    title: 'Documents',
    table: null,
    cols: {},
    columns: [
      { key: 'typeId', label: 'Document', type: 'doctype', required: true },
      { key: 'fileId', label: 'File', type: 'file', required: true },
      { key: 'number', label: 'Number', type: 'text', max: 80 },
      { key: 'issuedOn', label: 'Issued on', type: 'date' },
      { key: 'expiresOn', label: 'Valid till', type: 'date' },
    ],
    order: 'created_at DESC',
    proofHint: 'the document itself',
  },
};

export type RowData = Record<string, string | number | boolean | null>;

export interface EmployeeListRow {
  id: string;
  values: RowData;
}

/** The rows of one list, as the API keys. Documents carry the type name, file name and verification. */
export async function readEmployeeRows(
  c: PoolClient,
  employeeId: string,
  kind: EmployeeListKind,
): Promise<EmployeeListRow[]> {
  if (kind === 'documents') {
    const r = await c.query<{
      id: string;
      type_id: string;
      type_name: string;
      file_id: string;
      file_name: string | null;
      number: string | null;
      issued_on: string | null;
      expires_on: string | null;
      verified: boolean;
    }>(
      `SELECT d.id::text, d.type_id::text, t.name AS type_name, d.file_id::text, f.original_name AS file_name,
              d.number, d.issued_on::text, d.expires_on::text, d.verified_at IS NOT NULL AS verified
         FROM employee_documents d JOIN employee_document_types t ON t.id = d.type_id JOIN files f ON f.id = d.file_id
        WHERE d.employee_id = $1 AND d.deleted_at IS NULL ORDER BY d.created_at DESC`,
      [employeeId],
    );
    return r.rows.map((x) => ({
      id: x.id,
      values: {
        typeId: x.type_id,
        typeName: x.type_name,
        fileId: x.file_id,
        fileName: x.file_name,
        number: x.number,
        issuedOn: x.issued_on,
        expiresOn: x.expires_on,
        verified: x.verified,
      },
    }));
  }
  const def = EMPLOYEE_LISTS[kind];
  const sel = Object.entries(def.cols)
    .map(([k, col]) => (/_on$/.test(col) ? `${col}::text AS "${k}"` : `${col} AS "${k}"`))
    .join(', ');
  const r = await c.query<Record<string, unknown>>(
    // eslint-disable-next-line no-restricted-syntax -- table, columns and order come from the EMPLOYEE_LISTS constant; the id is bound
    `SELECT id::text, ${sel} FROM ${def.table} WHERE employee_id = $1 ORDER BY ${def.order}`,
    [employeeId],
  );
  return r.rows.map((x) => {
    const { id, ...values } = x;
    return { id: String(id), values: values as RowData };
  });
}

export async function insertEmployeeRow(
  c: PoolClient,
  employeeId: string,
  kind: Exclude<EmployeeListKind, 'documents'>,
  data: RowData,
): Promise<string> {
  const def = EMPLOYEE_LISTS[kind];
  const keys = Object.keys(def.cols).filter((k) => data[k] !== undefined);
  const r = await c.query<{ id: string }>(
    // eslint-disable-next-line no-restricted-syntax -- table and columns from the EMPLOYEE_LISTS constant; values are bound
    `INSERT INTO ${def.table} (school_id, employee_id, created_by${keys.map((k) => `, ${def.cols[k]}`).join('')})
     VALUES (app.current_school_id(), $1, app.current_user_id()${keys.map((_, i) => `, $${i + 2}`).join('')}) RETURNING id::text`,
    [employeeId, ...keys.map((k) => data[k])],
  );
  return r.rows[0]!.id;
}

export async function updateEmployeeRow(
  c: PoolClient,
  employeeId: string,
  kind: Exclude<EmployeeListKind, 'documents'>,
  rowId: string,
  data: RowData,
): Promise<boolean> {
  const def = EMPLOYEE_LISTS[kind];
  const keys = Object.keys(def.cols);
  const r = await c.query(
    // eslint-disable-next-line no-restricted-syntax -- table and columns from the EMPLOYEE_LISTS constant; values are bound
    `UPDATE ${def.table} SET ${keys.map((k, i) => `${def.cols[k]} = $${i + 3}`).join(', ')} WHERE id = $1 AND employee_id = $2`,
    [rowId, employeeId, ...keys.map((k) => data[k] ?? null)],
  );
  return (r.rowCount ?? 0) > 0;
}

export async function deleteEmployeeRow(
  c: PoolClient,
  employeeId: string,
  kind: Exclude<EmployeeListKind, 'documents'>,
  rowId: string,
): Promise<boolean> {
  const def = EMPLOYEE_LISTS[kind];
  const r = await c.query(
    // eslint-disable-next-line no-restricted-syntax -- the table from the EMPLOYEE_LISTS constant; values are bound
    `DELETE FROM ${def.table} WHERE id = $1 AND employee_id = $2`,
    [rowId, employeeId],
  );
  return (r.rowCount ?? 0) > 0;
}

const dmy = (v: unknown) =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
    ? `${v.slice(8, 10)}-${v.slice(5, 7)}-${v.slice(0, 4)}`
    : v === null || v === undefined || v === ''
      ? null
      : String(v);

/** One line that says what a row is, for approvals and request lists. */
export function summariseEmployeeRow(kind: EmployeeListKind, d: RowData | null): string {
  if (!d) return '—';
  const s = (k: string) => {
    const v = d[k];
    return v === null || v === undefined || v === '' ? null : String(v);
  };
  switch (kind) {
    case 'education':
      return [
        `${s('qualification') ?? '?'}${s('specialisation') ? ` (${s('specialisation')!})` : ''}`,
        s('institution'),
        s('passingYear'),
        s('score'),
        s('mode'),
      ]
        .filter(Boolean)
        .join(', ');
    case 'languages': {
      const can = (['canRead', 'canWrite', 'canSpeak'] as const)
        .filter((k) => d[k] === true || d[k] === 'true')
        .map((k) => ({ canRead: 'read', canWrite: 'write', canSpeak: 'speak' })[k]);
      return `${s('language') ?? '?'}${can.length ? `: ${can.join(', ')}` : ''}`;
    }
    case 'experience':
      return `${s('organisation') ?? '?'}${s('designation') ? ` – ${s('designation')!}` : ''}, ${dmy(d.fromOn) ?? '?'} to ${dmy(d.toOn) ?? 'date'}${s('reason') ? ` (${s('reason')!})` : ''}`;
    case 'documents':
      return [
        `${s('typeName') ?? 'Document'}${s('number') ? ` ${s('number')!}` : ''}`,
        dmy(d.issuedOn) ? `issued ${dmy(d.issuedOn)!}` : null,
        dmy(d.expiresOn) ? `valid till ${dmy(d.expiresOn)!}` : null,
        // the file itself is never named on screen: it is opened through a View icon
      ]
        .filter(Boolean)
        .join(', ');
  }
}

/** The change key of a row operation inside employee_change_requests.changes. */
export const employeeRowKey = (kind: EmployeeListKind, op: EmployeeRowOp, rowId: string) =>
  `list:${kind}:${op}:${rowId}`;
export function parseEmployeeRowKey(
  key: string,
): { kind: EmployeeListKind; op: EmployeeRowOp; rowId: string } | null {
  const m = /^list:(education|languages|experience|documents):(add|edit|remove):(.+)$/.exec(key);
  if (!m) return null;
  return { kind: m[1] as EmployeeListKind, op: m[2] as EmployeeRowOp, rowId: m[3]! };
}
