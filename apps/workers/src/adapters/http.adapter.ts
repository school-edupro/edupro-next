import type { ChannelAdapter, DeliveryResult, OutboundMessage } from './adapter';

/**
 * Generic JSON gateway for SMS, WhatsApp and push providers that accept a POST with a bearer token.
 * Indian SMS providers need the DLT template and entity ids on every request; both travel in the body.
 * Provider-specific field names are mapped here, so swapping providers touches one place.
 */
export class HttpAdapter implements ChannelAdapter {
  readonly name: string;
  constructor(
    channel: string,
    private readonly url: string,
    private readonly token: string | undefined,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.name = `http-${channel}`;
  }

  async send(message: OutboundMessage): Promise<DeliveryResult> {
    const res = await this.fetchImpl(this.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
      },
      body: JSON.stringify({
        channel: message.channel,
        to: message.to,
        message: message.body,
        subject: message.subject,
        sender_id: message.dlt.senderId,
        dlt_template_id: message.dlt.templateId,
        dlt_entity_id: message.dlt.entityId,
        client_ref: message.id,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`provider responded ${res.status}`);
    const data = (await res.json().catch(() => ({}))) as {
      id?: string;
      message_id?: string;
      status?: string;
    };
    return {
      providerMessageId: data.id ?? data.message_id ?? null,
      delivered: data.status === 'delivered',
    };
  }
}
