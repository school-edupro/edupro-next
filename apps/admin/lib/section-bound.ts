/**
 * A Class Teacher / Subject Teacher role the system gave — with the staff login or from Teacher
 * assignments — reaches only the sections ticked on it: none = no section (as the API's scopesFor reads
 * it). A role granted by hand in Access keeps "no scope = every section".
 */
export const sectionBound = (a: { roleCode: string; reason: string | null }) =>
  ['class_teacher', 'subject_teacher'].includes(a.roleCode) &&
  ['employee onboarded', 'teacher assignment sync'].includes(a.reason ?? '');
