import { Alert, Badge, Breadcrumbs, KpiTile, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { ConfirmAction } from '@/components/ConfirmAction';
import { FileLinks } from '@/components/FileLinks';
import { Notice } from '@/components/Notice';
import { CountSheet } from '@/components/purchase/CountSheet';
import { ApiError, apiFetch } from '@/lib/api';
import { COUNT_REASONS, COUNT_STATUS, type CountDetail, type StoreFormLists } from '@/lib/purchase';
import { approveCount, cancelCount, sendBackCount, submitCount } from '@/lib/purchase-actions';

const when = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }).format(new Date(iso.length === 10 ? `${iso}T00:00:00+05:30` : iso))
    : '—';
const money = (n: number) =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmt = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 3 });

/**
 * One physical count (docs/design/84, part 8; "As built — the count rebuilt", 9 Nov 2026). The figures
 * first — lines counted, excess, shortage, the net value — then what to do now. While counting, the
 * keeper's sheet (find, category, not yet counted, differences; the reason from a list; a save bar that
 * stays in view). Once sent: book, counted, excess, shortage, value and reason, filtered, with the
 * totals and a summary by reason, and the approval. Excel and PDF of the count at the top.
 */
export default async function CountPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d{1,18}$/.test(id)) notFound();
  const k = await apiFetch<CountDetail>(`/purchase/counts/${id}`).catch((e: unknown) => {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  });
  const st = COUNT_STATUS[k.status];
  const lists = k.can.count ? await apiFetch<StoreFormLists>('/purchase/store-form') : null;
  const f = k.figures;
  const counting = k.status === 'counting';

  // the review: differences only unless every line is asked for; a search
  const all = sp.show === 'all';
  const needle = (sp.q ?? '').trim().toLowerCase();
  const shown = k.lineItems.filter(
    (l) =>
      (all || (l.difference !== null && l.difference !== 0)) &&
      (!needle || `${l.item} ${l.itemCode} ${l.batch ?? ''}`.toLowerCase().includes(needle)),
  );
  const diffs = k.lineItems.filter((l) => l.difference);
  const byReason = new Map<string, { lines: number; value: number }>();
  for (const l of diffs) {
    const key = l.reasonCode ? COUNT_REASONS[l.reasonCode] : 'No reason given';
    const x = byReason.get(key) ?? { lines: 0, value: 0 };
    byReason.set(key, { lines: x.lines + 1, value: x.value + (l.value ?? 0) });
  }
  const total = (pick: (l: (typeof shown)[number]) => number) =>
    shown.reduce((a, l) => a + pick(l), 0);

  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Stores', href: '/purchase/stores' },
          { label: 'Physical counts', href: '/purchase/counts' },
          { label: k.number },
        ]}
      />
      <PageHeader
        kicker={`Purchase · Physical count · ${k.category ?? 'everything it holds'}`}
        title={`${k.number} · ${k.store}`}
        description={`Started ${when(k.countedOn)}${k.startedBy ? ` by ${k.startedBy}` : ''}${k.countedBy ? ` · counted by ${k.countedBy}` : ''}`}
        actions={
          <>
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href={`/api/purchase/stock-doc/counts/${k.id}?format=xlsx`}
            >
              Excel
            </a>
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href={`/api/purchase/stock-doc/counts/${k.id}?save=1`}
            >
              PDF
            </a>
            <FileLinks
              href={`/api/purchase/stock-doc/counts/${k.id}`}
              label={`${k.number} ${counting ? 'count sheet' : 'statement'} as a PDF`}
            />
          </>
        }
      />
      <Notice params={sp} />
      <div className="ep-dash-kpis ep-dash-kpis--4">
        <KpiTile
          label="Lines counted"
          value={`${String(f.counted)} of ${String(f.lines)}`}
          hint={<Badge tone={st.tone}>{st.label}</Badge>}
        />
        <KpiTile
          label="Excess"
          value={money(f.excessValue)}
          hint={`${String(f.excess)} line${f.excess === 1 ? '' : 's'} more than the book`}
        />
        <KpiTile
          label="Shortage"
          value={money(Math.abs(f.shortageValue))}
          hint={`${String(f.shortage)} line${f.shortage === 1 ? '' : 's'} less than the book`}
        />
        <KpiTile
          label="Net difference"
          value={money(f.net)}
          hint={
            f.noReason
              ? `${String(f.noReason)} difference${f.noReason === 1 ? '' : 's'} without a reason`
              : 'at the average rate'
          }
        />
      </div>
      {counting ? (
        <p className="ep-field__help">
          The sheet is blind: a line&apos;s book quantity shows only once it is counted.
        </p>
      ) : null}
      {k.decisionNote ? (
        <Alert tone={counting ? 'warning' : 'info'} title="Note">
          {k.decisionNote}
        </Alert>
      ) : null}
      {k.status === 'approved' ? (
        <p>
          Approved by {k.decidedBy ?? ''} on {when(k.decidedAt)}: the differences are posted as
          adjustments at the average rate.
        </p>
      ) : null}
      {k.can.decide || k.can.cancel || (k.can.submit && !lists) ? (
        <div
          style={{
            display: 'flex',
            gap: 'var(--sp-2)',
            flexWrap: 'wrap',
            marginBottom: 'var(--sp-3)',
          }}
        >
          {k.can.submit && !lists ? (
            <ConfirmAction
              action={submitCount}
              fields={{ id: k.id }}
              label="Send for approval"
              title={`Send ${k.number} for approval?`}
              confirmLabel="Send"
              variant="primary"
            >
              Every line must be counted (0 when none is found) and every difference must have its
              reason.
            </ConfirmAction>
          ) : null}
          {k.can.decide ? (
            <>
              <ConfirmAction
                action={approveCount}
                fields={{ id: k.id }}
                label="Approve: post the differences"
                title={`Approve ${k.number}?`}
                confirmLabel="Approve"
                variant="primary"
              >
                {diffs.length
                  ? `${String(diffs.length)} adjustments post to ${k.store} at the average rate: excess ${money(f.excessValue)}, shortage ${money(Math.abs(f.shortageValue))}, net ${money(f.net)}.`
                  : 'Nothing to adjust: the count is recorded.'}
              </ConfirmAction>
              <ConfirmAction
                action={sendBackCount}
                fields={{ id: k.id }}
                label="Send back to count again"
                title={`Send ${k.number} back?`}
                confirmLabel="Send back"
                variant="secondary"
                reason={{ label: 'What to count again' }}
              >
                The keeper counts again and sends it back.
              </ConfirmAction>
            </>
          ) : null}
          {k.can.cancel ? (
            <ConfirmAction
              action={cancelCount}
              fields={{ id: k.id }}
              label="Cancel the count"
              title={`Cancel ${k.number}?`}
              confirmLabel="Cancel it"
              variant="ghost"
              confirmVariant="danger"
              reason={{ label: 'Why it is cancelled' }}
            >
              Nothing is adjusted; a new count can be started.
            </ConfirmAction>
          ) : null}
        </div>
      ) : null}

      {k.can.count && lists ? (
        <section className="ep-card" aria-labelledby="ck-sheet">
          <h2 id="ck-sheet" className="ep-card__title">
            Count
          </h2>
          <p style={{ marginTop: 0 }}>
            Enter what is on the shelf, in the store unit (0 when none is found), and pick why a
            line differs. A wrong opening stock is better changed on the store&apos;s page than
            counted away.
          </p>
          <CountSheet
            count={k}
            items={lists.items.map((i) => ({
              id: i.id,
              code: i.code,
              name: i.name,
              tracksBatch: i.tracksBatch,
            }))}
          />
        </section>
      ) : (
        <>
          <section className="ep-card" aria-labelledby="ck-lines">
            <h2 id="ck-lines" className="ep-card__title">
              Book and count
            </h2>
            <form method="get" className="ep-grid__toolbar" style={{ marginBottom: 'var(--sp-3)' }}>
              <label className="ep-field" htmlFor="ck-q">
                <span className="ep-field__label">Find</span>
                <input
                  id="ck-q"
                  name="q"
                  type="search"
                  className="ep-input"
                  defaultValue={sp.q ?? ''}
                  placeholder="Item, code or batch"
                />
              </label>
              <label className="ep-field" htmlFor="ck-show">
                <span className="ep-field__label">Show</span>
                <select
                  id="ck-show"
                  name="show"
                  className="ep-select"
                  defaultValue={all ? 'all' : ''}
                >
                  <option value="">The differences ({diffs.length})</option>
                  <option value="all">Every line ({k.lineItems.length})</option>
                </select>
              </label>
              <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
                Show
              </button>
            </form>
            <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="ck-lines">
              <table className="ep-table ep-table--dense">
                <thead>
                  <tr>
                    <th scope="col">Item</th>
                    <th scope="col" style={{ textAlign: 'right' }}>
                      Book
                    </th>
                    <th scope="col" style={{ textAlign: 'right' }}>
                      Counted
                    </th>
                    <th scope="col" style={{ textAlign: 'right' }}>
                      Excess
                    </th>
                    <th scope="col" style={{ textAlign: 'right' }}>
                      Shortage
                    </th>
                    <th scope="col" style={{ textAlign: 'right' }}>
                      Value
                    </th>
                    <th scope="col">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.length ? (
                    shown.map((l) => (
                      <tr key={l.id}>
                        <td>
                          {l.item} ({l.itemCode})
                          <span className="ep-mr-col__desc">
                            {[l.category, l.batch ? `Batch ${l.batch}` : null, l.unit]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {l.book === null ? '—' : fmt(l.book)}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {l.counted === null ? '—' : fmt(l.counted)}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {l.difference && l.difference > 0 ? fmt(l.difference) : ''}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {l.difference && l.difference < 0 ? fmt(-l.difference) : ''}
                        </td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {l.difference && l.value !== null ? money(l.value) : ''}
                        </td>
                        <td>
                          {l.difference ? (
                            (l.reasonWords ?? <Badge tone="warning">No reason</Badge>)
                          ) : (
                            <Badge tone="success">Matches</Badge>
                          )}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={7}>
                        {diffs.length || all || needle
                          ? 'No line matches.'
                          : 'No difference: the shelves match the book.'}
                      </td>
                    </tr>
                  )}
                </tbody>
                {shown.length ? (
                  <tfoot>
                    <tr>
                      <td style={{ fontWeight: 600 }}>Total of the lines shown</td>
                      <td />
                      <td />
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>
                        {fmt(total((l) => (l.difference && l.difference > 0 ? l.difference : 0)))}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>
                        {fmt(total((l) => (l.difference && l.difference < 0 ? -l.difference : 0)))}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {money(total((l) => (l.difference ? (l.value ?? 0) : 0)))}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            </div>
          </section>
          {byReason.size ? (
            <section className="ep-card" aria-labelledby="ck-why">
              <h2 id="ck-why" className="ep-card__title">
                The differences by reason
              </h2>
              <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="ck-why">
                <table className="ep-table ep-table--dense">
                  <thead>
                    <tr>
                      <th scope="col">Reason</th>
                      <th scope="col" style={{ textAlign: 'right' }}>
                        Lines
                      </th>
                      <th scope="col" style={{ textAlign: 'right' }}>
                        Value
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...byReason.entries()].map(([reason, x]) => (
                      <tr key={reason}>
                        <td>{reason}</td>
                        <td style={{ textAlign: 'right' }}>{x.lines}</td>
                        <td style={{ textAlign: 'right' }}>{money(x.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
        </>
      )}
    </>
  );
}
