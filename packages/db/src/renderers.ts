/**
 * Document renderers (Sprint 4): exports that render one HTML template to PDF instead of tabulating a
 * dataset. The API validates the request and the worker renders under the requester's tenant context.
 */
export interface RendererDefinition {
  id: string;
  title: string;
  /** Permission the requester must hold. */
  permission: string;
  /** Printed page size passed to the PDF engine. */
  page: { width: string; height: string };
  /** Parameter names that must be present (numeric ids). */
  requiredParams: string[];
}

export const RENDERERS: Record<string, RendererDefinition> = {
  student_id_card: {
    id: 'student_id_card',
    title: 'Student ID card',
    permission: 'people.student.view',
    page: { width: '85.6mm', height: '54mm' },
    requiredParams: ['studentId'],
  },
  employee_id_card: {
    id: 'employee_id_card',
    title: 'Employee ID card',
    permission: 'people.employee.view',
    page: { width: '85.6mm', height: '54mm' },
    requiredParams: ['employeeId'],
  },
  /** Sprint 7: a document template (transfer certificate, bonafide, letter) filled for one entity. */
  document: {
    id: 'document',
    title: 'Document from template',
    permission: 'platform.template.view',
    page: { width: '210mm', height: '297mm' },
    requiredParams: ['templateId', 'entity', 'entityId'],
  },
  /** Sprint 16: an AI report (weekly narrative or the Monday brief) rendered from ai_reports. */
  ai_report: {
    id: 'ai_report',
    title: 'AI report',
    permission: 'insights.report.view',
    page: { width: '210mm', height: '297mm' },
    requiredParams: ['reportId'],
  },
};

// Sprint 17: report cards — one pupil, or a whole section in one PDF (page break per pupil)
RENDERERS.report_card = {
  id: 'report_card',
  title: 'Report card',
  permission: 'exams.report_card.view',
  page: { width: '210mm', height: '297mm' },
  requiredParams: ['releaseId', 'studentId'],
};
RENDERERS.report_card_batch = {
  id: 'report_card_batch',
  title: 'Report cards of a section',
  permission: 'exams.report_card.manage',
  page: { width: '210mm', height: '297mm' },
  requiredParams: ['releaseId', 'classSectionId'],
};

// Sprint 19: certificates — one issued certificate, or an issue batch (the export groups them)
RENDERERS.certificate = {
  id: 'certificate',
  title: 'Certificate',
  permission: 'engagement.certificate.issue',
  page: { width: '297mm', height: '210mm' },
  requiredParams: ['certificateId'],
};
RENDERERS.certificate_batch = {
  id: 'certificate_batch',
  title: 'Certificates of a batch',
  permission: 'engagement.certificate.issue',
  page: { width: '297mm', height: '210mm' },
  requiredParams: ['templateId'],
};

export const RENDERER_IDS = Object.keys(RENDERERS) as [string, ...string[]];

export function rendererOrNull(id: string): RendererDefinition | null {
  return Object.prototype.hasOwnProperty.call(RENDERERS, id) ? RENDERERS[id]! : null;
}
