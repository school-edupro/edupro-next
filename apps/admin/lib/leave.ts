/** Staff leave and attendance (docs/design/85): the shapes the admin pages read. */
import type { ApprovalLevel } from './recruitment';

export type LeaveScope = 'all' | 'department' | 'designation' | 'employee_type' | 'employee';
export const SCOPE_LABEL: Record<LeaveScope, string> = {
  all: 'All staff',
  department: 'Departments',
  designation: 'Designations',
  employee_type: 'Employee types',
  employee: 'Employees',
};

export interface LeaveOverview {
  counts: {
    types: number;
    policies: number;
    weekoffs: number;
    shifts: number;
    postings: number;
    leaveRules: number;
    regRules: number;
    staff: number;
    noApprover: number;
    holidays: number;
  };
  types: Array<{
    id: string;
    code: string;
    name: string;
    keepsBalance: boolean;
    lossOfPay: boolean;
    autoApprove: boolean;
    deductOrder: number | null;
    policies: number;
    uncovered: number;
  }>;
  warnings: string[];
  can: { manage: boolean };
}

export interface ApprovalRule {
  id: string;
  kind: 'leave' | 'regularisation';
  name: string;
  scope: LeaveScope;
  scopeWords: string;
  scopeValues: string[];
  leaveType: { id: string; code: string; name: string } | null;
  priority: number;
  status: 'active' | 'inactive';
  bands: Array<{ label: string; levels: string[] }>;
}

export interface ApprovalRules {
  rules: ApprovalRule[];
  types: Array<{ id: string; code: string; name: string; auto: boolean }>;
  staff: Array<{ id: string; code: string; name: string }>;
  scopes: Record<Exclude<LeaveScope, 'all'>, string[]>;
  bands: string[];
  can: { manage: boolean };
}

export interface ApprovalRuleDetail {
  rule: ApprovalRule;
  bands: Array<{ index: number; label: string; levels: ApprovalLevel[] }>;
  staff: Array<{
    id: string;
    code: string;
    name: string;
    designation: string | null;
    department: string | null;
    signsIn: boolean;
  }>;
  designations: Array<{ name: string; holders: number }>;
  departments: Array<{
    name: string;
    hod: { code: string; name: string; signsIn: boolean } | null;
  }>;
  roles: Array<{ code: string; name: string }>;
  can: { manage: boolean };
}

export interface ChainPreview {
  employee: string;
  band: string;
  rule: { id: string; name: string } | null;
  levels: Array<{ name: string; people: string[]; note: string | null }>;
  note: string | null;
}

export interface LeaveSettings {
  settings: {
    lateMarksPerLeave: number;
    missingPunchesPerLeave: number;
    lopAfterDays: number;
    punchGapMinutes: number;
    recheckDays: number;
    absentLookbackDays: number;
    exceptionsFrom: string | null;
    defaultShiftId: string | null;
    lateReducesHours: boolean;
    allowTimeEdit: boolean;
    allowOnBehalf: boolean;
    backdateDays: number | null;
    missingPunchCc: string | null;
    deviceSerials: string[];
    sendEmail: boolean;
    sendWhatsapp: boolean;
    sendApp: boolean;
    sendSms: boolean;
    updatedAt: string;
  };
  shifts: Array<{ id: string; code: string; name: string }>;
  can: { manage: boolean };
}
