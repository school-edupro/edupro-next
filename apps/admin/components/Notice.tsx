import { Alert } from '@edupro/ui';

const MESSAGES: Record<string, string> = {
  'permission-denied': 'You do not have permission for that action.',
  'mfa-required': 'This action needs a recent multi-factor sign-in.',
  'sod-conflict':
    'Refused: the user would hold two permissions that must stay separate (segregation of duties).',
  'validation-failed': 'Some values were not accepted.',
  conflict: 'That already exists.',
  'role.immutable':
    'System role templates cannot be edited. Copy the template into a school role instead.',
  'role.in_use': 'The role still has active assignments; revoke them first.',
  'user.not_member': 'The user is not an active member of this school.',
  'delegation.role_not_held': 'The giver does not currently hold that role.',
  'membership.self': 'You cannot deactivate your own membership.',
  'year.overlap': 'The dates overlap an existing year.',
  'year.not_planned': 'Only a planned year can be activated.',
  'year.active': 'Activate another year before closing this one.',
  'year.stage_locked': 'That stage of the year is locked.',
  'not-found': 'Not found.',
  forbidden: 'You cannot do that on this ticket.',
  'helpdesk.file_invalid': 'Attach your own PDF or image files of up to 5 MB.',
  'helpdesk.closed': 'This ticket is closed; reopen it to write again.',
  'helpdesk.reopen_window': 'This ticket can no longer be reopened; raise a new one.',
  'helpdesk.not_answered': 'Rate the ticket once it is answered.',
  'comms.template.inactive': 'The template is inactive.',
  'comms.template.not_found': 'No active template with that code and channel.',
  'comms.recipient.address_missing': 'The recipient has no mobile number or email address on file.',
  'comms.message.not_queued': 'Only queued messages can be cancelled.',
  'job.not_failed': 'Only failed jobs can be retried.',
  'people.student.enrolled': 'End the active enrolment before removing the student.',
  'enrolment.section_year_mismatch': 'That section belongs to another academic year.',
  'enrolment.student_not_active': 'The student is not active.',
  'file.not_ready': 'Upload the file before attaching it.',
  'scope-denied': 'That section is outside your assigned scope.',
  'year.not_selected': 'Select an academic year in the header first.',
  'academics.subject.in_use':
    'The subject is mapped to classes in an open year; remove the mapping first.',
  'assignment.class_teacher_exists':
    'The section already has a class teacher. End that assignment first.',
  'assignment.section_year_mismatch': 'That section belongs to another academic year.',
  'assignment.already_ended': 'The assignment has already ended.',
  'timetable.teacher_conflict': 'The teacher is already taking another section in this period.',
  'timetable.not_teaching_period': 'Subjects and teachers go in teaching periods only.',
  'timetable.period_in_use': 'The period still has timetable slots.',
  'import.has_rejects': 'Fix the rejected rows and upload the file again before committing.',
  'import.not_validated': 'Only a validated import can be committed.',
  'file.upload_failed': 'The file could not be uploaded.',
  'file.too_large': 'The file is too large for its classification.',
  'holiday.overlap': 'The dates overlap an existing holiday.',
  'tc.already_issued': 'The student already holds an issued transfer certificate.',
  'tc.already_cancelled': 'The certificate is already cancelled.',
  'template.missing':
    'No active template of that kind. Install the defaults under System → Templates.',
  'template.inactive': 'The template is inactive.',
  'withdrawal.open_exists': 'The student already has an open withdrawal.',
  'withdrawal.student_inactive': 'The student is not active.',
  'withdrawal.not_open': 'The withdrawal is already completed or cancelled.',
  'withdrawal.clearance_pending': 'Every department must clear the student before completion.',
  'promotion.same_year': 'The target year must differ from the source year.',
  'promotion.section_not_in_year': 'A chosen section does not belong to the target year.',
  'promotion.not_enrolled': 'A student is not enrolled in the source year.',
  'admission.not_submitted': 'The application has not been submitted yet.',
  'fees.periods_in_use': 'Demands exist for this year; the periods cannot be regenerated.',
  'fees.student_inactive': 'Withdrawn or inactive students get no demand.',
  'fees.not_enrolled': 'The student has no active enrolment in this year.',
  'fees.no_periods': 'Generate the fee periods of the year first.',
  'fees.no_opening_balance_head': 'Create a fee head of kind opening balance first.',
};

/** Reads ?ok=1 or ?error=<type>&detail=... written by server actions and renders the matching alert. */
export function Notice({ params }: { params: { ok?: string; error?: string; detail?: string } }) {
  if (params.ok) {
    return (
      <div style={{ marginBottom: 'var(--sp-4)' }}>
        <Alert tone="success">Saved.</Alert>
      </div>
    );
  }
  if (params.error) {
    const text = MESSAGES[params.error] ?? `The request failed (${params.error}).`;
    return (
      <div style={{ marginBottom: 'var(--sp-4)' }}>
        <Alert tone="danger" title={text}>
          {params.detail ? <span>{params.detail}</span> : null}
        </Alert>
      </div>
    );
  }
  return null;
}
