import nodemailer, { type Transporter } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import type { ChannelAdapter, DeliveryResult, OutboundMessage } from './adapter';

/** Email through any SMTP relay: Mailpit locally, the school's own SMTP or Amazon SES SMTP in production. */
export class SmtpAdapter implements ChannelAdapter {
  readonly name = 'smtp';
  private readonly transport: Transporter;

  constructor(
    smtp: string | SMTPTransport.Options,
    private readonly from: string,
    private readonly replyTo?: string,
  ) {
    this.transport = nodemailer.createTransport(smtp);
  }

  async send(message: OutboundMessage): Promise<DeliveryResult> {
    const info = await this.transport.sendMail({
      from: message.dlt.senderId ?? this.from,
      to: message.to,
      subject: message.subject ?? '',
      text: message.body,
      ...(message.html ? { html: message.html } : {}),
      ...(this.replyTo ? { replyTo: this.replyTo } : {}),
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
