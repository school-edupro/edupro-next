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
  lateFeeAmount?: string;
  slabs?: Array<{ on: string; amount: string }>;
  visibleFrom?: string | null;
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
  instalmentsOverride: number | null;
  hosteller: boolean;
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
  /** Sprint 17: who joins the step when it is overdue */
  escalateTo?: WorkflowResolver;
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
  /** Sprint 17 */
  dueAt?: string | null;
  overdue?: boolean;
  remindedAt?: string | null;
  escalatedAt?: string | null;
}
export interface WorkflowEvent {
  id: string;
  stepId: string | null;
  kind: string;
  actor: string | null;
  note: string | null;
  detail: Record<string, unknown>;
  occurredAt: string;
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
  alertBoarding: boolean;
  alertAlighting: boolean;
  lateAfter: string | null;
  vehicleId: string | null;
  vehicleRegNo: string | null;
  driverId: string | null;
  driverOnRecord: string | null;
  conductorName: string | null;
  conductorMobile: string | null;
  stops: number;
}
export interface RouteStudent {
  studentId: string;
  name: string;
  admissionNo: string;
  section: string | null;
  stopId: string | null;
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

// ---- Sprint 11: lesson plans, substitutions, attendance rules, privacy notices --------------------------
export interface LessonPlan {
  id: string;
  employeeId: string;
  teacher: string;
  classSectionId: string;
  section: string;
  subjectId: string;
  subject: string;
  weekStart: string;
  title: string;
  objectives: string | null;
  topics: Array<{
    day: number;
    topic: string;
    activities?: string;
    resources?: string;
    homework?: string;
  }>;
  assessment: string | null;
  status: 'draft' | 'submitted' | 'approved' | 'rejected' | 'returned';
  workflowInstanceId: string | null;
  submittedAt: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  updatedAt: string;
}
export interface Substitution {
  id: string;
  onDate: string;
  classSectionId: string;
  section: string;
  periodId: string;
  periodNumber: number;
  periodName: string;
  absentEmployeeId: string | null;
  absentTeacher: string | null;
  substituteEmployeeId: string;
  substitute: string;
  subjectId: string | null;
  subject: string | null;
  reason: string | null;
  note: string | null;
}
export interface FreeTeacher {
  id: string;
  name: string;
  designation: string | null;
  load: number;
}
export interface AttendanceRule {
  studentId: string;
  student: string;
  section: string | null;
  lateAfter: string | null;
  alertsMuted: boolean;
  reason: string | null;
  validFrom: string;
  validTo: string | null;
}
export interface PrivacyNotice {
  version: number;
  title: string;
  body: string;
  bodyHi: string | null;
  publishedAt: string | null;
  acknowledgements: number;
}

// ---- Sprint 12: fee ledger, fleet, insights ------------------------------------------------------
export interface FeeLateFee {
  amount: string;
  mode: string;
  days: number;
  overridden: boolean;
  reason: string | null;
  periodId: string | null;
  posted: string;
  outstanding: string;
}
export interface FeeLedgerInstalment {
  dueOn: string;
  ledger: string;
  label: string;
  instalment: number;
  sequences: number[];
  net: string;
  paid: string;
  balance: string;
  lateFee: FeeLateFee;
  visibleFrom: string;
  visible: boolean;
  status: 'paid' | 'overdue' | 'due' | 'upcoming';
}
export interface FeeLedgerPayment {
  id: string;
  receiptNo: string | null;
  receivedOn: string;
  amount: string;
  mode: string;
  reference: string | null;
  remarks: string | null;
  receivedBy: string | null;
  allocated: string;
  unallocated: string;
  intentId: string | null;
  lateFee: string;
  refunded: string;
  status: 'posted' | 'partly_refunded' | 'refunded' | 'bounced';
  instrumentNo: string | null;
  bankName: string | null;
  settled: boolean;
}
export interface FeeLedgerRefund {
  id: string;
  paymentId: string;
  receiptNo: string | null;
  amount: string;
  reason: string;
  mode: string;
  status: string;
  requestedAt: string;
  paidOn: string | null;
}
export interface FeeDemandDiff {
  added: Array<{ period: string; head: string; net: string; dueOn: string }>;
  removed: Array<{ period: string; head: string; net: string; dueOn: string }>;
  changed: Array<{
    period: string;
    head: string;
    before: { net: string; dueOn: string };
    after: { net: string; dueOn: string };
  }>;
  kept: number;
  totalBefore: string;
  totalAfter: string;
}
export interface FeeLedger {
  student: { id: string; name: string; admissionNo: string; section: string | null };
  year: { id: string; code: string; status: string };
  asOf: string;
  lateFeeMode: string;
  instalments: FeeLedgerInstalment[];
  totals: {
    net: string;
    paid: string;
    balance: string;
    lateFee: string;
    lateFeePosted: string;
    lateFeeOutstanding: string;
    payable: string;
  };
  payments: FeeLedgerPayment[];
  refunds: FeeLedgerRefund[];
  overrides: Array<{
    id: string;
    periodId: string;
    periodName: string;
    amount: string;
    reason: string;
    createdBy: string | null;
    createdAt: string;
  }>;
  lastRun: {
    id: string;
    ranAt: string;
    ranBy: string | null;
    rows: number;
    total: string;
    diff: FeeDemandDiff | null;
  } | null;
}
export interface ReceiptSequence {
  ledger: string;
  financialYearId: string;
  financialYear: string;
  prefix: string;
  width: number;
  nextNo: number;
  issued: number;
  configured: boolean;
}
export interface TransportVehicle {
  id: string;
  regNo: string;
  make: string | null;
  capacity: number | null;
  insuranceExpiry: string | null;
  fitnessExpiry: string | null;
  permitExpiry: string | null;
  gpsDeviceId: string | null;
  status: 'active' | 'inactive';
  routes: string[];
  nextExpiry: string | null;
}
export interface TransportDriver {
  id: string;
  name: string;
  mobile: string | null;
  licenceNo: string | null;
  licenceExpiry: string | null;
  employeeId: string | null;
  status: 'active' | 'inactive';
  routes: string[];
}
export interface TransportStop {
  id: string;
  routeId: string;
  sequence: number;
  name: string;
  lat: string | null;
  lng: string | null;
  pickupTime: string | null;
  dropTime: string | null;
  slabId: string | null;
  slabCode: string | null;
  students: number;
}
export interface DashboardAlert {
  severity: 'info' | 'warning' | 'danger';
  code: string;
  message: string;
  href: string | null;
}
export interface MartStatus {
  mart: string;
  refreshedAt: string | null;
  rows: number | null;
  durationMs: number | null;
  stale: boolean;
}
export interface PrincipalDashboard {
  date: string;
  year: { id: string; code: string; status: string };
  attendance: {
    strength: number;
    present: number;
    absent: number;
    late: number;
    pct: number | null;
    sections: number;
    markedSections: number;
    unmarked: string[];
    byClass: Array<{
      classId: string;
      classCode: string;
      strength: number;
      present: number;
      absent: number;
      pct: number | null;
    }>;
    trend: Array<{ date: string; pct: number | null; strength: number; present: number }>;
  };
  fees: {
    dueTillDate: string;
    collectedTillDate: string;
    balance: string;
    ageing: Array<{ bucket: string; balance: string; students: number }>;
    collectedToday: string;
    collected7d: string;
    collected30d: string;
    previous7d: string;
    byMode30d: Array<{ mode: string; amount: string; receipts: number }>;
    daily: Array<{ date: string; amount: string }>;
    defaulters: Array<{
      studentId: string;
      name: string;
      admissionNo: string;
      section: string | null;
      balance: string;
      daysOverdue: number;
    }>;
    byClass: Array<{ classCode: string; net: string; paid: string; balance: string }>;
  };
  admissions: Array<{
    cycleId: string;
    code: string;
    status: string;
    total: number;
    byStatus: Array<{ status: string; count: number }>;
  }>;
  comms: {
    last7: Array<{
      channel: string;
      sent: number;
      delivered: number;
      failed: number;
      queued: number;
    }>;
    deliveryRate: number | null;
  };
  approvals: { pending: number; oldestHours: number | null };
  readers: Array<{
    code: string;
    name: string;
    kind: string;
    lastSeenAt: string | null;
    silentHours: number | null;
  }>;
  alerts: DashboardAlert[];
  marts: MartStatus[];
}

// ---- Sprint 13: collect and pay ------------------------------------------------------------------
export interface ReceiptResult {
  paymentId: string;
  receiptNo: string | null;
  amount: string;
  principal: string;
  lateFee: string;
  advance: string;
  instalments: number;
}
export interface FeeRefund {
  id: string;
  paymentId: string;
  receiptNo: string | null;
  studentId: string;
  studentName: string;
  admissionNo: string;
  receiptAmount: string;
  amount: string;
  reason: string;
  mode: 'cash' | 'bank' | 'cheque' | 'gateway';
  reference: string | null;
  status: 'requested' | 'approved' | 'rejected' | 'paid' | 'failed';
  requestedBy: string | null;
  requestedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  provider: string | null;
  providerRef: string | null;
  paidOn: string | null;
}
export interface SettlementLine {
  id: string;
  lineNo: number;
  providerRef: string | null;
  txnId: string | null;
  amount: string;
  charges: string;
  tax: string;
  net: string | null;
  status: 'matched' | 'unmatched' | 'amount_mismatch' | 'duplicate' | 'refund';
  intentId: string | null;
  paymentId: string | null;
  receiptNo: string | null;
  studentName: string | null;
  note: string | null;
}
export interface PaymentSettlement {
  id: string;
  provider: string;
  settlementRef: string;
  settledOn: string;
  utr: string | null;
  gross: string;
  charges: string;
  tax: string;
  net: string;
  rows: number;
  matched: number;
  unmatched: number;
  mismatched: number;
  fileName: string | null;
  uploadedBy: string | null;
  createdAt: string;
  lines?: SettlementLine[];
}
export interface TransportRequest {
  id: string;
  studentId: string;
  studentName: string;
  admissionNo: string;
  section: string | null;
  kind: 'join' | 'change' | 'leave';
  routeId: string | null;
  routeCode: string | null;
  routeName: string | null;
  stopId: string | null;
  stopName: string | null;
  effectiveFrom: string | null;
  note: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  requestedBy: string | null;
  requestedAt: string;
  workflowInstanceId: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  current: { routeCode: string; routeName: string; stopName: string | null } | null;
}
export interface VehicleLog {
  id: string;
  vehicleId: string;
  regNo: string;
  routeId: string | null;
  routeCode: string | null;
  driverId: string | null;
  driverName: string | null;
  logDate: string;
  odometerStart: number | null;
  odometerEnd: number | null;
  km: number | null;
  fuelLitres: string | null;
  fuelCost: string | null;
  trips: number | null;
  incident: string | null;
  remarks: string | null;
  createdBy: string | null;
}
export type Department =
  'academics' | 'attendance' | 'fees' | 'admissions' | 'transport' | 'communication' | 'hr';
export interface DepartmentCard {
  department: Department;
  allowed: boolean;
  reports: number;
}
export interface DepartmentReport {
  id: string;
  title: string;
  permission: string;
  allowed: boolean;
  columns: string[];
}
/** The department dashboards share the envelope; the body differs per department (see the API). */
export interface DepartmentDashboard {
  department: Department;
  date: string;
  year: { id: string; code: string; status: string };
  classId: string | null;
  [k: string]: unknown;
}

// ---- Sprint 14: adjustments, misc, exams, assistant ------------------------------------------------
export interface FeeAdjustment {
  id: string;
  studentId: string;
  studentName: string;
  admissionNo: string;
  kind: 'waiver' | 'reversal' | 'bounce';
  demandId: string | null;
  demandLabel: string | null;
  paymentId: string | null;
  receiptNo: string | null;
  receiptAmount: string | null;
  amount: string;
  charge: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  requestedBy: string | null;
  requestedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
}
export interface FeeProfileChange {
  id: string;
  studentId: string;
  studentName: string;
  admissionNo: string;
  changes: Record<string, unknown>;
  before: Record<string, unknown>;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  requestedBy: string | null;
  requestedAt: string;
  workflowInstanceId: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
}
export interface MiscReceipt {
  id: string;
  receiptNo: string;
  payerKind: 'student' | 'employee' | 'vendor' | 'other';
  studentId: string | null;
  employeeId: string | null;
  payerName: string;
  payerMobile: string | null;
  headId: string;
  headCode: string;
  headName: string;
  amount: string;
  receivedOn: string;
  mode: string;
  reference: string | null;
  instrumentNo: string | null;
  bankName: string | null;
  remarks: string | null;
  status: string;
  receivedBy: string | null;
}
export interface ReconciliationRun {
  id: string;
  runDate: string;
  asOf: string;
  onlineReceipts: number;
  onlineAmount: string;
  settledReceipts: number;
  settledAmount: string;
  unsettledReceipts: number;
  unsettledAmount: string;
  agedUnsettled: number;
  unmatchedLines: number;
  mismatchedLines: number;
  succeededWithoutReceipt: number;
  variance: string;
  ranAt: string;
}
export interface ExamType {
  id: string;
  code: string;
  name: string;
  weightage: string | null;
  sortOrder: number;
  status: 'active' | 'inactive';
  exams: number;
}
export interface GradeBand {
  id: string;
  minPct: string;
  maxPct: string;
  grade: string;
  points: string | null;
  remark: string | null;
}
export interface GradeScale {
  id: string;
  code: string;
  name: string;
  description: string | null;
  status: 'active' | 'inactive';
  bands: GradeBand[];
}
export interface ExamClass {
  classId: string;
  classCode: string;
  gradeScaleId: string | null;
  gradeScaleCode: string | null;
  subjects: number;
  locked: number;
}
export interface ExamSubject {
  id: string;
  classId: string;
  subjectId: string;
  subjectCode: string;
  subjectName: string;
  maxMarks: string;
  passMarks: string | null;
  weightage: string | null;
  isElective: boolean;
  examOn: string | null;
  entryLocked: boolean;
  lockedBy: string | null;
  lockedAt: string | null;
}
export interface Exam {
  id: string;
  code: string;
  name: string;
  examTypeId: string;
  examTypeCode: string;
  examTypeName: string;
  startsOn: string | null;
  endsOn: string | null;
  showOnPortal: boolean;
  marksLocked: boolean;
  status: 'active' | 'inactive';
  classes: ExamClass[];
  subjects?: ExamSubject[];
}
export interface SubjectRow {
  id: string;
  code: string;
  name: string;
}
export interface CatalogueEntryView {
  id: string;
  department: string;
  title: string;
  titleHi: string;
  description: string;
  params: Array<{ name: string; type: string; description: string; required?: boolean }>;
  allowed: boolean;
}
export interface AssistantCitation {
  query: string;
  title: string;
  params: Record<string, unknown>;
  rows: number;
}
export interface AssistantMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  refused: boolean;
  citations: AssistantCitation[];
  usage: { inputTokens: number; outputTokens: number } | null;
  createdAt: string;
}
export interface AssistantConversation {
  id: string;
  title: string | null;
  language: string;
  turns: number;
  tokens: number;
  costPaise: number;
  updatedAt: string;
  messages?: AssistantMessage[];
}
export interface AssistantAudit {
  days: number;
  provider: string;
  model: string;
  totals: {
    prompts: number;
    refusals: number;
    tool_calls: number;
    input_tokens: number;
    output_tokens: number;
    cost_paise: number;
    users: number;
  };
  recent: Array<{
    id: string;
    at: string;
    kind: string;
    user: string | null;
    text: string;
    redactions: number;
    citations: string[] | null;
    costPaise: number | null;
  }>;
}

