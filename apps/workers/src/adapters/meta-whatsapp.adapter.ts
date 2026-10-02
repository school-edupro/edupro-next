import type { ChannelAdapter, DeliveryResult, OutboundMessage } from './adapter';

export interface MetaConfig {
  phoneNumberId?: string;
  wabaId?: string;
  apiVersion?: string;
  country?: string;
  baseUrl?: string;
}

/**
 * WhatsApp through the Meta Cloud API (the school's own WhatsApp Business number). Business-initiated
 * messages must use a template Meta approved: its name, language and the {{1}}, {{2}}... parameters
 * come from the template master. A PDF or image attachment goes as the template's header. Without a
 * template name the text is sent as a session message (only delivered inside 24 h of the parent's
 * last message). Statuses (sent, delivered, read, failed) come back on /comms/webhooks/meta.
 */
export class MetaWhatsAppAdapter implements ChannelAdapter {
  readonly name = 'meta_whatsapp';
  constructor(
    private readonly config: MetaConfig,
    private readonly accessToken: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(message: OutboundMessage): Promise<DeliveryResult> {
    if (!this.config.phoneNumberId) throw new Error('WhatsApp phone number id is not set');
    const to = `${this.config.country ?? '91'}${message.to}`;
    const wa = message.whatsapp;
    let payload: Record<string, unknown>;
    if (wa?.templateName) {
      const components: Array<Record<string, unknown>> = [];
      const media = message.attachments?.find((a) => a.url);
      if (wa.header === 'document' || wa.header === 'image') {
        if (!media?.url)
          throw new Error(`The WhatsApp template needs a ${wa.header} header: attach a file`);
        components.push({
          type: 'header',
          parameters: [
            wa.header === 'document'
              ? { type: 'document', document: { link: media.url, filename: media.name } }
              : { type: 'image', image: { link: media.url } },
          ],
        });
      }
      if (wa.params.length)
        components.push({
          type: 'body',
          parameters: wa.params.map((text) => ({ type: 'text', text: text || '-' })),
        });
      payload = {
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: wa.templateName,
          language: { code: wa.language ?? 'en' },
          ...(components.length ? { components } : {}),
        },
      };
    } else {
      payload = { messaging_product: 'whatsapp', to, type: 'text', text: { body: message.body } };
    }
    const res = await this.fetchImpl(
      `${this.config.baseUrl ?? 'https://graph.facebook.com'}/${this.config.apiVersion ?? 'v21.0'}/${this.config.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15_000),
      },
    );
    const data = (await res.json().catch(() => ({}))) as {
      messages?: Array<{ id: string }>;
      error?: { message?: string; code?: number };
    };
    if (!res.ok || !data.messages?.[0])
      throw new Error(`WhatsApp: ${data.error?.message ?? `HTTP ${String(res.status)}`}`);
    return { providerMessageId: data.messages[0].id, delivered: false };
  }
}
