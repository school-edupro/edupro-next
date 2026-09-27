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

// ---- Sprint 7 -----------------------------------------------------------------------------------
export type DailyWorkKind = 'homework' | 'classwork' | 'assignment';
export type Audience = 'everyone' | 'students' | 'employees';

export interface AttachedFile {
  id: string;
  name: string | null;
  contentType: string;
  sizeBytes: number;
}

export interface DailyWork {
  id: string;
  kind: DailyWorkKind;
  classSectionId: string;
  section: string;
  subjectId: string | null;
  subjectCode: string | null;
  subjectName: string | null;
  title: string;
  body: string;
  assignedOn: string;
  dueOn: string | null;
  postedBy: string | null;
  files: AttachedFile[];
  createdAt: string;
}

export interface Viewer {
  kind: 'staff' | 'family';
  sectionIds: string[] | null;
  students: Array<{
    id: string;
    name: string;
    classSectionId: string | null;
    section: string | null;
  }>;
  employeeId: string | null;
}

export interface NoticeTarget {
  type: 'class' | 'class_section' | 'student' | 'employee';
  id: string;
  label: string;
}

export interface Notice {
  id: string;
  kind: 'notice' | 'circular';
  title: string;
  body: string;
  audience: Audience;
  publishFrom: string;
  publishUntil: string | null;
  isPinned: boolean;
  publishedAt: string | null;
  publishedBy: string | null;
  targets: NoticeTarget[];
  files: AttachedFile[];
  createdAt: string;
}

export interface Holiday {
  id: string;
  name: string;
  kind: 'holiday' | 'vacation' | 'working_day';
  startsOn: string;
  endsOn: string;
  appliesTo: Audience;
  campusId: string | null;
}

export interface AlmanacEvent {
  id: string;
  title: string;
  kind: 'event' | 'exam' | 'meeting' | 'activity' | 'deadline';
  startsOn: string;
  endsOn: string;
  startsAt: string | null;
  description: string | null;
  audience: Audience;
}

export interface Calendar {
  holidays: Holiday[];
  events: AlmanacEvent[];
  from: string;
  to: string;
}

export interface Album {
  id: string;
  title: string;
  description: string | null;
  eventOn: string | null;
  audience: Audience;
  itemCount: number;
  coverFileId: string | null;
  createdAt: string;
  items?: Array<{
    id: string;
    fileId: string;
    name: string | null;
    contentType: string;
    caption: string | null;
  }>;
}

export interface DocumentTemplate {
  id: string;
  code: string;
  name: string;
  kind: 'transfer_certificate' | 'bonafide' | 'letter';
  pageWidth: string;
  pageHeight: string;
  bodyHtml: string;
  stylesCss: string;
  placeholders: string[];
  version: number;
  status: 'active' | 'inactive';
  updatedAt: string;
}

export interface TransferCertificate {
  id: string;
  studentId: string;
  studentName: string;
  admissionNo: string;
  tcNo: string;
  serial: number;
  issuedOn: string;
  reason: string;
  lastClass: string | null;
  conduct: string;
  promotionStatus: string | null;
  duesCleared: boolean;
  remarks: string | null;
  templateId: string | null;
  exportId: string | null;
  status: 'issued' | 'cancelled';
  issuedBy: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdAt: string;
}

export interface Clearance {
  id: string;
  department: string;
  status: 'pending' | 'cleared' | 'hold';
  dues: string;
  remarks: string | null;
  actedBy: string | null;
  actedAt: string | null;
}

export interface Withdrawal {
  id: string;
  studentId: string;
  studentName: string;
  admissionNo: string;
  section: string | null;
  requestedOn: string;
  leavingOn: string;
  reason: string;
  status: 'requested' | 'cleared' | 'completed' | 'cancelled';
  requestedBy: string | null;
  completedAt: string | null;
  cancelReason: string | null;
  clearances: Clearance[];
}

export interface PromotionRow {
  studentId: string;
  studentName: string;
  admissionNo: string;
  fromSection: string;
  rollNo: number | null;
  decisionId: string | null;
  decision: 'promote' | 'retain' | 'transfer_out' | 'graduate' | null;
  toClassSectionId: string | null;
  toSection: string | null;
  remarks: string | null;
  appliedAt: string | null;
}

