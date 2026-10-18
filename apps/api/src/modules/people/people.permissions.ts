export const PEOPLE = {
  studentView: 'people.student.view',
  studentCreate: 'people.student.create',
  studentEdit: 'people.student.edit',
  studentDelete: 'people.student.delete',
  guardianView: 'people.guardian.view',
  guardianEdit: 'people.guardian.edit',
  enrolmentManage: 'people.enrolment.manage',
  admissionNoChange: 'people.admission_no.change',
  rollNoManage: 'people.roll_no.manage',
  employeeView: 'people.employee.view',
  employeeCreate: 'people.employee.create',
  employeeEdit: 'people.employee.edit',
  employeeDelete: 'people.employee.delete',
  documentView: 'people.document.view',
  search: 'people.person.search',
  importRun: 'people.import.run',
  /** Move staff between campuses and to other schools of the group (0182). */
  staffTransfer: 'people.staff_transfer.manage',
  /** Full Aadhaar, PAN and bank account numbers (granted through the Sensitive data viewer role). */
  sensitiveView: 'people.sensitive.view',
  /** ACR set-up, starting, disclosing and closing (0184). */
  acrManage: 'people.acr.manage',
  /** Every employee's ACR and the progress board. */
  acrView: 'people.acr.view',
  /** What staff see and change on their own profile, and who approves (0186). */
  staffProfileManage: 'people.staff_profile.manage',
  staffChangeApprove: 'people.staff_change.approve',
  staffChangeOverride: 'people.staff_change.override',
} as const;
