import { FileLinks } from '@/components/FileLinks';
import { DialogButton } from '@/components/leave/DialogButton';
import { DateChips, LeaveStatusCell, halfWords, when } from '@/components/leave/LeaveCells';
import { ListBar, Pages } from '@/components/leave/ListBar';
import type { MyLeave } from '@/lib/leave';
import { askCancelLeave, withdrawLeave } from '@/lib/leave-actions';

/**
 * My Leave (My leave → My Leave), as the old screen: From and To, then my leave touching them — Leave Id,
 * type, the dates, the attachment, half day, reason, applied, who acted and when, what I may do, status —
 * a page at a time, all of it as Excel or PDF.
 */
export function MyLeaveTab({
  d,
  from,
  to,
  size,
  link,
}: {
  d: MyLeave;
  from: string;
  to: string;
  size: string;
  /** this tab at a page and size, filters kept */
  link: (page: number, size?: string) => string;
}) {
  const back = link(d.page);
  const file = (f: 'xlsx' | 'pdf') =>
    `/api/leave/my-leave-file?${new URLSearchParams({ format: f, from, to }).toString()}`;
  return (
    <section aria-label="My leave">
      <form method="get" action="/leave" className="ep-card ep-myleave__filter" aria-label="Filter">
        <input type="hidden" name="tab" value="leave" />
        <input type="hidden" name="size" value={size} />
        <label className="ep-field" htmlFor="ml-from">
          <span className="ep-field__label">From Date</span>
          <input id="ml-from" name="from" type="date" className="ep-input" defaultValue={from} />
        </label>
        <label className="ep-field" htmlFor="ml-to">
          <span className="ep-field__label">To Date</span>
          <input id="ml-to" name="to" type="date" className="ep-input" defaultValue={to} />
        </label>
        <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm">
          Search
        </button>
      </form>
      <ListBar
        page={d.page}
        size={d.size}
        total={d.total}
        href={(p) => link(p)}
        sizeHref={(s) => link(1, s)}
        noun="leave applications"
        files={d.employee ? { xlsx: file('xlsx'), pdf: file('pdf') } : null}
      />
      <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="My leave list">
        <table className="ep-table">
          <thead>
            <tr>
              <th scope="col">Sr No</th>
              <th scope="col">Leave Id</th>
              <th scope="col">Leave Type</th>
              <th scope="col">Days</th>
              <th scope="col">Attachment</th>
              <th scope="col">Is Half Day</th>
              <th scope="col">Reason</th>
              <th scope="col">Applied Date</th>
              <th scope="col">Action By</th>
              <th scope="col">Action Date</th>
              <th scope="col">Actions</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {d.rows.length ? (
              d.rows.map((r, i) => (
                <tr key={r.id}>
                  <td>{(d.page - 1) * d.size + i + 1}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <a href={`/leave/requests/${r.id}`}>{r.number}</a>
                  </td>
                  <td>
                    {r.leaveType.code} — {r.leaveType.name}
                  </td>
                  <td>
                    <DateChips r={r} />
                  </td>
                  <td>
                    {r.documentFileId ? (
                      <FileLinks
                        href={`/api/files/${r.documentFileId}/download`}
                        label={`the document of ${r.number}`}
                      />
                    ) : (
                      '—'
                    )}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>{halfWords(r)}</td>
                  <td>{r.reason}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{when(r.appliedAt)}</td>
                  <td>{r.decidedBy ?? (r.decidedAt ? 'System' : '')}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{when(r.decidedAt)}</td>
                  <td>
                    <div className="ep-rowacts">
                      <a
                        className="ep-btn ep-btn--ghost ep-btn--sm"
                        href={`/leave/requests/${r.id}`}
                        aria-label={`View ${r.number}`}
                      >
                        View
                      </a>
                      {r.can.withdraw ? (
                        <DialogButton
                          id={`ml-wd-${r.id}`}
                          label="Withdraw"
                          title={`Withdraw ${r.number}`}
                          className="ep-btn ep-btn--secondary ep-btn--sm"
                        >
                          <form
                            action={withdrawLeave.bind(null, r.id)}
                            className="ep-form-section__body"
                          >
                            <input type="hidden" name="back" value={back} />
                            <p className="ep-field__help">
                              It has not been decided yet: withdrawing it gives the days back.
                            </p>
                            <label className="ep-field" htmlFor={`ml-wd-${r.id}-why`}>
                              <span className="ep-field__label">Why (optional)</span>
                              <textarea
                                id={`ml-wd-${r.id}-why`}
                                name="reason"
                                className="ep-input"
                                rows={2}
                                maxLength={500}
                              />
                            </label>
                            <button type="submit" className="ep-btn ep-btn--danger ep-btn--sm">
                              Withdraw the leave
                            </button>
                          </form>
                        </DialogButton>
                      ) : null}
                      {r.can.requestCancel ? (
                        <DialogButton
                          id={`ml-cx-${r.id}`}
                          label="Ask to cancel"
                          title={`Ask to cancel ${r.number}`}
                          className="ep-btn ep-btn--secondary ep-btn--sm"
                        >
                          <form
                            action={askCancelLeave.bind(null, r.id)}
                            className="ep-form-section__body"
                          >
                            <input type="hidden" name="back" value={back} />
                            <p className="ep-field__help">
                              It is approved: the cancellation goes to your approvers, as the leave
                              did. The days come back once they approve it.
                            </p>
                            <label className="ep-field" htmlFor={`ml-cx-${r.id}-why`}>
                              <span className="ep-field__label">Why</span>
                              <textarea
                                id={`ml-cx-${r.id}-why`}
                                name="reason"
                                className="ep-input"
                                rows={2}
                                minLength={3}
                                maxLength={500}
                                required
                              />
                            </label>
                            <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm">
                              Send the cancellation
                            </button>
                          </form>
                        </DialogButton>
                      ) : null}
                    </div>
                  </td>
                  <td>
                    <LeaveStatusCell r={r} />
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={12}>
                  {d.employee ? 'No Leave Records in these dates.' : 'No leave for this sign-in.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Pages page={d.page} size={d.size} total={d.total} href={(p) => link(p)} noun="leave" />
    </section>
  );
}