// ---- Sprint 8 -----------------------------------------------------------------------------------
export interface AdmissionCriterion {
  id: string;
  classId: string;
  classCode: string;
  className: string;
  seats: number;
  dobFrom: string | null;
  dobTo: string | null;
  passcode: string | null;
  applications: number;
}
export interface ScoreCriterion {
  id: string;
  code: string;
  name: string;
  points: number;
  autoRule: string | null;
}
export interface AdmissionCycle {
  id: string;
  academicYearId: string;
  academicYear: string;
  code: string;
  name: string;
  nameHi: string | null;
  instructions: string | null;
  instructionsHi: string | null;
  opensAt: string;
  closesAt: string;
  status: 'draft' | 'open' | 'closed';
  formSchema: Array<{
    key: string;
    label: string;
    type: string;
    required?: boolean;
    section: string;
  }>;
  applicationFee: string;
  criteria: AdmissionCriterion[];
  scoreCriteria: ScoreCriterion[];
  applications: number;
}
export type ApplicationStatus =
  | 'draft'
  | 'submitted'
  | 'under_review'
  | 'shortlisted'
  | 'selected'
  | 'waitlisted'
  | 'rejected'
  | 'withdrawn'
  | 'admitted';
export interface AdmissionApplication {
  id: string;
  cycleId: string;
  cycleCode: string;
  classId: string;
  classCode: string;
  applicantId: string;
  applicantMobile: string;
  applicantName: string | null;
  applicationNo: string | null;
  status: ApplicationStatus;
  childFirstName: string;
  childLastName: string | null;
  childName: string;
  childDob: string;
  childGender: string;
  data: Record<string, unknown>;
  score: string | null;
  scoreBreakdown: Array<{ code: string; name: string; points: number; source: string }>;
  possibleDuplicateOf: string | null;
  submittedAt: string | null;
  decidedAt: string | null;
  remarks: string | null;
  createdAt: string;
  feePaidAt: string | null;
  studentId: string | null;
  workflowInstanceId: string | null;
  offer?: AdmissionOffer | null;
  events?: Array<{
    id: string;
    fromStatus: string | null;
    toStatus: string;
    note: string | null;
    actor: string | null;
    createdAt: string;
  }>;
}
export interface AdmissionOffer {
  status: 'offered' | 'accepted' | 'expired' | 'withdrawn';
  admissionFee: string;
  expiresAt: string;
  acceptedAt: string | null;
  payment: {
    status: PaymentIntent['status'];
    txnId: string;
    form: { action: string; fields: Record<string, string> } | null;
  } | null;
}
export interface AdmissionsDashboard {
  byStatus: Array<{ status: string; count: number }>;
  byClass: Array<{
    cycle: string;
    classCode: string;
    seats: number;
    applications: number;
    shortlisted: number;
    selected: number;
  }>;
  possibleDuplicates: number;
}

export interface FeeHead {
  id: string;
  code: string;
  name: string;
  kind: 'regular' | 'transport' | 'opening_balance' | 'late_fee' | 'misc';
  ledger: string;
  isOptional: boolean;
  refundable: boolean;
  sortOrder: number;
  status: 'active' | 'inactive';
}
export interface FeePeriod {
  id: string;
  sequence: number;
  name: string;
  month: number;
  year: number;
  instalment: number;
  dueOn: string;
}
export interface FeeStructure {
  id: string;
  classId: string;
  headId: string;
  headCode: string;
  headName: string;
  feeGroup: string;
  studentType: 'all' | 'new' | 'old';
  amount: string;
  frequency: 'monthly' | 'quarterly' | 'half_yearly' | 'annual' | 'one_time';
  periods: number[] | null;
  annual: string;
}
export interface TransportSlab {
  id: string;
  code: string;
  name: string;
  distanceFromKm: string | null;
  distanceToKm: string | null;
  monthlyAmount: string;
}
export interface FeeDiscount {
  id: string;
  code: string;
  name: string;
  headId: string | null;
  headCode: string | null;
  percent: string | null;
  amount: string | null;
  appliesToTransport: boolean;
  status: 'active' | 'inactive';
}
export interface FeeProfile {
  studentId: string;
  academicYearId: string;
  feeGroup: string;
  studentType: 'new' | 'old';
  transportSlabId: string | null;
  transportSlab: string | null;
  transportDisabled: boolean;
  discountId: string | null;
  discount: string | null;
  openingBalance: string;
  notes: string | null;
  isDefault: boolean;
}
export interface FeeDemandRow {
  id: string;
  periodId: string;
  periodName: string;
  sequence: number;
  instalment: number;
  headId: string;
  headCode: string;
  headName: string;
  gross: string;
  discount: string;
  net: string;
  paid: string;
  status: string;
  dueOn: string;
  source: string;
}
export interface FeeDemandSummary {
  rows: FeeDemandRow[];
  byInstalment: Array<{
    instalment: number;
    dueOn: string;
    net: string;
    paid: string;
    balance: string;
  }>;
  total: { net: string; paid: string; balance: string };
  lastRun: { id: string; ranAt: string; ranBy: string | null; rows: number; total: string } | null;
}
export interface FeeClassSummaryRow {
  studentId: string;
  name: string;
  admissionNo: string;
  section: string;
  rollNo: number | null;
  net: string;
  paid: string;
  balance: string;
  rows: number;
  hasProfile: boolean;
}

