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
};

export const RENDERER_IDS = Object.keys(RENDERERS) as [string, ...string[]];

export function rendererOrNull(id: string): RendererDefinition | null {
  return Object.prototype.hasOwnProperty.call(RENDERERS, id) ? RENDERERS[id]! : null;
}
