import type { ReactNode } from 'react';
import { DialogButton } from '@/components/leave/DialogButton';
import { withdrawDatedRow } from '@/lib/payroll-actions';

/** Which runs read an approved dated row (the API's `usage`). */
export interface RowUsage {
  closed: boolean;
  closedMonths: string[];
  open: Array<{ id: string; month: string; stage: string }>;
  correctFrom: string | null;
}

const words = (ym: string) =>
  new Date(`${ym.slice(0, 7)}-01T00:00:00Z`).toLocaleString('en-GB', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

/**
 * Fixing an approved dated row (docs/design/86, "Withdraw and correct"): while no approved, locked or paid run has
 * read it, a checker withdraws it with a reason (it stays in the history; the row before it is in force again; a run
 * only processed goes back to draft). Once read, it is corrected by a new row from the first month after — `correct`
 * is that form (or a pointer to it), shown to a maker or checker.
 */
export function RowFix({
  kind,
  id,
  usage,
  back,
  canApprove,
  canManage,
  what,
  correct,
}: {
  kind: string;
  id: string;
  usage: RowUsage | undefined;
  back: string;
  canApprove: boolean;
  canManage: boolean;
  /** the row in a few words, for the dialog's title */
  what: string;
  correct?: ReactNode;
}) {
  if (!usage) return null;
  if (!usage.closed)
    return canApprove ? (
      <DialogButton
        id={`fix-w-${kind}-${id}`}
        label="Withdraw"
        title={`Withdraw ${what}`}
        className="ep-btn ep-btn--ghost ep-btn--sm"
      >
        <form action={withdrawDatedRow.bind(null, kind, id)} className="ep-form-section__body">
          <input type="hidden" name="back" value={back} />
          <p className="ep-field__help">
            For a row approved by mistake. It stays in the history marked Withdrawn, no pay run
            reads it, and the row it replaced is in force again. Recorded in the payroll audit
            trail.
          </p>
          {usage.open.length ? (
            <p className="ep-alert ep-alert--warning" role="status">
              The run of {usage.open.map((r) => words(r.month)).join(', ')} read it and is not
              approved yet: it goes back to draft — process it again.
            </p>
          ) : null}
          <label className="ep-field" htmlFor={`fix-w-${kind}-${id}-why`}>
            <span className="ep-field__label">Why it is withdrawn</span>
            <textarea
              id={`fix-w-${kind}-${id}-why`}
              name="reason"
              className="ep-input"
              rows={2}
              required
              minLength={10}
              maxLength={300}
            />
          </label>
          <p>
            <button type="submit" className="ep-btn ep-btn--primary">
              Withdraw it
            </button>
          </p>
        </form>
      </DialogButton>
    ) : null;
  return canManage ? (
    <DialogButton
      id={`fix-c-${kind}-${id}`}
      label="Correct"
      title={`Correct ${what}`}
      className="ep-btn ep-btn--ghost ep-btn--sm"
    >
      <div className="ep-form-section__body">
        <p className="ep-field__help">
          An approved pay run read it ({usage.closedMonths.map(words).join(', ')}): those months
          keep it and it cannot be withdrawn. Make a new row from{' '}
          <strong>{usage.correctFrom ? words(usage.correctFrom) : 'the next open month'}</strong>; a
          checker approves it and it replaces this one from that date. To pay a difference for the
          months already approved, use Pay changes and leavers → a revision with arrears.
        </p>
        {correct}
      </div>
    </DialogButton>
  ) : null;
}
