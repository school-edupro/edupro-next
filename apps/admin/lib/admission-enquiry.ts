/** The enquiry desk of admissions (docs/design/39, part 8). */
export interface EnquiryMeta {
  sources: Array<{ id: string; name: string; status: string; used: number }>;
  cycles: Array<{ id: string; name: string; status: string }>;
  classes: Array<{ id: string; name: string }>;
  counsellors: Array<{ id: string; name: string }>;
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
}
export interface EnquiryDetail {
  id: string;
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
