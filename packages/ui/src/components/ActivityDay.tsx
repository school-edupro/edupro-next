export interface ActivityDayData {
  employee: { id: string; name: string };
  log: {
    id: string | null;
    date: string;
    state: 'draft' | 'submitted' | 'reviewed' | 'returned' | null;
    tomorrowPlan: string | null;
    pendingNote: string | null;
    submittedAt: string | null;
    late: boolean;
    reviewNote: string | null;
    reviewedBy: string | null;
    entries: Array<{
      from: string;
      to: string;
      categoryId: string;
      category: string;
      description: string;
      source: string;
    }>;
    minutes: number;
  };
  suggested: Array<{
    from: string;
    to: string;
    description: string;
    source: string;
    categoryId: string | null;
  }>;
  categories: Array<{ id: string; name: string }>;
  cutoffTime: string;
  backDays: number;
  editable: boolean;
  recent: Array<{ date: string; state: string | null; late: boolean }>;
}
type Act = (fd: FormData) => void | Promise<void>;

const STATE: Record<string, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  reviewed: 'Reviewed',
  returned: 'Sent back',
};
const day = (d: string, long = false) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', {
    timeZone: 'UTC',
    weekday: long ? 'long' : 'short',
    day: 'numeric',
    month: long ? 'long' : 'short',
    year: long ? 'numeric' : undefined,
  });
const hm = (m: number) => `${String(Math.floor(m / 60))}h ${String(m % 60).padStart(2, '0')}m`;

/**
 * My day: the activity log of one date as time slots (from, to, category, what was done). A day that
 * is still empty starts with the periods the timetable knows; the employee adds the rest, saves a draft
 * or submits. The last seven days show above with their state.
 */
