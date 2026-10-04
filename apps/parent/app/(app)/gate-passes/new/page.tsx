import { Button, Card, PageHeader } from '@edupro/ui';
import { ApiError } from '@edupro/bff';
import { redirect } from 'next/navigation';
import { chosenChild } from '@/lib/child';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import { dayOf } from '../../appointments/shared';
import { applyGatePass } from '../actions';

interface Options {
  data: Array<{
    id: string;
    name: string;
    guardians: Array<{ relation: string; name: string }>;
  }>;
}

/**
 * A guardian asks for a gate pass, a step at a time: which child, leaving early or arriving late, when and
 * why, and who takes the child (father, mother or guardian on the school's record, or someone else, who
 * is then confirmed with a one-time code to the parent at the front desk).
 */
export default async function NewGatePassPage({
  searchParams,
}: {
  searchParams: Promise<{ student?: string; kind?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const lang = await currentLang();
  let options: Options;
  try {
    options = await bff.api.fetch<Options>('/gate-passes/mine/options');
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && error.status === 403) redirect('/gate-passes');
    throw error;
  }
  const chosen = await chosenChild(sp.student);
  const student =
    options.data.find((s) => s.id === chosen?.id) ??
    (options.data.length === 1 ? options.data[0]! : null);
  const kind =
    sp.kind === 'late_arrival' ? 'late_arrival' : sp.kind === 'early_leave' ? 'early_leave' : null;
  const today = dayOf(new Date().toISOString());
  const onRecord = (student?.guardians ?? []).filter((g) =>
    ['father', 'mother', 'guardian'].includes(g.relation),
  );
  const REL: Record<string, string> = { father: 'Father', mother: 'Mother', guardian: 'Guardian' };
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
      <PageHeader
        kicker={t(lang, 'Gate passes')}
        title={t(lang, 'Request a gate pass')}
        description={t(
          lang,
          'The school approves the request and sends you the pass. The child is handed over at the front desk.',
        )}
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/gate-passes">
            {t(lang, 'Back to gate passes')}
          </a>
        }
      />
      {sp.error ? (
        <div
          className="ep-alert ep-alert--danger"
          role="alert"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {sp.detail || sp.error}
        </div>
      ) : null}
      <Card title={`1. ${t(lang, 'Child')}`} style={{ marginBottom: 'var(--sp-3)' }}>
        <div className="ep-choices">
          {options.data.map((s) => (
            <a
              key={s.id}
              className="ep-choice"
              href={`/gate-passes/new?student=${s.id}`}
              aria-current={student?.id === s.id ? 'true' : undefined}
            >
              <strong>{s.name}</strong>
            </a>
          ))}
        </div>
      </Card>
      {student ? (
        <Card title={`2. ${t(lang, 'What for')}`} style={{ marginBottom: 'var(--sp-3)' }}>
          <div className="ep-choices">
            {(
              [
                ['early_leave', 'Leaving early', 'Someone collects the child before school ends'],
                ['late_arrival', 'Arriving late', 'The child comes after school has started'],
              ] as const
            ).map(([k, label, help]) => (
              <a
                key={k}
                className="ep-choice"
                href={`/gate-passes/new?student=${student.id}&kind=${k}`}
                aria-current={kind === k ? 'true' : undefined}
              >
                <strong>{t(lang, label)}</strong>
                <span>{t(lang, help)}</span>
              </a>
            ))}
          </div>
        </Card>
      ) : null}
      {student && kind ? (
        <Card title={`3. ${t(lang, 'When, why and with whom')}`}>
          <form action={applyGatePass} style={{ display: 'grid', gap: 'var(--sp-3)' }}>
            <input type="hidden" name="studentId" value={student.id} />
            <input type="hidden" name="kind" value={kind} />
            <label className="ep-field" htmlFor="ng-date">
              <span className="ep-field__label">{t(lang, 'Date')} *</span>
              <input
                id="ng-date"
                name="onDate"
                type="date"
                className="ep-input"
                required
                min={today}
                defaultValue={today}
              />
            </label>
            <label className="ep-field" htmlFor="ng-time">
              <span className="ep-field__label">
                {t(lang, kind === 'early_leave' ? 'Time of leaving' : 'Time of arriving')} *
              </span>
              <input id="ng-time" name="atTime" type="time" className="ep-input" required />
            </label>
            <label className="ep-field" htmlFor="ng-reason">
              <span className="ep-field__label">{t(lang, 'Reason')} *</span>
              <input
                id="ng-reason"
                name="reason"
                className="ep-input"
                required
                minLength={3}
                maxLength={300}
              />
            </label>
            {kind === 'early_leave' ? (
              <>
                <fieldset className="ep-slots">
                  <legend className="ep-field__label">{t(lang, 'Who takes the child')} *</legend>
                  <div className="ep-slots__grid">
                    {onRecord.map((g, i) => (
                      <label key={g.relation} className="ep-slots__slot">
                        <input
                          type="radio"
                          name="escortKind"
                          value={g.relation}
                          required
                          defaultChecked={i === 0}
                        />
                        <span>
                          {t(lang, REL[g.relation] ?? g.relation)} · {g.name}
                        </span>
                      </label>
                    ))}
                    <label className="ep-slots__slot">
                      <input
                        type="radio"
                        name="escortKind"
                        value="other"
                        required
                        defaultChecked={onRecord.length === 0}
                      />
                      <span>{t(lang, 'Someone else')}</span>
                    </label>
                  </div>
                </fieldset>
                <p className="ep-field__help" style={{ margin: 0 }}>
                  {t(
                    lang,
                    'For someone else, fill the three boxes below. At the front desk the school sends a one-time code to your mobile before handing over the child.',
                  )}
                </p>
                <label className="ep-field" htmlFor="ng-ename">
                  <span className="ep-field__label">{t(lang, 'Name (someone else)')}</span>
                  <input id="ng-ename" name="escortName" className="ep-input" maxLength={120} />
                </label>
                <label className="ep-field" htmlFor="ng-erel">
                  <span className="ep-field__label">{t(lang, 'Relation to the child')}</span>
                  <input id="ng-erel" name="escortRelation" className="ep-input" maxLength={60} />
                </label>
                <label className="ep-field" htmlFor="ng-emob">
                  <span className="ep-field__label">{t(lang, 'Mobile (someone else)')}</span>
                  <input
                    id="ng-emob"
                    name="escortMobile"
                    className="ep-input"
                    inputMode="numeric"
                    pattern="[6-9][0-9]{9}"
                    maxLength={10}
                  />
                </label>
              </>
            ) : null}
            <div>
              <Button type="submit">{t(lang, 'Send the request')}</Button>
            </div>
          </form>
        </Card>
      ) : null}
    </main>
  );
}
