import { Button, Card, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import { saveRollcall } from '../actions';

interface Roll {
  session: { id: string; hostel: string; name: string; atTime: string };
  on: string;
  taken: { at: string; by: string | null } | null;
  pupils: Array<{
    studentId: string;
    name: string;
    admissionNo: string;
    room: string;
    bed: string;
    away: string | null;
    due: string | null;
    status: 'present' | 'absent' | 'on_leave' | 'sick';
    note: string | null;
  }>;
}

/** The roll of one session: every pupil holding a bed, present unless ticked otherwise; away on leave fixed. */
export default async function RollcallPage({
  searchParams,
}: {
  searchParams: Promise<{
    sessionId?: string;
    on?: string;
    ok?: string;
    detail?: string;
    error?: string;
  }>;
}) {
  const sp = await searchParams;
  const lang = await currentLang();
  if (!/^\d{1,18}$/.test(sp.sessionId ?? '')) redirect('/hostel');
  let roll: Roll;
  try {
    roll = await bff.api.fetch<Roll>(
      `/hostel/rollcall?sessionId=${sp.sessionId}${/^\d{4}-\d{2}-\d{2}$/.test(sp.on ?? '') ? `&on=${sp.on}` : ''}`,
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && (error.status === 403 || error.status === 404))
      redirect('/hostel');
    throw error;
  }
  const STATUS = [
    ['present', 'Present'],
    ['absent', 'Absent'],
    ['sick', 'Sick bay'],
  ] as const;
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 820, margin: '0 auto' }}>
      <PageHeader
        kicker={roll.session.hostel}
        title={`${roll.session.name} ${t(lang, 'roll-call')} · ${roll.on.split('-').reverse().join('-')}`}
        description={
          roll.taken
            ? `${t(lang, 'Taken by')} ${roll.taken.by ?? '—'}. ${t(lang, 'You can correct it and save again.')}`
            : t(
                lang,
                'Everyone is present unless you mark otherwise. Pupils away on leave are marked by the system.',
              )
        }
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
      <form
        method="get"
        style={{
          display: 'flex',
          gap: 'var(--sp-2)',
          alignItems: 'end',
          marginBottom: 'var(--sp-3)',
        }}
      >
        <input type="hidden" name="sessionId" value={roll.session.id} />
        <label className="ep-field" htmlFor="rc-on">
          <span className="ep-field__label">{t(lang, 'Day')}</span>
          <input id="rc-on" name="on" type="date" className="ep-input" defaultValue={roll.on} />
        </label>
        <Button type="submit" variant="secondary" size="sm">
          {t(lang, 'Open')}
        </Button>
      </form>
      {roll.pupils.length === 0 ? (
        <Card>{t(lang, 'Nobody holds a bed in this hostel on that day.')}</Card>
      ) : (
        <form action={saveRollcall}>
          <input type="hidden" name="sessionId" value={roll.session.id} />
          <input type="hidden" name="on" value={roll.on} />
          <ul className="fp-pay__list">
            {roll.pupils.map((p) => (
              <li key={p.studentId} className="fp-pay__row" style={{ gridTemplateColumns: '1fr' }}>
                <input type="hidden" name="studentId" value={p.studentId} />
                <div
                  style={{
                    display: 'flex',
                    gap: 'var(--sp-2)',
                    flexWrap: 'wrap',
                    alignItems: 'baseline',
                  }}
                >
                  <strong>{p.name}</strong>
                  <span className="ep-field__help">
                    {p.admissionNo} · {t(lang, 'Room')} {p.room} · {t(lang, 'Bed')} {p.bed}
                  </span>
                  <a
                    className="ep-btn ep-btn--ghost ep-btn--sm"
                    href={`/hostel/sickbay?studentId=${p.studentId}&name=${encodeURIComponent(p.name)}`}
                  >
                    {t(lang, 'Sick bay')}
                  </a>
                  <a
                    className="ep-btn ep-btn--ghost ep-btn--sm"
                    href={`/hostel/incident?studentId=${p.studentId}&name=${encodeURIComponent(p.name)}`}
                  >
                    {t(lang, 'Incident')}
                  </a>
                </div>
                {p.away ? (
                  <p className="ep-field__help" style={{ margin: 0 }}>
                    <input type="hidden" name={`s-${p.studentId}`} value="on_leave" />
                    {t(lang, 'On leave')} ({p.away})
                    {p.due ? ` · ${t(lang, 'back by')} ${p.due}` : ''}
                  </p>
                ) : (
                  <fieldset
                    style={{
                      border: 0,
                      padding: 0,
                      margin: 0,
                      display: 'flex',
                      gap: 'var(--sp-3)',
                      flexWrap: 'wrap',
                    }}
                  >
                    <legend className="ep-sr-only">{p.name}</legend>
                    {STATUS.map(([v, label]) => (
                      <label
                        key={v}
                        style={{ display: 'flex', gap: 'var(--sp-1)', alignItems: 'center' }}
                      >
                        <input
                          type="radio"
                          name={`s-${p.studentId}`}
                          value={v}
                          defaultChecked={p.status === v}
                        />
                        {t(lang, label)}
                      </label>
                    ))}
                    <label className="ep-sr-only" htmlFor={`n-${p.studentId}`}>
                      {t(lang, 'Note')} · {p.name}
                    </label>
                    <input
                      id={`n-${p.studentId}`}
                      name={`n-${p.studentId}`}
                      className="ep-input"
                      placeholder={t(lang, 'Note')}
                      defaultValue={p.note ?? ''}
                      maxLength={200}
                      style={{ flex: 1, minWidth: '8rem' }}
                    />
                  </fieldset>
                )}
              </li>
            ))}
          </ul>
          <div className="fp-pay__bar">
            <span>
              {roll.pupils.length} {t(lang, 'boarders')}
            </span>
            <Button type="submit">{t(lang, 'Save the roll')}</Button>
          </div>
        </form>
      )}
    </main>
  );
}
