import type { PoolClient } from 'pg';
import {
  EMPLOYEE_FIELDS,
  EMPLOYEE_FIELD_BY_KEY,
  EMPLOYEE_LIST_DEFAULTS,
  type EmployeeField,
} from './employee-fields';
import { decryptField, encryptField, maskValue } from './field-crypto';
import {
  applies,
  normaliseValue,
  type ProfileLists,
  type ProfileValue,
  type ProfileValues,
} from './student-profile';
import { loadProfileLists } from './student-profile-store';

/*
 * Reads and writes an employee's catalogue values (employee-fields.ts) across their storage: employees
 * columns, employees.address (present / permanent), employees.profile and employees.secure (encrypted).
 * Validation is the student catalogue's; an approver is picked by employee code or id and kept as the id.
 */

export class EmployeeWriteError extends Error {
  constructor(public readonly errors: Record<string, string>) {
    super('The employee profile has errors');
  }
}

/** The drop-downs: the profile lists and geography (shared with students) plus the staff setup masters. */
export async function loadEmployeeLists(c: PoolClient): Promise<ProfileLists> {
  const lists = await loadProfileLists(c);
  const m = await c.query<{ kind: string; name: string }>(
    `SELECT 'Department' AS kind, name, sort_order FROM departments WHERE status = 'active'
     UNION ALL SELECT 'Designation', name, sort_order FROM designations WHERE status = 'active'
     UNION ALL SELECT 'EmployeeType', name, sort_order FROM employee_types WHERE status = 'active'
     ORDER BY 1, 3, 2`,
  );
  for (const x of m.rows) (lists[x.kind] ??= []).push(x.name);
  // a staff list the school has not filled yet: the starter values
  for (const [code, values] of Object.entries(EMPLOYEE_LIST_DEFAULTS))
    if (!lists[code]?.length) lists[code] = values;
  return lists;
}

interface EmployeeRow {
  id: string;
  employee_code: string;
  first_name: string;
  last_name: string | null;
  gender: string | null;
  dob: string | null;
  designation: string | null;
  department: string | null;
  joined_on: string | null;
  left_on: string | null;
  mobile: string | null;
  email: string | null;
  biometric_id: string | null;
  address: Record<string, Record<string, unknown>>;
  profile: Record<string, unknown>;
  secure: Record<string, string>;
}

const SELECT = `SELECT id::text, employee_code, first_name, last_name, gender::text AS gender, dob::text, designation, department,
       joined_on::text, left_on::text, mobile, email::text, biometric_id, address, profile, secure
  FROM employees`;

/** Completed years between two YYYY-MM-DD dates. */
function yearsBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = to.split('-').map(Number) as [number, number, number];
  return ty - fy - (tm < fm || (tm === fm && td < fd) ? 1 : 0);
}

/** Values from a row; sensitive ones masked unless `full`. Approvers stay ids (labels come separately). */
function valuesOf(r: EmployeeRow, full: boolean, today: string): ProfileValues {
  const v: ProfileValues = {};
  for (const f of EMPLOYEE_FIELDS) {
    const s = f.store;
    let x: unknown = null;
    if (s.t === 'col') {
      x = (r as unknown as Record<string, unknown>)[s.col];
      if (s.col === 'gender') x = GENDER_LABEL[String(x)] ?? null;
    } else if (s.t === 'addr') x = r.address?.[s.part]?.[s.key];
    else if (s.t === 'json') x = r.profile?.[s.key];
    else if (s.t === 'secure') {
      const stored = r.secure?.[s.key];
      const plain = stored ? decryptField(stored) : null;
      x = plain === null ? null : full ? plain : maskValue(plain, f.type);
    }
    v[f.key] = x === undefined || x === '' ? null : (x as ProfileValue);
  }
  v.age = v.dob ? yearsBetween(String(v.dob), today) : null;
  const end = (v.left_on as string | null) ?? today;
  v.service_years = v.joined_on ? Math.max(0, yearsBetween(String(v.joined_on), end)) : null;
  return v;
}

export async function readEmployeeProfile(
  c: PoolClient,
  id: string,
  full: boolean,
): Promise<{ values: ProfileValues; approvers: Record<string, string> } | null> {
  // eslint-disable-next-line no-restricted-syntax -- SELECT is a fixed fragment; values are bound
  const r = await c.query<EmployeeRow>(`${SELECT} WHERE id = $1 AND deleted_at IS NULL`, [id]);
  if (!r.rows[0]) return null;
  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const values = valuesOf(r.rows[0], full, today);
  // the approvers' names and codes
  const ids = EMPLOYEE_FIELDS.filter((f) => f.type === 'employee')
    .map((f) => values[f.key])
    .filter((x): x is string => typeof x === 'string' && /^\d+$/.test(x));
  const approvers: Record<string, string> = {};
  if (ids.length) {
    const n = await c.query<{ id: string; label: string }>(
      `SELECT id::text, display_name || ' (' || employee_code || ')' AS label FROM employees WHERE id = ANY($1::bigint[])`,
      [ids],
    );
    for (const x of n.rows) approvers[x.id] = x.label;
  }
  return { values, approvers };
}

