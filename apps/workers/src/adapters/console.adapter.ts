import type { Logger } from '../logger';
import { maskAddress } from '../logger';
import type { ChannelAdapter, DeliveryResult, OutboundMessage } from './adapter';

/** Development and test adapter: logs the message id and a masked address, never the body. */
export class ConsoleAdapter implements ChannelAdapter {
  readonly name = 'console';
  constructor(private readonly log: Logger) {}

  async send(message: OutboundMessage): Promise<DeliveryResult> {
    this.log.info(
      {
        messageId: message.id,
        channel: message.channel,
        recipient: maskAddress(message.to),
        dltTemplateId: message.dlt.templateId,
      },
      'notification (console adapter)',
    );
    return { providerMessageId: `console-${message.id}`, delivered: true };
  }
}
