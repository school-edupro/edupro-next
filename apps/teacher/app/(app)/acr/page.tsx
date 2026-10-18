import { PageHeader } from '@edupro/ui';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';

interface Row {
  id: string;
  cycle: string;
  employee: { name: string; code: string; designation: string | null };
  status: 'self' | 'review' | 'disclosed' | 'represented' | 'closed';
  level: { seq: number; label: string | null } | null;
  grade: string | null;
  objectBy: string | null;
}
const STATUS: Record<Row['status'], string> = {
  self: 'Self-appraisal to fill',
  review: 'With the levels',
  disclosed: 'Ready for you to see',
  represented: 'Your objection is with the school',
  closed: 'Final',
};

/** My ACR and the ACRs waiting on me (docs/design/32-employee-acr.md). */
export default async function AcrHome() {
  const lang = await currentLang();
  const [mine, assess] = await Promise.all([
    bff.api.fetch<{ data: Row[] }>('/people/acr/mine').catch(() => ({ data: [] })),
    bff.api
      .fetch<{ waiting: Row[]; done: Row[] }>('/people/acr/to-assess')
      .catch(() => ({ waiting: [], done: [] })),
  ]);
  return (
    <main>
      <PageHeader
        kicker={t(lang, 'Office')}
        title={t(lang, 'My ACR')}
        description={t(lang, 'Your annual confidential report, and the reports waiting on you.')}
      />
      <section aria-labelledby="mine-h" style={{ marginBottom: 'var(--sp-5)' }}>
        <h2 id="mine-h" className="ep-card__title">
          {t(lang, 'My ACR')}
        </h2>
        {mine.data.length ? (
          <div className="ep-staff-tiles">
            {[...mine.data].reverse().map((r) => (
              <a
                key={r.id}
                href={`/acr/${r.id}`}
                className="ep-card ep-card--elevated ep-staff-tile"
              >
                <span className="ep-staff-tile__title">{r.cycle}</span>
                <span>{t(lang, STATUS[r.status])}</span>
                {r.grade && r.status !== 'self' && r.status !== 'review' ? (
                  <span className="ep-field__help">
                    {t(lang, 'Grade')}: {r.grade}
                  </span>
                ) : null}
              </a>
            ))}
          </div>
        ) : (
          <p className="ep-field__help">{t(lang, 'No ACR is open for you now.')}</p>
        )}
      </section>
      <section aria-labelledby="assess-h">
        <h2 id="assess-h" className="ep-card__title">
          {t(lang, 'ACRs to assess')} ({assess.waiting.length})
        </h2>
        {assess.waiting.length ? (
          <div className="ep-table-wrap">
            <table className="ep-table">
              <thead>
                <tr>
                  <th scope="col">{t(lang, 'Employee')}</th>
                  <th scope="col">{t(lang, 'Your level')}</th>
                </tr>
              </thead>
              <tbody>
                {assess.waiting.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <a href={`/acr/${r.id}`}>
                        <strong>{r.employee.name}</strong>
                      </a>
                      <div className="ep-field__help">
                        {[r.employee.code, r.employee.designation].filter(Boolean).join(' · ')}
                      </div>
                    </td>
                    <td>{r.level?.label ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="ep-field__help">{t(lang, 'Nothing is waiting on you.')}</p>
        )}
        {assess.done.length ? (
          <details style={{ marginTop: 'var(--sp-3)' }}>
            <summary>
              {t(lang, 'Filled by you this year')} ({assess.done.length})
            </summary>
            <ul>
              {assess.done.map((r) => (
                <li key={r.id}>
                  <a href={`/acr/${r.id}`}>{r.employee.name}</a>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>
    </main>
  );
}
