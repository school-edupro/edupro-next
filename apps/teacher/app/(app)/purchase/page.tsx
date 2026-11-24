import { Badge, PageHeader } from '@edupro/ui';
import { ApiError } from '@edupro/bff';
import { redirect } from 'next/navigation';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import {
  INDENT_ROUTE,
  INDENT_STATUS,
  inr,
  type IndentRoute,
  type IndentRow,
  type IndentStatus,
} from '@/lib/purchase';

const VIEWS = {
  waiting: 'Waiting for me',
  mine: 'Raised by me',
  all: 'All I can see',
} as const;
type View = keyof typeof VIEWS;

const ID = /^\d{1,18}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const when = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }).format(new Date(iso))
    : '—';

/**
 * Purchase Indents on the staff website, as the admin's page (docs/design/83, part 2): Waiting for me (those at my
 * approval level, or a colleague's handed to me), Raised by me and All I can see (mine, my department's, those I
 * approve); the purchase office also sees the approved ones waiting for the PR or, the PR skipped, for the PO. The
 * department, dates, status and a search filter the list; Excel and PDF of it as filtered.
 */
export default async function StaffPurchasePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const lang = await currentLang();
  const view: View = sp.view && sp.view in VIEWS ? (sp.view as View) : 'all';
  const status = sp.status && sp.status in INDENT_STATUS ? (sp.status as IndentStatus) : undefined;
  const route = sp.route && sp.route in INDENT_ROUTE ? (sp.route as IndentRoute) : undefined;
  const page = Math.max(1, Number(sp.page) || 1);
  const q = sp.q?.trim().slice(0, 80) || undefined;
  // department and dates, as the admin's list filters
  const f = {
    departmentId: sp.departmentId && ID.test(sp.departmentId) ? sp.departmentId : undefined,
    from: sp.from && DAY.test(sp.from) ? sp.from : undefined,
    to: sp.to && DAY.test(sp.to) ? sp.to : undefined,
  };
  const qs = new URLSearchParams({ view, page: String(page), size: '50' });
  if (status) qs.set('status', status);
  if (route) qs.set('route', route);
  if (q) qs.set('q', q);
  for (const [k, v] of Object.entries(f)) if (v) qs.set(k, v);
  let data: { data: IndentRow[]; total: number; waitingForMe: number };
  let choices: { departments: Array<{ id: string; name: string }> };
  let me;
  try {
    [data, choices, me] = await Promise.all([
      bff.api.fetch<{ data: IndentRow[]; total: number; waitingForMe: number }>(
        `/purchase/indents?${qs.toString()}`,
      ),
      bff.api.fetch<{ departments: Array<{ id: string; name: string }> }>('/purchase/list-filters'),
      bff.api.me(),
    ]);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    throw error;
  }
  const canRaise = me.permissions.includes('purchase.indent.raise');
  const seeAll = me.permissions.includes('purchase.indent.view');
  // the estimate shows to those who see rates (not to a raiser without purchase rights)
  const rates = data.data.some((x) => x.estimate !== null);
  const link = (p: Record<string, string | undefined>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ view, status, route, q, ...f, ...p }))
      if (v && !(k === 'view' && v === 'all')) u.set(k, v);
    const s = u.toString();
    return `/purchase${s ? `?${s}` : ''}`;
  };
  const fileHref = (format: 'xlsx' | 'pdf') => {
    const u = new URLSearchParams({ doc: 'indents', format, view });
    for (const [k, v] of Object.entries({ status, route, q, ...f })) if (v) u.set(k, v);
    return `/api/purchase-list-file?${u.toString()}`;
  };
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: '72rem', margin: '0 auto' }}>
      <p style={{ margin: '0 0 var(--sp-2)' }}>
        <a href="/" style={{ textDecoration: 'underline' }}>
          ← {t(lang, 'Home')}
        </a>
      </p>
      <PageHeader
        kicker={t(lang, 'Purchase')}
        title={t(lang, 'Purchase indents')}
        description={t(
          lang,
          'Ask for what your department needs. The department’s approvers decide in turn — nobody approves their own — and an approved indent goes to the purchase office’s requisition, or straight to the order when a rule allows it.',
        )}
        actions={
          <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href={fileHref('xlsx')}
              download
              title={t(lang, 'Excel of this list as filtered (every page), with the item lines')}
            >
              Excel
            </a>
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href={fileHref('pdf')}
              download
              title={t(lang, 'PDF of this list as filtered (every page)')}
            >
              PDF
            </a>
            {canRaise ? (
              <a
                className="ep-btn ep-btn--primary ep-btn--sm"
                href="/purchase/new"
                style={{ whiteSpace: 'nowrap' }}
              >
                {t(lang, 'Raise an indent')}
              </a>
            ) : null}
          </div>
        }
      />
      {sp.ok ? (
        <p className="ep-alert ep-alert--success" role="status">
          {sp.detail || t(lang, 'Done.')}
        </p>
      ) : null}
      {sp.error ? (
        <p className="ep-alert ep-alert--danger" role="alert">
          {sp.detail || t(lang, 'That did not work. Please try again.')}
        </p>
      ) : null}
      <nav
        aria-label={t(lang, 'Indents to show')}
        className="ep-tabs"
        style={{ marginBottom: 'var(--sp-3)' }}
      >
        <div className="ep-tabs__list">
          {(Object.keys(VIEWS) as View[]).map((v) => (
            <a
              key={v}
              className="ep-tabs__tab"
              href={link({ view: v, status: undefined, route: undefined, page: undefined })}
              aria-current={view === v && !route ? 'page' : undefined}
            >
              {t(lang, VIEWS[v])}
              {v === 'waiting' ? ` (${String(data.waitingForMe)})` : ''}
            </a>
          ))}
          {seeAll ? (
            <>
              <a
                className="ep-tabs__tab"
                href={link({
                  view: 'all',
                  status: 'approved',
                  route: 'to_requisition',
                  page: undefined,
                })}
                aria-current={route === 'to_requisition' ? 'page' : undefined}
              >
                {t(lang, 'Waiting for the PR')}
              </a>
              <a
                className="ep-tabs__tab"
                href={link({ view: 'all', status: 'approved', route: 'to_order', page: undefined })}
                aria-current={route === 'to_order' ? 'page' : undefined}
              >
                {t(lang, 'PR skipped: for the PO')}
              </a>
            </>
          ) : null}
        </div>
      </nav>
      <form method="get" action="/purchase" className="ep-grid__toolbar">
        {view !== 'all' ? <input type="hidden" name="view" value={view} /> : null}
        {route ? <input type="hidden" name="route" value={route} /> : null}
        {choices.departments.length > 1 ? (
          <label className="ep-field" htmlFor="pi-dept">
            <span className="ep-field__label">{t(lang, 'Department')}</span>
            <select
              id="pi-dept"
              name="departmentId"
              className="ep-select"
              defaultValue={f.departmentId ?? ''}
            >
              <option value="">{t(lang, 'Any')}</option>
              {choices.departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="ep-field" htmlFor="pi-from">
          <span className="ep-field__label">{t(lang, 'From')}</span>
          <input
            id="pi-from"
            name="from"
            type="date"
            className="ep-input"
            defaultValue={f.from ?? ''}
          />
        </label>
        <label className="ep-field" htmlFor="pi-to">
          <span className="ep-field__label">{t(lang, 'To')}</span>
          <input id="pi-to" name="to" type="date" className="ep-input" defaultValue={f.to ?? ''} />
        </label>
        <label className="ep-field" htmlFor="pi-status">
          <span className="ep-field__label">{t(lang, 'Status')}</span>
          <select id="pi-status" name="status" className="ep-select" defaultValue={status ?? ''}>
            <option value="">{t(lang, 'Any')}</option>
            {(Object.keys(INDENT_STATUS) as IndentStatus[]).map((s) => (
              <option key={s} value={s}>
                {t(lang, INDENT_STATUS[s].label)}
              </option>
            ))}
          </select>
        </label>
        <label className="ep-field" htmlFor="pi-q">
          <span className="ep-field__label">{t(lang, 'Search')}</span>
          <input
            id="pi-q"
            name="q"
            className="ep-input"
            maxLength={80}
            defaultValue={q ?? ''}
            placeholder={t(lang, 'Number or purpose')}
          />
        </label>
        <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
          {t(lang, 'Show')}
        </button>
      </form>
      <div
        className="ep-table-wrap"
        tabIndex={0}
        role="region"
        aria-label={t(lang, 'Purchase indents')}
      >
        <table className="ep-table">
          <caption className="ep-sr-only">{t(lang, 'Purchase indents')}</caption>
          <thead>
            <tr>
              <th scope="col">{t(lang, 'Indent')}</th>
              <th scope="col">{t(lang, 'Department')}</th>
              <th scope="col">{t(lang, 'Raised by')}</th>
              <th scope="col">{t(lang, 'Needed by')}</th>
              {rates ? (
                <th scope="col" style={{ textAlign: 'right' }}>
                  {t(lang, 'Estimate')}
                </th>
              ) : null}
              <th scope="col">{t(lang, 'Status')}</th>
            </tr>
          </thead>
          <tbody>
            {data.data.length ? (
              data.data.map((x) => (
                <tr key={x.id}>
                  <td>
                    <a href={`/purchase/${x.id}`}>{x.number ?? t(lang, 'Draft')}</a>
                    {x.priority === 'urgent' ? (
                      <>
                        {' '}
                        <Badge tone="danger">{t(lang, 'Urgent')}</Badge>
                      </>
                    ) : null}
                    <span className="ep-mr-col__desc">
                      {x.purpose.length > 80 ? `${x.purpose.slice(0, 80)}…` : x.purpose} · {x.lines}{' '}
                      {x.lines === 1 ? t(lang, 'line') : t(lang, 'lines')}
                    </span>
                  </td>
                  <td>{x.department}</td>
                  <td>
                    {x.raisedBy}
                    {x.onBehalf ? (
                      <span className="ep-mr-col__desc">
                        {t(lang, 'for')} {x.onBehalf}
                      </span>
                    ) : null}
                  </td>
                  <td>{x.requiredBy ? when(`${x.requiredBy}T00:00:00+05:30`) : '—'}</td>
                  {rates ? (
                    <td style={{ textAlign: 'right' }}>
                      {x.estimate === null ? '—' : inr(x.estimate)}
                    </td>
                  ) : null}
                  <td>
                    <Badge tone={INDENT_STATUS[x.status].tone}>
                      {t(lang, INDENT_STATUS[x.status].label)}
                    </Badge>
                    <span className="ep-mr-col__desc">
                      {x.status === 'submitted' && x.waitingWith
                        ? `${t(lang, 'With')} ${x.waitingWith}`
                        : x.status === 'approved' && x.route
                          ? `${t(lang, INDENT_ROUTE[x.route])}${x.partClosed ? ` · ${t(lang, 'part closed')}` : ''}`
                          : x.decidedAt
                            ? when(x.decidedAt)
                            : x.submittedAt
                              ? when(x.submittedAt)
                              : `${t(lang, 'Started')} ${when(x.createdAt)}`}
                    </span>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={rates ? 6 : 5}>
                  {view === 'waiting'
                    ? t(lang, 'Nothing is waiting for your approval.')
                    : t(lang, 'No indents here yet.')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {data.total > 50 ? (
        <p className="ep-field__help">
          {t(lang, 'Page')} {page} / {Math.ceil(data.total / 50)} ·{' '}
          {page > 1 ? <a href={link({ page: String(page - 1) })}>{t(lang, 'Previous')}</a> : null}{' '}
          {page * 50 < data.total ? (
            <a href={link({ page: String(page + 1) })}>{t(lang, 'Next')}</a>
          ) : null}
        </p>
      ) : null}
      <p style={{ marginTop: 'var(--sp-4)' }}>
        <a href="/purchase/hand-over">{t(lang, 'Away? Hand over your purchase approvals')}</a>
      </p>
    </main>
  );
}