/** Completeness over the required fields that apply. */
export function employeeCompleteness(values: ProfileValues): {
  percent: number;
  missing: string[];
} {
  const required = EMPLOYEE_FIELDS.filter(
    (f) => f.required && f.store.t !== 'auto' && applies(f as never, values),
  );
  const missing = required
    .filter((f) => values[f.key] === null || values[f.key] === undefined || values[f.key] === '')
    .map((f) => f.key);
  return {
    percent: required.length
      ? Math.round(((required.length - missing.length) / required.length) * 100)
      : 100,
    missing,
  };
}

/** The next code: the prefix most codes use, its highest number plus one (DPSN692 → DPSN693). */
export async function nextEmployeeCode(c: PoolClient): Promise<string> {
  const r = await c.query<{ prefix: string; n: string; width: number }>(
    `SELECT substring(employee_code FROM '^(.*?)[0-9]+$') AS prefix,
            max(substring(employee_code FROM '([0-9]+)$')::numeric)::text AS n,
            max(length(substring(employee_code FROM '([0-9]+)$')))::int AS width
       FROM employees WHERE employee_code ~ '[0-9]+$' AND deleted_at IS NULL
      GROUP BY 1 ORDER BY count(*) DESC, max(created_at) DESC LIMIT 1`,
  );
  const x = r.rows[0];
  if (!x) {
    const s = await c.query<{ code: string }>(
      `SELECT upper(code) AS code FROM schools WHERE id = app.current_school_id()`,
    );
    return `${(s.rows[0]?.code ?? 'EMP').replace(/[^A-Z0-9]/g, '').slice(0, 6)}0001`;
  }
  const next = String(BigInt(x.n) + 1n).padStart(x.width, '0');
  return `${x.prefix ?? ''}${next}`;
}

/**
 * Validates changes against the catalogue: unknown and computed keys are errors; a masked sensitive
 * value sent back unchanged is left as it is; an approver is resolved from a code or an id.
 */
export async function validateEmployeeChanges(
  c: PoolClient,
  changes: Record<string, unknown>,
  lists: ProfileLists,
  selfId: string | null,
): Promise<{ values: ProfileValues; errors: Record<string, string> }> {
  const values: ProfileValues = {};
  const errors: Record<string, string> = {};
  for (const [key, raw] of Object.entries(changes)) {
    const f = EMPLOYEE_FIELD_BY_KEY.get(key);
    if (!f) {
      errors[key] = 'unknown field';
      continue;
    }
    if (f.store.t === 'auto') {
      errors[key] = `${f.label}: is calculated automatically`;
      continue;
    }
    if (f.sensitive && typeof raw === 'string' && /^X{2,}/i.test(raw.trim())) continue;
    if (f.type === 'employee') {
      const s = typeof raw === 'string' || typeof raw === 'number' ? String(raw).trim() : '';
      if (!s) {
        values[key] = null;
        continue;
      }
      // "Name (CODE)" from the picker, a bare code, or an id
      const code = /\(([^()]+)\)\s*$/.exec(s)?.[1] ?? s;
      const r = await c.query<{ id: string }>(
        `SELECT id::text FROM employees WHERE deleted_at IS NULL AND (upper(employee_code) = upper($1) OR id::text = $1) LIMIT 1`,
        [code],
      );
      const id = r.rows[0]?.id;
      if (!id) errors[key] = `${f.label}: no employee with the code ${code}`;
      else if (id === selfId) errors[key] = `${f.label}: cannot be the employee themself`;
      else values[key] = id;
      continue;
    }
    const n = normaliseValue(f as never, raw, lists);
    if (n.ok) values[key] = n.value;
    else errors[key] = `${f.label}: ${n.error}`;
  }
  return { values, errors };
}

const GENDER_LABEL: Record<string, string> = { male: 'Male', female: 'Female', other: 'Other' };
const GENDER_ENUM: Record<string, string> = { Male: 'male', Female: 'female', Other: 'other' };

const COLS = new Set([
  'employee_code',
  'first_name',
  'last_name',
  'gender',
  'dob',
  'designation',
  'department',
  'joined_on',
  'left_on',
  'mobile',
  'email',
  'biometric_id',
]);

/**
 * Writes validated values to an employee (created first when `id` is null, which needs the code and
 * first name). The employee type also sets the staff group; completeness is kept. Returns the id.
 */
