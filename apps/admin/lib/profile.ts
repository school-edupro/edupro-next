/** Student 360 profile shapes as the API serves them (people/profile/catalogue, people/students/:id/profile). */

export type ProfileValue = string | number | null;
export type ProfileValues = Record<string, ProfileValue>;

export interface CatalogueField {
  key: string;
  section: string;
  label: string;
  type: string;
  required: boolean;
  list: string | null;
  options: string[] | null;
  upper: boolean;
  help: string | null;
  when: { key: string; in?: string[]; notIn?: string[] } | null;
  sensitive: boolean;
  readOnly: boolean;
  excelColumn: string;
}

export interface ProfileCatalogue {
  sections: ReadonlyArray<{ id: string; title: string }>;
  fields: CatalogueField[];
  quickAdd: string[];
  geography: {
    countries: Array<{ code: string; name: string }>;
    states: Array<{ code: string; name: string; country: string | null }>;
    cities: Array<{ name: string; state: string | null; pincode: string | null }>;
  };
  canSeeSensitive: boolean;
}

export interface ProfileSnapshot {
  studentId: string;
  admissionNo: string;
  displayName: string;
  values: ProfileValues;
  masked: string[];
  completeness: { percent: number; missing: string[] };
  guardianIds: Record<string, string>;
  enrolment: {
    academicYearId: string;
    academicYear: string;
    classSectionId: string;
    className: string;
    section: string;
    rollNo: number | null;
  } | null;
  updatedAt: string;
}

export type SaveProfileResult =
  | { ok: true; snapshot: ProfileSnapshot }
  | { ok: false; errors: Record<string, string>; detail: string };

export type QuickAddResult =
  | { ok: true; id: string; completeness: number; name: string; admissionNo: string }
  | { ok: false; errors: Record<string, string>; detail: string };

/** Whether a field applies to the current values (mirror of the API rule). */
export function applies(f: CatalogueField, values: ProfileValues): boolean {
  if (!f.when) return true;
  const v = values[f.when.key];
  const s = v === null || v === undefined ? '' : String(v);
  if (f.when.in) return f.when.in.includes(s);
  if (f.when.notIn) return !f.when.notIn.includes(s);
  return true;
}

/**
 * For address-like fields, which cascade they belong to: the state list follows the country, the
 * city list follows the state. Returns the sibling keys, or null for ordinary fields.
 */
export function cascadeOf(key: string): { country: string; state: string; city: string } | null {
  const groups: Array<[string, string, string]> = [
    ['residential_country', 'residential_state', 'residential_city'],
    ['permanent_country', 'permanent_state', 'permanent_city'],
    ['father_office_country', 'father_office_state', 'father_office_city'],
    ['mother_office_country', 'mother_office_state', 'mother_office_city'],
    ['guardian_office_country', 'guardian_office_state', 'guardian_office_city'],
  ];
  const g = groups.find((x) => x.includes(key));
  return g ? { country: g[0], state: g[1], city: g[2] } : null;
}

/** 2026-09-30 (or a date string) as 30-09-2026, the format schools write by hand. */
export function ddmmyyyy(v: string | null | undefined): string | null {
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  return m ? `${m[3]!}-${m[2]!}-${m[1]!}` : v;
}