export function ActivityDay({
  data,
  path,
  saveDraft,
  submit,
}: {
  data: ActivityDayData;
  /** The page itself, e.g. `/activity-log`: the day links and the date box reload it. */
  path: string;
  saveDraft: Act;
  submit: Act;
}) {
  const { log } = data;
  const filled = log.entries.length
    ? log.entries.map((e) => ({ ...e, categoryId: e.categoryId as string | null }))
    : data.suggested.map((s) => ({ ...s, category: '' }));
  // room for more: the day's rows and six empty ones
  const rows = data.editable ? [...filled, ...Array.from({ length: 6 }, () => null)] : filled;
  return (
    <div className="ep-actlog">
      <nav className="ep-tabs-links" aria-label="Last seven days">
        {data.recent.map((r) => (
          <a
            key={r.date}
            href={`${path}?date=${r.date}`}
            aria-current={r.date === log.date ? 'date' : undefined}
            data-state={r.state ?? 'missing'}
          >
            {day(r.date)} · {r.state ? STATE[r.state] : 'Not filled'}
            {r.late ? ' (late)' : ''}
          </a>
        ))}
      </nav>
      <form method="get" action={path} className="ep-hw__filter">
        <label className="ep-field">
          <span className="ep-field__label">Another date</span>
          <input className="ep-input" type="date" name="date" defaultValue={log.date} />
        </label>
        <button type="submit" className="ep-btn ep-btn--secondary">
          Show
        </button>
      </form>
      <p className="ep-actlog__state">
        <strong>{day(log.date, true)}</strong> · {log.state ? STATE[log.state] : 'Not filled yet'}
        {log.late ? ' (late)' : ''}
        {log.minutes ? ` · ${hm(log.minutes)} logged` : ''}
      </p>
      {log.state === 'returned' && log.reviewNote ? (
        <div className="ep-alert ep-alert--warning" role="status">
          Sent back{log.reviewedBy ? ` by ${log.reviewedBy}` : ''}: {log.reviewNote}
        </div>
      ) : null}
      {log.state === 'reviewed' && log.reviewNote ? (
        <p className="ep-field__help">
          Reviewer’s remark{log.reviewedBy ? ` (${log.reviewedBy})` : ''}: {log.reviewNote}
        </p>
      ) : null}
      {!log.entries.length && data.suggested.length && data.editable ? (
        <p className="ep-field__help">
          The first rows come from your timetable for this day. Correct them, remove what did not
          happen (empty the row), and add the rest of your day.
        </p>
      ) : null}
      <form>
        <input type="hidden" name="date" value={log.date} />
        <input type="hidden" name="rows" value={rows.length} />
        <div
          className="ep-table-wrap"
          tabIndex={0}
          role="region"
          aria-label="Activities of the day"
        >
          <table className="ep-table ep-table--dense ep-actlog__table">
            <caption className="ep-sr-only">Activities of the day, in time order</caption>
            <thead>
              <tr>
                <th scope="col">From</th>
                <th scope="col">To</th>
                <th scope="col">Category</th>
                <th scope="col">What was done</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={4}>Nothing was written for this day.</td>
                </tr>
              ) : null}
              {rows.map((r, i) =>
                data.editable ? (
                  <tr key={String(i)}>
                    <td>
                      <input
                        className="ep-input"
                        type="time"
                        name={`from-${String(i)}`}
                        defaultValue={r?.from ?? ''}
                        aria-label={`Row ${String(i + 1)}: from`}
                      />
                    </td>
                    <td>
                      <input
                        className="ep-input"
                        type="time"
                        name={`to-${String(i)}`}
                        defaultValue={r?.to ?? ''}
                        aria-label={`Row ${String(i + 1)}: to`}
                      />
                    </td>
                    <td>
                      <select
                        className="ep-select"
                        name={`cat-${String(i)}`}
                        defaultValue={r?.categoryId ?? ''}
                        aria-label={`Row ${String(i + 1)}: category`}
                      >
                        <option value="">Choose</option>
                        {data.categories.map((k) => (
                          <option key={k.id} value={k.id}>
                            {k.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        type="hidden"
                        name={`src-${String(i)}`}
                        value={r?.source ?? 'manual'}
                      />
                      <input
                        className="ep-input ep-actlog__what"
                        name={`desc-${String(i)}`}
                        defaultValue={r?.description ?? ''}
                        maxLength={1000}
                        aria-label={`Row ${String(i + 1)}: what was done`}
                      />
                    </td>
                  </tr>
                ) : (
                  <tr key={String(i)}>
                    <td>{r!.from}</td>
                    <td>{r!.to}</td>
                    <td>{r!.category}</td>
                    <td>{r!.description}</td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
        {data.editable ? (
          <>
            <div className="ep-actlog__notes">
              <label className="ep-field">
                <span className="ep-field__label">Pending / carried forward</span>
                <textarea
                  className="ep-input"
                  name="pendingNote"
                  rows={2}
                  maxLength={2000}
                  defaultValue={log.pendingNote ?? ''}
                />
              </label>
              <label className="ep-field">
                <span className="ep-field__label">Plan for tomorrow</span>
                <textarea
                  className="ep-input"
                  name="tomorrowPlan"
                  rows={2}
                  maxLength={2000}
                  defaultValue={log.tomorrowPlan ?? ''}
                />
              </label>
            </div>
            <div className="ep-actlog__foot">
              <p className="ep-field__help">
                A row needs its from, to, category and what was done; an empty row is ignored.
                Submit by {data.cutoffTime}; later it is marked late. After submitting, the day can
                be changed only if it is sent back. A day can be filled up to {data.backDays} day(s)
                later.
              </p>
              <button type="submit" className="ep-btn ep-btn--secondary" formAction={saveDraft}>
                Save draft
              </button>
              <button type="submit" className="ep-btn ep-btn--primary" formAction={submit}>
                Submit my day
              </button>
            </div>
          </>
        ) : (
          <>
            {log.pendingNote ? (
              <p>
                <strong>Pending / carried forward:</strong> {log.pendingNote}
              </p>
            ) : null}
            {log.tomorrowPlan ? (
              <p>
                <strong>Plan for tomorrow:</strong> {log.tomorrowPlan}
              </p>
            ) : null}
            <p className="ep-field__help">
              {log.state === 'submitted' || log.state === 'reviewed'
                ? 'This day is submitted. It can be changed only if it is sent back to you.'
                : 'This day can no longer be filled; ask the office if it must be reopened.'}
            </p>
          </>
        )}
      </form>
    </div>
  );
}

/** The rows of the "my day" form as the API takes them: complete rows only, a half-filled one is named. */
export function activityEntriesFrom(fd: FormData): {
  entries: Array<{
    from: string;
    to: string;
    categoryId: string;
    description: string;
    source: string;
  }>;
  problem: string | null;
} {
  const s = (k: string) => String(fd.get(k) ?? '').trim();
  const entries = [];
  let problem: string | null = null;
  for (let i = 0; i < Math.min(60, Number(s('rows')) || 0); i += 1) {
    const row = {
      from: s(`from-${String(i)}`),
      to: s(`to-${String(i)}`),
      categoryId: s(`cat-${String(i)}`),
      description: s(`desc-${String(i)}`),
      source: s(`src-${String(i)}`) || 'manual',
    };
    // a row with neither a time nor a text is empty (a suggested category alone does not count)
    if (!row.from && !row.to && !row.description) continue;
    if (!row.from || !row.to || !row.categoryId || !row.description)
      problem ??= `Row ${String(i + 1)}: fill from, to, category and what was done (or empty the row)`;
    else entries.push(row);
  }
  return { entries, problem };
}