export async function writeEmployeeProfile(
  c: PoolClient,
  id: string | null,
  values: ProfileValues,
): Promise<string> {
  let empId = id;
  if (!empId) {
    const code = values.employee_code;
    const first = values.first_name;
    const errs: Record<string, string> = {};
    if (!code) errs.employee_code = 'Employee code: an answer is needed';
    if (!first) errs.first_name = 'First name: an answer is needed';
    if (Object.keys(errs).length) throw new EmployeeWriteError(errs);
    const dup = await c.query(
      `SELECT 1 FROM employees WHERE upper(employee_code) = upper($1) AND deleted_at IS NULL`,
      [code],
    );
    if (dup.rowCount)
      throw new EmployeeWriteError({
        employee_code: `Employee code ${String(code)} is already used`,
      });
    const ins = await c.query<{ id: string }>(
      `INSERT INTO employees (school_id, employee_code, first_name, employee_type, created_by, updated_by)
       VALUES (app.current_school_id(), $1, $2, 'teaching', app.current_user_id(), app.current_user_id()) RETURNING id::text`,
      [code, first],
    );
    empId = ins.rows[0]!.id;
  } else if (values.employee_code) {
    const dup = await c.query(
      `SELECT 1 FROM employees WHERE upper(employee_code) = upper($1) AND id <> $2 AND deleted_at IS NULL`,
      [values.employee_code, empId],
    );
    if (dup.rowCount)
      throw new EmployeeWriteError({
        employee_code: `Employee code ${String(values.employee_code)} is already used`,
      });
  }

  const cur = await c.query<{
    address: EmployeeRow['address'];
    profile: EmployeeRow['profile'];
    secure: EmployeeRow['secure'];
  }>(`SELECT address, profile, secure FROM employees WHERE id = $1 FOR UPDATE`, [empId]);
  const address = structuredClone(cur.rows[0]?.address ?? {});
  const profile = { ...(cur.rows[0]?.profile ?? {}) };
  const secure = { ...(cur.rows[0]?.secure ?? {}) };
  const cols: Array<[string, unknown]> = [];
  for (const [key, v] of Object.entries(values)) {
    const f = EMPLOYEE_FIELD_BY_KEY.get(key) as EmployeeField;
    const s = f.store;
    if (s.t === 'col') {
      if (COLS.has(s.col)) cols.push([s.col, v]);
    } else if (s.t === 'addr') {
      const part = (address[s.part] ??= {});
      if (v === null) delete part[s.key];
      else part[s.key] = v;
    } else if (s.t === 'json') {
      if (v === null) delete profile[s.key];
      else profile[s.key] = v;
    } else if (s.t === 'secure') {
      if (v === null) delete secure[s.key];
      else secure[s.key] = encryptField(String(v));
    }
  }
  // the permanent address the same as the present one: copied, so reports read one place
  if (profile.permanent_same === 'Yes') address.permanent = { ...(address.present ?? {}) };

  const sets: string[] = [
    'address = $2',
    'profile = $3',
    'secure = $4',
    'updated_at = now()',
    'updated_by = app.current_user_id()',
  ];
  const params: unknown[] = [
    empId,
    JSON.stringify(address),
    JSON.stringify(profile),
    JSON.stringify(secure),
  ];
  for (const [col, v] of cols) {
    if (col === 'gender') {
      params.push(v ? (GENDER_ENUM[String(v)] ?? 'unspecified') : 'unspecified');
      sets.push(`gender = $${params.length}::gender`);
      continue;
    }
    params.push(v);
    // the column names come from the catalogue (COLS), never from the request
    sets.push(`${col} = $${params.length}`);
  }
  // the employee type sets the staff group the rest of the ERP reads
  if (values.staff_type) {
    params.push(values.staff_type);
    sets.push(
      // eslint-disable-next-line no-restricted-syntax -- a fixed fragment; the type name is bound
      `employee_type = COALESCE((SELECT staff_group FROM employee_types WHERE name = $${params.length} LIMIT 1), employee_type)`,
    );
  }
  // eslint-disable-next-line no-restricted-syntax -- column names from the catalogue; values are bound
  await c.query(`UPDATE employees SET ${sets.join(', ')} WHERE id = $1`, params);
  await refreshEmployeeCompleteness(c, empId);
  return empId;
}

export async function refreshEmployeeCompleteness(c: PoolClient, id: string): Promise<number> {
  const p = await readEmployeeProfile(c, id, true);
  if (!p) return 0;
  const { percent } = employeeCompleteness(p.values);
  await c.query(`UPDATE employees SET completeness = $2 WHERE id = $1`, [id, percent]);
  return percent;
}
