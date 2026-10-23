import { Badge, Button, Card, PageHeader } from '@edupro/ui';
import { notFound, redirect } from 'next/navigation';
import { apiFetch, getMe } from '@/lib/api';
import { dmy } from '@/lib/library-books';
import type { CheckResult } from '@/lib/library-overview';

/**
 * Check a book: scan or type an accession number or barcode (an old corrected number works too) to open
 * that copy's status at once; a title, author or ISBN lists the matching titles with how many copies
 * are on the shelf, out and reserved.
 */
export default async function CheckBookPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const me = await getMe();
  if (!me.permissions.includes('library.catalogue.view')) notFound();
  const sp = await searchParams;
  const q = (sp.q ?? '').trim().slice(0, 120);
  const result: CheckResult = q
    ? await apiFetch<CheckResult>(`/library/check?q=${encodeURIComponent(q)}`)
    : { kind: 'none', titles: [] };
  if (result.kind === 'copy') redirect(`/library/check/${result.copyId}`);
  return (
    <>
      <PageHeader
        kicker="Library"
        title="Check a book"
        description="Scan the barcode or type the accession number to see where a copy is and who has it. A title, author or ISBN finds the books."
      />
      <Card>
        <form method="get" action="/library/check" className="ep-dlog__filters" role="search">
          <label className="ep-field ep-dlog__search" htmlFor="ck-q">
            <span className="ep-field__label">Accession no., barcode, title, author or ISBN</span>
            <input
              id="ck-q"
              name="q"
              type="search"
              className="ep-input"
              defaultValue={q}
              autoFocus
              autoComplete="off"
              maxLength={120}
            />
          </label>
          <Button type="submit">Check</Button>
        </form>
      </Card>
      {q && result.kind === 'titles' ? (
        <Card title={`Books matching “${q}”`} style={{ marginTop: 'var(--sp-4)' }}>
          {result.titles.length ? (
            <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Matching books">
              <table className="ep-table ep-table--dense">
                <caption className="ep-sr-only">Books matching the search</caption>
                <thead>
                  <tr>
                    <th scope="col">Title</th>
                    <th scope="col">Author</th>
                    <th scope="col" className="ep-num">
                      Copies
                    </th>
                    <th scope="col" className="ep-num">
                      On the shelf
                    </th>
                    <th scope="col" className="ep-num">
                      Out
                    </th>
                    <th scope="col" className="ep-num">
                      Reserved
                    </th>
                    <th scope="col">Next due back</th>
                  </tr>
                </thead>
                <tbody>
                  {result.titles.map((t) => (
                    <tr key={t.id}>
                      <td>
                        <a href={`/library/books/${t.id}`}>{t.title}</a>
                        {t.subtitle ? <div className="ep-field__help">{t.subtitle}</div> : null}
                        <div className="ep-field__help">
                          {[t.material, t.callNo, t.isbn].filter(Boolean).join(' · ')}
                          {t.reference ? ' · reference only' : ''}
                        </div>
                      </td>
                      <td>{t.author ?? '—'}</td>
                      <td className="ep-num">{t.copies}</td>
                      <td className="ep-num">
                        {t.available ? (
                          <Badge tone="success">{t.available}</Badge>
                        ) : (
                          <Badge tone="neutral">0</Badge>
                        )}
                      </td>
                      <td className="ep-num">{t.onLoan}</td>
                      <td className="ep-num">{t.reserved}</td>
                      <td>{t.nextDue ? dmy(t.nextDue) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="ep-field__help">
              No book matches. Check the number, or try part of the title.
            </p>
          )}
        </Card>
      ) : null}
    </>
  );
}
