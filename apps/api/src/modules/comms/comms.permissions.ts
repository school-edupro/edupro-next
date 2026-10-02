export const COMMS = {
  templateView: 'comms.template.view',
  templateManage: 'comms.template.manage',
  messageSend: 'comms.message.send',
  messageView: 'comms.message.view',
} as const;

/** Sprint 10: message requests with approval, groups, consent, delivery receipts. */
export const COMMS_S10 = {
  requestView: 'comms.request.view',
  requestCreate: 'comms.request.create',
  groupView: 'comms.group.view',
  groupManage: 'comms.group.manage',
  consentView: 'comms.consent.view',
  consentManage: 'comms.consent.manage',
  consentSelf: 'comms.consent.self',
} as const;

/** Communication v2 (2026-10-02): settings and providers, reports, credits. */
export const COMMS_V2 = {
  settingsManage: 'comms.settings.manage',
  reportView: 'comms.report.view',
  creditManage: 'comms.credit.manage',
} as const;
