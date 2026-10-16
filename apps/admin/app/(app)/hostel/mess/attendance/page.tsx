import { Badge, Button, Card } from '@edupro/ui';
import { HostelPicker, MessHeader } from '@/components/hostel/MessHeader';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { saveMealAttendance } from '@/lib/mess-actions';
import { isDate, istToday, messHostels } from '@/lib/mess';

interface Roll {
  meal: { id: string; hostel: string; name: string; atTime: string };
  on: string;
  marked: { at: string; served: number } | null;
  pupils: Array<{
    studentId: string;
    name: string;
    admissionNo: string;
    room: string;
    away: boolean;
    skipped: boolean;
    reason: string | null;
    dietName: string;
    noOnionGarlic: boolean;
    allergies: string[];
    allergy: string | null;
  }>;
}

/**
 * Hostel → Mess → Meal attendance: everyone holding a bed has the meal; tick who skipped it (with why).
 * Pupils away on hostel leave at the meal's time are left out by themselves. The staff app does the same.
 */
export default async function MessAttendancePage({
  searchParams,
}: {
  searchParams: Promise<{
    hostel?: string;
    on?: string;
    meal?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  const { hostels, hostel } = await messHostels(sp.hostel);
  const today = istToday();
  const on = isDate(sp.on) && sp.on! <= today ? sp.on! : today;
  const meals = hostel
    ? (
        await apiFetch<{
          data: Array<{ id: string; name: string; atTime: string; active: boolean }>;
        }>(`/hostel/meals?hostelId=${hostel.id}`)
      ).data.filter((m) => m.active)
    : [];
  // the meal asked for, else the last one already served today
  const now = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(11, 16);
  const meal =
    meals.find((m) => m.id === sp.meal) ??
    [...meals].reverse().find((m) => on < today || m.atTime <= now) ??
    meals[0];
  let roll: Roll | null = null;
  let problem = '';
  if (meal)
    try {
      roll = await apiFetch<Roll>(`/hostel/meal-roll?mealId=${meal.id}&on=${on}`);
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      problem =
        error.status === 403
          ? 'You are not a warden of this hostel.'
          : 'The meal could not be read.';
    }
  const here = `/hostel/mess/attendance?hostel=${hostel?.id ?? ''}&on=${on}&meal=${meal?.id ?? ''}`;
  const away = roll?.pupils.filter((p) => p.away).length ?? 0;
  return (
    <>
      <MessHeader
        current="attendance"
        permissions={me.permissions}
        hostelId={hostel?.id}
        sp={sp}
        description="Everyone holding a bed has the meal: tick only who skipped it. Pupils out on hostel leave at the meal’s time are left out by themselves."
      />
      {!hostel ? (
        <Card>Set up a hostel first.</Card>
      ) : (
        <>
          <HostelPicker hostels={hostels} hostelId={hostel.id}>
            <label className="ep-field" htmlFor="ma-on">
              <span className="ep-field__label">Day</span>
              <input
                id="ma-on"
                name="on"
                type="date"
                className="ep-input"
                defaultValue={on}
                max={today}
              />
            </label>
            <label className="ep-field" htmlFor="ma-meal">
              <span className="ep-field__label">Meal</span>
              <select id="ma-meal" name="meal" className="ep-select" defaultValue={meal?.id ?? ''}>
                {meals.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.atTime})
                  </option>
                ))}
              </select>
            </label>
          </HostelPicker>
          {!meal ? (
            <Card>This hostel serves no meal yet: tick it on a meal under Mess → Set-up.</Card>
          ) : !roll ? (
            <Card>{problem}</Card>
          ) : (
            <Card
              title={`${roll.meal.name} · ${roll.meal.hostel} · ${on.split('-').reverse().join('-')}`}
              actions={
                roll.marked ? (
                  <Badge tone="success">Marked · {roll.marked.served} had it</Badge>
                ) : (
                  <Badge tone="warning">Not marked yet</Badge>
                )
              }
            >
              {roll.pupils.length === 0 ? (
                <p>Nobody holds a bed in this hostel on this day.</p>
              ) : (
                <form action={saveMealAttendance}>
                  <input type="hidden" name="mealId" value={roll.meal.id} />
                  <input type="hidden" name="on" value={on} />
                  <input type="hidden" name="returnTo" value={here} />
                  <p className="ep-field__help" style={{ marginTop: 0 }}>
                    {roll.pupils.length} boarder(s){away ? ` · ${String(away)} away on leave` : ''}.
                  </p>
                  <div
                    className="ep-table-wrap"
                    tabIndex={0}
                    role="region"
                    aria-label="Meal attendance"
                  >
                    <table className="ep-table ep-table--dense">
                      <caption className="ep-sr-only">Who skipped {roll.meal.name}</caption>
                      <thead>
                        <tr>
                          <th scope="col">Pupil</th>
                          <th scope="col">Room</th>
                          <th scope="col">Diet</th>
                          <th scope="col">Skipped</th>
                          <th scope="col">Why</th>
                        </tr>
                      </thead>
                      <tbody>
                        {roll.pupils.map((p) => (
                          <tr key={p.studentId}>
                            <td>
                              <strong>{p.name}</strong>
                              <div className="ep-field__help">{p.admissionNo}</div>
                            </td>
                            <td>{p.room}</td>
                            <td>
                              {p.dietName}
                              {p.noOnionGarlic ? ' · no onion-garlic' : ''}
                              {[...p.allergies, ...(p.allergy ? [p.allergy] : [])].map((a) => (
                                <span key={a} style={{ display: 'block' }}>
                                  <Badge tone="danger">{a}</Badge>
                                </span>
                              ))}
                            </td>
                            {p.away ? (
                              <td colSpan={2}>
                                <Badge tone="info">Away on hostel leave</Badge>
                              </td>
                            ) : (
                              <>
                                <td>
                                  <label className="ep-check" htmlFor={`sk-${p.studentId}`}>
                                    <input
                                      id={`sk-${p.studentId}`}
                                      type="checkbox"
                                      name="skip"
                                      value={p.studentId}
                                      defaultChecked={p.skipped}
                                    />{' '}
                                    <span className="ep-sr-only">{p.name} </span>Skipped
                                  </label>
                                </td>
                                <td>
                                  <label className="ep-sr-only" htmlFor={`rs-${p.studentId}`}>
                                    Why {p.name} skipped
                                  </label>
                                  <input
                                    id={`rs-${p.studentId}`}
                                    name={`reason-${p.studentId}`}
                                    className="ep-input"
                                    maxLength={120}
                                    defaultValue={p.reason ?? ''}
                                    placeholder="e.g. Fasting, sick bay"
                                  />
                                </td>
                              </>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {me.permissions.includes('hostel.mess.manage') ? (
                    <div style={{ marginTop: 'var(--sp-3)' }}>
                      <Button type="submit">Save the meal</Button>
                    </div>
                  ) : null}
                </form>
              )}
            </Card>
          )}
        </>
      )}
    </>
  );
}
