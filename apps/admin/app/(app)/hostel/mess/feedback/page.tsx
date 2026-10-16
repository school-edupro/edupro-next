import { Badge, Card } from '@edupro/ui';
import { MessHeader } from '@/components/hostel/MessHeader';
import { apiFetch, getMe } from '@/lib/api';
import { isDate, messHostels } from '@/lib/mess';

interface Feedback {
  from: string;
  to: string;
  meals: Array<{
    hostel: string;
    meal: string;
    atTime: string;
    ratings: number;
    average: number;
    spread: number[];
  }>;
  comments: Array<{
    onDate: string;
    hostel: string;
    meal: string;
    rating: number;
    comment: string;
    pupil: string;
    admissionNo: string;
  }>;
}
const tone = (avg: number) => (avg >= 4 ? 'success' : avg >= 3 ? 'warning' : 'danger');
const dmy = (d: string) => d.split('-').reverse().join('-');

/** Hostel → Mess → Feedback: how families rated the meals (1 to 5) in a period, and what they wrote. */
export default async function MessFeedbackPage({
  searchParams,
}: {
  searchParams: Promise<{
    hostel?: string;
    from?: string;
    to?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  const { hostels } = await messHostels();
  const hostelId = hostels.some((h) => h.id === sp.hostel) ? sp.hostel! : '';
  const qs = new URLSearchParams(
    Object.fromEntries(
      Object.entries({
        hostelId,
        from: isDate(sp.from) ? sp.from! : '',
        to: isDate(sp.to) ? sp.to! : '',
      }).filter(([, v]) => v),
    ),
  ).toString();
  const fb = await apiFetch<Feedback>(`/hostel/feedback${qs ? `?${qs}` : ''}`);
  return (
    <>
      <MessHeader
        current="feedback"
        permissions={me.permissions}
        hostelId={hostelId || undefined}
        sp={sp}
        description="Parents rate the meals their child had (1 to 5, with a comment) in the parent app, up to a week later. Here: each meal’s average and the comments."
      />
      <div className="ep-filter-band" style={{ marginBottom: 'var(--sp-4)' }}>
        <form method="get" className="ep-dlog__filters">
          <label className="ep-field" htmlFor="fb-hostel">
            <span className="ep-field__label">Hostel</span>
            <select id="fb-hostel" name="hostel" className="ep-select" defaultValue={hostelId}>
              <option value="">All hostels</option>
              {hostels.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          </label>
          <label className="ep-field" htmlFor="fb-from">
            <span className="ep-field__label">From</span>
            <input
              id="fb-from"
              name="from"
              type="date"
              className="ep-input"
              defaultValue={fb.from}
            />
          </label>
          <label className="ep-field" htmlFor="fb-to">
            <span className="ep-field__label">To</span>
            <input id="fb-to" name="to" type="date" className="ep-input" defaultValue={fb.to} />
          </label>
          <button type="submit" className="ep-btn ep-btn--secondary">
            Show
          </button>
        </form>
      </div>
      <Card
        title={`Ratings · ${dmy(fb.from)} to ${dmy(fb.to)}`}
        style={{ marginBottom: 'var(--sp-4)' }}
      >
        {fb.meals.length === 0 ? (
          <p>No meal was rated in these days.</p>
        ) : (
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Ratings by meal">
            <table className="ep-table ep-table--dense">
              <caption className="ep-sr-only">Ratings by meal</caption>
              <thead>
                <tr>
                  <th scope="col">Hostel · meal</th>
                  <th scope="col" className="ep-num">
                    Average
                  </th>
                  <th scope="col" className="ep-num">
                    Ratings
                  </th>
                  {[5, 4, 3, 2, 1].map((n) => (
                    <th key={n} scope="col" className="ep-num">
                      {n} ★
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {fb.meals.map((m) => (
                  <tr key={`${m.hostel}-${m.meal}`}>
                    <td>
                      <strong>{m.meal}</strong> <small className="ep-field__help">{m.atTime}</small>
                      <div className="ep-field__help">{m.hostel}</div>
                    </td>
                    <td className="ep-num">
                      <Badge tone={tone(m.average)}>{m.average.toFixed(1)}</Badge>
                    </td>
                    <td className="ep-num">{m.ratings}</td>
                    {[5, 4, 3, 2, 1].map((n) => (
                      <td key={n} className="ep-num">
                        {m.spread[n - 1] || '–'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card title={`Comments · ${String(fb.comments.length)}`}>
        {fb.comments.length === 0 ? (
          <p>No comment in these days.</p>
        ) : (
          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              margin: 0,
              display: 'grid',
              gap: 'var(--sp-3)',
            }}
          >
            {fb.comments.map((c, i) => (
              <li key={i} className="ep-card" style={{ padding: 'var(--sp-3)' }}>
                <div
                  style={{
                    display: 'flex',
                    gap: 'var(--sp-2)',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                  }}
                >
                  <Badge tone={tone(c.rating)}>{c.rating} ★</Badge>
                  <strong>
                    {c.meal} · {dmy(c.onDate)}
                  </strong>
                  <span className="ep-field__help">
                    {c.hostel} · {c.pupil} ({c.admissionNo})
                  </span>
                </div>
                <p style={{ margin: 'var(--sp-2) 0 0' }}>{c.comment}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
