import { DomainError } from '../../common/errors/domain-error';

export const PEOPLE = {
  studentView: 'people.student.view',
  studentCreate: 'people.student.create',
  studentEdit: 'people.student.edit',
  studentDelete: 'people.student.delete',
  /** Ask for a correction of the name, date of birth, gender or parents' names (0232). */
  studentCorrect: 'people.student.correct',
  /** Ask to correct a student's class: enrolment moved, fees made again (0234). */
  classCorrect: 'people.class.correct',
  /** Ask to merge a duplicate student record (0235). */
  studentMerge: 'people.student.merge',
  /** Ask to cancel an admission with the fee settled (0236). */
  admissionCancel: 'people.admission.cancel',
  /** Employee exits (0237): see them; create on an employee's behalf and set up. */
  exitView: 'people.exit.view',
  exitManage: 'people.exit.manage',
  /** Prepare the full and final statement and mark it paid (0239). */
  exitFnf: 'people.exit.fnf',
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
  /** Recruitment (0197): vacancies, candidates and the screening. */
  recruitmentView: 'people.recruitment.view',
  /** Raise a vacancy and send it for approval (the office, an HOD). */
  recruitmentRaise: 'people.recruitment.raise',
  /** Set up, publish and close vacancies, screen and select candidates. */
  recruitmentManage: 'people.recruitment.manage',
} as const;

/** A direct edit of a detail that changes only by an approved correction (docs/design/37, part 1). */
export const correctionRequired = () =>
  new DomainError(
    'people.correction_required',
    'The name, date of birth, gender and parents’ names change through Correct details, with approval',
    { status: 409 },
  );
