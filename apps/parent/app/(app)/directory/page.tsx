import { Card, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';

interface Entry {
  heading: string;
  name: string;
  designation: string | null;
  phone: string | null;
  email: string | null;
  timings: string | null;
  note: string | null;
}

/** The school directory: whom to contact for what, as the school office keeps it. */
export default async function DirectoryPage() {
  const lang = await currentLang();
  let rows: Entry[] = [];
  try {
    rows = (await bff.api.fetch<{ data: Entry[] }>('/academics/directory')).data;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (!(error instanceof ApiError && error.status === 403)) throw error;
  }
  const headings = [...new Set(rows.map((r) => r.heading))];
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 820, margin: '0 auto' }}>
      <PageHeader
        kicker={t(lang, 'School')}
        title={t(lang, 'School directory')}
        description={t(lang, 'Whom to contact at the school, and when.')}
      />
      {rows.length === 0 ? (
        <Card>{t(lang, 'The school has not published its directory yet.')}</Card>
      ) : null}
      {headings.map((h) => (
        <Card key={h} title={h} style={{ marginBottom: 'var(--sp-3)' }}>
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label={h}>
            <table className="ep-table ep-table--dense" style={{ width: '100%' }}>
              <caption className="ep-sr-only">{h}</caption>
              <thead>
                <tr>
                  <th scope="col">{t(lang, 'Name')}</th>
                  <th scope="col">{t(lang, 'Phone')}</th>
                  <th scope="col">{t(lang, 'E-mail')}</th>
                  <th scope="col">{t(lang, 'Timings')}</th>
                </tr>
              </thead>
              <tbody>
                {rows
                  .filter((r) => r.heading === h)
                  .map((r, i) => (
                    <tr key={String(i)}>
                      <th scope="row">
                        {r.name}
                        <div className="ep-kicker">
                          {[r.designation, r.note].filter(Boolean).join(' · ')}
                        </div>
                      </th>
                      <td>
                        {r.phone ? (
                          <a
                            href={`tel:${r.phone.replace(/[^0-9+]/g, '')}`}
                            style={{ textDecoration: 'underline' }}
                          >
                            {r.phone}
                          </a>
                        ) : (
                          '–'
                        )}
                      </td>
                      <td>
                        {r.email ? (
                          <a href={`mailto:${r.email}`} style={{ textDecoration: 'underline' }}>
                            {r.email}
                          </a>
                        ) : (
                          '–'
                        )}
                      </td>
                      <td>{r.timings ?? '–'}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Card>
      ))}
    </main>
  );
}
