import type { PoolClient } from 'pg';
import { EMPLOYEE_FIELDS, EMPLOYEE_SECTIONS, type EmployeeField } from './employee-fields';
import { employeeCompleteness } from './employee-profile-store';
import { decryptField, maskValue } from './field-crypto';
import type { ProfileValue } from './student-profile';
import type { ReportFieldDef, ReportRow } from './report-builder';

/*
 * The employee dataset of the list and the report builder (docs/design/30-employee-master.md, part 2):
 * every catalogue field plus record columns (name, status, staff group, login, completeness) and the
 * rows summed up (highest qualification, languages, years of experience before joining).
 */

const fieldType = (f: EmployeeField): ReportFieldDef['type'] =>
  f.type === 'date'
    ? 'date'
    : f.type === 'number' || f.key === 'age' || f.key === 'service_years'
      ? 'number'
      : 'text';

const RECORD: ReportFieldDef[] = [
  { key: 'full_name', label: 'Employee name', section: 'basic', type: 'text' },
  { key: 'employee_status', label: 'Status', section: 'record', type: 'text' },
  { key: 'staff_group', label: 'Staff group', section: 'record', type: 'text' },
  { key: 'has_login', label: 'Staff login', section: 'record', type: 'text' },
  { key: 'profile_completeness', label: 'Profile complete (%)', section: 'record', type: 'number' },
  { key: 'reports_to', label: 'Reports to', section: 'record', type: 'text' },
  { key: 'highest_qualification', label: 'Highest qualification', section: 'rows', type: 'text' },
  { key: 'qualifications', label: 'Qualifications', section: 'rows', type: 'text' },
  { key: 'languages', label: 'Languages', section: 'rows', type: 'text' },
  {
    key: 'experience_years',
    label: 'Experience before joining (years)',
    section: 'rows',
    type: 'number',
  },
];

export const EMPLOYEE_REPORT_SECTIONS: ReadonlyArray<{ id: string; title: string }> = [
  ...EMPLOYEE_SECTIONS,
  { id: 'rows', title: 'Education, languages, experience' },
  { id: 'record', title: 'Record' },
];

export const EMPLOYEE_REPORT_FIELDS: ReportFieldDef[] = [
  ...EMPLOYEE_FIELDS.map((f) => ({
    key: f.key,
    label: f.label,
    section: f.section,
    type: fieldType(f),
    list: f.list ?? null,
    sensitive: f.sensitive ?? false,
  })),
  ...RECORD,
];

/** Search box keys of the employee list: code, name, mobiles, email, department, designation. */
export const EMPLOYEE_SEARCH_KEYS = [
  'employee_code',
  'full_name',
  'mobile',
  'alternate_mobile',
  'email',
  'department',
  'designation',
  'biometric_id',
];

const GROUP: Record<string, string> = {
  teaching: 'Teaching',
  non_teaching: 'Non-teaching',
  contract: 'Contract',
  visiting: 'Visiting',
};
const GENDER: Record<string, string> = { male: 'Male', female: 'Female', other: 'Other' };
/** The usual order of qualifications, highest last (anything else counts below them). */
const LEVEL = [
  '10th',
  '12th',
  'Diploma',
  'NTT',
  'D.El.Ed.',
  'B.A.',
  'B.Sc.',
  'B.Com.',
  'BCA',
  'B.Tech.',
  'B.Ed.',
  'M.A.',
  'M.Sc.',
  'M.Com.',
  'MCA',
  'MBA',
  'M.Ed.',
  'M.Phil.',
  'Ph.D.',
];

