import { Button, Card } from '@edupro/ui';
import { HostelPicker, MessHeader } from '@/components/hostel/MessHeader';
import { apiFetch, getMe } from '@/lib/api';
import { cloneMenu, copyMenu, saveMenuCycle, saveMenuGrid } from '@/lib/mess-actions';
import { istToday, messHostels, mondayOf, type Template } from '@/lib/mess';

const DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEK = [1, 2, 3, 4, 5, 6, 0];

/**
 * Hostel → Mess → Menu cycle: the menu repeats every 1 to 4 weeks from a Monday. Edit a week of the cycle,
 * copy a day to other days or a week to other weeks, and copy the whole menu to other hostels.
 */
export default async function MessMenuPage({
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
  const asked = Math.min(4, Math.max(1, Number(sp.week) || 0));
  const first = hostel
    ? await apiFetch<Template>(
        `/hostel/menu/template?hostelId=${hostel.id}&week=${String(asked || 1)}`,
      ).catch(() => null)
    : null;
  // no week asked: the week of the cycle running now
  const t =
    first && !asked && first.thisWeek !== 1
      ? await apiFetch<Template>(
          `/hostel/menu/template?hostelId=${hostel!.id}&week=${String(first.thisWeek)}`,
        )
      : first;
  const canEdit = me.permissions.includes('hostel.mess.manage');
  const week = t ? Math.min(t.week, t.cycleWeeks) : 1;
  const here = `/hostel/mess/menu?hostel=${hostel?.id ?? ''}&week=${String(week)}`;
  const others = hostels.filter((h) => h.id !== hostel?.id);
  return (
    <>
      <MessHeader
        current="menu"
        permissions={me.permissions}
        hostelId={hostel?.id}
        sp={sp}
        description="The menu of each hostel repeats every week, or in a cycle of 2, 3 or 4 weeks. Change a single day on This week."
      />
      {!hostel || !t ? (
        <Card>{hostel ? 'You are not a warden of this hostel.' : 'Set up a hostel first.'}</Card>
      ) : (
        <>
          <HostelPicker hostels={hostels} hostelId={hostel.id} />
          <Card title="The cycle" style={{ marginBottom: 'var(--sp-4)' }}>
            <form action={saveMenuCycle} className="ep-hd__row">
              <input type="hidden" name="hostelId" value={hostel.id} />
              <input
                type="hidden"
                name="returnTo"
                value={`/hostel/mess/menu?hostel=${hostel.id}`}
              />
              <label className="ep-field" htmlFor="mc-weeks">
                <span className="ep-field__label">The menu repeats every</span>
                <select
                  id="mc-weeks"
                  name="weeks"
                  className="ep-select"
                  defaultValue={String(t.cycleWeeks)}
                  disabled={!canEdit}
                >
                  <option value="1">1 week</option>
                  <option value="2">2 weeks</option>
                  <option value="3">3 weeks</option>
                  <option value="4">4 weeks</option>
                </select>
              </label>
              <label className="ep-field" htmlFor="mc-start">
                <span className="ep-field__label">Week 1 starts on (a Monday)</span>
                <input
                  id="mc-start"
                  name="start"
                  type="date"
                  className="ep-input"
                  defaultValue={t.cycleStart}
                  step={7}
                  min="2026-01-05"
                  disabled={!canEdit}
                />
              </label>
              {canEdit ? (
                <Button type="submit" variant="secondary">
                  Save the cycle
                </Button>
              ) : null}
            </form>
            <p className="ep-field__help" style={{ marginBottom: 0 }}>
              This week ({mondayOf(istToday())}) is week {t.thisWeek} of {t.cycleWeeks}.
            </p>
          </Card>
          {t.cycleWeeks > 1 ? (
            <nav
              className="ep-tabs-links"
              aria-label="Week of the cycle"
              style={{ marginBottom: 'var(--sp-3)' }}
            >
              {Array.from({ length: t.cycleWeeks }, (_, i) => i + 1).map((w) => (
                <a
                  key={w}
                  href={`/hostel/mess/menu?hostel=${hostel.id}&week=${String(w)}`}
                  aria-current={w === week ? 'page' : undefined}
                >
                  Week {w}
                  {w === t.thisWeek ? ' (now)' : ''}
                </a>
              ))}
            </nav>
          ) : null}
          <Card
            title={t.cycleWeeks > 1 ? `Week ${String(week)} of the cycle` : 'The weekly menu'}
            style={{ marginBottom: 'var(--sp-4)' }}
          >
            {t.meals.length === 0 ? (
              <p className="ep-field__help">
                This hostel serves no meal yet: tick it on a meal under Mess → Set-up.
              </p>
            ) : (
              <form action={saveMenuGrid}>
                <input type="hidden" name="hostelId" value={hostel.id} />
                <input type="hidden" name="cycleWeek" value={String(week)} />
                <input type="hidden" name="returnTo" value={here} />
                <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Menu grid">
                  <table className="ep-table ep-table--dense">
                    <caption className="ep-sr-only">Menu of week {week}</caption>
                    <thead>
                      <tr>
                        <th scope="col">Day</th>
                        {t.meals.map((m) => (
                          <th key={m.id} scope="col">
                            {m.name} <small className="ep-field__help">{m.atTime}</small>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {t.days.map((d) => (
                        <tr key={d.weekday}>
                          <th
                            scope="row"
                            style={{ textTransform: 'none', letterSpacing: 'normal' }}
                          >
                            {d.day}
                          </th>
                          {t.meals.map((m, i) => (
                            <td key={m.id}>
                              <label
                                className="ep-sr-only"
                                htmlFor={`g-${m.id}-${String(d.weekday)}`}
                              >
                                {d.day} {m.name}
                              </label>
                              <textarea
                                id={`g-${m.id}-${String(d.weekday)}`}
                                name={`m-${m.id}-${String(d.weekday)}`}
                                className="ep-input"
                                rows={2}
                                maxLength={500}
                                disabled={!canEdit}
                                defaultValue={d.items[i] ?? ''}
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {canEdit ? (
                  <div style={{ marginTop: 'var(--sp-3)' }}>
                    <Button type="submit">Save week {week}</Button>
                  </div>
                ) : null}
              </form>
            )}
          </Card>
          {canEdit && t.meals.length ? (
            <div
              style={{
                display: 'grid',
                gap: 'var(--sp-4)',
                gridTemplateColumns: 'repeat(auto-fit, minmax(18rem, 1fr))',
              }}
            >
              <Card title="Copy a day">
                <form action={copyMenu} className="ep-hd__form">
                  <input type="hidden" name="hostelId" value={hostel.id} />
                  <input type="hidden" name="fromWeek" value={String(week)} />
                  <input type="hidden" name="returnTo" value={here} />
                  <label className="ep-field" htmlFor="cd-from">
                    <span className="ep-field__label">
                      Copy{t.cycleWeeks > 1 ? ` (week ${String(week)})` : ''}
                    </span>
                    <select id="cd-from" name="fromWeekday" className="ep-select" defaultValue="1">
                      {WEEK.map((wd) => (
                        <option key={wd} value={wd}>
                          {DAY[wd]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <fieldset
                    style={{
                      border: 0,
                      padding: 0,
                      margin: 0,
                      display: 'grid',
                      gap: 'var(--sp-2)',
                    }}
                  >
                    <legend className="ep-field__label">To</legend>
                    {Array.from({ length: t.cycleWeeks }, (_, i) => i + 1).map((w) => (
                      <div
                        key={w}
                        style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-2)' }}
                      >
                        {t.cycleWeeks > 1 ? (
                          <strong style={{ minWidth: '4.5rem' }}>Week {w}</strong>
                        ) : null}
                        {WEEK.map((wd) => (
                          <label
                            key={wd}
                            className="ep-check"
                            htmlFor={`cd-${String(w)}-${String(wd)}`}
                          >
                            <input
                              id={`cd-${String(w)}-${String(wd)}`}
                              type="checkbox"
                              name="to"
                              value={`${String(w)}-${String(wd)}`}
                            />{' '}
                            {DAY[wd]!.slice(0, 3)}
                          </label>
                        ))}
                      </div>
                    ))}
                  </fieldset>
                  <p className="ep-field__help" style={{ margin: 0 }}>
                    The days ticked get the same menu (an empty meal empties it there).
                  </p>
                  <div>
                    <Button type="submit" variant="secondary">
                      Copy the day
                    </Button>
                  </div>
                </form>
              </Card>
              {t.cycleWeeks > 1 ? (
                <Card title={`Copy week ${String(week)}`}>
                  <form action={copyMenu} className="ep-hd__form">
                    <input type="hidden" name="hostelId" value={hostel.id} />
                    <input type="hidden" name="fromWeek" value={String(week)} />
                    <input type="hidden" name="fromWeekday" value="" />
                    <input type="hidden" name="returnTo" value={here} />
                    <fieldset
                      style={{
                        border: 0,
                        padding: 0,
                        margin: 0,
                        display: 'grid',
                        gap: 'var(--sp-2)',
                      }}
                    >
                      <legend className="ep-field__label">To the weeks</legend>
                      {Array.from({ length: t.cycleWeeks }, (_, i) => i + 1)
                        .filter((w) => w !== week)
                        .map((w) => (
                          <label key={w} className="ep-check" htmlFor={`cw-${String(w)}`}>
                            <input
                              id={`cw-${String(w)}`}
                              type="checkbox"
                              name="to"
                              value={String(w)}
                            />{' '}
                            Week {w}
                          </label>
                        ))}
                    </fieldset>
                    <div>
                      <Button type="submit" variant="secondary">
                        Copy the week
                      </Button>
                    </div>
                  </form>
                </Card>
              ) : null}
              {others.length ? (
                <Card title="Copy to other hostels">
                  <form action={cloneMenu} className="ep-hd__form">
                    <input type="hidden" name="hostelId" value={hostel.id} />
                    <input type="hidden" name="returnTo" value={here} />
                    <fieldset
                      style={{
                        border: 0,
                        padding: 0,
                        margin: 0,
                        display: 'grid',
                        gap: 'var(--sp-2)',
                      }}
                    >
                      <legend className="ep-field__label">
                        Copy {hostel.name}’s menu (every week) to
                      </legend>
                      {others.map((h) => (
                        <label key={h.id} className="ep-check" htmlFor={`cl-${h.id}`}>
                          <input id={`cl-${h.id}`} type="checkbox" name="toHostel" value={h.id} />{' '}
                          {h.name}
                        </label>
                      ))}
                    </fieldset>
                    <fieldset
                      style={{
                        border: 0,
                        padding: 0,
                        margin: 0,
                        display: 'grid',
                        gap: 'var(--sp-2)',
                      }}
                    >
                      <legend className="ep-field__label">How</legend>
                      <label className="ep-check" htmlFor="cl-replace">
                        <input
                          id="cl-replace"
                          type="radio"
                          name="mode"
                          value="replace"
                          defaultChecked
                        />{' '}
                        Replace their menu and cycle
                      </label>
                      <label className="ep-check" htmlFor="cl-fill">
                        <input id="cl-fill" type="radio" name="mode" value="fill" /> Fill only their
                        empty meals
                      </label>
                    </fieldset>
                    <p className="ep-field__help" style={{ margin: 0 }}>
                      Meal by meal: a hostel that does not serve a meal is left out of it.
                    </p>
                    <div>
                      <Button type="submit" variant="secondary">
                        Copy the menu
                      </Button>
                    </div>
                  </form>
                </Card>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </>
  );
}
