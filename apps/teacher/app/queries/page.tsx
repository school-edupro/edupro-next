import { Badge, Card, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';

type Status = 'open' | 'in_progress' | 'answered' | 'closed';
interface Ticket {
  id: string;
  raisedByUserId: string;
  number: string;
  desk: 'parent' | 'staff' | 'provider';
  head: string;
  studentName: string | null;
  section: string | null;
  raisedBy: string | null;
  subject: string;
  status: Status;
  level: number;
  dueAt: string | null;
  overdue: boolean;
  assignedTo: string | null;
  assignedRoleName: string | null;
  openedAt: string;
}
interface Leave {
  id: string;
  number: string;
  studentName: string;
  section: string | null;
  raisedBy: string | null;
  subject: string;
  status: Status;
  leaveFrom: string | null;
  leaveTo: string | null;
  openedAt: string;
}
const LABEL: Record<Status, string> = {
  open: 'Open',
  in_progress: 'In progress',
  answered: 'Answered',
  closed: 'Closed',
};
const TONE: Record<Status, 'warning' | 'info' | 'success' | 'neutral'> = {
  open: 'warning',
  in_progress: 'info',
  answered: 'success',
  closed: 'neutral',
};
const DESK: Record<Ticket['desk'], string> = {
  parent: 'Family query',
  staff: 'Staff query',
  provider: 'ERP ticket',
};

/**
 * The teacher's helpdesk: queries to answer (families of their sections and anything handed to them),
 * leave requests to decide, and their own staff queries and tickets to the ERP provider.
 */
export default async function QueriesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; closed?: string; ok?: string }>;
}) {
  const sp = await searchParams;
  const lang = await currentLang();
  const tab = sp.tab === 'leave' || sp.tab === 'mine' ? sp.tab : 'answer';
  const closed = sp.closed === '1';
  let tickets: Ticket[] = [];
  let leaves: Leave[] = [];
  try {
    if (tab === 'leave')
      leaves = (
        await bff.api
          .fetch<{ data: Leave[] }>(
            `/engagement/queries?kind=leave&size=100${closed ? '' : '&status=open'}`,
          )
          .catch((error: unknown) => {
            if (error instanceof ApiError && error.status === 403) return { data: [] as Leave[] };
            throw error;
          })
      ).data;
    else {
      const me = await bff.api.me();
      tickets = (
        await bff.api.fetch<{ data: Ticket[] }>(
          `/helpdesk/tickets?size=100&view=${tab === 'mine' ? 'mine' : 'all'}&status=${closed ? 'closed' : 'active'}`,
        )
      ).data.filter((x) => tab === 'mine' || x.raisedByUserId !== me.user.id);
    }
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    throw error;
  }
  const tabs: Array<[string, string]> = [
    ['answer', t(lang, 'To answer')],
    ['leave', t(lang, 'Leave requests')],
    ['mine', t(lang, 'My requests')],
  ];
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 820, margin: '0 auto' }}>
      <PageHeader
        kicker={t(lang, 'Queries and helpdesk')}
        title={tabs.find(([k]) => k === tab)![1]}
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/queries/new?desk=staff">
              {t(lang, 'Raise a staff query')}
            </a>
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/queries/new?desk=provider">
              {t(lang, 'Ticket to ERP provider')}
            </a>
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/">
              {t(lang, 'Home')}
            </a>
          </span>
        }
      />
      <nav
        aria-label={t(lang, 'Queries')}
        style={{
          display: 'flex',
          gap: 'var(--sp-2)',
          flexWrap: 'wrap',
          marginBottom: 'var(--sp-3)',
        }}
      >
        {tabs.map(([k, label]) => (
          <a
            key={k}
            href={`/queries?tab=${k}`}
            aria-current={tab === k ? 'page' : undefined}
            className={`ep-btn ep-btn--sm ${tab === k ? 'ep-btn--primary' : 'ep-btn--ghost'}`}
          >
            {label}
          </a>
        ))}
        <a
          href={`/queries?tab=${tab}${closed ? '' : '&closed=1'}`}
          className="ep-btn ep-btn--sm ep-btn--ghost"
        >
          {closed ? t(lang, 'Show open') : t(lang, 'Show closed')}
        </a>
      </nav>
      {tab === 'leave' ? (
        leaves.length === 0 ? (
          <Card>{t(lang, 'No leave requests.')}</Card>
        ) : (
          leaves.map((q) => (
            <a key={q.id} href={`/queries/${q.id}`} style={{ textDecoration: 'none' }}>
              <Card elevated style={{ marginBottom: 'var(--sp-3)' }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 'var(--sp-2)',
                    flexWrap: 'wrap',
                  }}
                >
                  <div>
                    <div className="ep-hdt__title">{q.subject}</div>
                    <div className="ep-kicker">
                      {q.number} · {q.studentName}
                      {q.section ? ` (${q.section})` : ''} · {q.leaveFrom} → {q.leaveTo}
                    </div>
                  </div>
                  <Badge tone={TONE[q.status]}>{t(lang, LABEL[q.status])}</Badge>
                </div>
              </Card>
            </a>
          ))
        )
      ) : tickets.length === 0 ? (
        <Card>
          {tab === 'mine'
            ? t(lang, 'You have not raised anything yet.')
            : t(lang, 'Nothing waiting for you.')}
        </Card>
      ) : (
        tickets.map((q) => (
          <a key={q.id} href={`/queries/t/${q.id}`} style={{ textDecoration: 'none' }}>
            <Card elevated style={{ marginBottom: 'var(--sp-3)' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 'var(--sp-2)',
                  flexWrap: 'wrap',
                }}
              >
                <div>
                  <div className="ep-hdt__title">{q.subject}</div>
                  <div className="ep-kicker">
                    {q.number} · {t(lang, DESK[q.desk])} · {q.head}
                    {q.studentName
                      ? ` · ${q.studentName}${q.section ? ` (${q.section})` : ''}`
                      : ''}
                    {tab === 'answer' && q.raisedBy ? ` · ${q.raisedBy}` : ''}
                    {tab === 'mine'
                      ? ` · ${t(lang, 'with')} ${q.assignedTo ?? q.assignedRoleName ?? '—'}`
                      : ''}
                  </div>
                </div>
                <span
                  style={{
                    display: 'inline-flex',
                    gap: 'var(--sp-1)',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                  }}
                >
                  {q.level > 1 ? (
                    <Badge tone="danger">
                      {t(lang, 'Level')} {q.level}
                    </Badge>
                  ) : null}
                  {q.overdue ? <Badge tone="danger">{t(lang, 'Past due')}</Badge> : null}
                  <Badge tone={TONE[q.status]}>{t(lang, LABEL[q.status])}</Badge>
                </span>
              </div>
            </Card>
          </a>
        ))
      )}
    </main>
  );
}
