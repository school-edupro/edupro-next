import { Badge } from '@edupro/ui';
import { LEAVE_STATUS, dmy, type LeaveRequest } from '@/lib/leave';

/** The leave's dates as chips (one, or the first and the last) and its day count, as the old screens. */
export function DateChips({ r }: { r: Pick<LeaveRequest, 'from' | 'to' | 'days'> }) {
  return (
    <span className="ep-datechips">
      <span className="ep-datechip">{dmy(r.from)}</span>
      {r.to !== r.from ? <span className="ep-datechip">{dmy(r.to)}</span> : null}
      <span className="ep-mr-col__desc">
        {r.days} day{r.days === 1 ? '' : 's'}
      </span>
    </span>
  );
}

/** No, or which half */
export const halfWords = (r: Pick<LeaveRequest, 'halfDay' | 'session'>) =>
  r.halfDay ? (r.session === 'first' ? 'First half' : 'Second half') : 'No';

/** dd-mm-yyyy hh:mm, India time */
export const when = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
        .format(new Date(iso))
        .replace(/\//g, '-')
        .replace(',', '')
    : '';

/** The status badge, who it waits with, and a cancellation waiting. */
export function LeaveStatusCell({
  r,
}: {
  r: Pick<LeaveRequest, 'status' | 'waitingWith' | 'cancelStatus'>;
}) {
  return (
    <>
      <Badge tone={LEAVE_STATUS[r.status].tone}>{LEAVE_STATUS[r.status].label}</Badge>
      {r.status === 'pending' && r.waitingWith ? (
        <span className="ep-mr-col__desc">with {r.waitingWith}</span>
      ) : null}
      {r.cancelStatus === 'pending' ? (
        <span className="ep-mr-col__desc">cancellation waiting</span>
      ) : null}
    </>
  );
}
