/** Recruitment (docs/design/34-recruitment.md): the shapes the API gives and the words the screens use. */
export type VacancyStatus =
  'draft' | 'pending' | 'approved' | 'rejected' | 'published' | 'closed' | 'cancelled';
export type StageKind = 'shortlist' | 'test' | 'interview' | 'final';

export interface RecruitmentStage {
  id: string;
  name: string;
  kind: StageKind;
  maxMarks: number | null;
  active: boolean;
}
export interface RecruitmentSetup {
  stages: RecruitmentStage[];
  departments: string[];
  designations: string[];
  employeeTypes: string[];
  subjects: string[];
  campuses: Array<{ id: string; name: string }>;
  can: { raise: boolean; manage: boolean };
}
export interface Vacancy {
  id: string;
  code: string;
  title: string;
  designation: string | null;
  department: string | null;
  subject: string | null;
  employeeType: string | null;
  campusId: string | null;
  campus: string | null;
  posts: number;
  qualification: string | null;
  experience: string | null;
  payBand: string | null;
  description: string | null;
  stageIds: string[];
  stages: string[];
  status: VacancyStatus;
  opensAt: string | null;
  closesAt: string | null;
  waitingWith: string | null;
  decisionNote: string | null;
  raisedBy: string | null;
  submittedAt: string | null;
  decidedAt: string | null;
  publishedAt: string | null;
  closedAt: string | null;
  createdAt: string;
}
export interface VacancyApprovalStep {
  level: number;
  name: string;
  status: 'pending' | 'approved' | 'rejected' | 'skipped';
  people: string[];
  actedBy: string | null;
  actedAt: string | null;
  note: string | null;
  current: boolean;
  overdue: boolean;
}
export interface VacancyView extends Vacancy {
  events: Array<{ at: string; what: string; note: string | null; by_name: string | null }>;
  approval: { status: string; steps: VacancyApprovalStep[] } | null;
  /** the careers page of the vacancy, while it is published */
  share: { url: string; open: boolean } | null;
  can: {
    view: boolean;
    edit: boolean;
    submit: boolean;
    publish: boolean;
    close: boolean;
    cancel: boolean;
    approve: boolean;
  };
}

/** Who approves a vacancy, level by level (Recruitment set-up). */
export type ApprovalBy = 'employees' | 'designation' | 'hod' | 'role';
export interface ApprovalLevel {
  name: string;
  by: ApprovalBy;
  employeeIds: string[];
  designation: string | null;
  roleCode: string | null;
  slaHours: number | null;
}
export interface ApprovalSetup {
  levels: ApprovalLevel[];
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
  waiting: number;
  can: { manage: boolean };
}
export interface VacancyToApprove {
  id: string;
  code: string;
  title: string;
  department: string | null;
  posts: number;
  level: string;
  raisedBy: string | null;
  since: string;
  overdue: boolean;
}

export const VACANCY_ORDER: VacancyStatus[] = [
  'draft',
  'pending',
  'approved',
  'rejected',
  'published',
  'closed',
  'cancelled',
];
export const VACANCY_STATUS: Record<VacancyStatus, string> = {
  draft: 'Draft',
  pending: 'Waiting for approval',
  approved: 'Approved',
  rejected: 'Sent back',
  published: 'Published',
  closed: 'Closed',
  cancelled: 'Cancelled',
};
export const VACANCY_TONE: Record<VacancyStatus, string> = {
  draft: 'neutral',
  pending: 'info',
  approved: 'success',
  rejected: 'warning',
  published: 'success',
  closed: 'neutral',
  cancelled: 'danger',
};
export const STAGE_KIND: Record<StageKind, string> = {
  shortlist: 'Shortlisting (on the papers)',
  test: 'Test (marks)',
  interview: 'Interview (marks)',
  final: 'Final round (selection)',
};
export const VACANCY_EVENT: Record<string, string> = {
  raised: 'Raised',
  submitted: 'Sent for approval',
  approved: 'Approved',
  sent_back: 'Sent back',
  approval_moved: 'Approval moved (set-up changed)',
  published: 'Published',
  rescheduled: 'Dates changed',
  closed: 'Closed',
  cancelled: 'Cancelled',
};
export const dmy = (d: string | null | undefined) =>
  d && /^\d{4}-\d{2}-\d{2}/.test(d) ? `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}` : '';
