import { Badge, Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { ConfirmAction } from '@/components/ConfirmAction';
import { FileLinks } from '@/components/FileLinks';
import { FoldCard } from '@/components/FoldCard';
import { Notice } from '@/components/Notice';
import { OpeningFix } from '@/components/purchase/OpeningFix';
import { OpeningStock } from '@/components/purchase/OpeningStock';
import { ApiError, apiFetch } from '@/lib/api';
import {
  inr,
  type Revaluation,
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

/**
 * One store (docs/design/84, part 6): its details and keepers, its stock (quantity, reserved, free,
 * average rate, value, the reorder level and whether below it, the earliest expiry), the opening stock
 * posted — changed, removed or undone while untouched, with its statement — the rate corrections, the
 * opening stock to post (checked first), and the reorder levels ("As built — opening stock
 * corrections", 9 Nov 2026).
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
  if (!/^\d{1,18}$/.test(id)) notFound();
  const s = await apiFetch<StoreDetail>(`/purchase/stores/${id}`).catch((e: unknown) => {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  });
  const [lists, openings, revaluations] = await Promise.all([
    s.can.manage || s.can.operate
      ? apiFetch<StoreFormLists>('/purchase/store-form')
      : Promise.resolve(null),
    apiFetch<StoreOpenings>(`/purchase/stores/${id}/openings`).catch(() => null),
    apiFetch<{ rows: Revaluation[] }>(`/purchase/revaluations?storeId=${id}`)
      .then((r) => r.rows)
      .catch(() => [] as Revaluation[]),
  ]);
  // a rate correction is for what has moved since its opening (or came otherwise): untouched
  // openings are changed instead
  const revalue = s.stock.filter(
    (x) => x.qty > 0 && !(openings?.items[x.itemId]?.canChange ?? false),
  );
  const inStock = s.stock.filter((x) => x.qty > 0 || x.reserved > 0);
  const total = s.stock.reduce((a, x) => a + x.value, 0);
  const file = (format: 'xlsx' | 'pdf') =>
    `/api/purchase/stock-file?storeId=${s.id}&format=${format}`;
  const levelled = new Set(s.stock.map((x) => x.itemId));
  return (
    <>
      <Breadcrumbs items={[{ label: 'Stores', href: '/purchase/stores' }, { label: s.name }]} />
      <PageHeader
        kicker={`Purchase · ${s.kind === 'main' ? 'Main store' : 'Sub-store'}`}
        title={s.name}
        description={[s.code, s.department, s.location].filter(Boolean).join(' · ')}
        actions={
          <>
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href={file('xlsx')}>
              Excel
            </a>
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href={file('pdf')}>
              PDF
            </a>
            {s.can.manage ? (
              <a
                className="ep-btn ep-btn--secondary ep-btn--sm"
                href={`/purchase/stores/${s.id}/edit`}
              >
                Change
              </a>
            ) : null}
          </>
        }
      />
      <Notice params={sp} />
      {openings?.missingAssets.length ? (
        <div className="ep-alert ep-alert--warning" role="status">
          <div>
            <strong>Asset items without their assets</strong> — opening stock posted before openings
            made assets:{' '}
            {openings.missingAssets
              .map((m) => `${m.name} (${String(m.units - m.assets)} of ${String(m.units)})`)
              .join(', ')}
            . Each unit should be an asset with its tag and QR label.{' '}
            {s.can.operate && openings.missingAssets.some((m) => m.canMake) ? (
              <ConfirmAction
                action={makeOpeningAssets}
                fields={{ storeId: s.id }}
                label="Make their assets"
                title="Make the missing assets?"
                confirmLabel="Make them"
                variant="secondary"
              >
                One asset per unit, in this store, its cost the opening rate. Correct a wrong rate
                first (Change, below) — or change it afterwards: the assets take the new cost.
              </ConfirmAction>
            ) : null}
          </div>
        </div>
      ) : null}
      <section className="ep-card" aria-labelledby="st-facts">
        <h2 id="st-facts" className="ep-card__title">
          The store{' '}
          <Badge tone={s.status === 'active' ? 'success' : 'neutral'}>
            {s.status === 'active' ? 'Active' : 'Inactive'}
          </Badge>
        </h2>
        <dl className="ep-facts">
          <div>
            <dt>Keepers</dt>
            <dd>
              {s.keepers.length
                ? s.keepers.map((k) => `${k.name} (${k.code})`).join(', ')
                : 'Nobody yet: give the store a keeper'}
            </dd>
          </div>
          <div>
            <dt>Stock value</dt>
            <dd>
              <strong>{inr(total)}</strong> · {inStock.length} items
              {s.belowReorder ? ` · ${String(s.belowReorder)} below their reorder level` : ''}
            </dd>
          </div>
          {s.kind === 'sub' ? (
            <div>
              <dt>Under</dt>
              <dd>{s.parent}</dd>
            </div>
          ) : null}
          <div>
            <dt>Physical count</dt>
            <dd>
              <Badge tone={s.countedThisYear ? 'success' : 'warning'}>
                {s.countedThisYear ? 'Counted this year' : 'Not counted this year'}
              </Badge>{' '}
              {s.counts.length ? (
                <>
                  Last:{' '}
                  <a
                    href={`/purchase/counts/${s.counts[0]!.id}`}
                    style={{ textDecoration: 'underline' }}
                  >
                    {s.counts[0]!.number}
                  </a>{' '}
                  ({s.counts[0]!.countedOn})
                </>
              ) : (
                <a href="/purchase/counts" style={{ textDecoration: 'underline' }}>
                  Start a count
                </a>
              )}
            </dd>
          </div>
        </dl>
      </section>

      <section className="ep-card" aria-labelledby="st-stock">
        <h2 id="st-stock" className="ep-card__title">
          Stock
        </h2>
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
              </tr>
            </thead>
            <tbody>
              {inStock.length ? (
                inStock.map((x) => (
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
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7}>No stock yet: post the opening stock below, or receive goods.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {openings && openings.postings.length ? (
        <section className="ep-card" aria-labelledby="st-posted">
          <h2 id="st-posted" className="ep-card__title">
            Opening stock posted
          </h2>
          <p className="ep-field__help" style={{ marginTop: 0 }}>
            Each posting by hand or from Excel, the newest first. While an item has not moved since
            (no receipt, issue, transfer or approved count), its opening can be changed or removed
            with the reason — the wrong line is reversed and the right one posted, both in its
            register — and a whole upload undone. After that, the quantity is corrected by a
            physical count and the rate by a rate correction (below).
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
          <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
            {openings.postings.map((p, i) => {
              const standing = p.lines.filter((l) => !l.reversed);
              return (
                <FoldCard
                  key={p.id}
                  id={`op-${p.id}`}
                  open={i === 0}
                  title={
                    <>
                      {p.source === 'excel'
                        ? `From Excel${p.fileName ? ` (${p.fileName})` : ''}`
                        : p.source === 'correction'
                          ? 'Correction'
                          : 'By hand'}{' '}
                      {p.undoneAt ? <Badge tone="neutral">Undone</Badge> : null}
                    </>
                  }
                  hint={[
                    `${String(p.lines.length)} line${p.lines.length === 1 ? '' : 's'}`,
                    inr(p.value),
                    [p.by, when(p.at)].filter(Boolean).join(', '),
                    p.reason ? `why: ${p.reason}` : null,
                    p.undoneAt
                      ? `undone ${when(p.undoneAt)}${p.undoneBy ? ` by ${p.undoneBy}` : ''}: ${p.undoReason ?? ''}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                >
                  <div
                    className="ep-table-wrap"
                    tabIndex={0}
                    role="region"
                    aria-labelledby={`op-${p.id}`}
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
                        {p.lines.map((l) => {
                          const st = openings.items[l.itemId];
                          const all = openings.postings
                            .flatMap((x) => x.lines)
                            .filter((x) => x.itemId === l.itemId && !x.reversed);
                          return (
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
                                  <span className="ep-field__help">
                                    Reversed{p.undoneAt ? ' (upload undone)' : ''}
                                  </span>
                                ) : st?.canChange && s.can.operate ? (
                                  <span style={{ display: 'inline-flex', gap: 'var(--sp-2)' }}>
                                    <OpeningFix
                                      storeId={s.id}
                                      itemId={l.itemId}
                                      name={l.name}
                                      unit={l.unit}
                                      batch={Boolean(l.batch)}
                                      asset={l.asset}
                                      lines={all}
                                      mode="change"
                                    />
                                    <OpeningFix
                                      storeId={s.id}
                                      itemId={l.itemId}
                                      name={l.name}
                                      unit={l.unit}
                                      batch={Boolean(l.batch)}
                                      asset={l.asset}
                                      lines={all}
                                      mode="remove"
                                    />
                                  </span>
                                ) : st?.why ? (
                                  <span className="ep-field__help">Settled: {st.why}</span>
                                ) : null}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {p.canUndo && s.can.operate && p.source !== 'correction' ? (
                    <p style={{ marginBottom: 0 }}>
                      <ConfirmAction
                        action={undoOpening}
                        fields={{ id: p.id, storeId: s.id }}
                        label={p.source === 'excel' ? 'Undo this upload' : 'Undo this posting'}
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
                        {`Its ${String(standing.length)} standing line${standing.length === 1 ? ' is' : 's are'} reversed (worth ${inr(p.value)}) and the assets made from it taken off the register. The posting stays on record as undone.`}
                      </ConfirmAction>
                    </p>
                  ) : null}
                </FoldCard>
              );
            })}
          </div>
        </section>
      ) : null}

      {revaluations.length || (s.can.operate && revalue.length) ? (
        <section className="ep-card" aria-labelledby="st-rate">
          <h2 id="st-rate" className="ep-card__title">
            Rate corrections
          </h2>
          <p className="ep-field__help" style={{ marginTop: 0 }}>
            For an item that has moved since its opening (or came on a receipt) at a wrong rate:
            what is left in the store goes to the right rate once the school admin (not who asked)
            approves. What was issued before keeps the old value.
          </p>
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
                        {r.decidedBy ? (
                          <span className="ep-mr-col__desc">
                            {[r.decidedBy, r.decidedAt ? when(r.decidedAt) : null, r.decisionNote]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        ) : null}
                      </td>
                      <td>
                        <span
                          style={{ display: 'inline-flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}
                        >
                          {r.can.decide ? (
                            <>
                              <ConfirmAction
                                action={approveRevaluation}
                                fields={{ id: r.id, storeId: s.id }}
                                label="Approve"
                                title={`Approve ${r.number}?`}
                                confirmLabel="Approve"
                                variant="primary"
                              >
                                {`What is in the store now goes to ${inr(r.newRate)} per ${r.unit}. Asked for ${qty(r.qty)} ${r.unit}: ${inr(r.change)}.`}
                              </ConfirmAction>
                              <ConfirmAction
                                action={rejectRevaluation}
                                fields={{ id: r.id, storeId: s.id }}
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
                              fields={{ id: r.id, storeId: s.id }}
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
          ) : null}
          {s.can.operate && revalue.length ? (
            <details className="ep-cell-fold" style={{ marginTop: 'var(--sp-3)' }}>
              <summary>Ask for a rate correction</summary>
              <form action={requestRevaluation} className="ep-grid__toolbar">
                <input type="hidden" name="storeId" value={s.id} />
                <label className="ep-field" htmlFor="rv-item">
                  <span className="ep-field__label">Item</span>
                  <select id="rv-item" name="itemId" className="ep-select" required defaultValue="">
                    <option value="">Pick the item</option>
                    {revalue.map((x) => (
                      <option key={x.itemId} value={x.itemId}>
                        {x.name} — {qty(x.qty)} {x.unit} at {inr(x.avgRate)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="ep-field" htmlFor="rv-rate">
                  <span className="ep-field__label">Right rate per unit (₹)</span>
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
                <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
                  Send for approval
                </button>
              </form>
            </details>
          ) : null}
        </section>
      ) : null}

      {s.can.operate && lists ? (
        <FoldCard
          id="st-open"
          open={!openings?.postings.length}
          title="Post opening stock"
          hint="What the store holds on the day it starts in EduPro: by hand or from Excel, checked before it posts"
        >
          <OpeningStock storeId={s.id} items={lists.items} />
        </FoldCard>
      ) : null}

      {s.can.manage && lists ? (
        <section className="ep-card" aria-labelledby="st-levels">
          <h2 id="st-levels" className="ep-card__title">
            Reorder levels
          </h2>
          <p className="ep-field__help" style={{ marginTop: 0 }}>
            When the free stock (in stock less reserved) falls to the reorder level, the item is
            listed for reordering; the reorder quantity is what to buy, the maximum what the store
            should hold. Leave a row empty to remove its levels.
          </p>
          <form action={saveStoreLevels}>
            <input type="hidden" name="id" value={s.id} />
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
                  {s.stock.map((x) => (
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
                        {lists.items
                          .filter((i) => !levelled.has(i.id))
                          .map((i) => (
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
                Save the reorder levels
              </button>
            </p>
          </form>
        </section>
      ) : null}
    </>
  );
}
