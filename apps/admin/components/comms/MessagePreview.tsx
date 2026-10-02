import { CHANNEL_LABEL, type Channel } from '@/lib/comms';

export interface PreviewItem {
  channel: string;
  template: string;
  to: string | null;
  subject: string | null;
  text: string;
  html: string | null;
  units: number;
}

/**
 * The message as recipients get it, one block per channel (SMS / WhatsApp text, the email framed).
 * Used by the approver's inbox and the request page.
 */
export function MessagePreview({ items }: { items: PreviewItem[] }) {
  if (!items.length) return null;
  return (
    <div className="ep-mprev">
      {items.map((p) => (
        <section
          key={p.channel}
          className="ep-mprev__item"
          aria-label={`${CHANNEL_LABEL[p.channel as Channel] ?? p.channel} message`}
        >
          <h3 className="ep-mprev__head">
            {CHANNEL_LABEL[p.channel as Channel] ?? p.channel}
            <span className="ep-field__help">
              {' '}
              · {p.template}
              {p.to ? ` · as ${p.to} gets it` : ' · sample values'}
              {p.channel === 'sms'
                ? ` · ${String(p.units)} SMS part${p.units === 1 ? '' : 's'}`
                : ''}
            </span>
          </h3>
          {p.subject ? (
            <p className="ep-mprev__subject">
              <strong>{p.subject}</strong>
            </p>
          ) : null}
          {p.html ? (
            <iframe
              className="ep-mprev__frame"
              title={`${p.subject ?? 'Email'} preview`}
              sandbox=""
              srcDoc={p.html}
            />
          ) : (
            <p className="ep-mprev__text">{p.text}</p>
          )}
        </section>
      ))}
    </div>
  );
}
