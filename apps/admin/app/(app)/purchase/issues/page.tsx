import { Badge, Breadcrumbs, KpiTile, PageHeader } from '@edupro/ui';
import { ConfirmAction } from '@/components/ConfirmAction';
import { FileLinks } from '@/components/FileLinks';
import { Notice } from '@/components/Notice';
import { apiFetch, getMe } from '@/lib/api';
import {
  inr,
  toIssueGroups,
  type IssueList,
  type ReportFilters,
  type ToIssueGroup,
  type ToIssueResponse,
} from '@/lib/purchase';
import { releaseHold } from '@/lib/purchase-actions';

const TABS = [
  ['to-issue', 'To issue'],
  ['waiting', 'Waiting for acknowledgement'],
  ['mine', 'To acknowledge'],
  ['all', 'All'],
] as const;
type Tab = (typeof TABS)[number][0];
const KINDS = [
  ['indent', 'For an indent or a requisition'],
  ['receipt', 'On receipt, for the indent'],
  ['counter', 'Counter issue'],
] as const;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^\d{1,18}$/;
const DAY_MS = 86_400_000;
const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const when = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(iso.length === 10 ? `${iso}T00:00:00+05:30` : iso));
const qty = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 3 });
/** Whole days since an approval (the queue's wait). */
const daysSince = (iso: string | null) =>
  iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / DAY_MS)) : null;
const short = (g: ToIssueGroup) => g.lines.some((l) => l.inHand < l.toIssue);

/**
 * Issues (docs/design/84, part 8; "As built — issues and returns rebuilt", 8 Nov 2026). To issue: the
 * store's work queue — what approved indents hold and approved requisitions reserved, one row per
 * document and store, oldest first, whether the store has it all, the lines folded under the row. The
 * lists: figures, then filters (period, store, department, kind, status, item, search), the issues and
 * their slips. Report opens the issue register (or the unacknowledged issues) with the same filters.
 */
