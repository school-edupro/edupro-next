/** Sprint 6 permission codes (declared here, granted to templates in migration 0016). */
export const ACADEMICS = {
  subjectView: 'academics.subject.view',
  subjectManage: 'academics.subject.manage',
  assignmentView: 'academics.teacher_assignment.view',
  assignmentManage: 'academics.teacher_assignment.manage',
  timetableView: 'academics.timetable.view',
  timetableManage: 'academics.timetable.manage',
} as const;
