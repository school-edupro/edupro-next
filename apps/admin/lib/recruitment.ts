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
  opensOn: string | null;
  closesOn: string | null;
  waitingWith: string | null;
  decisionNote: string | null;
  raisedBy: string | null;
  submittedAt: string | null;
  decidedAt: string | null;
  publishedAt: string | null;
  closedAt: string | null;
  createdAt: string;
}
export interface VacancyView extends Vacancy {
  events: Array<{ at: string; what: string; note: string | null; by_name: string | null }>;
  can: { edit: boolean; submit: boolean; publish: boolean; close: boolean; cancel: boolean };
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
  published: 'Published',
  closed: 'Closed',
  cancelled: 'Cancelled',
};
export const dmy = (d: string | null | undefined) =>
  d && /^\d{4}-\d{2}-\d{2}/.test(d) ? `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}` : '';
