import { WorkflowService } from './workflow.service';

describe('WorkflowService.stepUp', () => {
  it('asks a recent second factor for the fee requests riding the approval levels', () => {
    for (const t of [
      'fee_waiver',
      'fee_waiver_undo',
      'fee_change_request',
      'fee_profile_change',
      'fee_opening',
      'fee_refund',
      'misc_fee_request',
    ])
      expect({ t, stepUp: WorkflowService.stepUp(t) }).toEqual({ t, stepUp: true });
  });

  it('leaves the other approvals as they are', () => {
    for (const t of [
      'staff_leave',
      'purchase_indent',
      'vacancy',
      'lesson_plan',
      'message_request',
      'admission_refund',
      'employee_exit',
    ])
      expect({ t, stepUp: WorkflowService.stepUp(t) }).toEqual({ t, stepUp: false });
  });
});
