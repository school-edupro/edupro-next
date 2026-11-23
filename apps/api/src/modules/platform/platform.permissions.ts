export const PLATFORM = {
  schoolView: 'platform.school.view',
  schoolManage: 'platform.school.manage',
  campusManage: 'platform.campus.manage',
  yearView: 'platform.year.view',
  yearManage: 'platform.year.manage',
  yearLock: 'platform.year.lock',
  yearReopen: 'platform.year.reopen',
  settingsView: 'platform.settings.view',
  settingsEdit: 'platform.settings.edit',
  filesUpload: 'platform.files.upload',
  filesView: 'platform.files.view',
  auditView: 'platform.audit.view',
  auditExport: 'platform.audit.export',
  jobsView: 'platform.jobs.view',
  jobsManage: 'platform.jobs.manage',
  /** docs/design/101: the AI model (LLM) for all schools — in no role; only its holders pass it on */
  aiModelManage: 'platform.ai_model.manage',
} as const;
