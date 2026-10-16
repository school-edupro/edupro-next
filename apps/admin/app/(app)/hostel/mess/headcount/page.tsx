import { Badge, Card } from '@edupro/ui';
import { MessHeader } from '@/components/hostel/MessHeader';
import { apiFetch, getMe } from '@/lib/api';
import { isDate, istToday, messFile, messHostels, shift } from '@/lib/mess';

interface Headcount {
  on: string;
  diets: Array<{ code: string; name: string }>;
  hostels: Array<{ id: string; name: string }>;
  rows: Array<{
    hostelId: string;
    hostel: string;
    mealId: string;
    meal: string;
    atTime: string;
    boarders: number;
    away: number;
    toCook: number;
    byDiet: Array<{ diet: string; name: string; n: number }>;
    noOnionGarlic: number;
    allergies: Array<{ name: string; n: number }>;
    onRecord: number;
    marked: { had: number; skipped: number } | null;
  }>;
}

/**
 * Hostel → Mess → Kitchen head count: for a day, each hostel's meals with how many to cook, split by diet,
 * no onion-garlic and the allergies; pupils on hostel leave at the meal's time (or due to leave) left out.
 */
export default async function MessHeadcountPage({
  searchParams,
}: {
  searchParams: Promise<{
    hostel?: string;
    on?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  const { hostels } = await messHostels();
  const hostelId = hostels.some((h) => h.id === sp.hostel) ? sp.hostel! : '';
  const on = isDate(sp.on) ? sp.on! : istToday();
  const hc = await apiFetch<Headcount>(
    `/hostel/headcount?on=${on}${hostelId ? `&hostelId=${hostelId}` : ''}`,
  );
  const total = hc.rows.reduce((n, r) => n + r.toCook, 0);
  return (
    <>
      <MessHeader
        current="headcount"
        permissions={me.permissions}
        hostelId={hostelId || undefined}
        sp={sp}
        description="How many to cook for each meal of a day, split by diet, with no onion-garlic and the allergies. Pupils on hostel leave at the meal’s time are left out."
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)' }}>
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href={messFile('headcount', { hostelId, on }, 'xlsx')}
            >
              Excel
            </a>
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href={messFile('headcount', { hostelId, on }, 'pdf')}
            >
              PDF
            </a>
          </span>
        }
      />
      <div className="ep-filter-band" style={{ marginBottom: 'var(--sp-4)' }}>
        <form method="get" className="ep-dlog__filters">
          <label className="ep-field" htmlFor="hc-hostel">
            <span className="ep-field__label">Hostel</span>
            <select id="hc-hostel" name="hostel" className="ep-select" defaultValue={hostelId}>
              <option value="">All hostels</option>
              {hostels.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          </label>
          <label className="ep-field" htmlFor="hc-on">
            <span className="ep-field__label">Day</span>
            <input id="hc-on" name="on" type="date" className="ep-input" defaultValue={on} />
          </label>
          <button type="submit" className="ep-btn ep-btn--secondary">
            Show
          </button>
          <a
            className="ep-btn ep-btn--secondary"
            href={`/hostel/mess/headcount?on=${shift(on, 1)}${hostelId ? `&hostel=${hostelId}` : ''}`}
          >
            Next day
          </a>
        </form>
      </div>
      <Card
        title={`${new Date(`${on}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'short', timeZone: 'UTC' })} · ${String(total)} plate(s) in all`}
      >
        {hc.rows.length === 0 ? (
          <p>No meal is served in these hostels: tick the hostels on a meal under Mess → Set-up.</p>
        ) : (
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Kitchen head count">
            <table className="ep-table ep-table--dense">
              <caption className="ep-sr-only">Kitchen head count of {on}</caption>
              <thead>
                <tr>
                  <th scope="col">Hostel · meal</th>
                  <th scope="col" className="ep-num">
                    Boarders
                  </th>
                  <th scope="col" className="ep-num">
                    Away
                  </th>
                  <th scope="col" className="ep-num">
                    To cook
                  </th>
                  {hc.diets.map((d) => (
                    <th key={d.code} scope="col" className="ep-num">
                      {d.name}
                    </th>
                  ))}
                  <th scope="col" className="ep-num">
                    No onion-garlic
                  </th>
                  <th scope="col">Allergies</th>
                  <th scope="col">Marked</th>
                </tr>
              </thead>
              <tbody>
                {hc.rows.map((r) => (
                  <tr key={r.mealId}>
                    <td>
                      <strong>{r.meal}</strong> <small className="ep-field__help">{r.atTime}</small>
                      <div className="ep-field__help">{r.hostel}</div>
                    </td>
                    <td className="ep-num">{r.boarders}</td>
                    <td className="ep-num">{r.away}</td>
                    <td className="ep-num">
                      <strong>{r.toCook}</strong>
                    </td>
                    {r.byDiet.map((d) => (
                      <td key={d.diet} className="ep-num">
                        {d.n || '–'}
                      </td>
                    ))}
                    <td className="ep-num">{r.noOnionGarlic || '–'}</td>
                    <td>
                      {r.allergies.length
                        ? r.allergies.map((a) => (
                            <span key={a.name} style={{ marginRight: 'var(--sp-1)' }}>
                              <Badge tone="danger">
                                {a.name} {a.n}
                              </Badge>
                            </span>
                          ))
                        : '–'}
                      {r.onRecord ? (
                        <div className="ep-field__help">{r.onRecord} with an allergy on record</div>
                      ) : null}
                    </td>
                    <td>
                      {r.marked ? (
                        <Badge tone="success">
                          {r.marked.had} had · {r.marked.skipped} skipped
                        </Badge>
                      ) : (
                        '–'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
