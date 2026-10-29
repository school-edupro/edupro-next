import { Badge, Button } from '@edupro/ui';
import { markEntryStatus } from '@/lib/exam-entry-actions';

export interface EntryStatus {
  status: 'open' | 'submitted' | 'verified';
  submittedBy: string | null;
  submittedAt: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  remark: string | null;
}

const TONE = { open: 'neutral', submitted: 'warning', verified: 'success' } as const;
const LABEL = { open: 'Open', submitted: 'Submitted', verified: 'Verified' } as const;
const when = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
      }).format(new Date(iso))
    : '';

/** The status of one section's subject (docs/design/65, part 2). */
export function EntryStatusBadge({ s }: { s: EntryStatus }) {
  return (
    <span>
      <Badge tone={TONE[s.status]}>{LABEL[s.status]}</Badge>
      {s.status === 'submitted' && s.submittedBy ? (
        <span className="ep-kicker">
          {' '}
          by {s.submittedBy} · {when(s.submittedAt)}
        </span>
      ) : null}
      {s.status === 'verified' && s.verifiedBy ? (
        <span className="ep-kicker">
          {' '}
          by {s.verifiedBy} · {when(s.verifiedAt)}
        </span>
      ) : null}
      {s.remark ? (
        <span className="ep-field__help" style={{ display: 'block', margin: 0 }}>
          {s.remark}
        </span>
      ) : null}
    </span>
  );
}

/**
 * Submit (the teacher, every student entered), Verify or Send back (the verifier) and Reopen (the
 * unlock right, with a reason) for one section's subject.
 */
export function EntryStatusActions({
  examId,
  classSectionId,
  subjectId,
  status,
  back,
  missing,
  canSubmit,
  canVerify,
  canReopen,
}: {
  examId: string;
  classSectionId: string;
  subjectId: string;
  status: EntryStatus['status'];
  back: string;
  /** students who take the subject still without a mark or code */
  missing: number;
  canSubmit: boolean;
  canVerify: boolean;
  canReopen: boolean;
}) {
  const hidden = (action: string) => (
    <>
      <input type="hidden" name="examId" value={examId} />
      <input type="hidden" name="classSectionId" value={classSectionId} />
      <input type="hidden" name="subjectId" value={subjectId} />
      <input type="hidden" name="back" value={back} />
      <input type="hidden" name="action" value={action} />
    </>
  );
  return (
    <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
      {status === 'open' && canSubmit ? (
        missing > 0 ? (
          <span className="ep-field__help" style={{ margin: 0 }}>
            {missing} without marks: enter them (or a code) to submit
          </span>
        ) : (
          <form action={markEntryStatus}>
            {hidden('submit')}
            <Button type="submit" size="sm">
              Submit for verification
            </Button>
          </form>
        )
      ) : null}
      {status === 'submitted' && canVerify ? (
        <>
          <form action={markEntryStatus}>
            {hidden('verify')}
            <Button type="submit" size="sm">
              Verify
            </Button>
          </form>
          <form action={markEntryStatus} style={{ display: 'inline-flex', gap: 'var(--sp-1)' }}>
            {hidden('send-back')}
            <input
              className="ep-input"
              name="note"
              aria-label="What to correct"
              placeholder="What to correct"
              required
              minLength={3}
              maxLength={500}
              style={{ width: 160 }}
            />
            <Button type="submit" size="sm" variant="ghost">
              Send back
            </Button>
          </form>
        </>
      ) : null}
      {status !== 'open' && canReopen ? (
        <form action={markEntryStatus} style={{ display: 'inline-flex', gap: 'var(--sp-1)' }}>
          {hidden('reopen')}
          <input
            className="ep-input"
            name="note"
            aria-label="Why reopen"
            placeholder="Why reopen"
            required
            minLength={3}
            maxLength={500}
            style={{ width: 140 }}
          />
          <Button type="submit" size="sm" variant="ghost">
            Reopen
          </Button>
        </form>
      ) : null}
    </span>
  );
}
