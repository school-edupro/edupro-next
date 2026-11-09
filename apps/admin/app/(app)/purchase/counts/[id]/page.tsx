import { Alert, Badge, Breadcrumbs, KpiTile, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { ConfirmAction } from '@/components/ConfirmAction';
import { FileLinks } from '@/components/FileLinks';
import { Notice } from '@/components/Notice';
import { CountSheet } from '@/components/purchase/CountSheet';
import { ApiError, apiFetch, getMe } from '@/lib/api';
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
const SIZES = ['25', '50', '100'] as const;
const STEP: Record<string, { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }> =
  {
    pending: { label: 'Waiting', tone: 'warning' },
    approved: { label: 'Approved', tone: 'success' },
    rejected: { label: 'Sent back', tone: 'danger' },
    skipped: { label: 'Skipped', tone: 'neutral' },
  };

/**
 * One physical count (docs/design/84, part 8; "As built — the count rebuilt" and "— count approval on
 * Who approves", 9 Nov 2026). The figures over the whole count; who approves it (the Physical count
 * levels of the store's department on Purchase → Who approves — none: the school admin) and where it
 * waits; then a page of its lines at a time, found by item, category, status and reason — the keeper's
 * counting sheet while counting, the review once sent. Excel and PDF of the whole count at the top.
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
  const size = SIZES.includes(sp.size as (typeof SIZES)[number]) ? sp.size! : '50';
  const page = Math.max(1, Number(sp.page) || 1);
  const q = (sp.q ?? '').trim().slice(0, 80);
  const reason = sp.reason && (sp.reason in COUNT_REASONS || sp.reason === 'none') ? sp.reason : '';
  // without a choice the API shows every line while counting, the differences once sent
  const asked = sp.show === 'all' || sp.show === 'todo' || sp.show === 'diff' ? sp.show : '';
  const qs = new URLSearchParams({ page: String(page), size });
  if (asked) qs.set('show', asked);
  if (q) qs.set('q', q);
  if (sp.category) qs.set('category', sp.category.slice(0, 80));
  if (reason) qs.set('reason', reason);
  const [k, me] = await Promise.all([
    apiFetch<CountDetail>(`/purchase/counts/${id}?${qs.toString()}`).catch((e: unknown) => {
      if (e instanceof ApiError && (e.status === 404 || e.status === 403)) notFound();
      throw e;
    }),
    getMe(),
  ]);
  const counting = k.status === 'counting';
  const show = k.show;
  const st = COUNT_STATUS[k.status];
  const lists = k.can.count ? await apiFetch<StoreFormLists>('/purchase/store-form') : null;
  const f = k.figures;
  const a = k.approval;
  const filtered = Boolean(q || sp.category || reason || sp.show);
  const link = (p: Record<string, string>) => {
    const u = new URLSearchParams({ show, size, page: String(k.page ?? 1) });
    if (q) u.set('q', q);
    if (sp.category) u.set('category', sp.category);
    if (reason) u.set('reason', reason);
    for (const [key, v] of Object.entries(p)) u.set(key, v);
    return `/purchase/counts/${k.id}?${u.toString()}`;
  };
  const pages = Math.max(1, Math.ceil(k.found / k.size));

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

      <section className="ep-card" aria-labelledby="ck-who">
        <h2 id="ck-who" className="ep-card__title">
          Who approves
        </h2>
        {a.steps.length ? (
          <ol className="ep-purch-checks" style={{ marginTop: 0 }}>
            {a.steps.map((s) => (
              <li key={s.level}>
                <strong>
                  Level {s.level}: {s.name}
                </strong>{' '}
                <Badge tone={STEP[s.status]?.tone ?? 'neutral'}>
                  {s.status === 'pending' && a.currentLevel !== s.level
                    ? 'Next'
                    : (STEP[s.status]?.label ?? s.status)}
                </Badge>{' '}
                {s.status === 'pending' ? (
                  <>
                    — {s.assignees.length ? s.assignees.join(', ') : 'nobody holds it'}
                    {s.overdue ? ' · past its time' : ''}
                    {a.mine && a.currentLevel === s.level ? ' (you)' : ''}
                  </>
                ) : (
                  <>
                    — {[s.actedBy, s.actedAt ? when(s.actedAt) : null].filter(Boolean).join(', ')}
                    {s.note ? `: ${s.note}` : ''}
                  </>
                )}
              </li>
            ))}
          </ol>
        ) : k.status === 'submitted' ? (
          <p style={{ marginTop: 0 }}>
            It waits for the <strong>school admin</strong>: it was sent before counts went by the
            levels on Who approves. The next counts of this store go by them.
          </p>
        ) : k.status !== 'counting' ? (
          <p style={{ marginTop: 0 }}>
            {k.status === 'approved'
              ? `Approved by ${k.decidedBy ?? 'the school admin'}.`
              : 'Cancelled: nobody approves it.'}
          </p>
        ) : (
          <p style={{ marginTop: 0 }}>
            Once sent, it goes to{' '}
            {a.levels.length ? (
              <>
                the Physical count levels of <strong>{a.department}</strong>: {a.levels.join(' → ')}
              </>
            ) : (
              <>
                the <strong>school admin</strong> (no Physical count levels are set for{' '}
                {a.department ?? 'the store’s department'})
              </>
            )}
            . Whoever started or counted it never approves it.
          </p>
        )}
        {!a.departmentId ? (
          <p className="ep-alert ep-alert--warning" role="status">
            {k.store} has no department and Purchase settings names no purchase office department,
            so only the school admin can approve its counts. To choose who approves, give the store
            a department (Stores → {k.store} → Change) or set the purchase office department in
            Purchase settings, then set its Physical count levels on Who approves.
          </p>
        ) : null}
        <p className="ep-field__help" style={{ marginBottom: 0 }}>
          Set on{' '}
          {me.permissions.includes('purchase.master.view') ? (
            <a href={`/purchase/approvals${a.departmentId ? `?department=${a.departmentId}` : ''}`}>
              Purchase → Who approves
            </a>
          ) : (
            'Purchase → Who approves'
          )}{' '}
          → {a.department ?? 'the store’s department'} → Physical count (the store’s department; the
          Main store and stores without one go by the purchase office department).
        </p>
      </section>

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
                label="Approve"
                title={`Approve ${k.number}?`}
                confirmLabel="Approve"
                variant="primary"
              >
                {`At the last level ${String(f.excess + f.shortage)} adjustments post to ${k.store} at the average rate: excess ${money(f.excessValue)}, shortage ${money(Math.abs(f.shortageValue))}, net ${money(f.net)}. Before it, the next level approves.`}
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

      <section className="ep-card" aria-labelledby="ck-lines">
        <h2 id="ck-lines" className="ep-card__title">
          {counting && lists ? 'Count' : 'Book and count'}
        </h2>
        <form method="get" className="ep-grid__toolbar" style={{ marginBottom: 'var(--sp-3)' }}>
          <label className="ep-field" htmlFor="ck-q">
            <span className="ep-field__label">Find</span>
            <input
              id="ck-q"
              name="q"
              type="search"
              className="ep-input"
              defaultValue={q}
              placeholder="Item, code or batch"
            />
          </label>
          {k.categories.length > 1 ? (
            <label className="ep-field" htmlFor="ck-cat">
              <span className="ep-field__label">Category</span>
              <select
                id="ck-cat"
                name="category"
                className="ep-select"
                defaultValue={sp.category ?? ''}
              >
                <option value="">All</option>
                {k.categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="ep-field" htmlFor="ck-show">
            <span className="ep-field__label">Show</span>
            <select id="ck-show" name="show" className="ep-select" defaultValue={show}>
              <option value="all">Every line ({f.lines})</option>
              <option value="todo">Not yet counted ({f.lines - f.counted})</option>
              <option value="diff">With a difference ({f.excess + f.shortage})</option>
            </select>
          </label>
          <label className="ep-field" htmlFor="ck-reason">
            <span className="ep-field__label">Reason</span>
            <select id="ck-reason" name="reason" className="ep-select" defaultValue={reason}>
              <option value="">Any</option>
              {Object.entries(COUNT_REASONS).map(([key, l]) => (
                <option key={key} value={key}>
                  {l}
                </option>
              ))}
              <option value="none">No reason given</option>
            </select>
          </label>
          <label className="ep-field" htmlFor="ck-size">
            <span className="ep-field__label">Per page</span>
            <select id="ck-size" name="size" className="ep-select" defaultValue={size}>
              {SIZES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
            Show
          </button>
          {filtered ? (
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href={`/purchase/counts/${k.id}`}>
              Clear
            </a>
          ) : null}
        </form>

        {k.can.count && lists ? (
          <CountSheet
            count={k}
            items={lists.items.map((i) => ({
              id: i.id,
              code: i.code,
              name: i.name,
              tracksBatch: i.tracksBatch,
            }))}
            pager={{
              page: k.page ?? 1,
              pages,
              found: k.found,
              first: link({ page: '1' }),
              prev: link({ page: String((k.page ?? 1) - 1) }),
              next: link({ page: String((k.page ?? 1) + 1) }),
              last: link({ page: String(pages) }),
            }}
          />
        ) : (
          <>
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
                  {k.lineItems.length ? (
                    k.lineItems.map((l) => (
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
                          ) : l.counted === null ? (
                            ''
                          ) : (
                            <Badge tone="success">Matches</Badge>
                          )}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={7}>
                        {f.excess + f.shortage || filtered
                          ? 'No line matches.'
                          : 'No difference: the shelves match the book.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <nav aria-label="Pages of lines" className="ep-field__help">
              {k.found} line{k.found === 1 ? '' : 's'}
              {pages > 1 ? (
                <>
                  {' '}
                  · page {k.page ?? 1} of {pages} ·{' '}
                  {(k.page ?? 1) > 1 ? (
                    <a href={link({ page: String((k.page ?? 1) - 1) })}>Previous</a>
                  ) : null}{' '}
                  {(k.page ?? 1) < pages ? (
                    <a href={link({ page: String((k.page ?? 1) + 1) })}>Next</a>
                  ) : null}
                </>
              ) : null}
            </nav>
          </>
        )}
      </section>

      {k.byReason.length ? (
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
                {k.byReason.map((x) => (
                  <tr key={x.code}>
                    <td>
                      <a href={`/purchase/counts/${k.id}?show=diff&reason=${x.code}`}>{x.words}</a>
                    </td>
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
  );
}
