import { Badge, Button, Card, PageHeader } from '@edupro/ui';
import { HostelNav } from '@/components/hostel/HostelNav';
import { Notice } from '@/components/Notice';
import { apiFetch, getMe } from '@/lib/api';
import { saveMeal, saveMenuChange, saveMenuWeek } from '@/lib/hostel-actions';

interface Meal {
  id: string;
  hostelId: string;
  name: string;
  atTime: string;
  active: boolean;
  markedToday: string | null;
}
interface Week {
  weekOf: string;
  meals: Array<{ id: string; name: string; atTime: string }>;
  days: Array<{
    date: string;
    weekday: number;
    meals: Array<{
      mealId: string;
      meal: string;
      items: string | null;
      weekly: string | null;
      changed: boolean;
      note: string | null;
    }>;
  }>;
}
interface Diet {
  studentId: string;
  name: string;
  admissionNo: string;
  room: string;
  diet: string;
  noOnionGarlic: boolean;
  notes: string | null;
  allergy: string | null;
}

const TABS = [
  ['week', 'This week'],
  ['menu', 'Weekly menu'],
  ['diets', 'Diet list'],
  ['meals', 'Meals'],
] as const;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DIET: Record<string, string> = {
  veg: 'Vegetarian',
  eggetarian: 'Vegetarian with egg',
  non_veg: 'Non-vegetarian',
  jain: 'Jain',
  vegan: 'Vegan',
};
const shift = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const dayName = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  });

