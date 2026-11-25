import { Card, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import { TicketFeed, type Ticket, type TicketWords } from './TicketFeed';

/** The first page: the latest 10; the rest load as the person scrolls. */
const PAGE = 10;

/**
 * The teacher's helpdesk: queries to answer (families of their sections and anything handed to them) and their own
 * staff queries and tickets to the ERP provider. Student leave is decided under Student leave (`/leaves`), not here:
 * families apply for leave under Attendance.
 */
export default async function QueriesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; closed?: string; ok?: string }>;
}) {
  const sp = await searchParams;
  const lang = await currentLang();
  const tab = sp.tab === 'mine' ? 'mine' : 'answer';
  const closed = sp.closed === '1';
  let tickets: Ticket[] = [];
  let total = 0;
  try {
    // to answer: all I may see but what I raised (that is under My requests)
    const r = await bff.api.fetch<{ data: Ticket[]; page: { total: number } }>(
      `/helpdesk/tickets?view=${tab === 'mine' ? 'mine' : 'others'}&status=${closed ? 'closed' : 'active'}&page=1&size=${String(PAGE)}`,
    );
    tickets = r.data;
    total = r.page.total;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    throw error;
  }
  const words: TicketWords = {
    desk: {
      parent: t(lang, 'Family query'),
      staff: t(lang, 'Staff query'),
      provider: t(lang, 'ERP ticket'),
      hostel: t(lang, 'Hostel complaint'),
    },
    status: {
      open: t(lang, 'Open'),
      in_progress: t(lang, 'In progress'),
      answered: t(lang, 'Answered'),
      closed: t(lang, 'Closed'),
    },
    level: t(lang, 'Level'),
    pastDue: t(lang, 'Past due'),
    with: t(lang, 'with'),
  };
  const foot = {
    more: t(lang, 'Show more'),
    loading: t(lang, 'Loading…'),
    failed: t(lang, 'Could not load more.'),
    end: t(lang, 'That is everything.'),
  };
  const tabs: Array<[string, string]> = [
    ['answer', t(lang, 'To answer')],
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
      {tickets.length === 0 ? (
        <Card>
          {tab === 'mine'
            ? t(lang, 'You have not raised anything yet.')
            : t(lang, 'Nothing waiting for you.')}
        </Card>
      ) : (
        <TicketFeed
          key={`${tab}-${String(closed)}`}
          first={tickets}
          more={PAGE < total}
          tab={tab}
          closed={closed}
          words={words}
          foot={foot}
        />
      )}
    </main>
  );
}
