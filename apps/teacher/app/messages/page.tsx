import { Card, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import { EnablePush } from './EnablePush';
import { MessageItem, type InboxItem } from './MessageItem';

interface Inbox {
  data: InboxItem[];
  children: Array<{ id: string; name: string }>;
  page: { number: number; size: number; more: boolean };
}

/**
 * Messages from the school in the teacher app (communication v2): every SMS, WhatsApp and email sent
 * to this employee, with the full text, the formatted email, attachments and delivery state.
 */
export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ child?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const lang = await currentLang();
  const page = Math.max(1, Number(sp.page) || 1);
  const q = new URLSearchParams({ page: String(page), size: '20' });
  if (sp.child && /^\d+$/.test(sp.child)) q.set('studentId', sp.child);
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
  const link = (p: number) =>
    `/messages?page=${String(p)}${sp.child ? `&child=${encodeURIComponent(sp.child)}` : ''}`;
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
      {inbox.children.length > 1 ? (
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
      {inbox.data.length === 0 ? <Card>{t(lang, 'No messages yet.')}</Card> : null}
      <div className="fp-msg__list">
        {inbox.data.map((m) => (
          <MessageItem
            key={m.id}
            item={m}
            labels={{
              unread: t(lang, 'Unread'),
              open: t(lang, 'Open the email'),
              attachment: t(lang, 'Attachment'),
              status,
            }}
          />
        ))}
      </div>
      <div className="fp-msg__pager">
        {page > 1 ? (
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href={link(page - 1)}>
            ← {t(lang, 'Newer messages')}
          </a>
        ) : null}
        {inbox.page.more ? (
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href={link(page + 1)}>
            {t(lang, 'Older messages')} →
          </a>
        ) : null}
      </div>
    </main>
  );
}