// ---- Sprint 15 ----
export interface DatasetRows {
  dataset: string;
  title: string;
  columns: Array<{ key: string; header: string; type?: string; width?: number }>;
  params: Record<string, unknown>;
  rows: Array<Record<string, unknown>>;
  truncated: boolean;
}
export interface BankStatement {
  id: string;
  bankName: string;
  accountRef: string | null;
  fromDate: string | null;
  toDate: string | null;
  fileName: string | null;
  rows: number;
  matched: number;
  unmatched: number;
  returned: number;
  credits: string;
  debits: string;
  uploadedBy: string | null;
  createdAt: string;
  lines?: Array<{
    id: string;
    lineNo: number;
    txnDate: string;
    valueDate: string | null;
    narration: string | null;
    reference: string | null;
    debit: string;
    credit: string;
    balance: string | null;
    status: 'matched' | 'unmatched' | 'ambiguous' | 'returned' | 'ignored';
    matchedBy: string | null;
    receiptNo: string | null;
    note: string | null;
  }>;
}
export interface InsightAlert {
  id: string;
  kind: string;
  severity: 'info' | 'warning' | 'danger';
  subjectType: string | null;
  subjectId: string | null;
  title: string;
  message: string;
  data: Record<string, unknown>;
  detectedOn: string;
  notifiedAt: string | null;
  ackedBy: string | null;
  ackedAt: string | null;
}

