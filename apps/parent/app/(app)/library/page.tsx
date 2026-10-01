import { Badge, Card, PageHeader } from '@edupro/ui';
import { ApiError } from '@edupro/bff';
import { redirect } from 'next/navigation';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';

interface Loan {
  id: string;
  accessionNo: string;
  title: string;
  author: string | null;
  issuedOn: string;
  dueOn: string;
  returnedOn: string | null;
  daysOverdue: number;
  fineAmount: string;
  fineWaived: string;
  finePaidOn: string | null;
}
interface Res {
  children: Array<{ student: { id: string; name: string }; loans: Loan[] }>;
}
interface Digital {
  id: string;
  title: string;
  author: string | null;
  url: string | null;
  category: string | null;
  description: string | null;
}

/** Sprint 17: the children's library loans. */
export default async function LibraryPage() {
  const lang = await currentLang();
  let res: Res;
  let digital: Digital[] = [];
  try {
    res = await bff.api.fetch<Res>('/library/mine');
    digital = await bff.api
      .fetch<{ data: Digital[] }>('/library/mine/digital')
      .then((r) => r.data)
      .catch(() => []);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && error.status === 403)
      return (
        <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
          <PageHeader kicker="EduPro" title={t(lang, 'Library')} />
          <Card>
            {t(
              lang,
              'Your account is not linked to a student yet. Please contact the school office.',
            )}
          </Card>
        </main>
      );
    throw error;
  }
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
      <PageHeader
        kicker={t(lang, 'Library')}
        title={t(lang, 'Books on loan')}
        description={t(lang, 'What your children have borrowed, when it is due, and any fine.')}
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/">
            {t(lang, 'Home')}
          </a>
        }
      />
      {res.children.map((c) => (
        <Card key={c.student.id} title={c.student.name} style={{ marginBottom: 'var(--sp-3)' }}>
          {c.loans.length === 0 ? (
            <p className="ep-field__help">{t(lang, 'No books on loan.')}</p>
          ) : (
            <table className="ep-table ep-table--dense" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>{t(lang, 'Book')}</th>
                  <th>{t(lang, 'Due on')}</th>
                  <th>{t(lang, 'Status')}</th>
                </tr>
              </thead>
              <tbody>
                {c.loans.map((l) => {
                  const fine = Number(l.fineAmount) - Number(l.fineWaived);
                  return (
                    <tr key={l.id}>
                      <td>
                        {l.title}
                        <div className="ep-kicker">
                          {l.author ?? ''} · {l.accessionNo}
                        </div>
                      </td>
                      <td>{l.dueOn}</td>
                      <td>
                        {l.returnedOn ? (
                          <Badge tone="neutral">
                            {t(lang, 'Returned')} {l.returnedOn}
                          </Badge>
                        ) : l.daysOverdue > 0 ? (
                          <Badge tone="danger">
                            {t(lang, 'Overdue')} · {l.daysOverdue} {t(lang, 'days')}
                          </Badge>
                        ) : (
                          <Badge tone="success">{t(lang, 'On loan')}</Badge>
                        )}
                        {fine > 0 && !l.finePaidOn ? (
                          <div className="ep-kicker">
                            {t(lang, 'Fine')} ₹{fine.toFixed(2)}
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>
      ))}
      {digital.length ? (
        <Card title={t(lang, 'Digital library')} style={{ marginBottom: 'var(--sp-3)' }}>
          <ul style={{ margin: 0, paddingLeft: 'var(--sp-4)' }}>
            {digital.map((d) => (
              <li key={d.id}>
                {d.url ? (
                  <a href={d.url} target="_blank" rel="noreferrer">
                    {d.title}
                  </a>
                ) : (
                  d.title
                )}
                {d.author ? ` · ${d.author}` : ''}
                {d.category ? <span className="ep-kicker"> · {d.category}</span> : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </main>
  );
}
