import { PageHeader } from '@edupro/ui';
import { ApiError } from '@edupro/bff';
import { redirect } from 'next/navigation';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import {
  INDENT_ROUTE,
  INDENT_STATUS,
  type IndentRoute,
  type IndentRow,
  type IndentStatus,
} from '@/lib/purchase';
import { IndentFeed, type IndentWords } from './IndentFeed';

/** The first page: the tab's latest 10 (urgent ones on top); the rest load as the person scrolls. */
const PAGE = 10;

const VIEWS = {
  waiting: 'Waiting for me',
  mine: 'Raised by me',
  all: 'All I can see',
} as const;
type View = keyof typeof VIEWS;

const ID = /^\d{1,18}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

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
  const q = sp.q?.trim().slice(0, 80) || undefined;
  // department and dates, as the admin's list filters
  const f = {
    departmentId: sp.departmentId && ID.test(sp.departmentId) ? sp.departmentId : undefined,
    from: sp.from && DAY.test(sp.from) ? sp.from : undefined,
    to: sp.to && DAY.test(sp.to) ? sp.to : undefined,
  };
  // the tab and the filters, as the next pages ask for them too
  const filters: Record<string, string> = { view };
  if (status) filters.status = status;
  if (route) filters.route = route;
  if (q) filters.q = q;
  for (const [k, v] of Object.entries(f)) if (v) filters[k] = v;
  const qs = new URLSearchParams({ ...filters, page: '1', size: String(PAGE) });
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
  const words: IndentWords = {
    caption: t(lang, 'Purchase indents'),
    indent: t(lang, 'Indent'),
    department: t(lang, 'Department'),
    raisedBy: t(lang, 'Raised by'),
    neededBy: t(lang, 'Needed by'),
    estimate: t(lang, 'Estimate'),
    status: t(lang, 'Status'),
    statusLabel: Object.fromEntries(
      (Object.keys(INDENT_STATUS) as IndentStatus[]).map((k) => [
        k,
        t(lang, INDENT_STATUS[k].label),
      ]),
    ) as Record<IndentStatus, string>,
    routeLabel: Object.fromEntries(
      (Object.keys(INDENT_ROUTE) as IndentRoute[]).map((k) => [k, t(lang, INDENT_ROUTE[k])]),
    ) as Record<IndentRoute, string>,
    draft: t(lang, 'Draft'),
    urgent: t(lang, 'Urgent'),
    line: t(lang, 'line'),
    lines: t(lang, 'lines'),
    for: t(lang, 'for'),
    with: t(lang, 'With'),
    partClosed: t(lang, 'part closed'),
    started: t(lang, 'Started'),
    empty:
      view === 'waiting'
        ? t(lang, 'Nothing is waiting for your approval.')
        : t(lang, 'No indents here yet.'),
  };
  const foot = {
    more: t(lang, 'Show more'),
    loading: t(lang, 'Loading…'),
    failed: t(lang, 'Could not load more.'),
    end: t(lang, 'That is everything.'),
  };
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
              href={link({ view: v, status: undefined, route: undefined })}
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
                href={link({ view: 'all', status: 'approved', route: 'to_requisition' })}
                aria-current={route === 'to_requisition' ? 'page' : undefined}
              >
                {t(lang, 'Waiting for the PR')}
              </a>
              <a
                className="ep-tabs__tab"
                href={link({ view: 'all', status: 'approved', route: 'to_order' })}
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
      <IndentFeed
        key={qs.toString()}
        first={data.data}
        more={PAGE < data.total}
        filters={filters}
        rates={rates}
        words={words}
        foot={foot}
      />
      <p style={{ marginTop: 'var(--sp-4)' }}>
        <a href="/purchase/hand-over">{t(lang, 'Away? Hand over your purchase approvals')}</a>
      </p>
    </main>
  );
}
