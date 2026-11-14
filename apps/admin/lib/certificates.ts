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
}

export interface CertificateType {
  code: string;
  name: string;
  audience: 'STUDENT' | 'STAFF';
  prefix: string;
  template: string | null;
  rules: {
    state?: 'active' | 'leaving' | 'any';
    fees?: boolean;
    library?: boolean;
    hostel?: boolean;
    transport?: boolean;
  };
  multiple: 'ONE' | 'YEAR' | 'ANY';
  usesBook: boolean;
  active: boolean;
  issued: number;
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
  template: { name: string; version: number | null } | null;
  can: CertificateCan;
}

export interface CertificatePreview {
  type: { code: string; name: string; usesBook: boolean; multiple: string };
  student: {
    id: string;
    name: string;
    admissionNo: string;
    className: string;
    section: string;
    left: boolean;
  };
  checks: CertificateCheck[];
  failed: number;
  held: boolean;
  fields: CertificateFieldSpec[];
  values: Record<string, string | number>;
  problems: string[];
  html: string | null;
  can: CertificateCan;
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
