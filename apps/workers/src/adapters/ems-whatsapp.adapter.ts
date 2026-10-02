import type { ChannelAdapter, DeliveryResult, OutboundMessage } from './adapter';

export interface EmsConfig {
  url?: string;
  /** send 91 + number instead of the bare 10 digits */
  countryPrefix?: boolean;
}

/**
 * WhatsApp through the Mobilise EMS bridge, as the legacy ERP's sendWhatsAppTemplate(): a JSON POST
 * {to, type: 'template', template: {name, language, variables, header}} with a bearer key. The bridge
 * takes the PDF / image header inline as base64, so no public file link is needed.
 */
export class EmsWhatsAppAdapter implements ChannelAdapter {
  readonly name = 'ems_whatsapp';
  constructor(
    private readonly config: EmsConfig,
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(message: OutboundMessage): Promise<DeliveryResult> {
    const wa = message.whatsapp;
    if (!wa?.templateName)
      throw new Error(
        'The WhatsApp template has no approved template name; add it in the template master',
      );
    const template: Record<string, unknown> = {
      name: wa.templateName,
      language: wa.language ?? 'en',
      variables: wa.params.map((v) => String(v ?? '')),
    };
    if (wa.header === 'document' || wa.header === 'image') {
      const file = message.attachments?.find((a) => a.bytes);
      if (!file?.bytes)
        throw new Error(`The WhatsApp template needs a ${wa.header} header: attach a file`);
      template.header = {
        type: wa.header,
        data: file.bytes.toString('base64'),
        mime: file.contentType,
        filename: file.name,
      };
    }
    const res = await this.fetchImpl(
      this.config.url ?? 'https://ems.onmobilise.com/api/v1/messages',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          to: this.config.countryPrefix ? `91${message.to}` : message.to,
          type: 'template',
          template,
        }),
        signal: AbortSignal.timeout(60_000),
      },
    );
    const text = await res.text();
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      data = {};
    }
    if (!res.ok) {
      const e = data.error;
      const reason =
        typeof e === 'string'
          ? e
          : typeof (e as { message?: unknown } | undefined)?.message === 'string'
            ? (e as { message: string }).message
            : typeof data.message === 'string'
              ? data.message
              : text;
      throw new Error(`EMS WhatsApp: HTTP ${String(res.status)} ${reason}`.slice(0, 300));
    }
    const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
    const id =
      str(data.id) ??
      str(data.message_id) ??
      str((data.messages as Array<{ id?: unknown }> | undefined)?.[0]?.id) ??
      str((data.data as { id?: unknown } | undefined)?.id);
    return { providerMessageId: id ?? null, delivered: false };
  }
}
