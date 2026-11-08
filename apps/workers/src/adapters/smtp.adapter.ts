import nodemailer, { type Transporter } from 'nodemailer';
import type SMTPPool from 'nodemailer/lib/smtp-pool';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import type { ChannelAdapter, DeliveryResult, OutboundMessage } from './adapter';

/**
 * At most this many connections to one SMTP server at a time (6 Nov 2026: a school's mail server
 * answered "421 too many connections" when the worker sent ten report-card e-mails at once, each on its
 * own connection, and seven ran out of retries).
 */
export const SMTP_MAX_CONNECTIONS = 2;
const POOLS = new Map<string, Transporter>();

/**
 * One pooled transport per SMTP server and login, shared by every message the worker sends there (the
 * school's adapter is rebuilt from its settings now and then; the pool stays), each connection reused
 * for up to 100 messages.
 */
export function smtpPool(smtp: string | SMTPTransport.Options): Transporter {
  const key = typeof smtp === 'string' ? smtp : JSON.stringify(smtp);
  const made = POOLS.get(key);
  if (made) return made;
  let transport: Transporter;
  if (typeof smtp === 'string') {
    // a connection URL takes its pool settings as query parameters
    const url = new URL(smtp);
    url.searchParams.set('pool', 'true');
    url.searchParams.set('maxConnections', String(SMTP_MAX_CONNECTIONS));
    url.searchParams.set('maxMessages', '100');
    transport = nodemailer.createTransport(url.toString());
  } else
    transport = nodemailer.createTransport({
      ...smtp,
      pool: true,
      maxConnections: SMTP_MAX_CONNECTIONS,
      maxMessages: 100,
    } as SMTPPool.Options);
  POOLS.set(key, transport);
  return transport;
}

/** Email through any SMTP relay: Mailpit locally, the school's own SMTP or Amazon SES SMTP in production. */
export class SmtpAdapter implements ChannelAdapter {
  readonly name = 'smtp';
  private readonly transport: Transporter;

  constructor(
    smtp: string | SMTPTransport.Options,
    private readonly from: string,
    private readonly replyTo?: string,
  ) {
    this.transport = smtpPool(smtp);
  }

  async send(message: OutboundMessage): Promise<DeliveryResult> {
    const info = await this.transport.sendMail({
      from: message.dlt.senderId ?? this.from,
      to: message.to,
      subject: message.subject ?? '',
      text: message.body,
      ...(message.html ? { html: message.html } : {}),
      ...((message.replyTo ?? this.replyTo) ? { replyTo: message.replyTo ?? this.replyTo } : {}),
      attachments: (message.attachments ?? [])
        .filter((a) => a.bytes)
        .map((a) => ({
          filename: a.name,
          content: a.bytes,
          contentType: a.contentType,
          // an image the HTML shows (src="cid:<file name>") travels inline with that id
          ...(message.html?.includes(`cid:${a.name}`)
            ? { cid: a.name, contentDisposition: 'inline' as const }
            : {}),
        })),
    });
    return { providerMessageId: info.messageId ?? null, delivered: false };
  }
}