/** The mess of a hostel: this week with one-off changes, the repeating weekly menu, the diet list, the meals. */
export default async function HostelMessPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    hostel?: string;
    week?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : 'week';
  const hostels = (await apiFetch<{ data: Array<{ id: string; name: string }> }>('/hostel/hostels'))
    .data;
  const hostel = hostels.find((h) => h.id === sp.hostel) ?? hostels[0];
  const canEdit = me.permissions.includes('hostel.mess.manage');
  const canSetup = me.permissions.includes('hostel.setup.manage');
  const weekOf = /^\d{4}-\d{2}-\d{2}$/.test(sp.week ?? '') ? sp.week! : '';
  const [meals, week, diets] = hostel
    ? await Promise.all([
        apiFetch<{ data: Meal[] }>(`/hostel/meals?hostelId=${hostel.id}`).then((r) => r.data),
        apiFetch<Week>(`/hostel/menu?hostelId=${hostel.id}${weekOf ? `&weekOf=${weekOf}` : ''}`),
        tab === 'diets' && canEdit
          ? apiFetch<{ data: Diet[] }>(`/hostel/diets?hostelId=${hostel.id}`).then((r) => r.data)
          : Promise.resolve([] as Diet[]),
      ])
    : [[] as Meal[], null, [] as Diet[]];
  const here = (t = tab) =>
    `/hostel/mess?tab=${t}${hostel ? `&hostel=${hostel.id}` : ''}${weekOf ? `&week=${weekOf}` : ''}`;
  const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  return (
    <>
      <PageHeader
        kicker="Hostel"
        title="Mess"
        description="The meals of each hostel, a weekly menu that repeats with one-off changes for a day, and the kitchen's diet list. Parents see the week in the portal; wardens mark who skipped a meal in the staff app."
      />
      <HostelNav current="/hostel/mess" permissions={me.permissions} />
      <Notice params={sp} />
      {!hostel ? (
        <p>Set up a hostel first.</p>
      ) : (
        <>
          <form method="get" className="ep-hd__row" style={{ marginBottom: 'var(--sp-3)' }}>
            <input type="hidden" name="tab" value={tab} />
            <label className="ep-field" htmlFor="ms-hostel">
              <span className="ep-field__label">Hostel</span>
              <select id="ms-hostel" name="hostel" className="ep-select" defaultValue={hostel.id}>
                {hostels.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit" variant="secondary">
              Show
            </Button>
          </form>
          <nav className="ep-tabs-links" aria-label="Mess" style={{ marginBottom: 'var(--sp-4)' }}>
            {TABS.map(([k, label]) => (
              <a
                key={k}
                href={`/hostel/mess?tab=${k}&hostel=${hostel.id}`}
                aria-current={k === tab ? 'page' : undefined}
              >
                {label}
              </a>
            ))}
          </nav>

          {tab === 'week' && week ? (
            <Card
              title={`Week of ${dayName(week.weekOf)}`}
              actions={
                <span style={{ display: 'flex', gap: 'var(--sp-2)' }}>
                  <a
                    className="ep-btn ep-btn--ghost ep-btn--sm"
                    href={`/hostel/mess?tab=week&hostel=${hostel.id}&week=${shift(week.weekOf, -7)}`}
                  >
                    Previous week
                  </a>
                  <a
                    className="ep-btn ep-btn--ghost ep-btn--sm"
                    href={`/hostel/mess?tab=week&hostel=${hostel.id}&week=${shift(week.weekOf, 7)}`}
                  >
                    Next week
                  </a>
                </span>
              }
            >
              {week.meals.length === 0 ? (
                <p className="ep-field__help">No meals yet: add them under Meals.</p>
              ) : (
                <>
                  <div className="ep-table-wrap">
                    <table className="ep-table ep-table--dense">
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
                            <th scope="row">
                              {dayName(d.date)}
                              {d.date === today ? ' · today' : ''}
                            </th>
                            {d.meals.map((m) => (
                              <td key={m.mealId}>
                                {m.items ?? '—'}
                                {m.changed ? (
                                  <span style={{ display: 'block' }}>
                                    <Badge tone="info">Changed{m.note ? `: ${m.note}` : ''}</Badge>
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
                      <input type="hidden" name="returnTo" value={here()} />
                      <label className="ep-field" htmlFor="mc-day">
                        <span className="ep-field__label">Change for a day</span>
                        <input
                          id="mc-day"
                          name="onDate"
                          type="date"
                          className="ep-input"
                          required
                          defaultValue={today}
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
                        <span className="ep-field__label">Served (empty = weekly menu)</span>
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
          ) : null}

          {tab === 'menu' && week ? (
            <Card title="Weekly menu (repeats every week)">
              {week.meals.length === 0 ? (
                <p className="ep-field__help">No meals yet: add them under Meals.</p>
              ) : (
                <form action={saveMenuWeek}>
                  <input type="hidden" name="hostelId" value={hostel.id} />
                  <input type="hidden" name="returnTo" value={here()} />
                  <div className="ep-table-wrap">
                    <table className="ep-table ep-table--dense">
                      <thead>
                        <tr>
                          <th scope="col">Day</th>
                          {week.meals.map((m) => (
                            <th key={m.id} scope="col">
                              {m.name}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {[1, 2, 3, 4, 5, 6, 0].map((wd) => {
                          const day = week.days.find((d) => d.weekday === wd)!;
                          return (
                            <tr key={wd}>
                              <th scope="row">{DAYS[wd]}</th>
                              {week.meals.map((m) => (
                                <td key={m.id}>
                                  <label
                                    className="ep-sr-only"
                                    htmlFor={`wm-${m.id}-${String(wd)}`}
                                  >
                                    {DAYS[wd]} {m.name}
                                  </label>
                                  <textarea
                                    id={`wm-${m.id}-${String(wd)}`}
                                    name={`m-${m.id}-${String(wd)}`}
                                    className="ep-input"
                                    rows={2}
                                    maxLength={500}
                                    disabled={!canEdit}
                                    defaultValue={
                                      day.meals.find((x) => x.mealId === m.id)?.weekly ?? ''
                                    }
                                  />
                                </td>
                              ))}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {canEdit ? (
                    <div style={{ marginTop: 'var(--sp-3)' }}>
                      <Button type="submit">Save the weekly menu</Button>
                    </div>
                  ) : null}
                </form>
              )}
            </Card>
          ) : null}

          {tab === 'diets' ? (
            <Card title={`Diet list · ${String(diets.length)} boarder(s)`}>
              {!canEdit ? (
                <p className="ep-field__help">Needs the mess right (hostel.mess.manage).</p>
              ) : (
                <>
                  <p className="ep-field__help">
                    {Object.entries(DIET)
                      .map(
                        ([k, label]) => [label, diets.filter((d) => d.diet === k).length] as const,
                      )
                      .filter(([, n]) => n)
                      .map(([label, n]) => `${label}: ${String(n)}`)
                      .join(' · ')}
                    . Wardens set each boarder’s diet in the staff app; the allergy is the one on
                    the student record.
                  </p>
                  <div className="ep-table-wrap">
                    <table className="ep-table ep-table--dense">
                      <thead>
                        <tr>
                          <th scope="col">Boarder</th>
                          <th scope="col">Room</th>
                          <th scope="col">Diet</th>
                          <th scope="col">Allergy / note</th>
                        </tr>
                      </thead>
                      <tbody>
                        {diets.map((d) => (
                          <tr key={d.studentId}>
                            <td>
                              {d.name} <small className="ep-field__help">{d.admissionNo}</small>
                            </td>
                            <td>{d.room}</td>
                            <td>
                              {DIET[d.diet] ?? d.diet}
                              {d.noOnionGarlic ? ' · no onion-garlic' : ''}
                            </td>
                            <td>
                              {d.allergy ? <Badge tone="danger">{d.allergy}</Badge> : null}{' '}
                              {d.notes ?? ''}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </Card>
          ) : null}

          {tab === 'meals' ? (
            <Card title={`Meals of ${hostel.name}`}>
              {meals.map((m) => (
                <form
                  key={m.id}
                  action={saveMeal}
                  className="ep-hd__row"
                  style={{ marginBottom: 'var(--sp-2)' }}
                >
                  <input type="hidden" name="id" value={m.id} />
                  <input type="hidden" name="hostelId" value={hostel.id} />
                  <input type="hidden" name="returnTo" value={here()} />
                  <label className="ep-field" htmlFor={`ml-n-${m.id}`}>
                    <span className="ep-field__label">Meal</span>
                    <input
                      id={`ml-n-${m.id}`}
                      name="name"
                      className="ep-input"
                      required
                      maxLength={40}
                      defaultValue={m.name}
                      disabled={!canSetup}
                    />
                  </label>
                  <label className="ep-field" htmlFor={`ml-t-${m.id}`}>
                    <span className="ep-field__label">Time</span>
                    <input
                      id={`ml-t-${m.id}`}
                      name="atTime"
                      type="time"
                      className="ep-input"
                      required
                      defaultValue={m.atTime}
                      disabled={!canSetup}
                    />
                  </label>
                  <label
                    className="ep-field"
                    htmlFor={`ml-a-${m.id}`}
                    style={{ alignSelf: 'center' }}
                  >
                    <span>
                      <input
                        id={`ml-a-${m.id}`}
                        name="active"
                        type="checkbox"
                        defaultChecked={m.active}
                        disabled={!canSetup}
                      />{' '}
                      Served
                    </span>
                  </label>
                  {canSetup ? (
                    <Button type="submit" variant="secondary">
                      Save
                    </Button>
                  ) : null}
                  {m.markedToday ? <Badge tone="success">Marked today</Badge> : null}
                </form>
              ))}
              {canSetup ? (
                <form action={saveMeal} className="ep-hd__row" style={{ marginTop: 'var(--sp-3)' }}>
                  <input type="hidden" name="hostelId" value={hostel.id} />
                  <input type="hidden" name="returnTo" value={here()} />
                  <label className="ep-field" htmlFor="ml-new">
                    <span className="ep-field__label">New meal</span>
                    <input
                      id="ml-new"
                      name="name"
                      className="ep-input"
                      required
                      maxLength={40}
                      placeholder="e.g. Breakfast"
                    />
                  </label>
                  <label className="ep-field" htmlFor="ml-newt">
                    <span className="ep-field__label">Time</span>
                    <input
                      id="ml-newt"
                      name="atTime"
                      type="time"
                      className="ep-input"
                      required
                      defaultValue="08:00"
                    />
                  </label>
                  <Button type="submit">Add</Button>
                </form>
              ) : null}
            </Card>
          ) : null}
        </>
      )}
    </>
  );
}
