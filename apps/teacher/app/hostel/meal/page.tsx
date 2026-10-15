import { Badge, Button, Card, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import { saveMeal } from '../actions';

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
    diet: string;
    noOnionGarlic: boolean;
    allergy: string | null;
  }>;
}
const DIET: Record<string, string> = {
  veg: 'Veg',
  non_veg: 'Non-veg',
  eggetarian: 'Egg',
  jain: 'Jain',
  vegan: 'Vegan',
};

/** Who skipped a meal: tick them; everyone else holding a bed and not away on leave had it. */
export default async function MealPage({
  searchParams,
}: {
  searchParams: Promise<{
    mealId?: string;
    on?: string;
    ok?: string;
    detail?: string;
    error?: string;
  }>;
}) {
  const sp = await searchParams;
  const lang = await currentLang();
  if (!/^\d{1,18}$/.test(sp.mealId ?? '')) redirect('/hostel');
  let roll: Roll;
  try {
    roll = await bff.api.fetch<Roll>(
      `/hostel/meal-roll?mealId=${sp.mealId}${/^\d{4}-\d{2}-\d{2}$/.test(sp.on ?? '') ? `&on=${sp.on}` : ''}`,
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && (error.status === 403 || error.status === 404))
      redirect('/hostel');
    throw error;
  }
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 820, margin: '0 auto' }}>
      <PageHeader
        kicker={roll.meal.hostel}
        title={`${t(lang, roll.meal.name)} · ${roll.on.split('-').reverse().join('-')}`}
        description={t(
          lang,
          'Tick who skipped the meal. Everyone else in the hostel and not away on leave had it.',
        )}
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/hostel">
            {t(lang, 'Hostel desk')}
          </a>
        }
      />
      {sp.ok ? (
        <div
          className="ep-alert ep-alert--success"
          role="status"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {sp.detail ?? t(lang, 'Saved.')}
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
      {roll.pupils.length === 0 ? (
        <Card>{t(lang, 'Nobody holds a bed in this hostel on that day.')}</Card>
      ) : (
        <form action={saveMeal}>
          <input type="hidden" name="mealId" value={roll.meal.id} />
          <input type="hidden" name="on" value={roll.on} />
          <ul className="fp-pay__list">
            {roll.pupils.map((p) => (
              <li key={p.studentId} className="fp-pay__row">
                {p.away ? (
                  <span className="fp-pay__tick" aria-hidden="true" />
                ) : (
                  <input
                    id={`sk-${p.studentId}`}
                    type="checkbox"
                    name="skip"
                    value={p.studentId}
                    className="fp-pay__tick"
                    defaultChecked={p.skipped}
                    aria-label={`${t(lang, 'Skipped')} · ${p.name}`}
                  />
                )}
                <label htmlFor={p.away ? undefined : `sk-${p.studentId}`} className="fp-pay__what">
                  <strong>{p.name}</strong>
                  <span className="ep-field__help">
                    {p.admissionNo} · {t(lang, 'Room')} {p.room}
                  </span>
                  {p.allergy ? <span className="ep-field__error">{p.allergy}</span> : null}
                </label>
                <span className="fp-pay__amt">
                  <Badge tone="info">
                    {DIET[p.diet] ?? p.diet}
                    {p.noOnionGarlic ? ' · no onion-garlic' : ''}
                  </Badge>
                  {p.away ? <Badge tone="neutral">{t(lang, 'On leave')}</Badge> : null}
                  {!p.away ? (
                    <>
                      <label className="ep-sr-only" htmlFor={`r-${p.studentId}`}>
                        {t(lang, 'Reason')} · {p.name}
                      </label>
                      <input
                        id={`r-${p.studentId}`}
                        name={`r-${p.studentId}`}
                        className="ep-input"
                        placeholder={t(lang, 'Reason')}
                        defaultValue={p.reason ?? ''}
                        maxLength={120}
                      />
                    </>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
          <div className="fp-pay__bar">
            <span>
              {roll.marked
                ? `${t(lang, 'Marked')}: ${String(roll.marked.served)} ${t(lang, 'had the meal')}`
                : t(lang, 'Not marked yet')}
            </span>
            <Button type="submit">{t(lang, 'Save')}</Button>
          </div>
        </form>
      )}
    </main>
  );
}