// ---- Sprint 9: workflow, payments, attendance ----------------------------------------------------
export type WorkflowResolver =
  | { kind: 'named_user'; userId: string }
  | { kind: 'role'; roleCode: string }
  | { kind: 'position'; designation: string }
  | { kind: 'approver_chain'; depth: number };
export interface WorkflowLevel {
  level: number;
  name: string;
  resolver: WorkflowResolver;
  slaHours?: number;
}
export interface WorkflowDefinition {
  id: string;
  code: string;
  name: string;
  entityType: string;
  levels: WorkflowLevel[];
  status: 'active' | 'inactive';
  open: number;
}
export interface WorkflowStep {
  id: string;
  instanceId: string;
  level: number;
  name: string;
  resolver: WorkflowResolver;
  assignees: Array<{ id: string; name: string }>;
  status: 'pending' | 'approved' | 'rejected' | 'skipped';
  actedBy: string | null;
  actedAt: string | null;
  note: string | null;
}
export interface WorkflowInstance {
  id: string;
  definitionId: string;
  definitionCode: string;
  definitionName: string;
  entityType: string;
  entityId: string;
  subject: string;
  payload: Record<string, unknown>;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  currentLevel: number;
  requestedBy: string | null;
  requestedAt: string;
  completedAt: string | null;
  steps: WorkflowStep[];
}
/** An inbox row: the step plus the instance it belongs to. */
export interface InboxItem extends WorkflowStep {
  instance: Omit<WorkflowInstance, 'steps'>;
}

export interface PaymentIntent {
  id: string;
  purpose: 'admission_fee' | 'fee_instalment' | 'misc';
  entityType: string | null;
  entityId: string | null;
  amount: string;
  currency: string;
  status: 'created' | 'pending' | 'succeeded' | 'failed' | 'cancelled';
  provider: string;
  txnId: string;
  providerRef: string | null;
  payerName: string | null;
  payerEmail: string | null;
  payerMobile: string | null;
  returnUrl: string | null;
  succeededAt: string | null;
  failedReason: string | null;
  createdAt: string;
  events?: Array<{ id: string; kind: string; providerRef: string | null; createdAt: string }>;
}

export type AttendanceCode = 'P' | 'A' | 'L' | 'SR' | 'H' | 'OD' | 'SB';
export interface AttendanceRosterRow {
  studentId: string;
  name: string;
  admissionNo: string;
  rollNo: number | null;
  code: AttendanceCode | null;
  remarks: string | null;
  inAt: string | null;
  outAt: string | null;
  source: string | null;
}
export interface AttendanceSession {
  id: string | null;
  classSectionId: string;
  section: string;
  date: string;
  kind: 'day' | 'subject';
  subjectId: string | null;
  subjectName: string | null;
  source: string | null;
  markedBy: string | null;
  markedAt: string | null;
  locked: boolean;
  roster: AttendanceRosterRow[];
  counts: Record<string, number>;
}
export interface AttendanceSummaryRow {
  classSectionId: string;
  section: string;
  strength: number;
  sessionId: string | null;
  source: string | null;
  locked: boolean;
  markedBy: string | null;
  present: number;
  absent: number;
  late: number;
  codes: Record<string, number>;
}
export interface AttendanceSummary {
  date: string;
  sections: AttendanceSummaryRow[];
}
export interface RfidDevice {
  id: string;
  code: string;
  name: string;
  campus: string | null;
  kind: 'gate' | 'bus' | 'biometric';
  routeId: string | null;
  route: string | null;
  direction: 'in' | 'out' | null;
  status: 'active' | 'inactive';
  lastSeenAt: string | null;
  events: number;
}
export interface RfidEvent {
  id: string;
  device: string;
  tag: string;
  student: string | null;
  occurredAt: string;
  direction: 'in' | 'out';
  outcome: string;
}

// ---- Sprint 10: communication requests, consent, groups, engagement, transport, devices ----------------
export type MessageAudience =
  | 'everyone'
  | 'students'
  | 'employees'
  | 'class'
  | 'class_section'
  | 'route'
  | 'group'
  | 'individuals';
