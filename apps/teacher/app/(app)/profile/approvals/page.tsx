import { PageHeader } from '@edupro/ui';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import { shown, type Value } from '@/lib/my-profile';
import { decideChange } from '../actions';

interface Req {
  id: string;
  employee: { name: string; code: string; designation: string | null };
  reason: string | null;
  createdAt: string;
  route: Array<{ label: string; done: boolean }>;
  step: number;
  proofs: Array<{ fileId: string; fileName: string | null }>;
  canAct: boolean;
  fields: Array<{ key: string; label: string; from: Value; to: Value; status: string }>;
}

/** Profile changes colleagues asked for that are routed to me (their HOD, L1 or L2 approver). */
export default async function ProfileApprovals({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const lang = await currentLang();
  const r = await bff.api
    .fetch<{ data: Req[]; awaitingMe: number }>('/people/staff-profile-approvals')
    .catch(() => ({ data: [] as Req[], awaitingMe: 0 }));
  return (
    <main>
      <PageHeader
        kicker={t(lang, 'Office')}
        title={t(lang, 'Profile changes to approve')}
        description={t(
          lang,
          'Accept or refuse each change; the record changes when the last approver accepts.',
        )}
      />
      {sp.ok ? (
        <div className="ep-alert ep-alert--success" role="status">
          {sp.detail ?? t(lang, 'Saved.')}
        </div>
      ) : null}
      {sp.error ? (
        <div className="ep-alert ep-alert--danger" role="alert">
          {sp.detail || t(lang, 'That did not go through.')}
        </div>
      ) : null}
      {!r.data.length ? (
        <p className="ep-field__help">{t(lang, 'Nothing is waiting on you.')}</p>
      ) : null}
      {r.data.map((q) => (
        <section
          key={q.id}
          className="ep-card ep-acr-card"
          aria-labelledby={`rq-${q.id}`}
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          <h2 id={`rq-${q.id}`} className="ep-card__title">
            {q.employee.name}{' '}
            <span className="ep-field__help">
              {[q.employee.code, q.employee.designation].filter(Boolean).join(' · ')} ·{' '}
              {new Date(q.createdAt).toLocaleDateString('en-IN')}
            </span>
          </h2>
          {q.reason ? (
            <p className="ep-field__help">
              {t(lang, 'Why')}: {q.reason}
            </p>
          ) : null}
          <form action={decideChange}>
            <input type="hidden" name="id" value={q.id} />
            <div className="ep-table-wrap">
              <table className="ep-table ep-table--dense">
                <thead>
                  <tr>
                    <th scope="col">{t(lang, 'Field')}</th>
                    <th scope="col">{t(lang, 'On file now')}</th>
                    <th scope="col">{t(lang, 'Asked for')}</th>
                    <th scope="col">{t(lang, 'Accept')}</th>
                  </tr>
                </thead>
                <tbody>
                  {q.fields
                    .filter((f) => f.status === 'pending')
                    .map((f) => (
                      <tr key={f.key}>
                        <td>
                          <strong>{t(lang, f.label)}</strong>
                        </td>
                        <td>{shown(f.from)}</td>
                        <td>
                          <strong>{shown(f.to)}</strong>
                        </td>
                        <td>
                          <input type="hidden" name="key" value={f.key} />
                          <input
                            type="checkbox"
                            name="accept"
                            value={f.key}
                            defaultChecked
                            aria-label={`${t(lang, 'Accept')} ${f.label}`}
                          />
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            {q.route.length > 1 ? (
              <p className="ep-field__help">
                {q.route
                  .map(
                    (s, i) =>
                      `${String(i + 1)}. ${s.label}${i === q.step - 1 ? ` (${t(lang, 'you')})` : ''}`,
                  )
                  .join(' → ')}
              </p>
            ) : null}
            <div className="ep-acr-actions">
              <label
                className="ep-field"
                htmlFor={`note-${q.id}`}
                style={{ flex: '1 1 16rem', margin: 0 }}
              >
                <span className="ep-field__label">{t(lang, 'Note (needed when refusing)')}</span>
                <input id={`note-${q.id}`} name="note" className="ep-input" maxLength={500} />
              </label>
              <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm">
                {t(lang, 'Save decision')}
              </button>
              <button
                type="submit"
                name="all"
                value="refuse"
                className="ep-btn ep-btn--ghost ep-btn--sm"
              >
                {t(lang, 'Refuse all')}
              </button>
            </div>
          </form>
        </section>
      ))}
    </main>
  );
}
