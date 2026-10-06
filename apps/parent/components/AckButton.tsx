import { Badge } from '@edupro/ui';
import { acknowledge } from '@/app/(app)/ack-actions';

/**
 * The acknowledgement of an item for a child: a button until it is acknowledged, then a mark. Shown
 * only on items where the school asked for it.
 */
export function AckButton({
  type,
  id,
  studentId,
  done,
  back,
  label,
  doneLabel,
}: {
  type: 'daily_work' | 'document' | 'notice';
  id: string;
  studentId: string;
  done: boolean;
  back: string;
  label: string;
  doneLabel: string;
}) {
  if (done) return <Badge tone="success">{doneLabel}</Badge>;
  return (
    <form action={acknowledge} style={{ display: 'inline' }}>
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="studentId" value={studentId} />
      <input type="hidden" name="back" value={back} />
      <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm">
        {label}
      </button>
    </form>
  );
}
