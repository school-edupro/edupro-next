import { Badge, Breadcrumbs, KpiTile, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { ConfirmAction } from '@/components/ConfirmAction';
import { FileLinks } from '@/components/FileLinks';
import { Notice } from '@/components/Notice';
import { Pager, PerPage, pageSizeOf } from '@/components/Pager';
import { OpeningFix } from '@/components/purchase/OpeningFix';
import { OpeningStock } from '@/components/purchase/OpeningStock';
import { ApiError, apiFetch } from '@/lib/api';
import {
  inr,
  type Revaluation,
  type StockPage,
  type StoreDetail,
  type StoreFormLists,
  type StoreOpenings,
} from '@/lib/purchase';
import {
  approveRevaluation,
  cancelRevaluation,
  makeOpeningAssets,
  rejectRevaluation,
  requestRevaluation,
  saveStoreLevels,
  undoOpening,
} from '@/lib/purchase-actions';

const dmy = (s: string | null) => (s ? `${s.slice(8, 10)}-${s.slice(5, 7)}-${s.slice(0, 4)}` : '—');
const qty = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 3 });
const when = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
const REVALUATION_STATUS: Record<Revaluation['status'], string> = {
  submitted: 'Waiting for approval',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};
const ID = /^\d{1,18}$/;
type Tab = 'stock' | 'opening' | 'rates' | 'post' | 'levels';
const SOURCE = { hand: 'By hand', excel: 'From Excel', correction: 'Correction' } as const;

/**
 * One store (docs/design/84, part 6; "As built — the store page in tabs", 9 Nov 2026): its details and
 * keepers, then five tabs, each filtered and a page at a time for stores of thousands of items —
 * Stock (search, category, below reorder / in stock / every item, Excel and PDF of what is found),
 * Opening stock posted (the postings, then their lines: change, remove, undo, the statement), Rate
 * corrections (approved at the Rate correction levels on Purchase → Who approves), Post opening stock
 * (checked first), and Reorder levels.
 */
