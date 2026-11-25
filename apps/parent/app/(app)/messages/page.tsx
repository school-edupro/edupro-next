import { Card, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { ChildSwitch } from '@/components/ChildSwitch';
import { chosenChild, familyKids } from '@/lib/child';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import { MoreFeed } from '@/components/MoreFeed';
import { messagesPage } from '@/lib/feed-actions';
import { EnablePush } from './EnablePush';
import { MessageItems } from './MessageItems';
import type { InboxItem } from './MessageItem';

/** The first page: the latest 10; the rest load as the family scrolls. */
const PAGE = 10;

interface Inbox {
  data: InboxItem[];
  children: Array<{ id: string; name: string }>;
  page: { number: number; size: number; more: boolean };
}

/**
 * Messages from the school (communication v2): every SMS, WhatsApp and email sent to this parent or
 * student, with the full text, the formatted email, attachments (View / Download) and delivery state.
 * Parents filter by child.
 */
export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ child?: string }>;
}) {
  const sp = await searchParams;
  const lang = await currentLang();
  const kid = await chosenChild(sp.child);
  const kids = await familyKids();
  // a family with several children reads one child's messages at a time (the switch is under the title)
  const filters: Record<string, string> = kid && kids.length > 1 ? { studentId: kid.id } : {};
  const q = new URLSearchParams({ ...filters, page: '1', size: String(PAGE) });
  let inbox: Inbox;
  try {
    inbox = await bff.api.fetch<Inbox>(`/comms/inbox?${q.toString()}`);
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
  return (
    <main className="fp-page">
      <PageHeader
        kicker={t(lang, 'Messages')}
        title={t(lang, 'Messages from school')}
        description={t(lang, 'SMS, WhatsApp and email the school sent you')}
      />
      <ChildSwitch lang={lang} back="/messages" current={kid?.id} />
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
      {inbox.data.length === 0 ? <Card>{t(lang, 'No messages yet.')}</Card> : null}
      {inbox.data.length ? (
        <div className="fp-msg__list">
          <MoreFeed
            key={JSON.stringify(filters)}
            first={<MessageItems items={inbox.data} lang={lang} />}
            more={inbox.page.more}
            load={messagesPage.bind(null, filters)}
            labels={{
              more: t(lang, 'Show more'),
              loading: t(lang, 'Loading…'),
              failed: t(lang, 'Could not load more.'),
              end: t(lang, 'That is everything.'),
            }}
          />
        </div>
      ) : null}
    </main>
  );
}
