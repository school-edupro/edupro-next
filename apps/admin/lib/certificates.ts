/** Certificate register (docs/design/87): what the API returns. */
export interface CertificateCheck {
  key: 'state' | 'fees' | 'library' | 'hostel' | 'transport' | 'one';
  label: string;
  ok: boolean;
  detail: string;
}

export interface CertificateFieldSpec {
  key: string;
  label: string;
  kind: 'text' | 'date' | 'number' | 'list';
  required?: boolean;
  options?: string[];
  hint?: string;
  custom?: boolean;
}

export interface CertificateType {
  code: string;
  name: string;
  audience: 'STUDENT' | 'STAFF';
  prefix: string;
  template: string | null;
  rules: {
    state?: 'active' | 'leaving' | 'any';
    classes?: string[];
    fees?: boolean;
    library?: boolean;
    hostel?: boolean;
    transport?: boolean;
  };
  multiple: 'ONE' | 'YEAR' | 'ANY';
  usesBook: boolean;
  active: boolean;
  issued: number;
  description: string | null;
  builtIn: boolean;
  restricted: boolean;
  variants: Array<{ templateId: string; label: string }>;
  fields: CertificateFieldSpec[];
}

export interface CertificateCan {
  issue: boolean;
  cancel: boolean;
  override: boolean;
  setup: boolean;
}

export interface Certificate {
  id: string;
  employeeId: string | null;
  typeCode: string;
  typeName: string;
  number: string;
  copyNo: number;
  originalId: string | null;
  studentId: string | null;
  studentName: string | null;
  admissionNo: string | null;
  className: string | null;
  status: 'issued' | 'cancelled';
  issuedOn: string;
  issuedBy: string | null;
  purpose: string | null;
  bookNo: number | null;
  slNo: number | null;
  overrideReason: string | null;
  overrideBy: string | null;
  checks: CertificateCheck[];
  exportId: string | null;
  transferCertificateId: string | null;
  legacy: boolean;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancelReason: string | null;
  createdAt: string;
  /** made again from this earlier certificate (re-issue with today's settings) */
  reissueOf: { id: string; number: string } | null;
  /** made again as this later certificate */
  reissuedAs: { id: string; number: string } | null;
  /** corrections that kept the number: 1 as issued, then 2, 3 … */
  revision: number;
  revisedAt: string | null;
}

export interface CertificateList {
  rows: Certificate[];
  total: number;
  figures: {
    total: number;
    issued: number;
    cancelled: number;
    duplicates: number;
    overrides: number;
    month: number;
  };
  years: string[];
  can: CertificateCan;
}

export interface CertificateDetail extends Certificate {
  copies: Certificate[];
  data: Record<string, unknown>;
  template: { id: string | null; name: string; version: number | null } | null;
  /** the change log of a certificate corrected keeping its number, newest first (revision 1: as issued) */
  revisions: Array<{
    revision: number;
    at: string;
    by: string | null;
    reason: string | null;
    changes: Array<{ label: string; from: string; to: string }>;
    exportId: string | null;
    ready: boolean;
    issuedOn: string;
  }>;
  /** the school's set-up: a correction keeps the number */
  correctionsKeepNumber: boolean;
  can: CertificateCan;
}

export interface CertificatePreview {
  type: {
    code: string;
    name: string;
    usesBook: boolean;
    multiple: string;
    audience: 'STUDENT' | 'STAFF';
  };
  person: CertificatePerson;
  student: {
    id: string;
    name: string;
    admissionNo: string;
    className: string;
    section: string;
    left: boolean;
  } | null;
  variants: Array<{ templateId: string | null; label: string }>;
  variant: string | null;
  checks: CertificateCheck[];
  failed: number;
  held: boolean;
  fields: CertificateFieldSpec[];
  values: Record<string, string | number>;
  /** the person's details the layout prints (17 Nov 2026): filled from the record, changed for this certificate */
  personDetails?: CertificatePersonBox[];
  /** the student's withdrawal, when one is open or done (a TC's checks clear there) */
  withdrawal?: { id: string; leavingOn: string | null } | null;
  problems: string[];
  html: string | null;
  can: CertificateCan;
}

