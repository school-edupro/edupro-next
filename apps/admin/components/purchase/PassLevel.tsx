import { ConfirmAction } from '@/components/ConfirmAction';
import { passPurchaseStep } from '@/lib/purchase-actions';
import type { IndentStep } from '@/lib/purchase';

/**
 * The admin passes the level a purchase document waits at for its approvers (an approver away), with
 * the reason; the document moves on and its history says it was passed and for whom (docs/design/83).
 */
export function PassLevel({ step, back }: { step: IndentStep | undefined; back: string }) {
  if (!step || step.status !== 'pending') return null;
  const who = step.assignees.map((a) => a.name).join(', ') || 'nobody';
  return (
    <div style={{ marginTop: 'var(--sp-3)' }}>
      <ConfirmAction
        action={passPurchaseStep}
        fields={{ stepId: step.id, back }}
        label={`Pass level ${String(step.level)} for them`}
        title={`Pass “${step.name}” for ${who}?`}
        confirmLabel="Pass the level"
        variant="ghost"
        reason={{ label: 'Why it is passed (shown in the history)' }}
      >
        Use it when the approvers cannot act (away, on leave). The document moves to the next level
        as if they had approved; it is recorded as passed by you. You cannot pass what you raised.
      </ConfirmAction>
    </div>
  );
}
