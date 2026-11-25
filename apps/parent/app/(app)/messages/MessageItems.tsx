import { t, type Lang } from '@/lib/i18n';
import { MessageItem, type InboxItem } from './MessageItem';

/** A page of messages: each opens to the full text and is marked read the first time. */
export function MessageItems({ items, lang }: { items: InboxItem[]; lang: Lang }) {
  const status: Record<string, string> = {
    delivered: t(lang, 'Delivered'),
    sent: t(lang, 'Sent'),
    sending: t(lang, 'Sent'),
    queued: t(lang, 'Queued'),
    failed: t(lang, 'Failed'),
    read: t(lang, 'Read on WhatsApp'),
  };
  return (
    <>
      {items.map((m) => (
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
    </>
  );
}