export interface CertificatePersonBox {
  /** student.fatherName, employee.designation, tc.lastClass … */
  path: string;
  label: string;
  kind: 'text' | 'date';
  /** as it prints now (a date yyyy-mm-dd) */
  value: string;
  /** the record's value, as it prints */
  record: string;
  changed: boolean;
}
/** what a certificate printed differently from the record: path → both values */
export type CertificatePrinted = Record<string, { label: string; record: string; printed: string }>;

/** The person's printed details travel as per_<path> (per_student.fatherName). */
export const PERSON_PREFIX = 'per_';
export const PERSON_PATH = /^(student|employee|tc)\.[a-zA-Z]{2,30}$/;
/** The boxes of the person's details, from a form or the address: path → value. */
export function personFrom(entries: Iterable<[string, unknown]>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of entries) {
    const path = k.replace(/^_?\d+_/, '').slice(PERSON_PREFIX.length);
    if (
      k.replace(/^_?\d+_/, '').startsWith(PERSON_PREFIX) &&
      typeof v === 'string' &&
      PERSON_PATH.test(path)
    )
      out[path] = v.slice(0, 300);
  }
  return out;
}

export interface CertificateStudentHit {
  id: string;
  name: string;
  admissionNo: string;
  className: string | null;
  left: boolean;
  leftOn: string | null;
}

