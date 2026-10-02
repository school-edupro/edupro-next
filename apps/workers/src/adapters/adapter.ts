export type Channel = 'sms' | 'whatsapp' | 'email' | 'push';

export interface OutboundMessage {
  id: string;
  channel: Channel;
  to: string;
  subject: string | null;
  body: string;
  dlt: { templateId: string | null; entityId: string | null; senderId: string | null };
  /** Email: html body (the text part is `body`). */
  html?: string | null;
  /** WhatsApp: the approved template, its parameters in order and header media. */
  whatsapp?: {
    templateName: string | null;
    language: string | null;
    params: string[];
    header: 'none' | 'text' | 'image' | 'document';
  } | null;
  attachments?: Array<{ name: string; contentType: string; bytes?: Buffer; url?: string }>;
}

export interface DeliveryResult {
  providerMessageId: string | null;
  /** True when the provider confirmed delivery synchronously (console, SMTP accepted). */
  delivered: boolean;
}

/** One interface for every channel (S3-02). Adapters throw on provider failure; the processor records and retries. */
export interface ChannelAdapter {
  readonly name: string;
  send(message: OutboundMessage): Promise<DeliveryResult>;
}
