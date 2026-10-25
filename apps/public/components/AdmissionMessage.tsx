'use client';
import { useState, type ReactNode } from 'react';
import { markInboxRead } from '@/app/[school]/admission/actions';

/**
 * One notice or message in the admission portal's Messages (docs/design/42, part 4), like the parent
 * portal's: a line with an unread dot that opens to the text; opening it marks it read.
 */
export function AdmissionMessage({
  kind,
  id,
  title,
  meta,
  preview,
  unread: initial,
  unreadLabel,
  open: openAtStart = false,
  tags,
  children,
}: {
  kind: 'notice' | 'message';
  id: string;
  title: string;
  meta: string;
  preview: string;
  unread: boolean;
  unreadLabel: string;
  /** opened from a link to it (Home's latest messages) */
  open?: boolean;
  /** what it is and how it came: "Answer to your question", "Email · SMS" (docs/design/44) */
  tags?: ReactNode;
  children: ReactNode;
}) {
  const [unread, setUnread] = useState(initial);
  return (
    <details
      className="fp-msg"
      id={`${kind}-${id}`}
      open={openAtStart}
      data-unread={unread ? 'true' : undefined}
      onToggle={(e) => {
        if ((e.target as HTMLDetailsElement).open && unread) {
          setUnread(false);
          void markInboxRead(kind, id);
        }
      }}
    >
      <summary className="fp-msg__head">
        <span className="fp-msg__title">
          {unread ? <span className="fp-msg__dot" role="img" aria-label={unreadLabel} /> : null}
          {title}
        </span>
        <span className="fp-msg__meta">
          {meta}
          {tags ? <span className="ep-adm-msgtags">{tags}</span> : null}
        </span>
        <span className="fp-msg__preview">{preview}</span>
      </summary>
      <div className="fp-msg__body">{children}</div>
    </details>
  );
}
