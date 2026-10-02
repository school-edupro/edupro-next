import type { ChannelAdapter, DeliveryResult, OutboundMessage } from './adapter';

export interface SmsBhejoConfig {
  url?: string;
  user?: string;
  senderId?: string;
  entityId?: string;
  /** send 91 + number instead of the bare 10 digits */
  countryPrefix?: boolean;
}

const FAILURE = ['error', 'fail', 'invalid', 'denied', 'reject', 'unauthor', 'expired'];

/**
 * SMS through smsbhejo.org (DLT), the gateway the legacy ERP uses: a GET on submitsms.jsp with the
 * account user and key, the DLT sender id (header), entity id and content template id. The gateway
 * answers in plain text; an empty answer or one with an error word is a failure (as the PHP worker).
 */
export class SmsBhejoAdapter implements ChannelAdapter {
  readonly name = 'smsbhejo';
  constructor(
    private readonly config: SmsBhejoConfig,
    private readonly key: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(message: OutboundMessage): Promise<DeliveryResult> {
    if (!message.dlt.templateId)
      throw new Error('SMS template has no DLT template id; add it in the template master');
    const sender = message.dlt.senderId ?? this.config.senderId;
    const entity = message.dlt.entityId ?? this.config.entityId;
    if (!sender)
      throw new Error('No SMS sender id (header); set it on the template or in settings');
    if (!entity) throw new Error('No DLT entity id; set it on the template or in settings');
    if (!this.config.user) throw new Error('smsbhejo user name is not set');
    const text = message.body.replace(/[\r\n]+/g, ' ').trim();
    const params = new URLSearchParams({
      user: this.config.user,
      key: this.key,
      mobile: this.config.countryPrefix ? `91${message.to}` : message.to,
      message: text,
      senderid: sender,
      accusage: '1',
      entityid: entity,
      tempid: message.dlt.templateId,
    });
    const res = await this.fetchImpl(
      `${this.config.url ?? 'https://smsbhejo.org/submitsms.jsp'}?${params.toString()}`,
      { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(15_000) },
    );
    const body = (await res.text()).trim();
    if (!res.ok || !body || FAILURE.some((w) => body.toLowerCase().includes(w)))
      throw new Error(`smsbhejo: ${body.slice(0, 200) || `HTTP ${String(res.status)}`}`);
    // the answer carries the gateway's message id (text); keep it for reports
    return { providerMessageId: body.slice(0, 100), delivered: false };
  }
}
