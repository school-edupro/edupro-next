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

// ---- Sprint 3 -----------------------------------------------------------------------------------
export type Channel = 'sms' | 'whatsapp' | 'email' | 'push';

export interface Template {
  id: string;
  code: string;
  channel: Channel;
  name: string;
  subject: string | null;
  body: string;
  variables: string[];
  dltTemplateId: string | null;
  dltEntityId: string | null;
  senderId: string | null;
  status: 'active' | 'inactive';
  updatedAt: string;
}

export interface Message {
  id: string;
  channel: Channel;
  templateId: string | null;
  templateCode: string | null;
  recipientUserId: string | null;
  recipientName: string | null;
  recipientAddress: string;
  subject: string | null;
  body: string;
  status: 'queued' | 'sending' | 'sent' | 'delivered' | 'failed' | 'cancelled';
  provider: string | null;
  providerMessageId: string | null;
  attempts: number;
  lastError: string | null;
  scheduledAt: string;
  sentAt: string | null;
  deliveredAt: string | null;
  failedAt: string | null;
  createdAt: string;
}

export interface ExportRow {
  id: string;
  dataset: string;
  format: 'xlsx' | 'csv' | 'pdf';
  title: string;
  params: Record<string, unknown>;
  status: 'queued' | 'running' | 'ready' | 'failed' | 'expired';
  fileId: string | null;
  rowCount: number | null;
  error: string | null;
  requestedBy: string | null;
  requestedByName: string | null;
  requestedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  expiresAt: string;
  downloadCount: number;
}

export interface Dataset {
  id: string;
  title: string;
  columns: string[];
  maxRows: number;
}

export interface AuditRow {
  id: string;
  occurredAt: string;
  actorType: string;
  actorUserId: string | null;
  actorName: string | null;
  impersonatedBy: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  diff: Record<string, { from: unknown; to: unknown }> | null;
  before?: unknown;
  after?: unknown;
  permissionCode: string | null;
  requestId: string | null;
  ip: string | null;
  userAgent?: string | null;
  source: string;
}

export interface OutboxRow {
  id: string;
  queue: string;
  kind: string | null;
  status: 'pending' | 'published' | 'failed';
  attempts: number;
  lastError: string | null;
  availableAt: string;
  createdAt: string;
  publishedAt: string | null;
  requestId: string | null;
}

// ---- Sprint 4: people ------------------------------------------------------------------------------
export interface Enrolment {
  id: string;
  academicYearId: string;
  academicYear: string;
  classSectionId: string;
  classCode: string;
  className: string;
  section: string;
  rollNo: number | null;
  status: string;
  joinedOn: string;
  endedOn: string | null;
}

export interface Student {
  id: string;
  admissionNo: string;
  firstName: string;
  lastName: string | null;
  displayName: string;
  dob: string | null;
  gender: string;
  category: string | null;
  bloodGroup: string | null;
  house: string | null;
  admittedOn: string | null;
  leftOn: string | null;
  photoFileId: string | null;
  address: Record<string, unknown>;
  details: Record<string, unknown>;
  status: 'active' | 'inactive';
  updatedAt: string;
  enrolment: Enrolment | null;
}

export interface GuardianLink {
  linkId: string;
  guardianId: string;
  displayName: string;
  mobile: string | null;
  email: string | null;
  occupation: string | null;
  relation: string;
  isPrimary: boolean;
  receivesNotifications: boolean;
}

export interface PersonDocument {
  id: string;
  kind: string;
  fileId: string;
  fileName: string | null;
  contentType: string;
  title: string | null;
  number: string | null;
  issuedOn: string | null;
  expiresOn: string | null;
  verifiedAt: string | null;
}

export interface Student360 extends Student {
  guardians: GuardianLink[];
  enrolments: Enrolment[];
  documents: PersonDocument[];
  siblings: Array<{ id: string; displayName: string; admissionNo: string }>;
}

export interface Posting {
  id: string;
  academicYearId: string;
  academicYear: string;
  campusId: string | null;
  campus: string | null;
  department: string | null;
  designation: string | null;
  reportsToEmployeeId: string | null;
  reportsTo: string | null;
  validFrom: string;
  validTo: string | null;
}

export interface Employee {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string | null;
  displayName: string;
  dob: string | null;
  gender: string;
  employeeType: 'teaching' | 'non_teaching' | 'contract' | 'visiting';
  designation: string | null;
  department: string | null;
  joinedOn: string | null;
  leftOn: string | null;
  mobile: string | null;
  email: string | null;
  photoFileId: string | null;
  status: 'active' | 'inactive';
  updatedAt: string;
  posting: Posting | null;
}

export interface Employee360 extends Employee {
  postings: Posting[];
  documents: PersonDocument[];
  directReports: Array<{ id: string; displayName: string; designation: string | null }>;
}

export interface SearchHit {
  kind: 'student' | 'guardian' | 'employee';
  id: string;
  displayName: string;
  subtitle: string;
  rank: number;
}

// ---- Sprint 6 -----------------------------------------------------------------------------------
export type SubjectKind = 'scholastic' | 'co_scholastic' | 'language' | 'vocational';
export type AssignmentKind = 'class_teacher' | 'subject_teacher' | 'coordinator' | 'indicator';
export type PeriodKind = 'teaching' | 'break' | 'assembly' | 'activity';

export interface Subject {
  id: string;
  code: string;
  name: string;
  kind: SubjectKind;
  displayOrder: number;
  status: 'active' | 'inactive';
  updatedAt: string;
}

export interface ClassSubject {
  id: string;
  classId: string;
  subjectId: string;
  code: string;
  name: string;
  kind: SubjectKind;
  isElective: boolean;
  periodsPerWeek: number | null;
}

export interface TeacherAssignment {
  id: string;
  academicYearId: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  userId: string | null;
  classSectionId: string;
  classCode: string;
  section: string;
  subjectId: string | null;
  subjectCode: string | null;
  subjectName: string | null;
  kind: AssignmentKind;
  canMarkAttendance: boolean;
  canPostHomework: boolean;
  canAnswerQueries: boolean;
  validFrom: string;
  validTo: string | null;
}

export interface Period {
  id: string;
  campusId: string | null;
  number: number;
  name: string;
  startsAt: string;
  endsAt: string;
  kind: PeriodKind;
}

export interface Slot {
  id: string;
  classSectionId: string;
  classCode: string;
  section: string;
  weekday: number;
  periodId: string;
  periodNumber: number;
  subjectId: string | null;
  subjectCode: string | null;
  subjectName: string | null;
  employeeId: string | null;
  employeeName: string | null;
  room: string | null;
}

export interface ImportIssue {
  row: number;
  field: string;
  message: string;
}

export interface ImportRow {
  id: string;
  kind: 'students' | 'employees';
  fileName: string | null;
  status: 'validated' | 'committed' | 'failed';
  totalRows: number;
  okRows: number;
  rejectedRows: number;
  report: ImportIssue[];
  requestedBy: string | null;
  createdAt: string;
  committedAt: string | null;
  preview: Array<Record<string, string>>;
}

export interface StatusHistoryRow {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  reason: string | null;
  changedAt: string;
  changedBy: string | null;
}
