/** Response shapes of the API used by the admin app. Replaced by the generated client in Sprint 3. */
export interface Page<T> {
  data: T[];
  page: { number: number; size: number; total: number };
}

export interface Permission {
  code: string;
  module: string;
  description: string;
  requiresMfa: boolean;
}

export interface Role {
  id: string;
  code: string;
  name: string;
  kind: 'global' | 'module';
  isSystem: boolean;
  schoolId: string | null;
  description: string;
  status: 'active' | 'inactive';
  permissions: string[];
  activeAssignments: number;
}

export interface Assignment {
  id: string;
  userId: string;
  userName: string;
  roleId: string;
  roleCode: string;
  roleName: string;
  campusId: string | null;
  validFrom: string;
  validTo: string | null;
  grantedBy: string | null;
  reason: string | null;
  revokedAt: string | null;
  active: boolean;
  scopes: Array<{ type: string; id: string }>;
}

export interface Membership {
  id: string;
  userId: string;
  displayName: string;
  email: string | null;
  mobile: string | null;
  personType: 'employee' | 'guardian' | 'student' | 'external';
  status: 'active' | 'inactive';
  pendingFirstLogin: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface Delegation {
  id: string;
  fromUserId: string;
  fromUserName: string;
  toUserId: string;
  toUserName: string;
  roleId: string;
  roleName: string;
  startsAt: string;
  endsAt: string;
  reason: string;
  revokedAt: string | null;
  active: boolean;
}

export interface Year {
  id: string;
  kind: 'academic' | 'financial';
  code: string;
  name: string;
  startDate: string;
  endDate: string;
  status: 'planned' | 'active' | 'locked' | 'closed';
  locks: Record<string, boolean>;
}

export interface Setting {
  key: string;
  module: string;
  description: string;
  value: unknown;
  isDefault: boolean;
  validFrom: string | null;
}

export interface Campus {
  id: string;
  code: string;
  name: string;
  address: Record<string, unknown>;
  geo: { lat: number; lng: number } | null;
  status: 'active' | 'inactive';
}

export interface School {
  id: string;
  code: string;
  name: string;
  shortName: string | null;
  affiliationNo: string | null;
  board: string;
  timezone: string;
  locale: string;
  campuses: Campus[];
}

export interface ClassRow {
  id: string;
  code: string;
  name: string;
  displayOrder: number;
  status: 'active' | 'inactive';
  updatedAt: string;
}

export interface SectionRow {
  id: string;
  academicYearId: string;
  classId: string;
  name: string;
  capacity: number | null;
  status: 'active' | 'inactive';
}