export default async function IssuesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  const keeper = ['purchase.store.operate', 'purchase.store.manage'].some((p) =>
    me.permissions.includes(p),
  );
  const sees = me.permissions.includes('purchase.store.view');
  const tab: Tab = TABS.some(([k]) => k === sp.tab)
    ? (sp.tab as Tab)
    : keeper
      ? 'to-issue'
      : 'mine';
  const page = Math.max(1, Number(sp.page) || 1);

  // the filters: the period is this month on All unless chosen (an empty box: no limit)
  const from = sp.from === undefined ? (tab === 'all' ? `${today().slice(0, 8)}01` : '') : sp.from;
  const f = {
    from: DAY.test(from) ? from : '',
    to: sp.to && DAY.test(sp.to) ? sp.to : '',
    storeId: sp.storeId && ID.test(sp.storeId) ? sp.storeId : '',
    departmentId: sp.departmentId && ID.test(sp.departmentId) ? sp.departmentId : '',
    itemId: sp.itemId && ID.test(sp.itemId) ? sp.itemId : '',
    kind: KINDS.some(([k]) => k === sp.kind) ? (sp.kind as string) : '',
    status: sp.status === 'issued' || sp.status === 'acknowledged' ? sp.status : '',
    source: sp.source === 'indent' || sp.source === 'requisition' ? sp.source : '',
    short: sp.short === '1' ? '1' : '',
    q: (sp.q ?? '').trim().slice(0, 80),
  };

  const qs = new URLSearchParams({ page: String(page) });
  if (tab === 'waiting') qs.set('status', 'issued');
  if (tab === 'mine') qs.set('mine', '1');
  if (tab === 'all' && f.status) qs.set('status', f.status);
  for (const k of ['from', 'to', 'storeId', 'departmentId', 'itemId', 'kind', 'q'] as const)
    if (f[k]) qs.set(k, f[k]);
  const [list, queue, lists] = await Promise.all([
    apiFetch<IssueList>(`/purchase/issues?${qs.toString()}`),
    keeper && tab === 'to-issue'
      ? apiFetch<ToIssueResponse>('/purchase/to-issue').then(toIssueGroups)
      : Promise.resolve([] as ToIssueGroup[]),
    sees && tab !== 'to-issue'
      ? apiFetch<ReportFilters>('/purchase/report-filters')
      : Promise.resolve(null),
  ]);

  // the queue, oldest approval first, then filtered here (it is one store keeper's work)
  const all = [...queue].sort((a, b) => (a.approvedAt ?? '9').localeCompare(b.approvedAt ?? '9'));
  const q = f.q.toLowerCase();
  const shown = all.filter(
    (g) =>
      (!f.storeId || g.storeId === f.storeId) &&
      (!f.departmentId || g.departmentId === f.departmentId) &&
      (!f.source || (f.source === 'indent') === Boolean(g.indentId)) &&
      (!f.short || short(g)) &&
      (!q ||
        [g.requisition, g.department, g.raisedBy, g.purpose, g.indents, g.store]
          .concat(g.lines.flatMap((l) => [l.item, l.itemCode]))
          .some((v) => v?.toLowerCase().includes(q))),
  );
  const pick = <T,>(xs: T[], key: (x: T) => string, name: (x: T) => string) =>
    [...new Map(xs.map((x) => [key(x), name(x)])).entries()].sort((a, b) =>
      a[1].localeCompare(b[1]),
    );
  const queueStores = pick(
    all,
    (g) => g.storeId,
    (g) => g.store,
  );
  const queueDepts = pick(
    all.filter((g) => g.departmentId),
    (g) => g.departmentId!,
    (g) => g.department ?? '',
  );
  const oldest = all.reduce<number | null>((m, g) => {
    const d = daysSince(g.approvedAt);
    return d === null ? m : Math.max(m ?? 0, d);
  }, null);

  /** this page with the same filters (an emptied From on All stays empty: no limit) */
  const link = (p: Record<string, string>) => {
    const u = new URLSearchParams({ tab });
    for (const [k, v] of Object.entries(f)) if (v) u.set(k, v);
    if (tab === 'all' && !f.from) u.set('from', '');
    for (const [k, v] of Object.entries(p)) u.set(k, v);
    return `/purchase/issues?${u.toString()}`;
  };
  const report =
    tab === 'waiting' || tab === 'mine'
      ? `/purchase/reports?${new URLSearchParams(
          Object.entries({
            report: 'unacknowledged',
            storeId: f.storeId,
            departmentId: f.departmentId,
          }).filter(([, v]) => v),
        ).toString()}`
      : `/purchase/reports?${new URLSearchParams(
          Object.entries({
            report: 'issue_register',
            from: f.from,
            to: f.to,
            storeId: f.storeId,
            departmentId: f.departmentId,
            itemId: f.itemId,
            status: tab === 'all' ? f.status : '',
          }).filter(([, v]) => v),
        ).toString()}`;
  const filtered =
    tab === 'to-issue'
      ? Boolean(f.storeId || f.departmentId || f.source || f.short || f.q)
      : Boolean(
          (tab === 'all' ? sp.from !== undefined : f.from) ||
          f.to ||
          f.storeId ||
          f.departmentId ||
          f.itemId ||
          f.kind ||
          f.status ||
          f.q,
        );

  return (
    <>
      <Breadcrumbs items={[{ label: 'Purchase', href: '/purchase' }, { label: 'Issues' }]} />
      <PageHeader
        kicker="Purchase"
        title="Issues"
        description="What the stores give out — for an approved indent or requisition, on a goods receipt, or at the counter — and the department’s acknowledgement of it."
        actions={
          <>
            {keeper ? (
              <a className="ep-btn ep-btn--primary ep-btn--sm" href="/purchase/issues/new">
                Counter issue
              </a>
            ) : null}
            {sees && tab !== 'to-issue' ? (
              <a className="ep-btn ep-btn--secondary ep-btn--sm" href={report}>
                Report
              </a>
            ) : null}
          </>
        }
      />
      <Notice params={sp} />
      <nav aria-label="Issues to show" className="ep-tabs" style={{ marginBottom: 'var(--sp-3)' }}>
        <div className="ep-tabs__list">
          {TABS.filter(([k]) => (k === 'to-issue' ? keeper : k === 'mine' ? true : sees)).map(
            ([k, l]) => (
              <a
                key={k}
                className="ep-tabs__tab"
                href={`/purchase/issues?tab=${k}`}
                aria-current={tab === k ? 'page' : undefined}
              >
                {l}
                {k === 'mine' ? ` (${String(list.toAcknowledge)})` : ''}
              </a>
            ),
          )}
        </div>
      </nav>

      {tab === 'to-issue' ? (
        <>
          <div className="ep-dash-kpis ep-dash-kpis--4">
            <KpiTile label="Documents to issue" value={String(all.length)} />
            <KpiTile
              label="Lines to issue"
              value={String(all.reduce((n, g) => n + g.lines.length, 0))}
            />
            <KpiTile
              label="Short of stock"
              value={String(all.filter(short).length)}
              hint="the store has less than is to issue"
            />
            <KpiTile
              label="Oldest waiting"
              value={oldest === null ? '—' : `${String(oldest)} day${oldest === 1 ? '' : 's'}`}
              hint="since its approval"
            />
          </div>
          {all.length ? (
            <form method="get" action="/purchase/issues" className="ep-grid__toolbar">
              <input type="hidden" name="tab" value="to-issue" />
              <label className="ep-field" htmlFor="ti-store">
                <span className="ep-field__label">Store</span>
                <select id="ti-store" name="storeId" className="ep-select" defaultValue={f.storeId}>
                  <option value="">All</option>
                  {queueStores.map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ep-field" htmlFor="ti-dept">
                <span className="ep-field__label">Department</span>
                <select
                  id="ti-dept"
                  name="departmentId"
                  className="ep-select"
                  defaultValue={f.departmentId}
                >
                  <option value="">All</option>
                  {queueDepts.map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ep-field" htmlFor="ti-src">
                <span className="ep-field__label">For</span>
                <select id="ti-src" name="source" className="ep-select" defaultValue={f.source}>
                  <option value="">Indents and requisitions</option>
                  <option value="indent">Indents (held from stock)</option>
                  <option value="requisition">Requisitions (reserved)</option>
                </select>
              </label>
              <label className="ep-field" htmlFor="ti-q">
                <span className="ep-field__label">Search</span>
                <input
                  id="ti-q"
                  name="q"
                  className="ep-input"
                  defaultValue={f.q}
                  placeholder="Number, item, department or who raised it"
                />
              </label>
              <label className="ep-check" htmlFor="ti-short" style={{ alignSelf: 'center' }}>
                <input
                  id="ti-short"
                  className="ep-check__input"
                  type="checkbox"
                  name="short"
                  value="1"
                  defaultChecked={Boolean(f.short)}
                />
                <span className="ep-check__box" />
                Short of stock only
              </label>
              <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
                Show
              </button>
              {filtered ? (
                <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/purchase/issues?tab=to-issue">
                  Clear
                </a>
              ) : null}
            </form>
          ) : null}
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="To issue">
            <table className="ep-table">
              <caption className="ep-sr-only">
                Indents and requisitions waiting to be issued, oldest first
              </caption>
              <thead>
                <tr>
                  <th scope="col">Document</th>
                  <th scope="col">Department</th>
                  <th scope="col">Store</th>
                  <th scope="col">Items</th>
                  <th scope="col">Waiting</th>
                  <th scope="col">Stock</th>
                  <th scope="col">
                    <span className="ep-sr-only">Issue</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.length ? (
                  shown.map((g) => {
                    const days = daysSince(g.approvedAt);
                    const isShort = short(g);
                    return (
                      <tr key={`${g.indentId ?? g.requisitionId}-${g.storeId}`}>
                        <td>
                          <a
                            href={
                              g.indentId
                                ? `/purchase/indents/${g.indentId}`
                                : `/purchase/requisitions/${g.requisitionId}`
                            }
                          >
                            {g.requisition}
                          </a>{' '}
                          <Badge tone={g.indentId ? 'info' : 'neutral'}>
                            {g.indentId ? 'Indent' : 'Requisition'}
                          </Badge>
                          <span className="ep-mr-col__desc">
                            {[g.indents ? `for ${g.indents}` : null, g.purpose]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        </td>
                        <td>
                          {g.department ?? '—'}
                          {g.raisedBy ? (
                            <span className="ep-mr-col__desc">raised by {g.raisedBy}</span>
                          ) : null}
                        </td>
                        <td>{g.store}</td>
                        <td>
                          <details className="ep-cell-fold">
                            <summary>
                              {g.lines.length} item{g.lines.length === 1 ? '' : 's'}
                            </summary>
                            <ul className="ep-cell-fold__lines">
                              {g.lines.map((l) => (
                                <li key={l.reservationId}>
                                  {l.item} ({l.itemCode}): <strong>{qty(l.toIssue)}</strong>{' '}
                                  {l.unit} to issue
                                  {l.issued ? ` (${qty(l.issued)} issued)` : ''} · {qty(l.inHand)}{' '}
                                  in hand{' '}
                                  {l.inHand < l.toIssue ? <Badge tone="danger">Short</Badge> : null}{' '}
                                  {g.indentId ? (
                                    <ConfirmAction
                                      action={releaseHold}
                                      fields={{ reservationId: l.reservationId }}
                                      label="Cannot give it"
                                      title={`Send ${l.item} on ${g.requisition} to purchase?`}
                                      confirmLabel="Send to purchase"
                                      variant="ghost"
                                      reason={{ label: 'Why the store cannot give it' }}
                                    >
                                      {`The ${qty(l.toIssue)} ${l.unit} held are let go; the indent waits for a requisition for them (Purchase Requisitions → To requisition).`}
                                    </ConfirmAction>
                                  ) : null}
                                </li>
                              ))}
                            </ul>
                          </details>
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          {days === null ? '—' : `${String(days)} day${days === 1 ? '' : 's'}`}
                          {g.approvedAt ? (
                            <span className="ep-mr-col__desc">since {when(g.approvedAt)}</span>
                          ) : null}
                        </td>
                        <td>
                          <Badge tone={isShort ? 'danger' : 'success'}>
                            {isShort ? 'Short' : 'Ready'}
                          </Badge>
                        </td>
                        <td>
                          <a
                            className="ep-btn ep-btn--secondary ep-btn--sm"
                            href={
                              g.indentId
                                ? `/purchase/issues/new?indent=${g.indentId}&store=${g.storeId}`
                                : `/purchase/issues/new?requisition=${g.requisitionId}&store=${g.storeId}`
                            }
                            aria-label={`Issue ${g.requisition} from ${g.store}`}
                          >
                            Issue
                          </a>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={7}>
                      {all.length
                        ? 'Nothing waiting matches these filters.'
                        : 'Nothing held for an indent or reserved on a requisition waits to be issued from your stores.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="ep-field__help">
            Short: the store has less in hand than is to issue — issue what there is, or (for an
            indent) press Cannot give it on the line to send the rest to purchase.
          </p>
        </>
      ) : (
        <>
          <div className="ep-dash-kpis ep-dash-kpis--4">
            <KpiTile label="Issues" value={String(list.figures.issues)} hint="in these filters" />
            <KpiTile label="Value issued" value={inr(list.figures.value)} />
            <KpiTile label="Waiting for acknowledgement" value={String(list.figures.waiting)} />
            <KpiTile
              label="Oldest unacknowledged"
              value={
                list.figures.oldestWaitingDays === null
                  ? '—'
                  : `${String(list.figures.oldestWaitingDays)} day${list.figures.oldestWaitingDays === 1 ? '' : 's'}`
              }
            />
          </div>
          <form method="get" action="/purchase/issues" className="ep-grid__toolbar">
            <input type="hidden" name="tab" value={tab} />
            <label className="ep-field" htmlFor="is-from">
              <span className="ep-field__label">From</span>
              <input
                id="is-from"
                name="from"
                type="date"
                className="ep-input"
                defaultValue={f.from}
              />
            </label>
            <label className="ep-field" htmlFor="is-to">
              <span className="ep-field__label">To</span>
              <input id="is-to" name="to" type="date" className="ep-input" defaultValue={f.to} />
            </label>
            {lists ? (
              <>
                <label className="ep-field" htmlFor="is-store">
                  <span className="ep-field__label">Store</span>
                  <select
                    id="is-store"
                    name="storeId"
                    className="ep-select"
                    defaultValue={f.storeId}
                  >
                    <option value="">All</option>
                    {lists.stores.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="ep-field" htmlFor="is-dept">
                  <span className="ep-field__label">Department</span>
                  <select
                    id="is-dept"
                    name="departmentId"
                    className="ep-select"
                    defaultValue={f.departmentId}
                  >
                    <option value="">All</option>
                    {lists.departments.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="ep-field" htmlFor="is-item">
                  <span className="ep-field__label">Item</span>
                  <select id="is-item" name="itemId" className="ep-select" defaultValue={f.itemId}>
                    <option value="">All</option>
                    {lists.items.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name} ({x.code})
                      </option>
                    ))}
                  </select>
                </label>
              </>
            ) : null}
            <label className="ep-field" htmlFor="is-kind">
              <span className="ep-field__label">Kind</span>
              <select id="is-kind" name="kind" className="ep-select" defaultValue={f.kind}>
                <option value="">All</option>
                {KINDS.map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            {tab === 'all' ? (
              <label className="ep-field" htmlFor="is-status">
                <span className="ep-field__label">Status</span>
                <select id="is-status" name="status" className="ep-select" defaultValue={f.status}>
                  <option value="">All</option>
                  <option value="issued">Waiting for acknowledgement</option>
                  <option value="acknowledged">Acknowledged</option>
                </select>
              </label>
            ) : null}
            <label className="ep-field" htmlFor="is-q">
              <span className="ep-field__label">Search</span>
              <input
                id="is-q"
                name="q"
                className="ep-input"
                defaultValue={f.q}
                placeholder="Issue, department, indent or who took it"
              />
            </label>
            <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
              Show
            </button>
            {filtered ? (
              <a className="ep-btn ep-btn--ghost ep-btn--sm" href={`/purchase/issues?tab=${tab}`}>
                Clear
              </a>
            ) : null}
          </form>
          {tab === 'all' && sp.from === undefined ? (
            <p className="ep-field__help">This month’s issues; change From for earlier ones.</p>
          ) : null}
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Issues">
            <table className="ep-table">
              <caption className="ep-sr-only">Issues</caption>
              <thead>
                <tr>
                  <th scope="col">Issue</th>
                  <th scope="col">To</th>
                  <th scope="col">From</th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    Items
                  </th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    Value
                  </th>
                  <th scope="col">Status</th>
                  <th scope="col">Slip</th>
                </tr>
              </thead>
              <tbody>
                {list.rows.length ? (
                  list.rows.map((x) => (
                    <tr key={x.id}>
                      <td>
                        <a href={`/purchase/issues/${x.id}`}>{x.number}</a>
                        <span className="ep-mr-col__desc">
                          {x.kindLabel} · {when(x.issuedOn)}
                        </span>
                      </td>
                      <td>
                        {x.department}
                        <span className="ep-mr-col__desc">
                          {[x.takenBy, x.indent ?? x.requisition].filter(Boolean).join(' · ')}
                        </span>
                      </td>
                      <td>{x.store}</td>
                      <td style={{ textAlign: 'right' }}>{x.lines}</td>
                      <td style={{ textAlign: 'right' }}>{inr(x.value)}</td>
                      <td>
                        <Badge tone={x.status === 'acknowledged' ? 'success' : 'warning'}>
                          {x.status === 'acknowledged'
                            ? 'Acknowledged'
                            : 'Waiting for acknowledgement'}
                        </Badge>
                        {x.status === 'acknowledged' && x.acknowledgedAt ? (
                          <span className="ep-mr-col__desc">
                            {[
                              x.acknowledgedBy,
                              x.ackOnPaper ? 'on paper' : null,
                              when(x.acknowledgedAt),
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        ) : null}
                      </td>
                      <td>
                        <FileLinks
                          href={`/api/purchase/stock-doc/issues/${x.id}`}
                          label={`${x.number} slip as a PDF`}
                        />
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7}>
                      {tab === 'mine' && !filtered
                        ? 'Nothing is waiting for your acknowledgement.'
                        : 'No issues match these filters.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {list.total > 50 ? (
            <p className="ep-field__help">
              {list.total} issues · page {page} of {Math.ceil(list.total / 50)} ·{' '}
              {page > 1 ? <a href={link({ page: String(page - 1) })}>Previous</a> : null}{' '}
              {page * 50 < list.total ? <a href={link({ page: String(page + 1) })}>Next</a> : null}
            </p>
          ) : null}
        </>
      )}
    </>
  );
}
