import { Badge, Button, Card } from '@edupro/ui';
import { HostelPicker, MessHeader } from '@/components/hostel/MessHeader';
import { apiFetch, getMe } from '@/lib/api';
import { saveMenuChange } from '@/lib/hostel-actions';
import { dayName, isDate, istToday, messFile, messHostels, shift, type Week } from '@/lib/mess';

/**
 * Hostel → Mess → This week: the menu of a week of one hostel (the week of its menu cycle, with the
 * one-off changes for a day), a change for a day, and the week as Excel or PDF.
 */
export default async function HostelMessPage({
  searchParams,
}: {
  searchParams: Promise<{
    hostel?: string;
    week?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  const { hostels, hostel } = await messHostels(sp.hostel);
  const weekOf = isDate(sp.week) ? sp.week! : '';
  const week = hostel
    ? await apiFetch<Week>(`/hostel/menu?hostelId=${hostel.id}${weekOf ? `&weekOf=${weekOf}` : ''}`)
    : null;
  const canEdit = me.permissions.includes('hostel.mess.manage');
  const today = istToday();
  const here = `/hostel/mess?hostel=${hostel?.id ?? ''}${weekOf ? `&week=${weekOf}` : ''}`;
  return (
    <>
      <MessHeader
        current=""
        permissions={me.permissions}
        hostelId={hostel?.id}
        sp={sp}
        description="The meals of the week in each hostel: the week of its menu cycle, with any change for a day. Parents see the same week in the portal."
        actions={
          week ? (
            <span style={{ display: 'inline-flex', gap: 'var(--sp-2)' }}>
              <a
                className="ep-btn ep-btn--secondary ep-btn--sm"
                href={messFile('menu', { hostelId: hostel!.id, weekOf: week.weekOf }, 'xlsx')}
              >
                Excel
              </a>
              <a
                className="ep-btn ep-btn--secondary ep-btn--sm"
                href={messFile('menu', { hostelId: hostel!.id, weekOf: week.weekOf }, 'pdf')}
              >
                PDF
              </a>
            </span>
          ) : undefined
        }
      />
      {!hostel || !week ? (
        <Card>Set up a hostel first.</Card>
      ) : (
        <>
          <HostelPicker hostels={hostels} hostelId={hostel.id} />
          <Card
            title={`${hostel.name} · week of ${dayName(week.weekOf)}${week.cycleWeeks > 1 ? ` · week ${String(week.cycleWeek)} of ${String(week.cycleWeeks)}` : ''}`}
            actions={
              <span style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
                <a
                  className="ep-btn ep-btn--ghost ep-btn--sm"
                  href={`/hostel/mess?hostel=${hostel.id}&week=${shift(week.weekOf, -7)}`}
                >
                  Previous week
                </a>
                <a
                  className="ep-btn ep-btn--ghost ep-btn--sm"
                  href={`/hostel/mess?hostel=${hostel.id}`}
                >
                  This week
                </a>
                <a
                  className="ep-btn ep-btn--ghost ep-btn--sm"
                  href={`/hostel/mess?hostel=${hostel.id}&week=${shift(week.weekOf, 7)}`}
                >
                  Next week
                </a>
              </span>
            }
          >
            {week.meals.length === 0 ? (
              <p className="ep-field__help">
                This hostel serves no meal yet: tick it on a meal under Mess → Set-up.
              </p>
            ) : (
              <>
                <div
                  className="ep-table-wrap"
                  tabIndex={0}
                  role="region"
                  aria-label="Menu of the week"
                >
                  <table className="ep-table ep-table--dense">
                    <caption className="ep-sr-only">Menu of the week of {week.weekOf}</caption>
                    <thead>
                      <tr>
                        <th scope="col">Day</th>
                        {week.meals.map((m) => (
                          <th key={m.id} scope="col">
                            {m.name} <small className="ep-field__help">{m.atTime}</small>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {week.days.map((d) => (
                        <tr key={d.date}>
                          <th
                            scope="row"
                            style={{ textTransform: 'none', letterSpacing: 'normal' }}
                          >
                            {dayName(d.date)}
                            {d.date === today ? (
                              <>
                                {' '}
                                <Badge tone="info">Today</Badge>
                              </>
                            ) : null}
                          </th>
                          {d.meals.map((m) => (
                            <td key={m.mealId}>
                              {m.items ?? '—'}
                              {m.changed ? (
                                <span style={{ display: 'block' }}>
                                  <Badge tone="warning">Changed{m.note ? `: ${m.note}` : ''}</Badge>
                                </span>
                              ) : null}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {canEdit ? (
                  <form
                    action={saveMenuChange}
                    className="ep-hd__row"
                    style={{ marginTop: 'var(--sp-4)' }}
                  >
                    <input type="hidden" name="returnTo" value={here} />
                    <label className="ep-field" htmlFor="mc-day">
                      <span className="ep-field__label">Change for a day</span>
                      <input
                        id="mc-day"
                        name="onDate"
                        type="date"
                        className="ep-input"
                        required
                        defaultValue={week.days.some((d) => d.date === today) ? today : week.weekOf}
                        min={week.weekOf}
                        max={shift(week.weekOf, 6)}
                      />
                    </label>
                    <label className="ep-field" htmlFor="mc-meal">
                      <span className="ep-field__label">Meal</span>
                      <select id="mc-meal" name="mealId" className="ep-select" required>
                        {week.meals.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="ep-field" htmlFor="mc-items">
                      <span className="ep-field__label">Served (empty = the cycle’s menu)</span>
                      <input id="mc-items" name="items" className="ep-input" maxLength={500} />
                    </label>
                    <label className="ep-field" htmlFor="mc-note">
                      <span className="ep-field__label">Why</span>
                      <input
                        id="mc-note"
                        name="note"
                        className="ep-input"
                        maxLength={200}
                        placeholder="e.g. Diwali"
                      />
                    </label>
                    <Button type="submit" variant="secondary">
                      Save the change
                    </Button>
                  </form>
                ) : null}
              </>
            )}
          </Card>
        </>
      )}
    </>
  );
}
