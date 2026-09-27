import nodemailer, { type Transporter } from 'nodemailer';
import type { ChannelAdapter, DeliveryResult, OutboundMessage } from './adapter';

/** Email through any SMTP relay (Mailpit locally, the school's provider in production). */
export class SmtpAdapter implements ChannelAdapter {
  readonly name = 'smtp';
  private readonly transport: Transporter;

  constructor(
    smtpUrl: string,
    private readonly from: string,
  ) {
    this.transport = nodemailer.createTransport(smtpUrl);
  }

  async send(message: OutboundMessage): Promise<DeliveryResult> {
    const info = await this.transport.sendMail({
      from: message.dlt.senderId ?? this.from,
      to: message.to,
      subject: message.subject ?? '',
      text: message.body,
    });
    return { providerMessageId: info.messageId ?? null, delivered: false };
  }
}
