/** Portal profile shapes (API engagement/mine/profile), shared by the profile pages. */

export type Level = 'hidden' | 'view' | 'edit_approval' | 'edit_direct';
export type Value = string | number | null;

export interface PortalField {
  key: string;
  label: string;
  type: string;
  level: Level;
  value: Value;
  options: string[] | null;
  help: string | null;
  required: boolean;
  upper: boolean;
  when: { key: string; in?: string[]; notIn?: string[] } | null;
  proof: string | null;
  pending: { to: Value; requestId: string; since: string } | null;
}

export interface PortalProfile {
  studentId: string;
  audience: 'parent' | 'student';
  admissionNo: string;
  name: string;
  enrolment: {
    className: string;
    section: string;
    rollNo: number | null;
    academicYear: string;
  } | null;
  classTeacher: string | null;
  completeness: number;
  photos: { student: boolean; father: boolean; mother: boolean };
  window: { open: boolean; message: string | null; until: string | null };
  canEdit: boolean;
  proofKinds: Array<{ id: string; label: string }>;
  sections: Array<{ id: string; title: string; fields: PortalField[] }>;
  photoFields: Array<{
    key: string;
    party: 'student' | 'father' | 'mother';
    label: string;
    level: Level;
    pending: { requestId: string; since: string } | null;
  }>;
  geography: {
    states: Array<{ name: string; country: string | null }>;
    cities: Array<{ name: string; state: string | null }>;
  };
}

/** Address groups: the state list follows the country, the city list follows the state. */
const CASCADES: Array<[string, string, string]> = [
  ['residential_country', 'residential_state', 'residential_city'],
  ['permanent_country', 'permanent_state', 'permanent_city'],
  ['father_office_country', 'father_office_state', 'father_office_city'],
  ['mother_office_country', 'mother_office_state', 'mother_office_city'],
  ['guardian_office_country', 'guardian_office_state', 'guardian_office_city'],
];

/** The options to offer for a field, narrowed by the country or state chosen in the same group. */
export function optionsFor(
  f: PortalField,
  values: Record<string, Value>,
  geo: PortalProfile['geography'] | undefined,
): string[] | null {
  if (!f.options) return null;
  const g = CASCADES.find((x) => x.includes(f.key));
  if (!g || !geo) return f.options;
  if (f.key === g[1]) {
    const country = String(values[g[0]] ?? '');
    const states = geo.states.filter((s) => !country || !s.country || s.country === country);
    return states.length
      ? states.map((s) => s.name).filter((n) => f.options!.includes(n))
      : f.options;
  }
  if (f.key === g[2]) {
    const state = String(values[g[1]] ?? '');
    return state ? geo.cities.filter((c) => c.state === state).map((c) => c.name) : f.options;
  }
  return f.options;
}

export interface PortalRequest {
  id: string;
  status: 'pending' | 'approved' | 'rejected' | 'partially_approved' | 'cancelled';
  autoApplied: boolean;
  requestedBy: string | null;
  level: number;
  levels: number;
  waitingFor: string | null;
  items: Array<{
    key: string;
    label: string;
    to: Value;
    status: 'pending' | 'approved' | 'rejected';
    note: string | null;
  }>;
  decisionNote: string | null;
  createdAt: string;
  mine: boolean;
}

/** Whether a field applies to the current values (mirror of the API rule). */
export function applies(f: Pick<PortalField, 'when'>, values: Record<string, Value>): boolean {
  if (!f.when) return true;
  const v = values[f.when.key];
  const s = v === null || v === undefined ? '' : String(v);
  if (f.when.in) return f.when.in.includes(s);
  if (f.when.notIn) return !f.when.notIn.includes(s);
  return true;
}

/** A value as families read it: dates as 30-09-2026. */
export function shown(v: Value | undefined): string {
  if (v === null || v === undefined || v === '') return '';
  const s = String(v);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? `${m[3]!}-${m[2]!}-${m[1]!}` : s;
}
