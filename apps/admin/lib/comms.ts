/** Communication v2 shapes shared by the admin screens and server actions. */
export type Channel = 'sms' | 'whatsapp' | 'email';
export type SendTo = 'primary' | 'parents' | 'student' | 'student_parents';
export type GroupKind = 'student' | 'employee' | 'student_teacher' | 'external' | 'mixed';
export type MemberType = 'student' | 'employee' | 'guardian' | 'contact' | 'user';
export type Result<T> = { ok: true; data: T } | { ok: false; error: string; errors?: string[] };

export interface Rule {
  people?: 'students' | 'employees' | 'both';
  classIds?: string[];
  sectionIds?: string[];
  houses?: string[];
  categories?: string[];
  genders?: string[];
  streams?: string[];
  religions?: string[];
  routeIds?: string[];
  departments?: string[];
  designations?: string[];
  employeeTypes?: string[];
}

export interface RuleOptions {
  houses: string[];
  categories: string[];
  genders: string[];
  streams: string[];
  religions: string[];
  departments: string[];
  designations: string[];
  employeeTypes: string[];
  routes: Array<{ id: string; label: string }>;
}

export interface CommsTemplate {
  id: string;
  code: string;
  channel: Channel | 'push';
  name: string;
  subject: string | null;
  body: string;
  format: 'text' | 'html';
  category: 'service' | 'general';
  variables: string[];
  dltTemplateId: string | null;
  dltEntityId: string | null;
  senderId: string | null;
  waTemplateName: string | null;
  waLanguage: string | null;
  waParams: string[];
  waHeader: 'none' | 'text' | 'image' | 'document';
  providerTemplateId: string | null;
  status: 'active' | 'inactive';
  updatedAt: string;
}

export interface TemplateVariable {
  key: string;
  label: string;
  for: string;
}

export interface TemplatePreview {
  subject: string | null;
  body: string;
  html: string | null;
  text: string;
  sms: { units: number; unicode: boolean; length: number } | null;
  unknownVariables: string[];
}

export interface Group {
  id: string;
  code: string;
  name: string;
  description: string | null;
  kind: GroupKind;
  mode: 'static' | 'rule';
  rule: Rule | null;
  members: number;
  createdAt: string;
  updatedAt: string;
}

export interface Member {
  type: MemberType;
  id: string;
  name: string;
  ref: string | null;
  detail: string | null;
  mobile: string | null;
  email: string | null;
}

export interface UploadRow {
  name: string;
  mobile?: string | null;
  email?: string | null;
  vars?: Record<string, string>;
}

export interface SheetResult {
  rows: number;
  targets: Array<{ type: string; id: string }>;
  upload: UploadRow[];
  variables: string[];
  problems: Array<{ row: number; value: string; reason: string }>;
}

export interface ComposePayload {
  title: string;
  category: 'service' | 'general';
  channels: Array<{ channel: Channel; templateId?: string; custom?: boolean }>;
  body: string;
  bodyFormat: 'text' | 'html';
  subject?: string;
  audience: string;
  targets: Array<{ type: string; id: string }>;
  rule?: Rule;
  upload?: UploadRow[];
  sendTo: SendTo;
  attachments: string[];
  variables?: Record<string, string>;
  scheduledAt?: string;
}

export interface ComposePreview {
  total: number;
  people: number;
  skipped: number;
  skippedReasons: Record<string, number>;
  byChannel: Record<string, { send: number; skipped: number; units: number; cost: number }>;
  needsApproval: boolean;
  /** template variables nobody fills in: compose asks for one value for everyone */
  askValues: string[];
  switchedOff: string[];
  quietHours: string | null;
  sample: Array<{ channel: string; name: string; address: string; student: string | null }>;
  rendered: Array<{ channel: string; subject: string | null; text: string; units: number }>;
}

export interface Attachment {
  id: string;
  name: string;
  size: number;
  contentType: string;
}

export interface CommsPolicy {
  approvalThreshold: number;
  approvalExemptRoles: string[];
  quietFrom: string | null;
  quietTo: string | null;
  attachmentMaxMb: number;
  rates: Record<Channel, number>;
  lowBalance: Partial<Record<Channel, number>>;
}

export interface ProviderView {
  channel: Channel;
  provider: string;
  config: Record<string, string | number | boolean>;
  secrets: Record<string, boolean>;
  active: boolean;
  updatedAt: string;
}

export interface CommsSettings {
  policy: CommsPolicy;
  providers: ProviderView[];
  roles: Array<{ code: string; name: string }>;
  switchedOff?: string[];
  webhooks: { msg91: string; meta: string };
}

export interface Balance {
  channel: Channel;
  credited: number;
  used: number;
  balance: number;
  tracked: boolean;
  low: boolean;
}

export interface ChannelKpi {
  channel: Channel;
  messages: number;
  units: number;
  delivered: number;
  read: number;
  failed: number;
  pending: number;
  cost: number;
}

export interface Dashboard {
  month: string;
  previousMonth: string;
  channels: ChannelKpi[];
  previous: ChannelKpi[];
  daily: Array<{ day: string; channel: Channel; messages: number }>;
  balances: Balance[];
  providers: Array<{ channel: Channel; provider: string; active: boolean }>;
  requests: Array<{
    id: string;
    title: string;
    status: string;
    channels: string[];
    recipients: number;
    delivered: number;
    failed: number;
    requestedAt: string;
    by: string | null;
  }>;
  senders: Array<{ name: string; messages: number; cost: number }>;
  failures: Array<{ channel: string; reason: string; messages: number }>;
}

export const CHANNEL_LABEL: Record<Channel, string> = {
  sms: 'SMS',
  whatsapp: 'WhatsApp',
  email: 'Email',
};

export const KIND_LABEL: Record<GroupKind, string> = {
  student: 'Students',
  employee: 'Employees',
  student_teacher: 'Students + teachers',
  external: 'Outside contacts',
  mixed: 'Mixed (older group)',
};

export const SEND_TO_LABEL: Record<SendTo, string> = {
  primary: 'Family’s primary contact',
  parents: 'Both parents',
  student: 'The student',
  student_parents: 'Student and parents',
};

export const SKIP_LABEL: Record<string, string> = {
  no_address: 'no mobile / email on file',
  consent_withdrawn: 'opted out',
  duplicate: 'same number already included',
};

/** Rough SMS parts for the compose meter (the server counts exactly). */
export function smsParts(text: string): { units: number; unicode: boolean; length: number } {
  const unicode = /[^\u0000-\u007f£¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ¡ÄÖÑÜ§¿äöñüà€]/.test(text);
  const length = [...text].length;
  const [single, multi] = unicode ? [70, 67] : [160, 153];
  return { units: length <= single ? 1 : Math.ceil(length / multi), unicode, length };
}
