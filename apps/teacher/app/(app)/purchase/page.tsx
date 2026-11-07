import { Badge, Card, PageHeader } from '@edupro/ui';
import { ApiError } from '@edupro/bff';
import { redirect } from 'next/navigation';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import { INDENT_ROUTE, INDENT_STATUS, inr, type IndentRow } from '@/lib/purchase';

const dmy = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(iso));

/**
 * My Purchase Indents in the staff app (docs/design/83, part 2): what I asked for and where each one
 * stands, and those of my department waiting for my approval (or a colleague's handed to me).
 */
export default async function StaffPurchasePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const lang = await currentLang();
  const view = sp.view === 'waiting' ? 'waiting' : 'mine';
  let data: { data: IndentRow[]; total: number; waitingForMe: number };
  let me;
  try {
    [data, me] = await Promise.all([
      bff.api.fetch<{ data: IndentRow[]; total: number; waitingForMe: number }>(
        `/purchase/indents?view=${view}&size=50`,
      ),
      bff.api.me(),
    ]);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    throw error;
  }
  const canRaise = me.permissions.includes('purchase.indent.raise');
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: '52rem', margin: '0 auto' }}>
      <p style={{ margin: '0 0 var(--sp-2)' }}>
        <a href="/" style={{ textDecoration: 'underline' }}>
          ← {t(lang, 'Home')}
        </a>
      </p>
      <PageHeader
        kicker="EduPro staff"
        title={t(lang, 'Purchase indents')}
        description={t(
          lang,
          'Ask for what your department needs; your department’s approvers decide in turn.',
        )}
        actions={
          canRaise ? (
            <a className="ep-btn ep-btn--primary ep-btn--sm" href="/purchase/new">
              {t(lang, 'Raise an indent')}
            </a>
          ) : null
        }
      />
      {sp.ok ? (
        <p className="ep-alert ep-alert--success" role="status">
          {sp.detail || 'Done.'}
        </p>
      ) : null}
      {sp.error ? (
        <p className="ep-alert ep-alert--danger" role="alert">
          {sp.detail || 'That did not work. Please try again.'}
        </p>
      ) : null}
      <nav
        aria-label={t(lang, 'Indents to show')}
        className="ep-tabs"
        style={{ marginBottom: 'var(--sp-3)' }}
      >
        <div className="ep-tabs__list">
          <a
            className="ep-tabs__tab"
            href="/purchase"
            aria-current={view === 'mine' ? 'page' : undefined}
          >
            {t(lang, 'Raised by me')}
          </a>
          <a
            className="ep-tabs__tab"
            href="/purchase?view=waiting"
            aria-current={view === 'waiting' ? 'page' : undefined}
          >
            {t(lang, 'Waiting for me')} ({data.waitingForMe})
          </a>
        </div>
      </nav>
      {data.data.length === 0 ? (
        <Card>
          {view === 'waiting'
            ? t(lang, 'Nothing is waiting for your approval.')
            : t(lang, 'You have not raised an indent yet.')}
        </Card>
      ) : null}
      <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
        {data.data.map((x) => (
          <Card key={x.id} title={`${x.number ?? t(lang, 'Draft')} · ${x.department}`}>
            <p style={{ marginTop: 0 }}>
              <Badge tone={INDENT_STATUS[x.status].tone}>{INDENT_STATUS[x.status].label}</Badge>{' '}
              {x.priority === 'urgent' ? <Badge tone="danger">Urgent</Badge> : null}{' '}
              {x.estimate !== null ? (
                <>
                  <strong>{inr(x.estimate)}</strong> ·{' '}
                </>
              ) : null}
              {x.lines} {x.lines === 1 ? 'line' : 'lines'}
            </p>
            <p>{x.purpose}</p>
            <p className="ep-field__help">
              {view === 'waiting' ? `${x.raisedBy} · ` : ''}
              {x.status === 'submitted' && x.waitingWith
                ? `With ${x.waitingWith}`
                : x.status === 'approved' && x.route
                  ? INDENT_ROUTE[x.route]
                  : `Started ${dmy(x.createdAt)}`}
            </p>
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href={`/purchase/${x.id}`}>
              {view === 'waiting' ? t(lang, 'Open and decide') : t(lang, 'Open')}
            </a>
          </Card>
        ))}
      </div>
      <p style={{ marginTop: 'var(--sp-4)' }}>
        <a href="/purchase/hand-over">{t(lang, 'Away? Hand over your purchase approvals')}</a>
      </p>
    </main>
  );
}
