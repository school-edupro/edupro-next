import { Badge, Breadcrumbs, Button, Card, InputField, PageHeader, SelectField } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { StockScan } from '@/components/library/StockScan';
import { Notice } from '@/components/Notice';
import { Pager } from '@/components/RegisterTools';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { dmy, type BookSetup } from '@/lib/library-books';
import {
  METHOD_LABEL,
  STATE_LABEL,
  STATE_TONE,
  type StockCycle,
  type StockExtra,
  type StockItem,
  type StockState,
  type StockUpload,
} from '@/lib/library-stock';
import {
  decideStockUpload,
  endStockCycle,
  reopenStockCycle,
  markStockItem,
  uploadStockFile,
} from '@/lib/library-stock-actions';

type Items = { rows: Array<StockItem | StockExtra>; total: number; page: number; pages: number };
const ID = /^\d{1,18}$/;
const STATES: StockState[] = ['pending', 'verified', 'on_loan', 'missing', 'gone', 'extras', 'all'];
const TAB: Record<StockState, string> = {
  pending: 'Pending',
  verified: 'Verified',
  on_loan: 'On loan',
  missing: 'Missing',
  gone: 'Lost, withdrawn or sold since',
  extras: 'Not in the cycle',
  all: 'Every copy',
};
/** the copies register opened on the same copies */
const REGISTER: Partial<Record<StockState, string>> = {
  pending: 'stock_pending',
  verified: 'stock_verified',
  missing: 'stock_missing',
};

/**
 * One stock cycle (docs/design/36-library.md, "Library reports", part 3): how far it has come; while
 * open, the scan box and a file of book numbers (checked, then applied); the copies by state with the
 * numbers not in the cycle, each list as Excel or PDF; a copy verified by hand or taken back; the close
 * (copies not found marked lost if ticked) or a cancel with its reason.
 */
