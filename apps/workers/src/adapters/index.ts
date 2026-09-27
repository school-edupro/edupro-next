import type { WorkerEnv } from '../env';
import type { Logger } from '../logger';
import type { Channel, ChannelAdapter } from './adapter';
import { ConsoleAdapter } from './console.adapter';
import { HttpAdapter } from './http.adapter';
import { SmtpAdapter } from './smtp.adapter';

export type Adapters = Record<Channel, ChannelAdapter>;

export function buildAdapters(env: WorkerEnv, log: Logger): Adapters {
  const console_ = new ConsoleAdapter(log);
  const http = (channel: Channel, url: string | undefined, token: string | undefined) => {
    if (!url) throw new Error(`${channel.toUpperCase()}_HTTP_URL is required for the http adapter`);
    return new HttpAdapter(channel, url, token);
  };
  return {
    sms:
      env.NOTIFY_SMS_ADAPTER === 'http'
        ? http('sms', env.SMS_HTTP_URL, env.SMS_HTTP_TOKEN)
        : console_,
    whatsapp:
      env.NOTIFY_WHATSAPP_ADAPTER === 'http'
        ? http('whatsapp', env.WHATSAPP_HTTP_URL, env.WHATSAPP_HTTP_TOKEN)
        : console_,
    email:
      env.NOTIFY_EMAIL_ADAPTER === 'smtp'
        ? new SmtpAdapter(
            env.SMTP_URL ??
              (() => {
                throw new Error('SMTP_URL is required for the smtp adapter');
              })(),
            env.SMTP_FROM,
          )
        : console_,
    push:
      env.NOTIFY_PUSH_ADAPTER === 'http'
        ? http('push', env.PUSH_HTTP_URL, env.PUSH_HTTP_TOKEN)
        : console_,
  };
}

export type { Channel, ChannelAdapter, DeliveryResult, OutboundMessage } from './adapter';
