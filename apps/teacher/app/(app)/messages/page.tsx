import { Card, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import { EnablePush } from './EnablePush';
import { MessageFeed } from './MessageFeed';
import type { InboxItem } from './MessageItem';
import { NoticeFeed, type NoticeView } from '@/components/NoticeFeed';

interface Inbox {
  data: InboxItem[];
  children: Array<{ id: string; name: string }>;
  page: { number: number; size: number; more: boolean };
}

/**
 * Messages from the school on the staff website (communication v2): **Messages** — every SMS, WhatsApp and email
 * sent to this employee, with the full text, the formatted email, attachments and delivery state — and **Notices**
 * — the notices, circulars and office orders for staff. Each shows the latest 10; 10 more load as the person scrolls.
 */
export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ child?: string; tab?: string }>;
}) {
  const sp = await searchParams;
  const lang = await currentLang();
  const tab = sp.tab === 'notices' ? 'notices' : 'messages';
  // the latest 10 of each; more load as the person scrolls
  const q = new URLSearchParams({ page: '1', size: '10' });
  if (sp.child && /^\d+$/.test(sp.child)) q.set('studentId', sp.child);
  let inbox: Inbox;
  let notices: { data: NoticeView[]; page: { total: number } } = {
    data: [],
    page: { total: 0 },
  };
  try {
    inbox = await bff.api.fetch<Inbox>(`/comms/inbox?${q.toString()}`);
    if (tab === 'notices')
      notices = await bff.api
        .fetch<{ data: NoticeView[]; page: { total: number } }>('/academics/notices?page=1&size=10')
        .catch(() => notices);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && (error.status === 403 || error.status === 404))
      return (
        <main className="fp-page">
          <PageHeader kicker="EduPro" title={t(lang, 'Messages')} />
          <Card>{t(lang, 'Messages are not available for this account.')}</Card>
        </main>
      );
    throw error;
  }
  const foot = {
    more: t(lang, 'Show more'),
    loading: t(lang, 'Loading…'),
    failed: t(lang, 'Could not load more.'),
    end: t(lang, 'That is everything.'),
  };
  const status: Record<string, string> = {
    delivered: t(lang, 'Delivered'),
    sent: t(lang, 'Sent'),
    sending: t(lang, 'Sent'),
    queued: t(lang, 'Queued'),
    failed: t(lang, 'Failed'),
    read: t(lang, 'Read on WhatsApp'),
  };
  return (
    <main className="fp-page">
      <PageHeader
        kicker={t(lang, 'Messages')}
        title={t(lang, 'Messages from school')}
        description={t(lang, 'SMS, WhatsApp and email the school sent you')}
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/">
            {t(lang, 'Home')}
          </a>
        }
      />
      <nav
        className="ep-tabs-links"
        aria-label={t(lang, 'Messages')}
        style={{ marginBottom: 'var(--sp-3)' }}
      >
        <a href="/messages" aria-current={tab === 'messages' ? 'page' : undefined}>
          {t(lang, 'Messages')}
        </a>
        <a href="/messages?tab=notices" aria-current={tab === 'notices' ? 'page' : undefined}>
          {t(lang, 'Notices')}
        </a>
      </nav>
      {tab === 'messages' && inbox.children.length > 1 ? (
        <nav className="fp-msg__children" aria-label={t(lang, 'All children')}>
          <a href="/messages" aria-current={!sp.child ? 'page' : undefined}>
            {t(lang, 'All children')}
          </a>
          {inbox.children.map((c) => (
            <a
              key={c.id}
              href={`/messages?child=${c.id}`}
              aria-current={sp.child === c.id ? 'page' : undefined}
            >
              {c.name}
            </a>
          ))}
        </nav>
      ) : null}
      <EnablePush
        labels={{
          on: t(lang, 'Notifications are on for this device.'),
          off: t(lang, 'Get a notification when the school sends you something.'),
          turnOn: t(lang, 'Turn on notifications'),
          turnOff: t(lang, 'Turn off'),
          denied: t(lang, 'Notifications are blocked in this browser’s settings.'),
          unsupported: t(
            lang,
            'This browser cannot show notifications. On iPhone, add the app to the Home Screen first.',
          ),
          notSetUp: t(lang, 'The school has not set up notifications yet.'),
          failed: t(lang, 'Notifications could not be turned on. Try again.'),
        }}
      />
      {tab === 'notices' ? (
        notices.data.length === 0 ? (
          <Card>{t(lang, 'No notices now.')}</Card>
        ) : (
          <NoticeFeed
            first={notices.data}
            more={notices.data.length < notices.page.total}
            foot={foot}
            words={{
              kinds: {
                notice: t(lang, 'Notice'),
                circular: t(lang, 'Circular'),
                office_order: t(lang, 'Office order'),
              },
              pinned: t(lang, 'Pinned'),
              attachments: t(lang, 'Attachments'),
              acknowledge: t(lang, 'Acknowledge'),
              acknowledged: t(lang, 'You acknowledged this'),
              failed: t(lang, 'That did not work. Please try again.'),
            }}
          />
        )
      ) : inbox.data.length === 0 ? (
        <Card>{t(lang, 'No messages yet.')}</Card>
      ) : (
        <MessageFeed
          first={inbox.data}
          more={inbox.page.more}
          foot={foot}
          labels={{
            unread: t(lang, 'Unread'),
            open: t(lang, 'Open the email'),
            attachment: t(lang, 'Attachment'),
            status,
          }}
        />
      )}
    </main>
  );
}