// ---- Sprint 16 ----
export interface ShadowFeed {
  id: string;
  kind: 'receipts' | 'balances';
  source: string;
  fileName: string | null;
  rows: number;
  accepted: number;
  posted: number;
  skipped: number;
  rejected: number;
  receivedBy: string;
  receivedAt: string;
}
export interface ShadowRun {
  id: string;
  runDate: string;
  fromDate: string;
  toDate: string;
  legacyReceipts: number;
  legacyAmount: string;
  newReceipts: number;
  newAmount: string;
  matched: number;
  variances: number;
  openVariances: number;
  varianceAmount: string;
  balancesCompared: number;
  balanceVariances: number;
  status: 'zero' | 'variance';
  ranAt: string;
}
export interface ShadowVariance {
  id: string;
  runId: string;
  runDate: string;
  kind: string;
  ref: string;
  legacy: Record<string, unknown>;
  current: Record<string, unknown>;
  delta: string;
  status: 'open' | 'explained' | 'resolved';
  explanation: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
}
export interface ServiceKeyRow {
  id: string;
  name: string;
  scopes: string[];
  status: string;
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}
export interface RegisterSheet {
  exam: { id: string; code: string; name: string; marksLocked: boolean; computedAt: string | null };
  section: { id: string; code: string };
  subjects: Array<{
    id: string;
    code: string;
    name: string;
    maxMarks: string;
    passMarks: string | null;
  }>;
  rows: Array<{
    studentId: string;
    name: string;
    admissionNo: string;
    rollNo: number | null;
    marks: Record<string, { marks: string | null; absent: boolean; exempt: boolean }>;
    total: string | null;
    maxTotal: string | null;
    pct: string | null;
    grade: string | null;
    result: string | null;
    rankInSection: number | null;
    rankInClass: number | null;
    failedSubjects: number | null;
  }>;
}
export interface ExamAnalysis {
  exam: { id: string; code: string; name: string; computedAt: string | null };
  classId: string | null;
  totals: {
    pupils: number;
    complete: number;
    pass: number;
    fail: number;
    incomplete: number;
    passPct: number | null;
    meanPct: number | null;
  };
  subjects: Array<{
    classCode: string;
    code: string;
    name: string;
    maxMarks: string;
    passMarks: string | null;
    pupils: number;
    entered: number;
    absent: number;
    exempt: number;
    mean: string | null;
    highest: string | null;
    lowest: string | null;
    passPct: number | null;
  }>;
  grades: Array<{ grade: string; pupils: number }>;
  sections: Array<{
    section: string;
    pupils: number;
    complete: number;
    meanPct: number | null;
    passPct: number | null;
  }>;
  toppers: Array<{
    section: string;
    name: string;
    admissionNo: string;
    pct: string;
    grade: string | null;
    rankInClass: number | null;
  }>;
}
export interface PromotionProposals {
  exam: { id: string; code: string; name: string; computedAt: string | null };
  rule: { minPct: number; maxFailed: number };
  totals: { promote: number; retain: number; review: number };
  proposals: Array<{
    studentId: string;
    name: string;
    admissionNo: string;
    section: string;
    classSectionId: string;
    classId: string;
    pct: string | null;
    grade: string | null;
    result: string;
    failedSubjects: number;
    decision: 'promote' | 'retain' | 'review';
    reason: string;
  }>;
}
export interface AiReport {
  id: string;
  kind: 'principal_brief' | 'department_weekly';
  department: string | null;
  periodFrom: string;
  periodTo: string;
  language: string;
  title: string;
  narrative: string;
  facts: Array<{
    id: string;
    label: string;
    value: string | number | null;
    unit?: string;
    detail?: Record<string, unknown>;
  }>;
  citations: string[];
  provider: string;
  model: string;
  costPaise: number;
  exportId: string | null;
  exportStatus: string | null;
  createdAt: string;
}
export interface AssistantCosts {
  days: number;
  budget: { perUserDailyTokens: number; perSchoolMonthlyTokens: number };
  totals: {
    prompts: number;
    refusals: number;
    inputTokens: number;
    outputTokens: number;
    costPaise: number;
    refusalRatePct: number | null;
  };
  reports: { count: number; costPaise: number };
  byDay: Array<{
    day: string;
    prompts: number;
    refusals: number;
    inputTokens: number;
    outputTokens: number;
    costPaise: number;
  }>;
  bySurface: Array<{
    surface: string;
    prompts: number;
    refusals: number;
    costPaise: number;
    users: number;
  }>;
  byUser: Array<{ user: string | null; prompts: number; costPaise: number; tokens: number }>;
  byModel: Array<{ provider: string; model: string; prompts: number; costPaise: number }>;
}