/** One row per employee (all, or the active ones), approvers by name, sensitive values masked unless allowed. */
export async function loadEmployeeReportRows(
  c: PoolClient,
  opts: { includeInactive: boolean; showSensitive: boolean; limit?: number },
): Promise<ReportRow[]> {
  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const r = await c.query<{
    id: string;
    employee_code: string;
    first_name: string;
    last_name: string | null;
    display_name: string;
    gender: string;
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
    status: string;
    employee_type: string;
    user_id: string | null;
    photo_file_id: string | null;
    completeness: number;
    reports_to: string | null;
    quals: Array<{ q: string; y: number | null }> | null;
    langs: string | null;
    exp_days: number | null;
  }>(
    `SELECT e.id::text, e.employee_code, e.first_name, e.last_name, e.display_name, e.gender::text, e.dob::text,
            e.designation, e.department, e.joined_on::text, e.left_on::text, e.mobile, e.email::text, e.biometric_id,
            e.address, e.profile, e.secure, e.status::text, e.employee_type::text, e.user_id::text, e.photo_file_id::text,
            e.completeness,
            (SELECT m.display_name FROM postings p JOIN employees m ON m.id = p.reports_to_employee_id
              WHERE p.employee_id = e.id ORDER BY p.valid_from DESC LIMIT 1) AS reports_to,
            (SELECT jsonb_agg(jsonb_build_object('q', ed.qualification, 'y', ed.passing_year) ORDER BY ed.passing_year NULLS FIRST)
               FROM employee_education ed WHERE ed.employee_id = e.id) AS quals,
            (SELECT string_agg(l.language, ', ' ORDER BY l.language) FROM employee_languages l WHERE l.employee_id = e.id) AS langs,
            (SELECT sum(x.to_on - x.from_on)::int FROM employee_experience x
              WHERE x.employee_id = e.id AND x.from_on IS NOT NULL AND x.to_on IS NOT NULL) AS exp_days
       FROM employees e
      WHERE e.deleted_at IS NULL AND ($1::boolean OR e.status = 'active')
      ORDER BY e.display_name
      LIMIT $2`,
    [opts.includeInactive, opts.limit ?? 20000],
  );
  // approvers by name
  const approverIds = new Set<string>();
  for (const x of r.rows)
    for (const k of ['acr_hod', 'approver_l1', 'approver_l2', 'approver_l3'])
      if (typeof x.profile?.[k] === 'string') approverIds.add(x.profile[k] as string);
  const names = new Map<string, string>();
  if (approverIds.size) {
    const n = await c.query<{ id: string; label: string }>(
      `SELECT id::text, display_name || ' (' || employee_code || ')' AS label FROM employees WHERE id = ANY($1::bigint[])`,
      [[...approverIds]],
    );
    for (const x of n.rows) names.set(x.id, x.label);
  }
  const years = (from: string, to: string) => {
    const [fy, fm, fd] = from.split('-').map(Number) as [number, number, number];
    const [ty, tm, td] = to.split('-').map(Number) as [number, number, number];
    return ty - fy - (tm < fm || (tm === fm && td < fd) ? 1 : 0);
  };
  return r.rows.map((x) => {
    const row: ReportRow = {};
    for (const f of EMPLOYEE_FIELDS) {
      const s = f.store;
      let v: unknown = null;
      if (s.t === 'col') v = (x as unknown as Record<string, unknown>)[s.col];
      else if (s.t === 'addr') v = x.address?.[s.part]?.[s.key];
      else if (s.t === 'json') v = x.profile?.[s.key];
      else if (s.t === 'secure') {
        const stored = x.secure?.[s.key];
        const plain = stored ? decryptField(stored) : null;
        v = plain === null ? null : opts.showSensitive ? plain : maskValue(plain, f.type);
      }
      if (f.type === 'employee' && typeof v === 'string') v = names.get(v) ?? null;
      row[f.key] = v === undefined || v === '' ? null : (v as ProfileValue);
    }
    row.gender = GENDER[x.gender] ?? null;
    row.age = x.dob ? years(x.dob, today) : null;
    row.service_years = x.joined_on ? Math.max(0, years(x.joined_on, x.left_on ?? today)) : null;
    const quals = x.quals ?? [];
    const best = [...quals].sort((a, b) => LEVEL.indexOf(a.q) - LEVEL.indexOf(b.q)).at(-1);
    return {
      ...row,
      full_name: x.display_name,
      employee_status: x.status === 'active' ? 'Active' : 'Inactive',
      staff_group: GROUP[x.employee_type] ?? x.employee_type,
      has_login: x.user_id ? 'Yes' : 'No',
      // worked out from the values (the stored figure is kept on saves only)
      profile_completeness: employeeCompleteness(row).percent,
      reports_to: x.reports_to,
      highest_qualification: best?.q ?? null,
      qualifications: quals.map((q) => q.q).join(', ') || null,
      languages: x.langs,
      experience_years: x.exp_days ? Math.round((x.exp_days / 365.25) * 10) / 10 : null,
      __id: x.id,
      __photo: x.photo_file_id,
    };
  });
}
