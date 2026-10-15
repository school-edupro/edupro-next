import { Badge, Button, Card, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { ChildSwitch } from '@/components/ChildSwitch';
import { chosenChild } from '@/lib/child';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import { addVisitor, removeVisitor } from './actions';

interface Visitors {
  onRecord: Array<{ name: string; relation: string; mobile: string | null }>;
  visitors: Array<{
    id: string;
    name: string;
    relation: string;
    mobile: string;
    status: 'pending' | 'approved' | 'rejected';
    note: string | null;
    hasPhoto: boolean;
  }>;
}
interface Menu {
  hostel: { id: string; name: string } | null;
  diet: { diet: string; noOnionGarlic: boolean; notes: string | null } | null;
  week: {
    weekOf: string;
    meals: Array<{ id: string; name: string; atTime: string }>;
    days: Array<{
      date: string;
      meals: Array<{ mealId: string; items: string | null; changed: boolean; note: string | null }>;
    }>;
  } | null;
}

const DIET: Record<string, string> = {
  veg: 'Vegetarian',
  non_veg: 'Non-vegetarian',
  eggetarian: 'Vegetarian with egg',
  jain: 'Jain',
  vegan: 'Vegan',
};
const STATUS: Record<string, [string, 'success' | 'warning' | 'danger']> = {
  approved: ['Approved', 'success'],
  pending: ['Waiting for the warden', 'warning'],
  rejected: ['Not approved', 'danger'],
};

/** The child's hostel for the family: who may visit (the approved list) and this week's mess menu. */
export default async function HostelPage({
  searchParams,
}: {
  searchParams: Promise<{
    student?: string;
    ok?: string;
    error?: string;
    detail?: string;
    week?: string;
  }>;
}) {
  const sp = await searchParams;
  const lang = await currentLang();
  const kid = await chosenChild(sp.student);
  if (!kid) redirect('/');
  let menu: Menu;
  let visitors: Visitors | null = null;
  try {
    menu = await bff.api.fetch<Menu>(
      `/hostel/mine/menu?studentId=${kid.id}${/^\d{4}-\d{2}-\d{2}$/.test(sp.week ?? '') ? `&weekOf=${sp.week}` : ''}`,
    );
    if (menu.hostel)
      visitors = await bff.api.fetch<Visitors>(`/hostel/mine/visitors?studentId=${kid.id}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && error.status === 403) redirect('/');
    throw error;
  }
  const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  const shift = (n: number) => {
    const d = new Date(`${menu.week?.weekOf ?? today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const dayName = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString(lang === 'hi' ? 'hi-IN' : 'en-IN', {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      timeZone: 'UTC',
    });
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 820, margin: '0 auto' }}>
      <PageHeader
        kicker={t(lang, 'Hostel')}
        title={menu.hostel ? menu.hostel.name : t(lang, 'Hostel')}
        description={t(lang, 'Who may visit your child in the hostel, and this week’s mess menu.')}
      />
      <ChildSwitch lang={lang} back="/hostel" current={kid.id} />
      {sp.ok ? (
        <div
          className="ep-alert ep-alert--success"
          role="status"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {t(
            lang,
            sp.ok === 'removed'
              ? 'Removed from the list.'
              : 'Added. The warden will approve the visitor.',
          )}
        </div>
      ) : null}
      {sp.error ? (
        <div
          className="ep-alert ep-alert--danger"
          role="alert"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {sp.detail || sp.error}
        </div>
      ) : null}
      {!menu.hostel ? (
        <Card>{t(lang, 'Your child does not board in the hostel.')}</Card>
      ) : (
        <>
          <Card title={t(lang, 'Approved visitors')} style={{ marginBottom: 'var(--sp-4)' }}>
            <p className="ep-field__help">
              {t(
                lang,
                'Only people on this list may visit your child, in the hostel’s visiting hours. Anyone else waits at the gate for the warden, and you are told.',
              )}
            </p>
            <ul className="fp-rcpts">
              {visitors?.onRecord.map((g) => (
                <li key={`r-${g.relation}-${g.mobile ?? ''}`}>
                  <span>
                    <strong>{g.name}</strong>
                    <span className="ep-field__help" style={{ display: 'block' }}>
                      {t(
                        lang,
                        g.relation.replace(/^\w/, (c) => c.toUpperCase()),
                      )}{' '}
                      · {g.mobile ?? '—'}
                    </span>
                  </span>
                  <Badge tone="success">{t(lang, 'On the school record')}</Badge>
                </li>
              ))}
              {visitors?.visitors.map((v) => (
                <li key={v.id}>
                  <span style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'center' }}>
                    {v.hasPhoto ? (
                      <img
                        src={`/hostel/visitor-photo/${v.id}`}
                        alt={`${v.name}`}
                        width={48}
                        height={48}
                        style={{ objectFit: 'cover', borderRadius: 'var(--radius-sm)' }}
                      />
                    ) : null}
                    <span>
                      <strong>{v.name}</strong>
                      <span className="ep-field__help" style={{ display: 'block' }}>
                        {v.relation} · {v.mobile}
                        {v.note ? ` · ${v.note}` : ''}
                      </span>
                    </span>
                  </span>
                  <span style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
                    <Badge tone={STATUS[v.status]![1]}>{t(lang, STATUS[v.status]![0])}</Badge>
                    <form action={removeVisitor}>
                      <input type="hidden" name="id" value={v.id} />
                      <input type="hidden" name="studentId" value={kid.id} />
                      <Button
                        type="submit"
                        variant="ghost"
                        size="sm"
                        aria-label={`${t(lang, 'Remove')} ${v.name}`}
                      >
                        {t(lang, 'Remove')}
                      </Button>
                    </form>
                  </span>
                </li>
              ))}
            </ul>
            <form
              action={addVisitor}
              style={{ display: 'grid', gap: 'var(--sp-3)', marginTop: 'var(--sp-4)' }}
            >
              <h3 className="ep-field__label" style={{ margin: 0 }}>
                {t(lang, 'Add a visitor')}
              </h3>
              <input type="hidden" name="studentId" value={kid.id} />
              <label className="ep-field" htmlFor="hv-name">
                <span className="ep-field__label">{t(lang, 'Name')} *</span>
                <input
                  id="hv-name"
                  name="name"
                  className="ep-input"
                  required
                  minLength={2}
                  maxLength={120}
                />
              </label>
              <label className="ep-field" htmlFor="hv-rel">
                <span className="ep-field__label">{t(lang, 'Relation to the child')} *</span>
                <input
                  id="hv-rel"
                  name="relation"
                  className="ep-input"
                  required
                  minLength={2}
                  maxLength={60}
                />
              </label>
              <label className="ep-field" htmlFor="hv-mob">
                <span className="ep-field__label">{t(lang, 'Mobile')} *</span>
                <input
                  id="hv-mob"
                  name="mobile"
                  className="ep-input"
                  required
                  inputMode="numeric"
                  pattern="[6-9][0-9]{9}"
                  maxLength={10}
                />
              </label>
              <label className="ep-field" htmlFor="hv-photo">
                <span className="ep-field__label">{t(lang, 'Photo (helps the gate)')}</span>
                <input
                  id="hv-photo"
                  name="photo"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                />
                <span className="ep-field__help">{t(lang, 'A JPEG or PNG under 300 KB.')}</span>
              </label>
              <div>
                <Button type="submit">{t(lang, 'Add to the list')}</Button>
              </div>
            </form>
          </Card>

          <Card
            title={`${t(lang, 'Mess menu')} · ${t(lang, 'week of')} ${menu.week ? dayName(menu.week.weekOf) : ''}`}
            actions={
              <span style={{ display: 'flex', gap: 'var(--sp-2)' }}>
                <a
                  className="ep-btn ep-btn--ghost ep-btn--sm"
                  href={`/hostel?student=${kid.id}&week=${shift(-7)}`}
                >
                  {t(lang, 'Previous week')}
                </a>
                <a
                  className="ep-btn ep-btn--ghost ep-btn--sm"
                  href={`/hostel?student=${kid.id}&week=${shift(7)}`}
                >
                  {t(lang, 'Next week')}
                </a>
              </span>
            }
          >
            {menu.diet ? (
              <p>
                <Badge tone="info">
                  {t(lang, DIET[menu.diet.diet] ?? menu.diet.diet)}
                  {menu.diet.noOnionGarlic ? ` · ${t(lang, 'no onion or garlic')}` : ''}
                </Badge>{' '}
                {menu.diet.notes ? <span className="ep-field__help">{menu.diet.notes}</span> : null}
              </p>
            ) : null}
            {!menu.week || menu.week.meals.length === 0 ? (
              <p className="ep-field__help">{t(lang, 'The hostel has not put up its menu yet.')}</p>
            ) : (
              <div className="ep-table-wrap">
                <table className="ep-table ep-table--dense">
                  <thead>
                    <tr>
                      <th scope="col">{t(lang, 'Day')}</th>
                      {menu.week.meals.map((m) => (
                        <th key={m.id} scope="col">
                          {t(lang, m.name)} <small className="ep-field__help">{m.atTime}</small>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {menu.week.days.map((d) => (
                      <tr key={d.date} aria-current={d.date === today ? 'date' : undefined}>
                        <th scope="row">
                          {dayName(d.date)}
                          {d.date === today ? ` · ${t(lang, 'today')}` : ''}
                        </th>
                        {d.meals.map((m) => (
                          <td key={m.mealId}>
                            {m.items ?? '—'}
                            {m.changed ? (
                              <small className="ep-field__help" style={{ display: 'block' }}>
                                {t(lang, 'Special')}
                                {m.note ? `: ${m.note}` : ''}
                              </small>
                            ) : null}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </main>
  );
}
