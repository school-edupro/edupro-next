export const PEOPLE = {
  studentView: 'people.student.view',
  studentCreate: 'people.student.create',
  studentEdit: 'people.student.edit',
  studentDelete: 'people.student.delete',
  guardianView: 'people.guardian.view',
  guardianEdit: 'people.guardian.edit',
  enrolmentManage: 'people.enrolment.manage',
  employeeView: 'people.employee.view',
  employeeCreate: 'people.employee.create',
  employeeEdit: 'people.employee.edit',
  employeeDelete: 'people.employee.delete',
  documentView: 'people.document.view',
  search: 'people.person.search',
  importRun: 'people.import.run',
  /** Full Aadhaar, PAN and bank account numbers (granted through the Sensitive data viewer role). */
  sensitiveView: 'people.sensitive.view',
} as const;