export default async function StockCyclePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const me = await getMe();
  if (!me.permissions.includes('library.stock.verify') || !ID.test(id)) notFound();
  let k: StockCycle;
  try {
    k = await apiFetch<StockCycle>(`/library/stock/cycles/${id}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
  const open = k.status === 'open';
  const mayClose = me.permissions.includes('library.stock.close');
  const state: StockState = STATES.includes(sp.state as StockState)
    ? (sp.state as StockState)
    : open
      ? 'pending'
      : k.counts.missing
        ? 'missing'
        : 'verified';
  const f: Record<string, string> = {};
  for (const key of ['libraryId', 'shelfId', 'materialTypeId'] as const)
    if (ID.test(sp[key] ?? '')) f[key] = sp[key]!;
  const search = (sp.q ?? '').trim().slice(0, 80);
  if (search) f.q = search;
  const page = Math.max(1, Math.min(10_000, Number(sp.page) || 1));
  const qs = (x: Record<string, string>) => new URLSearchParams(x).toString();
  const [items, setup, upload] = await Promise.all([
    apiFetch<Items>(
      `/library/stock/cycles/${id}/items?${qs({ ...f, state, page: String(page), size: '50' })}`,
    ),
    apiFetch<BookSetup>('/library/books/setup').catch(() => null),
    ID.test(sp.upload ?? '')
      ? apiFetch<StockUpload>(`/library/stock/uploads/${sp.upload!}`).catch(() => null)
      : Promise.resolve(null),
  ]);
  // the filters offer what the cycle covers
  const inScope = <T extends { id: string }>(all: T[], chosen: Array<{ id: string }>) =>
    chosen.length ? all.filter((x) => chosen.some((c) => c.id === x.id)) : all;
  const libraries = inScope(setup?.libraries ?? [], k.scope.libraries);
  const shelves = inScope(setup?.shelves ?? [], k.scope.shelves).filter(
    (s) => !k.scope.libraries.length || libraries.some((l) => l.id === s.libraryId),
  );
  const types = inScope(setup?.materialTypes ?? [], k.scope.materialTypes);
  const here = `/library/stock/${id}?${qs({ ...f, state, ...(page > 1 ? { page: String(page) } : {}) })}`;
  const file = (format: 'xlsx' | 'pdf') =>
    `/api/library-report?${qs({ report: 'stock', id, state, ...f, format })}`;
  const tabHref = (s: StockState) => `/library/stock/${id}?${qs({ ...f, state: s })}#list`;
  const backField = <input type="hidden" name="back" value={here} />;
  const tile = (s: StockState, label: string, n: number, sub: string) => (
    <a
      key={s}
      href={tabHref(s)}
      className="ep-tile-link"
      aria-current={state === s ? 'true' : undefined}
      aria-label={`${label}: ${String(n)}. Show the list`}
    >
      <Card title={label}>
        <div className="ep-cdash__big">{n}</div>
        <p className="ep-field__help" style={{ margin: 0 }}>
          {sub}
        </p>
      </Card>
    </a>
  );
  const tabs = STATES.filter(
    (s) => s === state || (s === 'missing' ? !open : s === 'gone' ? k.counts.gone > 0 : true),
  );
  const extrasCount = k.counts.outside + k.counts.unknown;

  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Library', href: '/library' },
          { label: 'Stock verification', href: '/library/stock' },
          { label: k.name },
        ]}
      />
      <PageHeader
        kicker="Stock cycle"
        title={k.name}
        description={`${k.scope.words} · started ${dmy(k.startedOn)}${k.startedBy ? ` by ${k.startedBy}` : ''}${k.note ? ` · ${k.note}` : ''}`}
        actions={
          <>
            <Badge tone={open ? 'warning' : k.status === 'closed' ? 'success' : 'neutral'}>
              {open ? 'Open' : k.status === 'closed' ? 'Closed' : 'Cancelled'}
            </Badge>
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href={file('xlsx')}>
              Excel
            </a>
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href={file('pdf')}>
              PDF
            </a>
          </>
        }
      />
      <Notice params={sp} />
      {k.status !== 'open' ? (
        <p
          className={`ep-alert ep-alert--${k.status === 'closed' ? 'info' : 'warning'}`}
          role="status"
        >
          {k.status === 'closed'
            ? `Closed on ${dmy(k.finishedOn)}${k.closedBy ? ` by ${k.closedBy}` : ''}: ${String(k.counts.missing)} missing${k.missingMarkedLost ? ' (marked lost)' : ''}, ${String(k.counts.onLoan)} on loan.`
            : `Cancelled on ${dmy(k.finishedOn)}${k.closedBy ? ` by ${k.closedBy}` : ''}: ${k.cancelReason ?? ''}`}
        </p>
      ) : null}
      {k.reopenLog?.length ? (
        <p className="ep-field__help">
          {k.reopenLog
            .map(
              (r) =>
                `Reopened on ${dmy(r.at.slice(0, 10))} by ${r.by}${r.closedOn ? ` (${r.was === 'cancelled' ? 'cancelled' : 'closed'} ${dmy(r.closedOn)})` : ''}: ${r.reason}${r.restored ? ` · ${String(r.restored)} lost cop${r.restored === 1 ? 'y' : 'ies'} put back` : ''}`,
            )
            .join(' · ')}
        </p>
      ) : null}
      {k.status !== 'open' && mayClose && k.reopen ? (
        k.reopen.allowed ? (
          <details className="ep-stock-cancel" style={{ marginBottom: 'var(--sp-4)' }}>
            <summary>
              {k.status === 'cancelled' ? 'Cancelled by mistake?' : 'Closed too early?'} Reopen the
              cycle
              {k.reopen.until ? ` (until ${dmy(k.reopen.until)})` : ''}
            </summary>
            <p className="ep-field__help">
              {k.status === 'cancelled'
                ? 'The cycle opens again with what was verified before it was cancelled'
                : 'The books found missing go back to pending'}
              {k.missingMarkedLost
                ? ', and the copies this close marked lost get their earlier status back'
                : ''}
              . Carry on verifying, then close it again.
            </p>
            <form action={reopenStockCycle} className="ep-dlog__filters">
              <input type="hidden" name="cycleId" value={id} />
              <div className="ep-dlog__search">
                <InputField
                  id="st-reopen"
                  name="reason"
                  label="Why"
                  required
                  minLength={3}
                  maxLength={300}
                />
              </div>
              <Button type="submit" variant="secondary">
                Reopen the cycle
              </Button>
            </form>
          </details>
        ) : (
          <p className="ep-field__help">Reopening: {k.reopen.why}</p>
        )
      ) : null}

      <div className="ep-dash-kpis ep-dash-kpis--4">
        {tile('verified', 'Verified', k.counts.verified, `of ${String(k.counts.total)} copies`)}
        {open
          ? tile('pending', 'Pending', k.counts.pending, 'still to find on the shelves')
          : tile('missing', 'Missing', k.counts.missing, 'not found at the close')}
        {tile('on_loan', 'On loan', k.counts.onLoan, 'counted as accounted for')}
        {tile(
          'extras',
          'Not in the cycle',
          extrasCount,
          `${String(k.counts.outside)} from elsewhere · ${String(k.counts.unknown)} unknown`,
        )}
      </div>
      <div className="ep-stock-progress">
        <div className="ep-stock-bar" aria-hidden="true">
          <span style={{ width: `${String(Math.min(100, k.done))}%` }} />
        </div>
        <span>
          <strong>{k.done}%</strong> accounted for (verified, on loan, or lost, withdrawn or sold
          since)
        </span>
      </div>

      {open ? (
        <div className="ep-stock-tools">
          <StockScan cycleId={id} />
          <section className="ep-card" aria-labelledby="st-up-h">
            <h2 id="st-up-h" className="ep-card__title">
              Upload a file of book numbers
            </h2>
            <p className="ep-field__help" style={{ marginTop: 0 }}>
              An .xlsx with a column headed Accession no. (a Remarks column is kept), or a
              scanner&apos;s .csv or .txt with one number a line. It is checked first: nothing is
              verified until you apply it.{' '}
              <a href="/api/library-report?report=stock-template">The layout</a>
            </p>
            <form action={uploadStockFile} className="ep-dlog__filters">
              {backField}
              <input type="hidden" name="cycleId" value={id} />
              <label className="ep-field ep-dlog__search" htmlFor="st-file" style={{ margin: 0 }}>
                <span className="ep-field__label">File *</span>
                <input
                  id="st-file"
                  name="file"
                  type="file"
                  required
                  accept=".xlsx,.csv,.txt"
                  className="ep-input"
                />
              </label>
              <Button type="submit" variant="secondary">
                Check the file
              </Button>
            </form>
          </section>
        </div>
      ) : null}

      {upload && upload.cycleId === id ? (
        <section className="ep-card ep-stock-upload" aria-labelledby="st-pre-h">
          <h2 id="st-pre-h" className="ep-card__title">
            {upload.fileName} · {upload.numbers} numbers
          </h2>
          {upload.status === 'checked' && upload.counts && upload.lists ? (
            <>
              <p className="ep-field__help" style={{ marginTop: 0 }}>
                Checked against the cycle now. Apply it to verify the copies; the numbers not in the
                cycle are kept on its &quot;Not in the cycle&quot; list.
              </p>
              <dl className="ep-sheet__grid">
                {(
                  [
                    ['To verify', upload.counts.verify],
                    ['Verified already', upload.counts.already],
                    ['From another shelf or library', upload.counts.outside],
                    ['No such book', upload.counts.unknown],
                    ['Twice in the file', upload.counts.repeated],
                  ] as Array<[string, number]>
                ).map(([label, n]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{n}</dd>
                  </div>
                ))}
              </dl>
              {(
                [
                  ['outside', 'From another shelf or library'],
                  ['unknown', 'No such book'],
                  ['verify', 'To verify'],
                ] as const
              ).map(([key, label]) =>
                upload.lists![key].length ? (
                  <details key={key} className="ep-stock-upload__list" open={key !== 'verify'}>
                    <summary>
                      {label} · {upload.counts![key]}
                    </summary>
                    <ul>
                      {upload.lists![key].map((x) => (
                        <li key={`${key}-${String(x.row)}-${x.no}`}>
                          {x.row ? `Row ${String(x.row)}: ` : ''}
                          {x.no}
                          {x.title ? ` · ${x.title}` : ''}
                          {key === 'outside'
                            ? ` (${[x.library, x.shelf ? `shelf ${x.shelf}` : null].filter(Boolean).join(', ')})`
                            : ''}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null,
              )}
              <div className="ep-desk__actions">
                {(['apply', 'discard'] as const).map((d) => (
                  <form key={d} action={decideStockUpload}>
                    {backField}
                    <input type="hidden" name="cycleId" value={id} />
                    <input type="hidden" name="uploadId" value={upload.id} />
                    <input type="hidden" name="decision" value={d} />
                    <Button type="submit" variant={d === 'apply' ? 'primary' : 'secondary'}>
                      {d === 'apply'
                        ? `Verify ${String(upload.counts!.verify)} copies`
                        : 'Discard the file'}
                    </Button>
                  </form>
                ))}
              </div>
            </>
          ) : (
            <p className="ep-field__help" style={{ margin: 0 }}>
              This file is {upload.status}.
            </p>
          )}
        </section>
      ) : null}

      <section className="ep-card" id="list" aria-labelledby="st-list-h">
        <nav
          className="ep-tabs"
          aria-label="Copies by state"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          <div className="ep-tabs__list">
            {tabs.map((s) => (
              <a
                key={s}
                className="ep-tabs__tab"
                href={tabHref(s)}
                aria-current={state === s ? 'page' : undefined}
              >
                {TAB[s]}
              </a>
            ))}
          </div>
        </nav>
        <h2 id="st-list-h" className="ep-card__title">
          {TAB[state]} · {items.total}
          {REGISTER[state] ? (
            <a
              className="ep-stock-register"
              href={`/library?view=copies&status=${REGISTER[state]!}`}
            >
              In the copies register
            </a>
          ) : null}
        </h2>
        {state !== 'extras' ? (
          <form
            method="get"
            action={`/library/stock/${id}`}
            className="ep-dlog__filters ep-filter-band"
          >
            <input type="hidden" name="state" value={state} />
            {libraries.length > 1 ? (
              <SelectField
                id="st-lib"
                name="libraryId"
                label="Library"
                defaultValue={f.libraryId ?? ''}
                options={[
                  { value: '', label: 'Every library' },
                  ...libraries.map((l) => ({ value: l.id, label: l.name })),
                ]}
              />
            ) : null}
            {shelves.length ? (
              <SelectField
                id="st-shelf"
                name="shelfId"
                label="Shelf"
                defaultValue={f.shelfId ?? ''}
                options={[
                  { value: '', label: 'Every shelf' },
                  ...shelves.map((s) => ({
                    value: s.id,
                    label: `${s.code}${s.name ? ` · ${s.name}` : ''}`,
                  })),
                ]}
              />
            ) : null}
            {types.length > 1 ? (
              <SelectField
                id="st-type"
                name="materialTypeId"
                label="Material type"
                defaultValue={f.materialTypeId ?? ''}
                options={[
                  { value: '', label: 'Every type' },
                  ...types.map((m) => ({ value: m.id, label: m.name })),
                ]}
              />
            ) : null}
            <div className="ep-dlog__search">
              <InputField
                id="st-q"
                name="q"
                type="search"
                label="Search"
                placeholder="Book no., barcode, title or author"
                maxLength={80}
                defaultValue={search}
              />
            </div>
            <Button type="submit">Show</Button>
            {Object.keys(f).length ? (
              <a
                className="ep-btn ep-btn--secondary"
                href={`/library/stock/${id}?state=${state}#list`}
              >
                Clear
              </a>
            ) : null}
          </form>
        ) : null}
        {items.rows.length === 0 ? (
          <p className="ep-field__help">
            {state === 'pending' && !Object.keys(f).length
              ? 'Nothing is pending: every copy is accounted for.'
              : 'Nothing here.'}
          </p>
        ) : state === 'extras' ? (
          <div
            className="ep-table-wrap"
            tabIndex={0}
            role="region"
            aria-label="Numbers not in the cycle (scrolls sideways)"
          >
            <table className="ep-table ep-table--dense">
              <thead>
                <tr>
                  <th scope="col">Number</th>
                  <th scope="col">What it is</th>
                  <th scope="col">Where it belongs</th>
                  <th scope="col">Noted</th>
                  <th scope="col">Remarks</th>
                </tr>
              </thead>
              <tbody>
                {(items.rows as StockExtra[]).map((x) => (
                  <tr key={`${x.extra}-${x.typed}`}>
                    <td>{x.typed}</td>
                    <td>
                      {x.extra === 'outside' ? (
                        <>
                          {x.accessionNo} · {x.title}
                          <div className="ep-field__help">
                            A book of the library, not in this cycle
                          </div>
                        </>
                      ) : (
                        <Badge tone="danger">No such book</Badge>
                      )}
                    </td>
                    <td>
                      {x.extra === 'outside'
                        ? [x.library, x.shelf ? `shelf ${x.shelf}` : null]
                            .filter(Boolean)
                            .join(', ')
                        : '—'}
                    </td>
                    <td>
                      {dmy(x.on)}
                      <div className="ep-field__help">
                        {METHOD_LABEL[x.method] ?? x.method}
                        {x.by ? ` · ${x.by}` : ''}
                      </div>
                    </td>
                    <td>{x.remark ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div
            className="ep-table-wrap"
            tabIndex={0}
            role="region"
            aria-label={`${TAB[state]} (scrolls sideways)`}
          >
            <table className="ep-table ep-table--dense">
              <thead>
                <tr>
                  <th scope="col">Book no.</th>
                  <th scope="col">Book</th>
                  <th scope="col">Where</th>
                  <th scope="col">Stock check</th>
                  <th scope="col">Verified</th>
                  {open ? (
                    <th scope="col">
                      <span className="ep-sr-only">Actions</span>
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {(items.rows as StockItem[]).map((x) => (
                  <tr key={x.copyId}>
                    <td>{x.accessionNo}</td>
                    <td>
                      <a href={`/library/books/${x.titleId}`}>{x.title}</a>
                      <div className="ep-field__help">
                        {[x.author, x.material].filter(Boolean).join(' · ')}
                      </div>
                    </td>
                    <td>
                      {x.library ?? '—'}
                      <div className="ep-field__help">
                        {[x.shelf ? `Shelf ${x.shelf}` : null, x.rack ? `rack ${x.rack}` : null]
                          .filter(Boolean)
                          .join(' · ') || '—'}
                      </div>
                    </td>
                    <td>
                      <Badge tone={STATE_TONE[x.state] ?? 'neutral'}>
                        {STATE_LABEL[x.state] ?? x.state}
                      </Badge>
                      {x.borrower ? (
                        <div className="ep-field__help">
                          {x.state === 'on_loan' ? '' : 'Now on loan to '}
                          {x.borrower} ({x.borrowerRef}) · due {dmy(x.dueOn)}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      {x.foundOn ? (
                        <>
                          {dmy(x.foundOn)}
                          <div className="ep-field__help">
                            {METHOD_LABEL[x.method ?? ''] ?? x.method}
                            {x.foundBy ? ` · ${x.foundBy}` : ''}
                            {x.remark ? ` · ${x.remark}` : ''}
                          </div>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    {open ? (
                      <td>
                        {x.state === 'pending' || x.state === 'verified' ? (
                          <form action={markStockItem}>
                            {backField}
                            <input type="hidden" name="cycleId" value={id} />
                            <input type="hidden" name="copyId" value={x.copyId} />
                            <input type="hidden" name="accessionNo" value={x.accessionNo} />
                            <input
                              type="hidden"
                              name="to"
                              value={x.state === 'pending' ? 'verified' : 'pending'}
                            />
                            <Button type="submit" size="sm" variant="secondary">
                              {x.state === 'pending' ? 'Verified by hand' : 'Undo'}
                            </Button>
                          </form>
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager
          page={items.page}
          pages={items.pages}
          hrefFor={(n) => `/library/stock/${id}?${qs({ ...f, state, page: String(n) })}#list`}
        />
      </section>

      {open ? (
        <section className="ep-card ep-stock-end" aria-labelledby="st-end-h">
          <h2 id="st-end-h" className="ep-card__title">
            Close the cycle
          </h2>
          <p className="ep-field__help" style={{ marginTop: 0 }}>
            The {k.counts.pending} pending cop{k.counts.pending === 1 ? 'y becomes' : 'ies become'}{' '}
            missing; books on loan then are counted as on loan. Nothing more can be verified after.
          </p>
          {!mayClose ? (
            <p className="ep-alert ep-alert--info">
              Closing or cancelling a cycle needs the right “Close or cancel a stock verification
              cycle”, which the administrator gives to the library in-charge or the Principal
              (Access → Roles). Keep scanning and uploading; they close it when the count is
              complete.
            </p>
          ) : null}
          {mayClose ? (
            <form action={endStockCycle} className="ep-dlog__filters">
              <input type="hidden" name="cycleId" value={id} />
              <input type="hidden" name="end" value="close" />
              <label className="ep-check" htmlFor="st-lost" style={{ alignSelf: 'center' }}>
                <input id="st-lost" type="checkbox" name="markMissingLost" /> Mark the missing
                copies lost
              </label>
              <div className="ep-dlog__search">
                <InputField id="st-note" name="note" label="Note" maxLength={300} />
              </div>
              <Button type="submit">Close the cycle</Button>
            </form>
          ) : null}
          {mayClose ? (
            <details className="ep-stock-cancel">
              <summary>Started by mistake? Cancel the cycle</summary>
              <form action={endStockCycle} className="ep-dlog__filters">
                <input type="hidden" name="cycleId" value={id} />
                <input type="hidden" name="end" value="cancel" />
                <div className="ep-dlog__search">
                  <InputField
                    id="st-reason"
                    name="reason"
                    label="Why"
                    required
                    minLength={3}
                    maxLength={300}
                  />
                </div>
                <Button type="submit" variant="danger">
                  Cancel the cycle
                </Button>
              </form>
            </details>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