/** dd-mm-yyyy from an ISO date */
export const dmy = (iso: string | null | undefined) =>
  iso && /^\d{4}-\d{2}-\d{2}/.test(iso)
    ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`
    : '';

/** The typed fields of the issue form travel as fld_<key>. */
export const FIELD_PREFIX = 'fld_';

// ---- phase B: staff, variants, set-up -------------------------------------------------------------------------------
export interface CertificatePerson {
  kind: 'student' | 'employee';
  id: string;
  name: string;
  no: string;
  detail: string;
  left: boolean;
}

export interface CertificateEmployeeHit {
  id: string;
  name: string;
  code: string;
  designation: string | null;
  left: boolean;
}

export interface CertificateSettings {
  signatory: {
    id: string;
    name: string;
    code: string;
    designation: string | null;
    hasSignature: boolean;
  } | null;
  signatoryTitle: string;
  printSignature: boolean;
  printPreparer: boolean;
  footerNote: string;
  /** a correction keeps the certificate number (a new revision) */
  correctionsKeepNumber: boolean;
}

export interface CertificateTemplateRow {
  id: string;
  code: string;
  name: string;
  kind: string;
  version: number;
  ready: boolean;
  updatedAt: string;
  usedBy: string[];
  made: number;
  /** printed by Parent engagement → Achievement certificates, which picks a layout itself */
  screenMade?: number;
  /** transfer certificates issued before the register, which print with it */
  tcMade?: number;
  pageWidth: string;
  pageHeight: string;
}

export interface CertificateSetupOverview {
  figures: {
    types: number;
    active: number;
    own: number;
    templates: number;
    restricted: number;
    signatory: boolean;
    online: number;
    withFee: number;
    issued: number;
    issuedYear: number;
    toFix: number;
  };
  yearCode: string | null;
  checks: Array<{ text: string; href: string }>;
  types: Array<{
    code: string;
    name: string;
    audience: 'STUDENT' | 'STAFF';
    prefix: string;
    template: string | null;
    templateId: string | null;
    rules: CertificateType['rules'] & { classes?: string[] };
    multiple: 'ONE' | 'YEAR' | 'ANY';
    active: boolean;
    builtIn: boolean;
    restricted: boolean;
    ownFields: number;
    variants: number;
    issued: number;
    issuedYear: number;
    waiting: number;
    nextNumber: string | null;
    request: CertificateRequestSettings;
  }>;
  templates: CertificateTemplateRow[];
  settings: CertificateSettings;
}

export interface CertificateTypeDetail {
  code: string;
  name: string;
  description: string | null;
  audience: 'STUDENT' | 'STAFF';
  prefix: string;
  templateId: string | null;
  variants: Array<{ templateId: string; label: string }>;
  rules: CertificateType['rules'] & { classes?: string[] };
  multiple: 'ONE' | 'YEAR' | 'ANY';
  usesBook: boolean;
  active: boolean;
  sortOrder: number;
  issuers: string[];
  builtIn: boolean;
  ownFields: CertificateFieldSpec[];
  fields: CertificateFieldSpec[];
  issued: number;
  issuedYear: number;
  waiting: number;
  yearCode: string | null;
  nextNumber: string | null;
  classes: Array<{ code: string; name: string }>;
  templates: CertificateTemplateRow[];
  /** `issues`: the role holds the right to issue certificates */
  roles: Array<{ id: string; name: string; code: string; issues: boolean }>;
  request: CertificateRequestSettings;
}

export interface CertificateRequestSettings {
  open: { parent: boolean; student: boolean; staff: boolean };
  purposes: string[];
  maxCopies: number;
  fee: number | null;
  levels: Array<
    | { kind: 'office' }
    | { kind: 'class_teacher' }
    | { kind: 'signatory' }
    | { kind: 'role'; roleId: string; name?: string }
    | { kind: 'user'; userId: string; name?: string }
  >;
}

export interface CertificateTemplateDetail {
  id: string;
  code: string;
  name: string;
  kind: string;
  pageWidth: string;
  pageHeight: string;
  bodyHtml: string;
  stylesCss: string;
  version: number;
  ready: boolean;
  usedBy: Array<{ code: string; name: string }>;
  /** printed by Parent engagement → Achievement certificates, which picks a layout itself */
  screenMade?: number;
  /** transfer certificates issued before the register, which print with it */
  tcMade?: number;
  types: Array<{ code: string; name: string; audience: 'STUDENT' | 'STAFF' }>;
  forType: string | null;
  catalogue: Array<{ group: string; items: Array<{ token: string; label: string }> }>;
  versions: Array<{ version: number; at: string; by: string | null; made: number }>;
}

/** Page sizes a template can take. */
export const PAGE_SIZES: Array<{ value: string; label: string; w: string; h: string }> = [
  { value: 'a4p', label: 'A4, portrait', w: '210mm', h: '297mm' },
  { value: 'a4l', label: 'A4, landscape', w: '297mm', h: '210mm' },
  { value: 'a5p', label: 'A5, portrait', w: '148mm', h: '210mm' },
  { value: 'a5l', label: 'A5, landscape', w: '210mm', h: '148mm' },
  { value: 'ltr', label: 'Letter', w: '216mm', h: '279mm' },
];

/** A page size in words ("A4, portrait"); an odd size as its measures. */
export const paperLabel = (w: string, h: string) =>
  PAGE_SIZES.find((p) => p.w === w && p.h === h)?.label ?? `${w} × ${h}`;

/**
 * The paper scaled to fit its preview frame: zoom steps by the frame's own width (an A4 page is about 800 CSS pixels
 * wide), so the whole width shows on a narrow screen or a half column. Only for the screen preview, never the PDF.
 */
export function fitPaper(html: string, pageWidthPx = 800): string {
  const steps: string[] = [];
  for (
    let w = pageWidthPx - 1, z = 0.95;
    w > 240 && z >= 0.3;
    w -= 40, z = Math.round((z - 0.05) * 100) / 100
  )
    steps.push(`@media screen and (max-width: ${String(w)}px) { html { zoom: ${String(z)}; } }`);
  return html.replace('</head>', `<style>${steps.join('\n')}</style></head>`);
}

// ---- phase C: requests ------------------------------------------------------------------------------------------------
export type RequestStage = 'waiting' | 'fee' | 'ready' | 'issued' | 'rejected' | 'withdrawn';
export interface CertificateRequest {
  id: string;
  typeCode: string;
  typeName: string;
  audience: 'STUDENT' | 'STAFF';
  studentId: string | null;
  employeeId: string | null;
  person: string;
  personNo: string;
  classLabel: string | null;
  channel: 'parent' | 'student' | 'staff' | 'office';
  requestedBy: string | null;
  purpose: string | null;
  copies: number;
  note: string | null;
  status: 'submitted' | 'approved' | 'issued' | 'rejected' | 'withdrawn';
  stage: RequestStage;
  waitingWith: string | null;
  waitingWithMe: boolean;
  fee: number | null;
  feePaid: boolean;
  feeWaived: string | null;
  certificateIds: string[];
  checks: CertificateCheck[];
  decisionNote: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  issuedAt: string | null;
  createdAt: string;
  ageDays: number;
}
export interface CertificateRequestList {
  rows: CertificateRequest[];
  total: number;
  figures: {
    waiting: number;
    fee: number;
    ready: number;
    month: number;
    oldest: number | null;
    mine: number;
  };
  can: { issue: boolean };
}
export interface CertificateRequestDetail extends CertificateRequest {
  levels: Array<{
    level: number;
    name: string;
    status: string;
    assignees: string[];
    actedBy: string | null;
    actedAt: string | null;
    note: string | null;
  }>;
  can: { decide: boolean; issue: boolean; waive: boolean; reject: boolean };
}
export const STAGE: Record<
  RequestStage,
  { label: string; tone: 'warning' | 'info' | 'success' | 'danger' | 'neutral' }
> = {
  waiting: { label: 'Waiting for approval', tone: 'warning' },
  fee: { label: 'Waiting for the fee', tone: 'warning' },
  ready: { label: 'Ready to issue', tone: 'info' },
  issued: { label: 'Issued', tone: 'success' },
  rejected: { label: 'Not approved', tone: 'danger' },
  withdrawn: { label: 'Withdrawn', tone: 'neutral' },
};
export const CHANNEL: Record<CertificateRequest['channel'], string> = {
  parent: 'Parent app',
  student: 'Student',
  staff: 'Staff app',
  office: 'Office',
};

// ---- phase E ------------------------------------------------------------------------------------------------------
export interface BulkPreview {
  type: { code: string; name: string };
  rows: Array<{
    id: string;
    name: string;
    admissionNo: string;
    rollNo: string | null;
    classLabel: string | null;
    checks: CertificateCheck[];
    problems: string[];
    held: boolean;
    ok: boolean;
    /** the section (students) or department (staff) it is taken from */
    sectionId: string | null;
    kind: 'student' | 'employee';
  }>;
  figures: { total: number; ok: number; failed: number; held: number; sections: number };
  can: { override: boolean };
}

/** Bulk issue's tick lists (16 Nov 2026). */
export interface BulkClasses {
  classes: Array<{
    id: string;
    name: string;
    students: number;
    sections: Array<{ id: string; name: string; students: number }>;
  }>;
  max: number;
}
export interface BulkDepartments {
  departments: Array<{ name: string; active: number; left: number }>;
  max: number;
}
/** A bulk run: a batch (and PDF) for each section or department. */
export interface BulkRun {
  runId: string;
  typeName: string;
  by: string | null;
  createdAt: string;
  figures: { batches: number; issued: number; skipped: number; ready: number; withPdf: number };
  batches: Array<{
    id: string;
    title: string;
    issued: number;
    skipped: number;
    exportId: string | null;
    exportStatus: string | null;
  }>;
}
/** "No department" travels as this token in a link (an empty value would be dropped). */
export const NO_DEPT = '~';
export interface CertificateBatch {
  id: string;
  title: string;
  typeName: string;
  typeCode: string;
  scope: Record<string, unknown>;
  issued: Array<{
    id: string;
    number: string;
    status: string;
    name: string;
    admissionNo: string;
    override: boolean;
  }>;
  skipped: Array<{ studentId: string; name: string; reason: string }>;
  overrideReason: string | null;
  exportId: string | null;
  by: string | null;
  createdAt: string;
}
export interface CertificateAward {
  id: string;
  name: string;
  typeCode: string;
  typeName: string | null;
  description: string | null;
  active: boolean;
  sortOrder: number;
  allotted: number;
  issued: number;
}
export interface CertificateAllotment {
  id: string;
  award: string;
  awardId: string;
  studentId: string;
  name: string;
  admissionNo: string;
  classLabel: string | null;
  event: string | null;
  position: string | null;
  awardedOn: string;
  remarks: string | null;
  certificateId: string | null;
  number: string | null;
}
export interface TcBookRow {
  id: string;
  bookNo: number | null;
  slNo: number | null;
  number: string;
  issuedOn: string;
  name: string | null;
  admissionNo: string | null;
  lastClass: string | null;
  reason: string | null;
  status: string;
  cancelReason: string | null;
  copies: number;
}
export interface CertificateReports {
  from: string;
  to: string;
  figures: {
    issued: number;
    duplicates: number;
    cancelled: number;
    overrides: number;
    requests: number;
    checks: number;
  };
  types: Array<{
    name: string;
    issued: number;
    duplicates: number;
    cancelled: number;
    overrides: number;
  }>;
  months: Array<{ month: string; issued: number; duplicates: number; cancelled: number }>;
  issuers: Array<{ name: string; issued: number; overrides: number }>;
  overrides: Array<{
    number: string;
    type: string;
    issuedOn: string;
    name: string | null;
    reason: string;
    by: string | null;
  }>;
  requests: Array<{
    name: string;
    asked: number;
    issued: number;
    rejected: number;
    open: number;
    avgDays: number | null;
  }>;
  checks: { total: number; valid: number; cancelled: number; not_found: number };
}

// ---- certificate types in plain words (the types list and a type's page) --------------------------------------------
type TypeRules = CertificateType['rules'] & { classes?: string[] };

/** Who can get it, in words: the student's or employee's state. */
export const stateInWords = (state: string | undefined, staff: boolean) =>
  staff
    ? state === 'active'
      ? 'In service'
      : state === 'leaving'
        ? 'Has left'
        : 'Any employee'
    : state === 'active'
      ? 'On the rolls'
      : state === 'leaving'
        ? 'Withdrawal complete or left'
        : 'Any student';

/** What a type checks before it is issued, in a few words. */
export function checksInWords(rules: TypeRules, multiple: string, staff: boolean): string {
  const cleared = [
    rules.fees ? 'fees' : null,
    rules.library ? 'library' : null,
    rules.hostel ? 'hostel' : null,
    rules.transport ? 'transport' : null,
  ].filter(Boolean);
  return [
    stateInWords(rules.state, staff),
    cleared.length ? `${cleared.join(', ')} cleared` : null,
    rules.classes?.length ? `classes ${rules.classes.join(', ')}` : null,
    multiple === 'ONE' ? 'one a person' : multiple === 'YEAR' ? 'one a year' : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

const LEVEL_WORD: Record<string, string> = {
  office: 'the office',
  class_teacher: 'the class teacher',
  signatory: 'the principal',
};

/** Who decides a request, in order: "the office, then the principal". */
export const levelsInWords = (levels: CertificateRequestSettings['levels']) =>
  levels
    .map((l) => ('name' in l && l.name ? l.name : (LEVEL_WORD[l.kind] ?? 'a role')))
    .join(', then ');

/** Who may ask for it online and on what terms, in a few words; "Office only" when no one may. */
export function onlineInWords(r: CertificateRequestSettings, staff: boolean): string {
  const who = staff
    ? r.open.staff
      ? ['Staff']
      : []
    : [r.open.parent ? 'Parents' : null, r.open.student ? 'students' : null].filter(
        (x): x is string => !!x,
      );
  if (!who.length) return 'Office only (not asked online)';
  const w = who.join(', ');
  return [
    w.charAt(0).toUpperCase() + w.slice(1),
    staff ? null : r.fee && r.fee > 0 ? `₹${String(r.fee)} a copy` : 'free',
    r.levels.length ? `decided by ${levelsInWords(r.levels)}` : 'no one decides yet',
  ]
    .filter(Boolean)
    .join(' · ');
}
