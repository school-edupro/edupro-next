'use client';
import { useState } from 'react';
import { FileLinks } from '@/components/FileLinks';
import { markMessageRead } from './actions';

export interface InboxItem {
  id: string;
  messageIds: string[];
  title: string;
  channels: string[];
  subject: string | null;
  text: string;
  html: string | null;
  student: { id: string | null; name: string } | null;
  sentAt: string;
  status: Record<string, string>;
  readOnPhone: boolean;
  unread: boolean;
  attachments: Array<{ name: string; contentType: string; url: string; saveUrl: string }>;
}

const CHANNEL: Record<string, string> = { sms: 'SMS', whatsapp: 'WhatsApp', email: 'Email' };

/** One message: opens to the full text (the email formatted) and is marked read the first time. */
export function MessageItem({
  item,
  labels,
}: {
  item: InboxItem;
  labels: { unread: string; open: string; attachment: string; status: Record<string, string> };
}) {
  const [unread, setUnread] = useState(item.unread);
  const [showHtml, setShowHtml] = useState(false);
  return (
    <details
      className="fp-msg"
      data-unread={unread ? 'true' : undefined}
      onToggle={(e) => {
        if ((e.target as HTMLDetailsElement).open && unread) {
          setUnread(false);
          void markMessageRead(item.messageIds);
        }
      }}
    >
      <summary className="fp-msg__head">
        <span className="fp-msg__title">
          {unread ? <span className="fp-msg__dot" aria-label={labels.unread} /> : null}
          {item.title}
        </span>
        <span className="fp-msg__meta">
          {new Date(item.sentAt).toLocaleString('en-IN', {
            day: '2-digit',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
          })}
          {item.student ? ` · ${item.student.name}` : ''} ·{' '}
          {item.channels.map((c) => CHANNEL[c] ?? c).join(' + ')}
        </span>
        <span className="fp-msg__preview">{item.text.slice(0, 120)}</span>
      </summary>
      <div className="fp-msg__body">
        {item.subject ? (
          <p>
            <strong>{item.subject}</strong>
          </p>
        ) : null}
        <p className="fp-msg__text">{item.text}</p>
        {item.html ? (
          showHtml ? (
            <iframe
              className="fp-msg__frame"
              title={item.subject ?? item.title}
              sandbox=""
              srcDoc={item.html}
            />
          ) : (
            <button
              type="button"
              className="ep-btn ep-btn--ghost ep-btn--sm"
              onClick={() => setShowHtml(true)}
            >
              {labels.open}
            </button>
          )
        ) : null}
        {item.attachments.length ? (
          <div className="fp-msg__files">
            {item.attachments.map((a, i) => (
              <FileLinks
                key={a.url}
                url={a.url}
                saveUrl={a.saveUrl}
                label={`${labels.attachment} ${String(i + 1)}`}
              />
            ))}
          </div>
        ) : null}
        <p className="fp-msg__status">
          {Object.entries(item.status)
            .map(([c, st]) => `${CHANNEL[c] ?? c}: ${labels.status[st] ?? st}`)
            .join(' · ')}
          {item.readOnPhone ? ` · ${labels.status.read ?? 'read'}` : ''}
        </p>
      </div>
    </details>
  );
}
