import type { ChannelAdapter, DeliveryResult, OutboundMessage } from './adapter';

export interface Msg91Config {
  senderId?: string;
  route?: string;
  dltEntityId?: string;
  country?: string;
  baseUrl?: string;
}

/**
 * SMS through MSG91 (the school's own account). Every message carries the DLT content template id
 * (TRAI); the text must match the registered template, which the template master keeps. Unicode is
 * switched on for Hindi and other non-GSM text. MSG91 returns a request id that its delivery report
 * webhook quotes back (/comms/webhooks/msg91).
 */
export class Msg91Adapter implements ChannelAdapter {
  readonly name = 'msg91';
  constructor(
    private readonly config: Msg91Config,
    private readonly authKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(message: OutboundMessage): Promise<DeliveryResult> {
    if (!message.dlt.templateId)
      throw new Error('SMS template has no DLT template id; add it in the template master');
    const sender = message.dlt.senderId ?? this.config.senderId;
    if (!sender)
      throw new Error('No SMS sender id (header); set it on the template or in settings');
    const unicode = /[^\u0000-\u007f₹]/.test(message.body) || message.body.includes('₹');
    const params = new URLSearchParams({
      authkey: this.authKey,
      mobiles: `${this.config.country ?? '91'}${message.to}`,
      message: message.body,
      sender,
      route: this.config.route ?? '4',
      country: this.config.country ?? '91',
      DLT_TE_ID: message.dlt.templateId,
      response: 'json',
    });
    if (unicode) params.set('unicode', '1');
    const entity = message.dlt.entityId ?? this.config.dltEntityId;
    if (entity) params.set('PE_ID', entity);
    const res = await this.fetchImpl(
      `${this.config.baseUrl ?? 'https://api.msg91.com'}/api/sendhttp.php?${params.toString()}`,
      { method: 'GET', signal: AbortSignal.timeout(15_000) },
    );
    const text = await res.text();
    let data: { type?: string; message?: string } = {};
    try {
      data = JSON.parse(text) as typeof data;
    } catch {
      data = { type: res.ok ? 'success' : 'error', message: text.trim() };
    }
    if (!res.ok || data.type !== 'success')
      throw new Error(`MSG91: ${data.message ?? `HTTP ${String(res.status)}`}`);
    return { providerMessageId: data.message ?? null, delivered: false };
  }
}