// ---- Sprint 17 ----
export type ClassBand = 'primary' | 'middle' | 'secondary' | 'senior';
export interface ReportCardTemplate {
  id: string;
  code: string;
  name: string;
  band: ClassBand;
  layout: Record<string, unknown>;
  bodyHtml: string | null;
  stylesCss: string;
  pageWidth: string;
  pageHeight: string;
  version: number;
  status: 'active' | 'inactive';
  updatedAt: string;
}
export interface ReportCardRelease {
  id: string;
  termCode: string;
  name: string;
  examIds: string[];
  exams: Array<{ id: string; code: string; name: string }>;
  templates: Record<string, string>;
  hideDefaulters: boolean;
  defaulterMin: string;
  status: 'draft' | 'released' | 'withdrawn';
  releasedAt: string | null;
  createdAt: string;
  cards: { rendered: number; withheld: number };
}
export interface ReportCardStatus {
  studentId: string;
  name: string;
  admissionNo: string;
  rollNo: number | null;
  exportId: string | null;
  exportStatus: string | null;
  withheld: boolean;
  withheldReason: string | null;
  renderedAt: string | null;
}
export interface VehiclePosition {
  vehicleId: string;
  regNo: string;
  recordedAt: string;
  lat: string;
  lng: string;
  speedKmh: string | null;
  heading: string | null;
  ignition: boolean | null;
  source: string;
  ageSeconds: number;
}
export interface LibraryTitle {
  id: string;
  code: string;
  title: string;
  author: string | null;
  publisher: string | null;
  category: string | null;
  language: string | null;
  location: string | null;
  isReference: boolean;
  price: string | null;
  copies: number;
  available: number;
}
export interface LibraryCopy {
  id: string;
  accessionNo: string;
  accessionedOn: string;
  source: string | null;
  price: string | null;
  status: string;
  remarks: string | null;
  lastVerifiedOn: string | null;
  loan: { dueOn: string; borrower: string; kind: string } | null;
}
export interface LibraryLoan {
  id: string;
  accessionNo: string;
  title: string;
  author: string | null;
  borrowerKind: 'student' | 'employee';
  borrowerId: string;
  borrower: string;
  borrowerRef: string;
  issuedOn: string;
  dueOn: string;
  returnedOn: string | null;
  renewed: number;
  daysOverdue: number;
  fineAmount: string;
  fineWaived: string;
  finePaidOn: string | null;
  note: string | null;
}
