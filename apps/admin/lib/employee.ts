/** Employee master shapes as the API serves them (docs/design/30-employee-master.md). */
import type { ProfileCatalogue, ProfileValues } from './profile';

export type EmployeeCatalogue = ProfileCatalogue & {
  lists: Record<string, string[]>;
  nextCode: string;
  subjects: Array<{ id: string; name: string; code: string }>;
};

export interface EmployeeDocType {
  typeId: string;
  code: string;
  name: string;
  hasExpiry: boolean;
  required: boolean;
  done: boolean;
  files: Array<{
    id: string;
    fileId: string;
    fileName: string | null;
    contentType: string;
    number: string | null;
    issuedOn: string | null;
    expiresOn: string | null;
    expired: boolean;
    remarks: string | null;
    verifiedAt: string | null;
    verifiedBy: string | null;
    uploadedAt: string;
  }>;
}

export interface EmployeeRows {
  education: Array<{
    id: string;
    qualification: string;
    specialisation: string | null;
    institution: string | null;
    passingYear: number | null;
    score: string | null;
    mode: string | null;
  }>;
  languages: Array<{
    id: string;
    language: string;
    canRead: boolean;
    canWrite: boolean;
    canSpeak: boolean;
  }>;
  experience: Array<{
    id: string;
    organisation: string;
    designation: string | null;
    fromOn: string | null;
    toOn: string | null;
    reason: string | null;
  }>;
  transfers: Array<{
    id: string;
    onDate: string;
    fromPlace: string | null;
    toPlace: string;
    orderNo: string | null;
    remarks: string | null;
  }>;
  remarks: Array<{
    id: string;
    onDate: string;
    remark: string;
    source: 'office' | 'system';
    by: string | null;
  }>;
}

export interface EmployeeProfile {
  id: string;
  name: string;
  status: string;
  staffGroup: string;
  hasLogin: boolean;
  photoFileId: string | null;
  values: ProfileValues;
  approvers: Record<string, string>;
  masked: string[];
  completeness: number;
  missing: string[];
  sensitiveShown: boolean;
  rows: EmployeeRows;
  subjects: Array<{ id: string; name: string }>;
  documents: { types: EmployeeDocType[]; required: number; missing: number; unverified: number };
}

export type SaveEmployeeResult =
  | { ok: true; profile: EmployeeProfile }
  | { ok: false; errors: Record<string, string>; detail: string };

export type OnboardResult =
  | { ok: true; id: string; code: string; login: { made: boolean; reason?: string } }
  | { ok: false; errors: Record<string, string>; detail: string };

/** Approvers are kept as ids; the form shows and sends "NAME (CODE)". */
export function forForm(p: EmployeeProfile): ProfileValues {
  const v: ProfileValues = { ...p.values };
  for (const k of ['acr_hod', 'approver_l1', 'approver_l2', 'approver_l3']) {
    const id = v[k];
    if (typeof id === 'string' && p.approvers[id]) v[k] = p.approvers[id];
  }
  return v;
}