export interface MessageRequest {
  id: string;
  title: string;
  category: 'service' | 'general';
  channel: Channel;
  templateId: string;
  templateCode: string | null;
  body: string;
  variables: Record<string, unknown>;
  audience: MessageAudience;
  targets: Array<{ type: string; id: string }>;
  targetLabels: string[];
  status: 'draft' | 'pending_approval' | 'approved' | 'rejected' | 'sending' | 'sent' | 'cancelled';
  scheduledAt: string | null;
  requestedBy: string | null;
  requestedAt: string;
  workflowInstanceId: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  recipientsTotal: number;
  recipientsSkipped: number;
  dispatchedAt: string | null;
  delivery: Record<string, number>;
  recipients?: Array<{
    id: string;
    name: string | null;
    address: string | null;
    student: string | null;
    skippedReason: string | null;
    status: string | null;
    sentAt: string | null;
    lastError: string | null;
  }>;
}
export interface RequestPreview {
  total: number;
  skipped: number;
  skippedReasons: Record<string, number>;
  sample: Array<{ name: string; address: string; student: string | null }>;
}
export interface CommsGroup {
  id: string;
  code: string;
  name: string;
  description: string | null;
  members: number;
  createdAt: string;
}
export interface ConsentPurpose {
  code: string;
  name: string;
  description: string;
  channel: string | null;
  isRequired: boolean;
  version: number;
  status: 'granted' | 'withdrawn' | null;
  recordedAt: string | null;
  source: string | null;
}
export interface ConsentView {
  user: { id: string; name: string };
  purposes: ConsentPurpose[];
  history: Array<{
    id: string;
    purposeCode: string;
    status: string;
    source: string;
    note: string | null;
    recordedBy: string | null;
    recordedAt: string;
  }>;
}

export interface ParentQuery {
  id: string;
  number: string;
  kind: 'query' | 'complaint' | 'leave';
  categoryCode: string;
  categoryName: string;
  studentId: string;
  studentName: string;
  section: string | null;
  raisedBy: string | null;
  raisedByUserId: string;
  subject: string;
  body: string;
  fileIds: string[];
  leaveFrom: string | null;
  leaveTo: string | null;
  status: 'open' | 'in_progress' | 'answered' | 'closed';
  assignedRole: string | null;
  assignedTo: string | null;
  assignedUserId: string | null;
  decision: string | null;
  rating: number | null;
  ratingComment: string | null;
  openedAt: string;
  firstResponseAt: string | null;
  closedAt: string | null;
  responses?: Array<{
    id: string;
    author: string | null;
    authorKind: 'guardian' | 'student' | 'staff';
    body: string;
    fileIds: string[];
    isInternal: boolean;
    createdAt: string;
  }>;
}
export interface FeedbackEntry {
  id: string;
  author: string;
  student: string | null;
  category: string;
  rating: number;
  comment: string | null;
  createdAt: string;
}
export interface ChangeRequest {
  id: string;
  studentId: string;
  studentName: string;
  requestedBy: string | null;
  entity: 'student' | 'guardian';
  entityId: string;
  entityName: string | null;
  changes: Record<string, { from: unknown; to: string }>;
  reason: string | null;
  status: 'pending' | 'approved' | 'rejected';
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
}
export interface TransportRoute {
  id: string;
  code: string;
  name: string;
  vehicleNo: string | null;
  driverName: string | null;
  driverMobile: string | null;
  status: 'active' | 'inactive';
  students: number;
}
export interface RouteStudent {
  studentId: string;
  name: string;
  admissionNo: string;
  section: string | null;
  stopName: string | null;
  pickupTime: string | null;
  dropTime: string | null;
  guardianMobile: string | null;
}
export interface RfidDashboard {
  date: string;
  devices: Array<{
    id: string;
    code: string;
    name: string;
    kind: 'gate' | 'bus' | 'biometric';
    status: string;
    route: string | null;
    lastSeenAt: string | null;
    health: 'online' | 'idle' | 'silent' | 'inactive';
    gateIn: number;
    gateOut: number;
    gateRejected: number;
    boarded: number;
    alighted: number;
    punches: number;
  }>;
  sections: Array<{
    classSectionId: string;
    section: string;
    strength: number;
    tagged: number;
    inToday: number;
    late: number;
    notIn: number;
  }>;
  notIn: Array<{ id: string; name: string; section: string; tag: string }>;
}
export interface BusEvent {
  id: string;
  occurredAt: string;
  direction: string;
  outcome: string;
  tag: string;
  lat: string | null;
  lng: string | null;
  student: string | null;
  studentId: string | null;
  route: string | null;
  device: string;
  alertSentAt: string | null;
}
export interface PunchSummary {
  date: string;
  present: number;
  absent: number;
  rows: Array<{
    employeeId: string;
    code: string;
    name: string;
    designation: string | null;
    department: string | null;
    firstIn: string | null;
    lastOut: string | null;
    punches: number;
    hours: number | null;
  }>;
}
