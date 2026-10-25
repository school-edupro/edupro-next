/** The enquiry desk of admissions (docs/design/39, part 8). */
/** A stage of a lead (docs/design/45, part 1). */
export interface EnquiryStage {
  id: string;
  code: string;
  name: string;
  kind: 'open' | 'started' | 'registered' | 'admitted' | 'lost';
  status: 'active' | 'inactive' | string;
  leads: number;
}
/** An assignment rule of the enquiry desk (docs/design/45, part 3). */
export interface EnquiryRule {
  id: string;
  name: string;
  classIds: string[];
  sourceIds: string[];
  autoAssign: boolean;
  pool: string[];
  firstContactHours: number | null;
  level2UserId: string | null;
  level2Role: string | null;
  level2Name: string | null;
  acknowledge: boolean;
  isDefault: boolean;
  status: string;
  leads: number;
}
export const LOST_REASONS = ['Fees', 'Distance', 'Another school', 'No seat', 'Other'];
export const SCORE_LABEL: Record<string, string> = { hot: 'Hot', warm: 'Warm', cold: 'Cold' };
export const SCORE_TONE: Record<string, 'danger' | 'warning' | 'info'> = {
  hot: 'danger',
  warm: 'warning',
  cold: 'info',
};
/** The enquiry list with what the board needs (docs/design/45, part 2). */
export interface EnquiryList {
  total: number;
  counts: Record<string, number>;
  data: EnquiryRow[];
  byStage?: Array<{ stageId: string; leads: number }>;
}

export interface EnquiryMeta {
  sources: Array<{ id: string; name: string; status: string; used: number }>;
  cycles: Array<{ id: string; name: string; status: string }>;
  classes: Array<{ id: string; name: string }>;
  counsellors: Array<{ id: string; name: string }>;
  /** the school's stages of a lead (docs/design/45) */
  stages?: EnquiryStage[];
  rules?: EnquiryRule[];
  roles?: Array<{ code: string; name: string }>;
  /** how website enquiries are taken (docs/design/43, part 3) */
  desk?: { autoAssign: boolean; counsellors: string[]; acknowledge: boolean; channels: string[] };
}
export interface EnquiryRow {
  id: string;
  parentName: string;
  childName: string | null;
  className: string | null;
  source: string | null;
  campaign: string | null;
  mobile: string | null;
  email: string | null;
  status: string;
  nextFollowUpOn: string | null;
  counsellor: string | null;
  createdAt: string;
  lastContactAt: string | null;
  fromWebsite: boolean;
  registrationNo: string | null;
  /** the lead's stage, score and first contact (docs/design/45) */
  stage?: { id: string; name: string; kind: EnquiryStage['kind'] } | null;
  score?: 'hot' | 'warm' | 'cold' | null;
  firstContactAt?: string | null;
}
export interface EnquiryDetail {
  id: string;
  /** the lead's stage and the school's stages (docs/design/45) */
  stageId?: string | null;
  score?: 'hot' | 'warm' | 'cold' | null;
  lostReason?: string | null;
  firstContactAt?: string | null;
  stages?: EnquiryStage[];
  /** ENQ-000123: the number the family was given */
  number?: string;
  cycleId: string | null;
  classId: string | null;
  sourceId: string | null;
  campaign: string | null;
  parentName: string;
  childName: string | null;
  childDob: string | null;
  mobile: string | null;
  email: string | null;
  locality: string | null;
  previousSchool: string | null;
  notes: string | null;
  status: string;
  counsellorUserId: string | null;
  nextFollowUpOn: string | null;
  invitedAt: string | null;
  fromWebsite: boolean;
  createdAt: string;
  createdBy: string | null;
  application: {
    id: string;
    number: string | null;
    status: string;
    candidate: string | null;
  } | null;
  convertedAt: string | null;
  followups: Array<{
    id: string;
    mode: string;
    outcome: string;
    nextOn: string | null;
    statusAfter: string | null;
    by: string | null;
    at: string;
  }>;
}
export const ENQUIRY_STATUS: Record<
  string,
  { label: string; tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger' }
> = {
  new: { label: 'New', tone: 'warning' },
  follow_up: { label: 'Following up', tone: 'info' },
  interested: { label: 'Interested', tone: 'info' },
  converted: { label: 'Registered', tone: 'success' },
  not_interested: { label: 'Not interested', tone: 'neutral' },
  closed: { label: 'Closed', tone: 'neutral' },
};
export const MODE_LABEL: Record<string, string> = {
  call: 'Call',
  visit: 'Visit',
  email: 'Email',
  sms: 'SMS',
  whatsapp: 'WhatsApp',
  note: 'Note',
  invite: 'Invitation',
  system: 'Update',
  reply: 'Reply to family',
};