/** A moment as people in the school read it: 30-10-2026, 5:00 pm (India time). */
export const istText = (iso: string | null | undefined) =>
  iso
    ? new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      })
        .format(new Date(iso))
        .replace(/\//g, '-')
        .replace(/\s?(am|pm)$/i, (m) => ` ${m.trim().toLowerCase()}`)
    : '';
/** The value of a date-and-time box (YYYY-MM-DDTHH:MM) for a moment, in India time. */
export const istInput = (iso: string | null | undefined) =>
  iso ? new Date(new Date(iso).getTime() + 330 * 60_000).toISOString().slice(0, 16) : '';

// ---- part 3: candidates and screening -----------------------------------------------------------------

export type AppStatus =
  'submitted' | 'screening' | 'selected' | 'rejected' | 'on_hold' | 'withdrawn' | 'joined';
export const APP_ORDER: AppStatus[] = [
  'submitted',
  'screening',
  'on_hold',
  'selected',
  'rejected',
  'joined',
];
export const APP_STATUS: Record<AppStatus, string> = {
  submitted: 'New',
  screening: 'In screening',
  selected: 'Selected',
  rejected: 'Not taken forward',
  on_hold: 'On hold',
  withdrawn: 'Withdrawn',
  joined: 'Joined',
};
export const APP_TONE: Record<AppStatus, string> = {
  submitted: 'info',
  screening: 'info',
  selected: 'success',
  rejected: 'danger',
  on_hold: 'warning',
  withdrawn: 'neutral',
  joined: 'success',
};
export const RESULT_WORD = { pass: 'Passed', fail: 'Not through', hold: 'On hold' } as const;
export const APP_EVENT: Record<string, string> = {
  applied: 'Applied',
  added: 'Added by the office',
  scheduled: 'Scheduled',
  passed: 'Passed',
  on_hold: 'Put on hold',
  resumed: 'Taken up again',
  not_taken_forward: 'Not taken forward',
  selected: 'Selected',
  joined: 'Joined the staff',
};
export interface ApplicationRow {
  id: string;
  number: string;
  name: string;
  mobile: string | null;
  email: string | null;
  vacancyId: string;
  vacancy: string;
  vacancyCode: string;
  status: AppStatus;
  stageId: string | null;
  stage: string | null;
  source: 'online' | 'office';
  match: boolean;
  submittedAt: string;
}
export interface ApplicationStage {
  id: string;
  name: string;
  kind: StageKind;
  maxMarks: number | null;
  current: boolean;
  scheduledAt: string | null;
  venue: string | null;
  panel: string | null;
  marks: number | null;
  result: 'pass' | 'fail' | 'hold' | null;
  remarks: string | null;
  recordedBy: string | null;
  recordedAt: string | null;
}
export interface ApplicationView {
  id: string;
  number: string;
  name: string;
  vacancy: { id: string; title: string; code: string };
  status: AppStatus;
  stageId: string | null;
  source: 'online' | 'office';
  submittedAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
  employeeMatch: Array<{ id: string; code: string; name: string }>;
  sections: Array<{
    title: string;
    fields: Array<{ key: string; label: string; type: string; value: string }>;
  }>;
  rows: Array<{
    kind: string;
    title: string;
    columns: Array<{ key: string; label: string }>;
    rows: Array<Record<string, string | null>>;
  }>;
  activities: string[];
  documents: Array<{
    id: string;
    kind: string;
    label: string;
    fileId: string;
    contentType: string;
  }>;
  stages: ApplicationStage[];
  events: Array<{ at: string; what: string; note: string | null; by_name: string | null }>;
  /** the employee the candidate became (part 4) */
  employee: { id: string; code: string; name: string } | null;
  joinedAt: string | null;
  can: { record: boolean; reject: boolean; resume: boolean; sensitive: boolean; join: boolean };
}
/** What moving a selected candidate to the employee master will make (part 4). */
export interface JoinPreview {
  status: AppStatus;
  employeeId: string | null;
  nextCode: string;
  defaults: {
    department: string | null;
    designation: string | null;
    employeeType: string | null;
    post: string;
  };
  lists: {
    departments: string[];
    designations: string[];
    employeeTypes: string[];
    natures: string[];
  };
  copies: { fields: string[]; education: number; experience: number; training: number };
  stays: string[];
  documents: Array<{
    id: string;
    kind: string;
    label: string;
    fileId: string;
    suggestedTypeId: string | null;
  }>;
  documentTypes: Array<{ id: string; name: string }>;
  matches: Array<{ id: string; code: string; name: string; why: string[] }>;
}
export interface VacancyPipeline {
  posts: number;
  total: number;
  stages: Array<{ id: string; name: string; open: number }>;
  selected: number;
  rejected: number;
  onHold: number;
}
export interface RecruitmentNotices {
  applied: boolean;
  scheduled: boolean;
  selected: boolean;
  rejected: boolean;
  sms: boolean;
  whatsapp: boolean;
  email: boolean;
}
