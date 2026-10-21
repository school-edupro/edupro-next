import { Badge, Breadcrumbs } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { AddCopies, CopyActions } from '@/components/library/CopyActions';
import { Notice } from '@/components/Notice';
import { ApiError, apiFetch } from '@/lib/api';
import {
  COPY_EVENT,
  COPY_STATUS,
  COPY_TONE,
  dmy,
  isbnText,
  type BookSetup,
  type BookView,
} from '@/lib/library-books';

const TABS = [
  ['copies', 'Copies'],
  ['loans', 'Loans'],
  ['history', 'History'],
] as const;
type Tab = (typeof TABS)[number][0];
const ROLE_WORD: Record<string, string> = {
  Editor: 'edited by',
  Translator: 'translated by',
  Illustrator: 'illustrated by',
};
const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

/**
 * A title's page (docs/design/36-library.md, part 2): the book at the top (its people, material,
 * subject, call number, publication) with how many copies are on the shelf and out; then its copies
 * (where each is, how it came, its status or who has it), its loans and its copies' history.
 */
export default async function BookPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; ok?: string; error?: string; detail?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d{1,18}$/.test(id)) notFound();
  const [book, setup] = await Promise.all([
    apiFetch<BookView>(`/library/books/${id}`).catch((e: unknown) => {
      if (e instanceof ApiError && e.status === 404) notFound();
      throw e;
    }),
    apiFetch<BookSetup>('/library/books/setup'),
  ]);
  const tab: Tab = TABS.some(([k]) => k === sp.tab) ? (sp.tab as Tab) : 'copies';
  const inUse = book.copies.filter((c) => c.status !== 'withdrawn' && c.status !== 'sold');
  const count = (s: string) => book.copies.filter((c) => c.status === s).length;
  const authors = book.people.filter((p) => p.role === 'Author').map((p) => p.name);
  const others = book.people.filter((p) => p.role !== 'Author');
  const facts: Array<[string, string | null]> = [
    ['Subject', [book.subject, book.subSubject].filter(Boolean).join(' · ') || null],
    ['Call number', book.callNo],
    ['Publisher', [book.publisher, book.publicationPlace].filter(Boolean).join(', ') || null],
    ['Year', book.year ? String(book.year) : null],
    ['Edition · volume', [book.edition, book.volume].filter(Boolean).join(' · ') || null],
    ['Pages', book.pages ? String(book.pages) : null],
    ['ISBN', isbnText(book.isbn) || null],
    ['Language', book.language],
    ['For class', book.class],
    ['Price', book.price ? `₹${book.price}` : null],
    ['Catalogue code', book.code],
    ['Keywords', book.keywords.join(', ') || null],
  ];
  const counts: Record<Tab, number> = {
    copies: book.copies.length,
    loans: book.loans.length,
    history: book.events.length,
  };
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Library', href: '/library' },
          { label: 'Books', href: '/library' },
          { label: book.title },
        ]}
      />
      <Notice params={sp} />
      <section className="ep-hero ep-book__hero" aria-label="The book">
        <div className="ep-hero__main">
          <div className="ep-hero__title">
            <h1>{book.title}</h1>
            {book.material ? <Badge tone="info">{book.material}</Badge> : null}
            {book.isReference || !book.issuable ? <Badge tone="warning">Not issued</Badge> : null}
          </div>
          {book.subtitle ? <p className="ep-book__subtitle">{book.subtitle}</p> : null}
          <p className="ep-hero__line">
            {authors.length ? `by ${authors.join(', ')}` : 'No author given'}
            {others.map((p) => ` · ${ROLE_WORD[p.role] ?? p.role} ${p.name}`).join('')}
          </p>
          <dl className="ep-hero__facts">
            {facts
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
          </dl>
          {book.notes ? <p className="ep-field__help">{book.notes}</p> : null}
          {book.oldLocation ? (
            <p className="ep-field__help">
              Location before the shelves were set up: {book.oldLocation}
            </p>
          ) : null}
        </div>
        <div className="ep-hero__side">
          <dl className="ep-hero__facts ep-book__counts" aria-label="Copies">
            <div>
              <dt>Copies</dt>
              <dd>{inUse.length}</dd>
            </div>
            <div>
              <dt>On the shelf</dt>
              <dd>{count('available')}</dd>
            </div>
            <div>
              <dt>Issued</dt>
              <dd>{count('issued')}</dd>
            </div>
            <div>
              <dt>Lost · damaged</dt>
              <dd>
                {count('lost')} · {count('damaged')}
              </dd>
            </div>
          </dl>
          {book.can.manage ? (
            <div className="ep-hero__actions">
              <a
                className="ep-btn ep-btn--secondary ep-btn--sm"
                href={`/library/books/${book.id}/edit`}
              >
                Edit
              </a>
              <a
                className="ep-btn ep-btn--ghost ep-btn--sm"
                href={`/library/books/new?from=${book.id}`}
              >
                Clone
              </a>
            </div>
          ) : null}
        </div>
      </section>

      <nav className="ep-tabs" aria-label="Book sections" style={{ marginBottom: 'var(--sp-4)' }}>
        <div className="ep-tabs__list">
          {TABS.map(([k, label]) => (
            <a
              key={k}
              className="ep-tabs__tab"
              href={`/library/books/${book.id}${k === 'copies' ? '' : `?tab=${k}`}`}
              aria-current={tab === k ? 'page' : undefined}
            >
              {label}
              {counts[k] ? (
                <span className="ep-badge ep-badge--neutral" style={{ marginLeft: 'var(--sp-1)' }}>
                  {counts[k]}
                </span>
              ) : null}
            </a>
          ))}
        </div>
      </nav>

      {tab === 'copies' ? (
        <section className="ep-card ep-acr-card" aria-labelledby="bk-copies-h">
          <div className="ep-acr-head">
            <h2 id="bk-copies-h" className="ep-card__title" style={{ margin: 0 }}>
              Copies
            </h2>
            {book.can.manage ? (
              <span className="ep-hero__actions">
                {inUse.length ? (
                  <a
                    className="ep-btn ep-btn--ghost ep-btn--sm"
                    href={`/library/labels?title=${book.id}`}
                  >
                    Print labels
                  </a>
                ) : null}
                <AddCopies titleId={book.id} setup={setup} materialTypeId={book.materialTypeId} />
              </span>
            ) : null}
          </div>
          {book.copies.length ? (
            <div
              className="ep-table-wrap"
              tabIndex={0}
              role="region"
              aria-label="Copies (scrolls sideways)"
            >
              <table className="ep-table ep-table--dense">
                <caption className="ep-sr-only">Copies of {book.title}</caption>
                <thead>
                  <tr>
                    <th scope="col">Accession no.</th>
                    <th scope="col">Where</th>
                    <th scope="col">Status</th>
                    <th scope="col">How it came</th>
                    <th scope="col" className="is-numeric">
                      Price
                    </th>
                    {book.can.manage ? (
                      <th scope="col">
                        <span className="ep-sr-only">Actions</span>
                      </th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {book.copies.map((c) => (
                    <tr key={c.id} id={`copy-${c.id}`}>
                      <td>
                        <strong>{c.accessionNo}</strong>
                        {c.former.length ? (
                          <div className="ep-field__help">formerly {c.former.join(', ')}</div>
                        ) : null}
                        <div className="ep-field__help">
                          {dmy(c.accessionedOn)}
                          {c.barcode ? ` · barcode ${c.barcode}` : ''}
                        </div>
                      </td>
                      <td>
                        {c.library}
                        <div className="ep-field__help">
                          {c.shelf
                            ? `Shelf ${c.shelf}${c.rack ? ` · rack ${c.rack}` : ''}`
                            : 'No shelf given'}
                        </div>
                      </td>
                      <td>
                        <Badge tone={COPY_TONE[c.status]}>{COPY_STATUS[c.status]}</Badge>
                        {c.loan ? (
                          <div className="ep-field__help">
                            {c.loan.borrower} ({c.loan.ref}) · due {dmy(c.loan.dueOn)}
                          </div>
                        ) : c.statusReason ? (
                          <div className="ep-field__help">
                            {c.statusReason}
                            {c.statusOn ? ` · ${dmy(c.statusOn)}` : ''}
                          </div>
                        ) : null}
                      </td>
                      <td>
                        {c.acquisition === 'Purchase'
                          ? `Purchase${c.vendor ? ` · ${c.vendor}` : ''}`
                          : c.acquisition === 'Donation'
                            ? `Donation${c.donor ? ` · ${c.donor}` : ''}`
                            : '—'}
                        {c.billNo || c.billDate ? (
                          <div className="ep-field__help">
                            Bill {c.billNo ?? ''}
                            {c.billDate ? ` of ${dmy(c.billDate)}` : ''}
                            {c.poNo ? ` · PO ${c.poNo}` : ''}
                          </div>
                        ) : null}
                      </td>
                      <td className="is-numeric">{c.price ? `₹${c.price}` : '—'}</td>
                      {book.can.manage ? (
                        <td>
                          <CopyActions titleId={book.id} copy={c} setup={setup} />
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="ep-field__help">
              No copy yet{book.can.manage ? ': add its copies.' : '.'}
            </p>
          )}
        </section>
      ) : null}

      {tab === 'loans' ? (
        <section className="ep-card ep-acr-card" aria-labelledby="bk-loans-h">
          <h2 id="bk-loans-h" className="ep-card__title">
            Loans
          </h2>
          {book.loans.length ? (
            <div
              className="ep-table-wrap"
              tabIndex={0}
              role="region"
              aria-label="Loans (scrolls sideways)"
            >
              <table className="ep-table ep-table--dense">
                <caption className="ep-sr-only">Loans of {book.title}</caption>
                <thead>
                  <tr>
                    <th scope="col">Copy</th>
                    <th scope="col">Borrower</th>
                    <th scope="col">Issued</th>
                    <th scope="col">Due</th>
                    <th scope="col">Returned</th>
                    <th scope="col" className="is-numeric">
                      Fine
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {book.loans.map((l) => (
                    <tr key={l.id}>
                      <td>{l.accessionNo}</td>
                      <td>
                        {l.borrower}
                        <div className="ep-field__help">
                          {l.kind === 'student' ? 'Student' : 'Staff'} · {l.ref}
                        </div>
                      </td>
                      <td>{dmy(l.issuedOn)}</td>
                      <td>
                        {dmy(l.dueOn)}
                        {l.renewed ? (
                          <div className="ep-field__help">renewed {l.renewed}×</div>
                        ) : null}
                      </td>
                      <td>{l.returnedOn ? dmy(l.returnedOn) : <Badge tone="info">Out</Badge>}</td>
                      <td className="is-numeric">{l.fine ? `₹${l.fine.toFixed(2)}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="ep-field__help">Not issued yet.</p>
          )}
        </section>
      ) : null}

      {tab === 'history' ? (
        <section className="ep-card ep-acr-card" aria-labelledby="bk-hist-h">
          <h2 id="bk-hist-h" className="ep-card__title">
            History of the copies
          </h2>
          <ol className="ep-app-history">
            {book.events.map((e, i) => (
              <li key={i}>
                <strong>
                  {e.accessionNo}: {COPY_EVENT[e.what] ?? e.what}
                </strong>
                <div className="ep-field__help">
                  {dmy(e.on)}
                  {e.amount ? ` · ₹${e.amount}` : ''} · {e.by ?? 'System'} · {when(e.at)}
                </div>
                {e.reason ? <p style={{ margin: 'var(--sp-1) 0 0' }}>{e.reason}</p> : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </>
  );
}
