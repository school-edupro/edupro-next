import { Badge, Button } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
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
export async function EntryStatusBadge({ s }: { s: EntryStatus }) {
  const t = await getTranslations('examHub.esa');
  return (
    <span>
      <Badge tone={TONE[s.status]}>{t(s.status)}</Badge>
      {s.status === 'submitted' && s.submittedBy ? (
        <span className="ep-kicker">
          {' '}
          {t('by', { who: s.submittedBy, when: when(s.submittedAt) })}
        </span>
      ) : null}
      {s.status === 'verified' && s.verifiedBy ? (
        <span className="ep-kicker">
          {' '}
          {t('by', { who: s.verifiedBy, when: when(s.verifiedAt) })}
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
export async function EntryStatusActions({
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
  const t = await getTranslations('examHub.esa');
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
            {t('withoutMarks', { n: missing })}
          </span>
        ) : (
          <form action={markEntryStatus}>
            {hidden('submit')}
            <Button type="submit" size="sm">
              {t('submit')}
            </Button>
          </form>
        )
      ) : null}
      {status === 'submitted' && canVerify ? (
        <>
          <form action={markEntryStatus}>
            {hidden('verify')}
            <Button type="submit" size="sm">
              {t('verify')}
            </Button>
          </form>
          <form action={markEntryStatus} style={{ display: 'inline-flex', gap: 'var(--sp-1)' }}>
            {hidden('send-back')}
            <input
              className="ep-input"
              name="note"
              aria-label={t('whatToCorrect')}
              placeholder={t('whatToCorrect')}
              required
              minLength={3}
              maxLength={500}
              style={{ width: '10rem' }}
            />
            <Button type="submit" size="sm" variant="ghost">
              {t('sendBack')}
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
            aria-label={t('whyReopen')}
            placeholder={t('whyReopen')}
            required
            minLength={3}
            maxLength={500}
            style={{ width: '9rem' }}
          />
          <Button type="submit" size="sm" variant="ghost">
            {t('reopen')}
          </Button>
        </form>
      ) : null}
    </span>
  );
}
