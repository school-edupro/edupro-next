import { Badge, Button, Card } from '@edupro/ui';
import { MessHeader } from '@/components/hostel/MessHeader';
import { apiFetch, getMe } from '@/lib/api';
import { deleteMessMeal, orderMessMeals, saveDietTypes, saveMessMeal } from '@/lib/mess-actions';
import type { DietLists } from '@/lib/mess';

interface MessMeal {
  id: string;
  name: string;
  atTime: string;
  sortOrder: number;
  active: boolean;
  hostels: Array<{
    mealId: string;
    hostelId: string;
    hostel: string;
    atTime: string;
    active: boolean;
    used: boolean;
  }>;
}
const HERE = '/hostel/mess/setup';

/**
 * Hostel → Mess → Set-up: the school's meals (each ticked for the hostels that serve it, a hostel may keep
 * its own time; delete only a meal never served), and the school's diet types and allergies.
 */
export default async function MessSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  const canSetup = me.permissions.includes('hostel.setup.manage');
  const [{ meals, hostels }, lists] = await Promise.all([
    apiFetch<{ meals: MessMeal[]; hostels: Array<{ id: string; name: string }> }>(
      '/hostel/mess/meals',
    ),
    me.permissions.includes('hostel.mess.manage')
      ? apiFetch<DietLists>('/hostel/mess/diet-types')
      : Promise.resolve(null),
  ]);
  const order = (i: number, by: number) => {
    const ids = meals.map((m) => m.id);
    const j = i + by;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    return ids.join(',');
  };
  const mealForm = (m: MessMeal | null) => {
    const key = m?.id ?? 'new';
    return (
      <form action={saveMessMeal} className="ep-hd__form">
        {m ? <input type="hidden" name="id" value={m.id} /> : null}
        <input type="hidden" name="returnTo" value={HERE} />
        <div className="ep-hd__row">
          <label className="ep-field" htmlFor={`mm-name-${key}`}>
            <span className="ep-field__label">Meal</span>
            <input
              id={`mm-name-${key}`}
              name="name"
              className="ep-input"
              required
              maxLength={40}
              defaultValue={m?.name ?? ''}
              placeholder="e.g. Breakfast"
              disabled={!canSetup}
            />
          </label>
          <label className="ep-field" htmlFor={`mm-time-${key}`}>
            <span className="ep-field__label">Time</span>
            <input
              id={`mm-time-${key}`}
              name="atTime"
              type="time"
              className="ep-input"
              required
              defaultValue={m?.atTime ?? '08:00'}
              disabled={!canSetup}
            />
          </label>
          {m ? (
            <label className="ep-check" htmlFor={`mm-on-${key}`} style={{ alignSelf: 'end' }}>
              <input
                id={`mm-on-${key}`}
                type="checkbox"
                name="active"
                defaultChecked={m.active}
                disabled={!canSetup}
              />{' '}
              In use
            </label>
          ) : null}
        </div>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="ep-field__label">Served in</legend>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-4)' }}>
            {hostels.map((h) => {
              const at = m?.hostels.find((x) => x.hostelId === h.id);
              return (
                <span
                  key={h.id}
                  style={{ display: 'inline-flex', gap: 'var(--sp-2)', alignItems: 'center' }}
                >
                  <label className="ep-check" htmlFor={`mm-h-${key}-${h.id}`}>
                    <input
                      id={`mm-h-${key}-${h.id}`}
                      type="checkbox"
                      name="hostel"
                      value={h.id}
                      defaultChecked={m ? !!at?.active : true}
                      disabled={!canSetup}
                    />{' '}
                    {h.name}
                  </label>
                  <label className="ep-sr-only" htmlFor={`mm-t-${key}-${h.id}`}>
                    Own time in {h.name}
                  </label>
                  <input
                    id={`mm-t-${key}-${h.id}`}
                    name={`t-${h.id}`}
                    type="time"
                    className="ep-input"
                    style={{ width: 'auto' }}
                    defaultValue={at && m && at.atTime !== m.atTime ? at.atTime : ''}
                    title={`Own time in ${h.name} (empty: the meal’s time)`}
                    disabled={!canSetup}
                  />
                </span>
              );
            })}
          </div>
          <p className="ep-field__help" style={{ margin: 'var(--sp-1) 0 0' }}>
            A time next to a hostel is its own time; empty: the meal’s time. Untick a hostel to stop
            serving it there (its menu and marks are kept).
          </p>
        </fieldset>
        {canSetup ? (
          <div>
            <Button type="submit" variant={m ? 'secondary' : 'primary'}>
              {m ? 'Save' : 'Add the meal'}
            </Button>
          </div>
        ) : null}
      </form>
    );
  };
  return (
    <>
      <MessHeader
        current="setup"
        permissions={me.permissions}
        sp={sp}
        description="The school’s meals and the hostels that serve them, and the diet types and allergies the kitchen works with."
      />
      <Card title="Meals" style={{ marginBottom: 'var(--sp-4)' }}>
        {meals.length === 0 ? (
          <p className="ep-field__help">No meal yet: add Breakfast, Lunch, Snacks and Dinner.</p>
        ) : null}
        <ol
          style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 'var(--sp-4)' }}
        >
          {meals.map((m, i) => (
            <li key={m.id} className="ep-card" style={{ padding: 'var(--sp-3)' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 'var(--sp-2)',
                  flexWrap: 'wrap',
                }}
              >
                <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
                  <strong>{m.name}</strong>
                  {m.active ? null : <Badge tone="neutral">Switched off</Badge>}
                </span>
                {canSetup ? (
                  <span style={{ display: 'inline-flex', gap: 'var(--sp-1)' }}>
                    <form action={orderMessMeals}>
                      <input type="hidden" name="ids" value={i > 0 ? order(i, -1) : ''} />
                      <input type="hidden" name="returnTo" value={HERE} />
                      <Button
                        type="submit"
                        variant="ghost"
                        size="sm"
                        disabled={i === 0}
                        aria-label={`Move ${m.name} up`}
                      >
                        ↑
                      </Button>
                    </form>
                    <form action={orderMessMeals}>
                      <input
                        type="hidden"
                        name="ids"
                        value={i < meals.length - 1 ? order(i, 1) : ''}
                      />
                      <input type="hidden" name="returnTo" value={HERE} />
                      <Button
                        type="submit"
                        variant="ghost"
                        size="sm"
                        disabled={i === meals.length - 1}
                        aria-label={`Move ${m.name} down`}
                      >
                        ↓
                      </Button>
                    </form>
                    {m.hostels.some((h) => h.used) ? null : (
                      <form action={deleteMessMeal}>
                        <input type="hidden" name="id" value={m.id} />
                        <input type="hidden" name="returnTo" value={HERE} />
                        <Button
                          type="submit"
                          variant="ghost"
                          size="sm"
                          aria-label={`Delete ${m.name}`}
                        >
                          Delete
                        </Button>
                      </form>
                    )}
                  </span>
                ) : null}
              </div>
              {mealForm(m)}
            </li>
          ))}
        </ol>
        {canSetup ? (
          <div className="ep-card" style={{ padding: 'var(--sp-3)', marginTop: 'var(--sp-4)' }}>
            <h3 className="ep-cdash__h3" style={{ marginTop: 0 }}>
              New meal
            </h3>
            {mealForm(null)}
          </div>
        ) : null}
      </Card>
      {lists ? (
        <Card title="Diet types and allergies">
          <form action={saveDietTypes} className="ep-hd__form">
            <input type="hidden" name="returnTo" value={HERE} />
            <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Diet types">
              <table className="ep-table ep-table--dense">
                <caption className="ep-sr-only">Diet types</caption>
                <thead>
                  <tr>
                    <th scope="col">Diet</th>
                    <th scope="col">Code</th>
                    <th scope="col">Default</th>
                    <th scope="col">In use</th>
                    <th scope="col">Boarders</th>
                    <th scope="col">Remove</th>
                  </tr>
                </thead>
                <tbody>
                  {[...lists.types.map((t, i) => ({ t, i: String(i) })), { t: null, i: 'new' }].map(
                    ({ t, i }) => (
                      <tr key={i}>
                        <td>
                          {t ? <input type="hidden" name={`t-${i}-id`} value={t.id} /> : null}
                          <label className="ep-sr-only" htmlFor={`dt-${i}-name`}>
                            {t ? `Name of ${t.name}` : 'New diet'}
                          </label>
                          <input
                            id={`dt-${i}-name`}
                            name={`t-${i}-name`}
                            className="ep-input"
                            maxLength={40}
                            defaultValue={t?.name ?? ''}
                            placeholder={t ? undefined : 'New diet, e.g. Sattvic'}
                            disabled={!canSetup}
                          />
                        </td>
                        <td>
                          <label className="ep-sr-only" htmlFor={`dt-${i}-code`}>
                            Code
                          </label>
                          <input
                            id={`dt-${i}-code`}
                            name={`t-${i}-code`}
                            className="ep-input"
                            maxLength={30}
                            pattern="[a-z][a-z0-9_]{0,29}"
                            defaultValue={t?.code ?? ''}
                            placeholder={t ? undefined : 'made from the name'}
                            readOnly={!!t?.used}
                            disabled={!canSetup}
                          />
                        </td>
                        <td>
                          <label className="ep-check" htmlFor={`dt-${i}-def`}>
                            <input
                              id={`dt-${i}-def`}
                              type="radio"
                              name="default"
                              value={i}
                              defaultChecked={!!t?.isDefault}
                              disabled={!canSetup}
                            />
                            <span className="ep-sr-only"> Default</span>
                          </label>
                        </td>
                        <td>
                          {t ? (
                            <label className="ep-check" htmlFor={`dt-${i}-on`}>
                              <input
                                id={`dt-${i}-on`}
                                type="checkbox"
                                name={`t-${i}-active`}
                                defaultChecked={t.active}
                                disabled={!canSetup}
                              />
                              <span className="ep-sr-only"> {t.name} in use</span>
                            </label>
                          ) : null}
                        </td>
                        <td>{t ? t.used : ''}</td>
                        <td>
                          {t && !t.used && !t.isDefault ? (
                            <label className="ep-check" htmlFor={`dt-${i}-rm`}>
                              <input
                                id={`dt-${i}-rm`}
                                type="checkbox"
                                name={`remove-t-${i}`}
                                disabled={!canSetup}
                              />
                              <span className="ep-sr-only"> Remove {t.name}</span>
                            </label>
                          ) : null}
                        </td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
            <p className="ep-field__help" style={{ margin: 0 }}>
              The default is the diet of a boarder nobody has set. A diet some boarders have can be
              switched off, not removed.
            </p>
            <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="ep-field__label">Allergies the kitchen must know</legend>
              <div
                style={{
                  display: 'grid',
                  gap: 'var(--sp-2)',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(16rem, 1fr))',
                }}
              >
                {[
                  ...lists.allergies.map((a, i) => ({ a, i: String(i) })),
                  { a: null, i: 'new' },
                ].map(({ a, i }) => (
                  <span
                    key={i}
                    style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}
                  >
                    {a ? <input type="hidden" name={`a-${i}-id`} value={a.id} /> : null}
                    <label className="ep-sr-only" htmlFor={`al-${i}-name`}>
                      {a ? `Allergy ${a.name}` : 'New allergy'}
                    </label>
                    <input
                      id={`al-${i}-name`}
                      name={`a-${i}-name`}
                      className="ep-input"
                      maxLength={40}
                      defaultValue={a?.name ?? ''}
                      placeholder={a ? undefined : 'New allergy'}
                      disabled={!canSetup}
                    />
                    {a ? (
                      <>
                        <label className="ep-check" htmlFor={`al-${i}-on`} title="In use">
                          <input
                            id={`al-${i}-on`}
                            type="checkbox"
                            name={`a-${i}-active`}
                            defaultChecked={a.active}
                            disabled={!canSetup}
                          />
                          <span className="ep-sr-only"> {a.name} in use</span>
                        </label>
                        {a.used ? (
                          <Badge tone="neutral">{a.used}</Badge>
                        ) : (
                          <label className="ep-check" htmlFor={`al-${i}-rm`} title="Remove">
                            <input
                              id={`al-${i}-rm`}
                              type="checkbox"
                              name={`remove-a-${i}`}
                              disabled={!canSetup}
                            />
                            <span className="ep-sr-only"> Remove {a.name}</span>
                          </label>
                        )}
                      </>
                    ) : null}
                  </span>
                ))}
              </div>
              <p className="ep-field__help" style={{ margin: 'var(--sp-1) 0 0' }}>
                First tick: in use. Second tick: remove (only an allergy no boarder has; the number
                is how many have it).
              </p>
            </fieldset>
            {canSetup ? (
              <div>
                <Button type="submit">Save diet types and allergies</Button>
              </div>
            ) : null}
          </form>
        </Card>
      ) : null}
    </>
  );
}