export default async function StorePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!ID.test(id)) notFound();
  const s = await apiFetch<StoreDetail>(`/purchase/stores/${id}?stock=0`).catch((e: unknown) => {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  });
  const tabs: Array<[Tab, string]> = [
    ['stock', 'Stock'],
    ['opening', 'Opening stock posted'],
    ['rates', 'Rate corrections'],
    ...(s.can.operate ? ([['post', 'Post opening stock']] as Array<[Tab, string]>) : []),
    ...(s.can.manage ? ([['levels', 'Reorder levels']] as Array<[Tab, string]>) : []),
  ];
  const tab: Tab = tabs.some(([k]) => k === sp.tab) ? (sp.tab as Tab) : 'stock';
  const size = pageSizeOf(sp.size);
  const page = Math.max(1, Number(sp.page) || 1);
  const q = (sp.q ?? '').trim().slice(0, 80);
  const categoryId = sp.categoryId && ID.test(sp.categoryId) ? sp.categoryId : '';
  // stock: in stock (default), below the reorder level, or every item (those with levels too)
  const show = sp.show === 'below' || sp.show === 'all' ? sp.show : '';
  /** this page with these settings (the tab's own filters kept unless changed) */
  const link = (p: Record<string, string | undefined>) => {
    const u = new URLSearchParams();
    const keep: Record<string, string | undefined> = {
      tab,
      q: q || undefined,
      categoryId: categoryId || undefined,
      show: show || undefined,
      posting: sp.posting,
      status: sp.status,
      size: size === '50' ? undefined : size,
      page: String(page),
      ...p,
    };
    for (const [k, v] of Object.entries(keep)) if (v) u.set(k, v);
    return `/purchase/stores/${s.id}?${u.toString()}`;
  };
  const here = link({});
  const stockQs = new URLSearchParams({ storeId: s.id });
  if (q) stockQs.set('q', q);
  if (categoryId) stockQs.set('categoryId', categoryId);
  if (show === 'below') stockQs.set('below', '1');
  if (show === 'all' || tab === 'levels') stockQs.set('empty', '1');

  const [lists, stock, openings, revaluations, found] = await Promise.all([
    (tab === 'post' || tab === 'levels') && (s.can.manage || s.can.operate)
      ? apiFetch<StoreFormLists>('/purchase/store-form')
      : Promise.resolve(null),
    tab === 'stock' || tab === 'levels'
      ? apiFetch<StockPage>(
          `/purchase/stock?${stockQs.toString()}&page=${String(page)}&size=${size}`,
        )
      : Promise.resolve(null),
    tab === 'opening'
      ? apiFetch<StoreOpenings>(
          `/purchase/stores/${s.id}/openings?${new URLSearchParams(
            Object.entries({
              posting: sp.posting && ID.test(sp.posting) ? sp.posting : '',
              q,
              status: ['standing', 'changeable', 'settled', 'reversed'].includes(sp.status ?? '')
                ? sp.status!
                : '',
              page: String(page),
              size,
            }).filter(([, v]) => v),
          ).toString()}`,
        ).catch(() => null)
      : Promise.resolve(null),
    tab === 'rates'
      ? apiFetch<{ rows: Revaluation[] }>(`/purchase/revaluations?storeId=${s.id}`)
          .then((r) => r.rows)
          .catch(() => [] as Revaluation[])
      : Promise.resolve([] as Revaluation[]),
    // the rate corrections tab: the item asked for, or the items found by name
    tab === 'rates' && s.can.operate && (sp.item || q)
      ? apiFetch<StockPage>(
          `/purchase/stock?storeId=${s.id}&size=25&page=1${q ? `&q=${encodeURIComponent(q)}` : ''}`,
        ).catch(() => null)
      : Promise.resolve(null),
  ]);
  const picked =
    tab === 'rates' && sp.item && ID.test(sp.item)
      ? ((
          await apiFetch<StockPage>(
            `/purchase/stock?storeId=${s.id}&itemId=${sp.item}&empty=1&page=1&size=25`,
          ).catch(() => null)
        )?.data[0] ?? null)
      : null;
  const file = (format: 'xlsx' | 'pdf') => {
    const u = new URLSearchParams({ storeId: s.id, format });
    if (q) u.set('q', q);
    if (categoryId) u.set('categoryId', categoryId);
    if (show === 'below') u.set('below', '1');
    return `/api/purchase/stock-file?${u.toString()}`;
  };

  return (
    <>
      <Breadcrumbs items={[{ label: 'Stores', href: '/purchase/stores' }, { label: s.name }]} />
      <PageHeader
        kicker={`Purchase · ${s.kind === 'main' ? 'Main store' : 'Sub-store'}`}
        title={s.name}
        description={[s.code, s.department, s.location].filter(Boolean).join(' · ')}
        actions={
          s.can.manage ? (
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href={`/purchase/stores/${s.id}/edit`}
            >
              Change
            </a>
          ) : null
        }
      />
      <Notice params={sp} />
      <div className="ep-dash-kpis ep-dash-kpis--4">
        <KpiTile label="Items in stock" value={String(s.items)} />
        <KpiTile label="Stock value" value={inr(s.value)} />
        <KpiTile
          label="Below reorder level"
          value={String(s.belowReorder)}
          hint={
            s.belowReorder ? (
              <a href={`/purchase/stores/${s.id}?tab=stock&show=below`}>show them</a>
            ) : undefined
          }
        />
        <KpiTile
          label="Physical count"
          value={s.countedThisYear ? 'Counted this year' : 'Not counted this year'}
          hint={
            s.counts.length ? (
              <a href={`/purchase/counts/${s.counts[0]!.id}`}>
                Last: {s.counts[0]!.number} ({dmy(s.counts[0]!.countedOn)})
              </a>
            ) : (
              <a href="/purchase/counts">Start a count</a>
            )
          }
        />
      </div>
      <p className="ep-field__help">
        Keepers:{' '}
        {s.keepers.length
          ? s.keepers.map((k) => `${k.name} (${k.code})`).join(', ')
          : 'nobody yet — give the store a keeper'}
        {s.kind === 'sub' && s.parent ? ` · under ${s.parent}` : ''}
        {s.status !== 'active' ? ' · inactive' : ''}
      </p>
      <nav
        aria-label="Parts of the store"
        className="ep-tabs"
        style={{ marginBottom: 'var(--sp-3)' }}
      >
        <div className="ep-tabs__list">
          {tabs.map(([k, l]) => (
            <a
              key={k}
              className="ep-tabs__tab"
              href={`/purchase/stores/${s.id}?tab=${k}`}
              aria-current={tab === k ? 'page' : undefined}
            >
              {l}
            </a>
          ))}
        </div>
      </nav>

      {tab === 'stock' && stock ? (
        <section className="ep-card" aria-labelledby="st-stock">
          <h2 id="st-stock" className="ep-card__title">
            Stock
          </h2>
          <form method="get" className="ep-grid__toolbar" style={{ marginBottom: 'var(--sp-3)' }}>
            <input type="hidden" name="tab" value="stock" />
            <label className="ep-field" htmlFor="sk-q">
              <span className="ep-field__label">Find</span>
              <input
                id="sk-q"
                name="q"
                type="search"
                className="ep-input"
                defaultValue={q}
                placeholder="Item or code"
              />
            </label>
            <label className="ep-field" htmlFor="sk-cat">
              <span className="ep-field__label">Category</span>
              <select id="sk-cat" name="categoryId" className="ep-select" defaultValue={categoryId}>
                <option value="">All</option>
                {stock.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="ep-field" htmlFor="sk-show">
              <span className="ep-field__label">Show</span>
              <select id="sk-show" name="show" className="ep-select" defaultValue={show}>
                <option value="">In stock</option>
                <option value="below">Below the reorder level</option>
                <option value="all">Every item (with levels too)</option>
              </select>
            </label>
            <PerPage id="sk-size" value={size} />
            <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
              Show
            </button>
            {q || categoryId || show ? (
              <a
                className="ep-btn ep-btn--ghost ep-btn--sm"
                href={`/purchase/stores/${s.id}?tab=stock`}
              >
                Clear
              </a>
            ) : null}
            <span className="ep-grid__spacer" />
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href={file('xlsx')}>
              Excel
            </a>
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href={file('pdf')}>
              PDF
            </a>
          </form>
          <p className="ep-field__help" style={{ marginTop: 0 }}>
            {stock.total} item{stock.total === 1 ? '' : 's'} found, worth {inr(stock.value)}
            {stock.below ? ` · ${String(stock.below)} below the reorder level` : ''}
          </p>
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="st-stock">
            <table className="ep-table ep-table--dense">
              <thead>
                <tr>
                  <th scope="col">Item</th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    In stock
                  </th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    Reserved
                  </th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    Average rate
                  </th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    Value
                  </th>
                  <th scope="col">Reorder</th>
                  <th scope="col">Earliest expiry</th>
                  {s.can.operate ? (
                    <th scope="col">
                      <span className="ep-sr-only">Correct</span>
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {stock.data.length ? (
                  stock.data.map((x) => (
                    <tr key={x.itemId}>
                      <td>
                        <a href={`/purchase/stock/${x.itemId}?storeId=${s.id}`}>{x.name}</a>
                        <span className="ep-mr-col__desc">
                          {x.code} · {x.category}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {qty(x.qty)} {x.unit}
                      </td>
                      <td style={{ textAlign: 'right' }}>{x.reserved ? qty(x.reserved) : '—'}</td>
                      <td style={{ textAlign: 'right' }}>{inr(x.avgRate)}</td>
                      <td style={{ textAlign: 'right' }}>{inr(x.value)}</td>
                      <td>
                        {x.reorderLevel ? `at ${qty(x.reorderLevel)}` : '—'}
                        {x.below ? (
                          <>
                            {' '}
                            <Badge tone="warning">Below</Badge>
                          </>
                        ) : null}
                      </td>
                      <td>{dmy(x.earliestExpiry)}</td>
                      {s.can.operate ? (
                        <td>
                          {x.qty > 0 ? (
                            <a
                              href={`/purchase/stores/${s.id}?tab=rates&item=${x.itemId}`}
                              aria-label={`Correct the rate of ${x.name}`}
                            >
                              Correct the rate
                            </a>
                          ) : null}
                        </td>
                      ) : null}
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={s.can.operate ? 8 : 7}>
                      {q || categoryId || show
                        ? 'No item matches these filters.'
                        : 'No stock yet: post the opening stock, or receive goods.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Pager
            page={stock.page ?? 1}
            size={Number(size)}
            total={stock.total}
            noun="items"
            href={(n) => link({ page: String(n) })}
          />
        </section>
      ) : null}

      {tab === 'opening' ? (
        openings ? (
          <>
            {openings.missingAssets.length ? (
              <div className="ep-alert ep-alert--warning" role="status">
                <div>
                  <strong>Asset items without their assets</strong> — opening stock posted before
                  openings made assets:{' '}
                  {openings.missingAssets
                    .slice(0, 10)
                    .map((m) => `${m.name} (${String(m.units - m.assets)} of ${String(m.units)})`)
                    .join(', ')}
                  {openings.missingAssets.length > 10
                    ? ` and ${String(openings.missingAssets.length - 10)} more`
                    : ''}
                  . Each unit should be an asset with its tag and QR label.{' '}
                  {s.can.operate && openings.missingAssets.some((m) => m.canMake) ? (
                    <ConfirmAction
                      action={makeOpeningAssets}
                      fields={{ storeId: s.id, back: here }}
                      label="Make their assets"
                      title="Make the missing assets?"
                      confirmLabel="Make them"
                      variant="secondary"
                    >
                      One asset per unit, in this store, its cost the opening rate. Correct a wrong
                      rate first (Change) — or afterwards: the assets take the new cost.
                    </ConfirmAction>
                  ) : null}
                </div>
              </div>
            ) : null}
            <section className="ep-card" aria-labelledby="st-posts">
              <h2 id="st-posts" className="ep-card__title">
                Postings
              </h2>
              <p className="ep-field__help" style={{ marginTop: 0 }}>
                Each posting by hand or from Excel, the newest first. While an item has not moved
                since, its opening can be changed or removed with the reason (the wrong line
                reversed, the right one posted) and a whole posting undone; after that, the quantity
                is corrected by a physical count and the rate by a rate correction.
              </p>
              <div className="ep-grid__toolbar" style={{ marginBottom: 'var(--sp-3)' }}>
                <span className="ep-field__label" style={{ alignSelf: 'center' }}>
                  Opening stock statement
                </span>
                <FileLinks
                  href={`/api/purchase/opening-statement?store=${s.id}`}
                  label={`${s.name} opening stock statement as a PDF`}
                />
                <a
                  className="ep-btn ep-btn--secondary ep-btn--sm"
                  href={`/api/purchase/opening-statement?store=${s.id}&format=xlsx`}
                >
                  Excel
                </a>
              </div>
              {openings.postings.length ? (
                <div
                  className="ep-table-wrap"
                  tabIndex={0}
                  role="region"
                  aria-labelledby="st-posts"
                >
                  <table className="ep-table ep-table--dense">
                    <thead>
                      <tr>
                        <th scope="col">Posting</th>
                        <th scope="col">By, when</th>
                        <th scope="col" style={{ textAlign: 'right' }}>
                          Lines
                        </th>
                        <th scope="col" style={{ textAlign: 'right' }}>
                          Value
                        </th>
                        <th scope="col">
                          <span className="ep-sr-only">Do</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {openings.postings.map((p) => (
                        <tr key={p.id}>
                          <td>
                            <a href={`/purchase/stores/${s.id}?tab=opening&posting=${p.id}`}>
                              {SOURCE[p.source]}
                              {p.fileName ? ` (${p.fileName})` : ''}
                            </a>{' '}
                            {p.undoneAt ? <Badge tone="neutral">Undone</Badge> : null}
                            <span className="ep-mr-col__desc">
                              {[
                                p.reason ? `why: ${p.reason}` : null,
                                p.undoneAt
                                  ? `undone ${when(p.undoneAt)}${p.undoneBy ? ` by ${p.undoneBy}` : ''}: ${p.undoReason ?? ''}`
                                  : null,
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </span>
                          </td>
                          <td>{[p.by, when(p.at)].filter(Boolean).join(', ')}</td>
                          <td style={{ textAlign: 'right' }}>
                            {p.standing === p.lines
                              ? p.lines
                              : `${String(p.standing)} of ${String(p.lines)}`}
                          </td>
                          <td style={{ textAlign: 'right' }}>{inr(p.value)}</td>
                          <td>
                            {p.canUndo && s.can.operate && p.source !== 'correction' ? (
                              <ConfirmAction
                                action={undoOpening}
                                fields={{ id: p.id, storeId: s.id, back: here }}
                                label={
                                  p.source === 'excel' ? 'Undo this upload' : 'Undo this posting'
                                }
                                title={
                                  p.source === 'excel'
                                    ? 'Undo the whole upload?'
                                    : 'Undo the whole posting?'
                                }
                                confirmLabel="Undo it"
                                variant="ghost"
                                confirmVariant="danger"
                                reason={{
                                  label: 'Why',
                                  placeholder: 'e.g. the wrong sheet was uploaded',
                                }}
                              >
                                {`Its ${String(p.standing)} standing line${p.standing === 1 ? ' is' : 's are'} reversed (worth ${inr(p.value)}) and the assets made from it taken off the register. The posting stays on record as undone.`}
                              </ConfirmAction>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p>No opening stock posted yet{s.can.operate ? ': see Post opening stock' : ''}.</p>
              )}
            </section>
            {openings.postings.length ? (
              <section className="ep-card" aria-labelledby="st-lines">
                <h2 id="st-lines" className="ep-card__title">
                  Opening lines
                </h2>
                <form
                  method="get"
                  className="ep-grid__toolbar"
                  style={{ marginBottom: 'var(--sp-3)' }}
                >
                  <input type="hidden" name="tab" value="opening" />
                  <label className="ep-field" htmlFor="ol-post">
                    <span className="ep-field__label">Posting</span>
                    <select
                      id="ol-post"
                      name="posting"
                      className="ep-select"
                      defaultValue={sp.posting ?? ''}
                    >
                      <option value="">All</option>
                      {openings.postings.map((p) => (
                        <option key={p.id} value={p.id}>
                          {SOURCE[p.source]}
                          {p.fileName ? ` (${p.fileName})` : ''} · {when(p.at)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="ep-field" htmlFor="ol-q">
                    <span className="ep-field__label">Find</span>
                    <input
                      id="ol-q"
                      name="q"
                      type="search"
                      className="ep-input"
                      defaultValue={q}
                      placeholder="Item, code or batch"
                    />
                  </label>
                  <label className="ep-field" htmlFor="ol-st">
                    <span className="ep-field__label">Status</span>
                    <select
                      id="ol-st"
                      name="status"
                      className="ep-select"
                      defaultValue={sp.status ?? ''}
                    >
                      <option value="">Every line</option>
                      <option value="standing">Standing</option>
                      <option value="changeable">Can still be changed</option>
                      <option value="settled">Settled (moved since)</option>
                      <option value="reversed">Reversed</option>
                    </select>
                  </label>
                  <PerPage id="ol-size" value={size} />
                  <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
                    Show
                  </button>
                  {sp.posting || q || sp.status ? (
                    <a
                      className="ep-btn ep-btn--ghost ep-btn--sm"
                      href={`/purchase/stores/${s.id}?tab=opening`}
                    >
                      Clear
                    </a>
                  ) : null}
                </form>
                <div
                  className="ep-table-wrap"
                  tabIndex={0}
                  role="region"
                  aria-labelledby="st-lines"
                >
                  <table className="ep-table ep-table--dense">
                    <thead>
                      <tr>
                        <th scope="col">Item</th>
                        <th scope="col" style={{ textAlign: 'right' }}>
                          Quantity
                        </th>
                        <th scope="col" style={{ textAlign: 'right' }}>
                          Rate
                        </th>
                        <th scope="col" style={{ textAlign: 'right' }}>
                          Value
                        </th>
                        <th scope="col">Correct</th>
                      </tr>
                    </thead>
                    <tbody>
                      {openings.lines.length ? (
                        openings.lines.map((l) => (
                          <tr key={l.moveId}>
                            <td>
                              {l.reversed ? <s>{l.name}</s> : l.name}
                              <span className="ep-mr-col__desc">
                                {[
                                  l.code,
                                  l.batch ? `Batch ${l.batch}` : null,
                                  l.expiry ? `expiry ${dmy(l.expiry)}` : null,
                                  l.asset
                                    ? `${String(l.assets)} asset${l.assets === 1 ? '' : 's'}`
                                    : null,
                                ]
                                  .filter(Boolean)
                                  .join(' · ')}
                              </span>
                            </td>
                            <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                              {qty(l.qty)} {l.unit}
                            </td>
                            <td style={{ textAlign: 'right' }}>
                              {inr(l.rate)}
                              {!l.reversed && l.rate === 0 ? (
                                <>
                                  {' '}
                                  <Badge tone="warning">₹0</Badge>
                                </>
                              ) : null}
                            </td>
                            <td style={{ textAlign: 'right' }}>{inr(l.value)}</td>
                            <td>
                              {l.reversed ? (
                                <span className="ep-field__help">Reversed</span>
                              ) : l.canChange && s.can.operate ? (
                                <span style={{ display: 'inline-flex', gap: 'var(--sp-2)' }}>
                                  {(['change', 'remove'] as const).map((mode) => (
                                    <OpeningFix
                                      key={mode}
                                      storeId={s.id}
                                      itemId={l.itemId}
                                      name={l.name}
                                      unit={l.unit}
                                      batch={Boolean(l.batch)}
                                      asset={l.asset}
                                      lines={openings.itemLines[l.itemId] ?? []}
                                      mode={mode}
                                    />
                                  ))}
                                </span>
                              ) : l.why ? (
                                <span className="ep-field__help">Settled: {l.why}</span>
                              ) : null}
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={5}>No line matches these filters.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <Pager
                  page={openings.page}
                  size={openings.size}
                  total={openings.found}
                  noun="lines"
                  href={(n) => link({ page: String(n) })}
                />
              </section>
            ) : null}
          </>
        ) : (
          <p>The opening stock could not be read.</p>
        )
      ) : null}

      {tab === 'rates' ? (
        <section className="ep-card" aria-labelledby="st-rate">
          <h2 id="st-rate" className="ep-card__title">
            Rate corrections
          </h2>
          <p className="ep-field__help" style={{ marginTop: 0 }}>
            For an item that has moved since its opening (or came on a receipt) at a wrong rate:
            what is left in the store goes to the right rate once approved at the{' '}
            <a href={`/purchase/approvals${s.departmentId ? `?department=${s.departmentId}` : ''}`}>
              Rate correction levels on Who approves
            </a>{' '}
            ({s.department ?? 'the purchase office department'}; none set: the school admin). Who
            asked never approves it. What was issued before keeps the old value.
          </p>
          {s.can.operate ? (
            picked ? (
              <form
                action={requestRevaluation}
                className="ep-grid__toolbar"
                style={{ marginBottom: 'var(--sp-3)' }}
              >
                <input type="hidden" name="storeId" value={s.id} />
                <input type="hidden" name="itemId" value={picked.itemId} />
                <input type="hidden" name="back" value={`/purchase/stores/${s.id}?tab=rates`} />
                <p style={{ margin: 0, alignSelf: 'center' }}>
                  <strong>{picked.name}</strong> — {qty(picked.qty)} {picked.unit} at{' '}
                  {inr(picked.avgRate)}
                </p>
                <label className="ep-field" htmlFor="rv-rate">
                  <span className="ep-field__label">Right rate per {picked.unit} (₹)</span>
                  <input
                    id="rv-rate"
                    name="newRate"
                    className="ep-input"
                    inputMode="decimal"
                    required
                  />
                </label>
                <label className="ep-field" htmlFor="rv-why">
                  <span className="ep-field__label">Why</span>
                  <input
                    id="rv-why"
                    name="reason"
                    className="ep-input"
                    required
                    minLength={3}
                    maxLength={300}
                    placeholder="e.g. the opening rate was per box"
                  />
                </label>
                <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm">
                  Send for approval
                </button>
                <a
                  className="ep-btn ep-btn--ghost ep-btn--sm"
                  href={`/purchase/stores/${s.id}?tab=rates`}
                >
                  Another item
                </a>
              </form>
            ) : (
              <>
                <form
                  method="get"
                  className="ep-grid__toolbar"
                  style={{ marginBottom: 'var(--sp-2)' }}
                >
                  <input type="hidden" name="tab" value="rates" />
                  <label className="ep-field" htmlFor="rv-find">
                    <span className="ep-field__label">
                      Ask for a rate correction: find the item
                    </span>
                    <input
                      id="rv-find"
                      name="q"
                      type="search"
                      className="ep-input"
                      defaultValue={q}
                      placeholder="Item or code"
                    />
                  </label>
                  <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
                    Find
                  </button>
                </form>
                {found ? (
                  <ul className="ep-purch-checks">
                    {found.data
                      .filter((x) => x.qty > 0)
                      .map((x) => (
                        <li key={x.itemId}>
                          <a href={`/purchase/stores/${s.id}?tab=rates&item=${x.itemId}`}>
                            {x.name} ({x.code})
                          </a>{' '}
                          — {qty(x.qty)} {x.unit} at {inr(x.avgRate)}
                        </li>
                      ))}
                    {!found.data.some((x) => x.qty > 0) ? <li>No item in stock matches.</li> : null}
                  </ul>
                ) : (
                  <p className="ep-field__help">
                    Or press Correct the rate on an item in the Stock tab.
                  </p>
                )}
              </>
            )
          ) : null}
          {revaluations.length ? (
            <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="st-rate">
              <table className="ep-table ep-table--dense">
                <thead>
                  <tr>
                    <th scope="col">Correction</th>
                    <th scope="col">Item</th>
                    <th scope="col" style={{ textAlign: 'right' }}>
                      Rate
                    </th>
                    <th scope="col" style={{ textAlign: 'right' }}>
                      Change in value
                    </th>
                    <th scope="col">Status</th>
                    <th scope="col">
                      <span className="ep-sr-only">Decide</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {revaluations.map((r) => (
                    <tr key={r.id}>
                      <td>
                        {r.number}
                        <span className="ep-mr-col__desc">
                          {[r.by, when(r.at)].filter(Boolean).join(', ')} · {r.reason}
                        </span>
                      </td>
                      <td>
                        {r.item}
                        <span className="ep-mr-col__desc">
                          {qty(r.qty)} {r.unit} when asked
                        </span>
                      </td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {inr(r.oldRate)} → {inr(r.newRate)}
                      </td>
                      <td style={{ textAlign: 'right' }}>{inr(r.change)}</td>
                      <td>
                        <Badge
                          tone={
                            r.status === 'approved'
                              ? 'success'
                              : r.status === 'submitted'
                                ? 'warning'
                                : 'neutral'
                          }
                        >
                          {REVALUATION_STATUS[r.status]}
                        </Badge>
                        <span className="ep-mr-col__desc">
                          {r.status === 'submitted' && r.waitingWith
                            ? `with ${r.waitingWith}`
                            : [r.decidedBy, r.decidedAt ? when(r.decidedAt) : null, r.decisionNote]
                                .filter(Boolean)
                                .join(' · ')}
                        </span>
                      </td>
                      <td>
                        <span
                          style={{ display: 'inline-flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}
                        >
                          {r.can.decide ? (
                            <>
                              <ConfirmAction
                                action={approveRevaluation}
                                fields={{ id: r.id, storeId: s.id, back: here }}
                                label="Approve"
                                title={`Approve ${r.number}?`}
                                confirmLabel="Approve"
                                variant="primary"
                              >
                                {`At the last level what is in the store goes to ${inr(r.newRate)} per ${r.unit}. Asked for ${qty(r.qty)} ${r.unit}: ${inr(r.change)}.`}
                              </ConfirmAction>
                              <ConfirmAction
                                action={rejectRevaluation}
                                fields={{ id: r.id, storeId: s.id, back: here }}
                                label="Reject"
                                title={`Reject ${r.number}?`}
                                confirmLabel="Reject"
                                variant="ghost"
                                confirmVariant="danger"
                                reason={{ label: 'Why' }}
                              >
                                The rate stays as it is.
                              </ConfirmAction>
                            </>
                          ) : null}
                          {r.can.cancel ? (
                            <ConfirmAction
                              action={cancelRevaluation}
                              fields={{ id: r.id, storeId: s.id, back: here }}
                              label="Cancel"
                              title={`Cancel ${r.number}?`}
                              confirmLabel="Cancel it"
                              variant="ghost"
                              reason={{ label: 'Why', optional: true }}
                            >
                              The request is withdrawn; nothing changes.
                            </ConfirmAction>
                          ) : null}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>No rate correction asked for here yet.</p>
          )}
        </section>
      ) : null}

      {tab === 'post' && s.can.operate && lists ? (
        <section className="ep-card" aria-labelledby="st-open">
          <h2 id="st-open" className="ep-card__title">
            Post opening stock
          </h2>
          <p className="ep-field__help" style={{ marginTop: 0 }}>
            What the store holds on the day it starts in EduPro: by hand or from Excel (best for
            many items), checked before it posts. A mistake afterwards is changed under Opening
            stock posted.
          </p>
          <OpeningStock storeId={s.id} items={lists.items} />
        </section>
      ) : null}

      {tab === 'levels' && s.can.manage && lists && stock ? (
        <section className="ep-card" aria-labelledby="st-levels">
          <h2 id="st-levels" className="ep-card__title">
            Reorder levels
          </h2>
          <p className="ep-field__help" style={{ marginTop: 0 }}>
            When the free stock (in stock less reserved) falls to the reorder level, the item is
            listed for reordering; the reorder quantity is what to buy, the maximum what the store
            should hold. Leave a row empty to remove its levels. Saving keeps the other pages as
            they are.
          </p>
          <form method="get" className="ep-grid__toolbar" style={{ marginBottom: 'var(--sp-3)' }}>
            <input type="hidden" name="tab" value="levels" />
            <label className="ep-field" htmlFor="lv-q">
              <span className="ep-field__label">Find</span>
              <input
                id="lv-q"
                name="q"
                type="search"
                className="ep-input"
                defaultValue={q}
                placeholder="Item or code"
              />
            </label>
            <label className="ep-field" htmlFor="lv-cat">
              <span className="ep-field__label">Category</span>
              <select id="lv-cat" name="categoryId" className="ep-select" defaultValue={categoryId}>
                <option value="">All</option>
                {stock.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <PerPage id="lv-size" value={size} />
            <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
              Show
            </button>
          </form>
          <form action={saveStoreLevels}>
            <input type="hidden" name="id" value={s.id} />
            <input type="hidden" name="back" value={here} />
            <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="st-levels">
              <table className="ep-table ep-table--dense">
                <thead>
                  <tr>
                    <th scope="col">Item</th>
                    <th scope="col">Reorder level</th>
                    <th scope="col">Reorder quantity</th>
                    <th scope="col">Maximum</th>
                  </tr>
                </thead>
                <tbody>
                  {stock.data.map((x) => (
                    <tr key={x.itemId}>
                      <td>
                        <input type="hidden" name="itemId" value={x.itemId} />
                        {x.name} <span className="ep-mr-col__desc">in {x.unit}</span>
                      </td>
                      <td>
                        <input
                          name={`level_${x.itemId}`}
                          className="ep-input"
                          inputMode="decimal"
                          aria-label={`Reorder level of ${x.name}`}
                          defaultValue={x.reorderLevel ?? ''}
                        />
                      </td>
                      <td>
                        <input
                          name={`qty_${x.itemId}`}
                          className="ep-input"
                          inputMode="decimal"
                          aria-label={`Reorder quantity of ${x.name}`}
                          defaultValue={x.reorderQty ?? ''}
                        />
                      </td>
                      <td>
                        <input
                          name={`max_${x.itemId}`}
                          className="ep-input"
                          inputMode="decimal"
                          aria-label={`Maximum of ${x.name}`}
                          defaultValue={x.maxQty ?? ''}
                        />
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td>
                      <select
                        name="newItemId"
                        className="ep-select"
                        aria-label="Another item"
                        defaultValue=""
                      >
                        <option value="">Another item…</option>
                        {lists.items.map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.name} ({i.code}, {i.unit})
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        name="level_new"
                        className="ep-input"
                        inputMode="decimal"
                        aria-label="Reorder level of the other item"
                      />
                    </td>
                    <td>
                      <input
                        name="qty_new"
                        className="ep-input"
                        inputMode="decimal"
                        aria-label="Reorder quantity of the other item"
                      />
                    </td>
                    <td>
                      <input
                        name="max_new"
                        className="ep-input"
                        inputMode="decimal"
                        aria-label="Maximum of the other item"
                      />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p>
              <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm">
                Save this page’s levels
              </button>
            </p>
          </form>
          <Pager
            page={stock.page ?? 1}
            size={Number(size)}
            total={stock.total}
            noun="items"
            href={(n) => link({ page: String(n) })}
          />
        </section>
      ) : null}
    </>
  );
}
