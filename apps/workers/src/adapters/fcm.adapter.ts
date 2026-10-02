import { createSign } from 'node:crypto';
import type { ChannelAdapter, DeliveryResult, OutboundMessage } from './adapter';

export interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

/** FCM said the device token is no longer valid: the device is removed, the message is not retried. */
export class DeadToken extends Error {}

const tokens = new Map<string, { value: string; until: number }>();

/**
 * Push through Firebase Cloud Messaging (HTTP v1) with the school's service account: a short-lived
 * Google access token (JWT signed with the account's key), then one message per device token. The
 * notification opens the app at the message's link (Messages, Notices, Homework...).
 */
export class FcmAdapter implements ChannelAdapter {
  readonly name = 'fcm';
  constructor(
    private readonly account: ServiceAccount,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    if (!account.project_id || !account.client_email || !account.private_key)
      throw new Error('The Firebase service account JSON is incomplete');
  }

  private async accessToken(): Promise<string> {
    const hit = tokens.get(this.account.client_email);
    if (hit && hit.until > Date.now()) return hit.value;
    const now = Math.floor(Date.now() / 1000);
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
      iss: this.account.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    })}`;
    const signature = createSign('RSA-SHA256')
      .update(unsigned)
      .sign(this.account.private_key, 'base64url');
    const res = await this.fetchImpl('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${unsigned}.${signature}`,
      }).toString(),
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
      error_description?: string;
    };
    if (!res.ok || !data.access_token)
      throw new Error(
        `Firebase sign-in failed: ${data.error_description ?? `HTTP ${String(res.status)}`}`,
      );
    tokens.set(this.account.client_email, {
      value: data.access_token,
      until: Date.now() + Math.max(60, (data.expires_in ?? 3600) - 300) * 1000,
    });
    return data.access_token;
  }

  async send(message: OutboundMessage): Promise<DeliveryResult> {
    const link = message.link ?? '/messages';
    const res = await this.fetchImpl(
      `https://fcm.googleapis.com/v1/projects/${this.account.project_id}/messages:send`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${await this.accessToken()}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          message: {
            token: message.to,
            notification: { title: message.subject ?? 'School', body: message.body },
            data: { link },
            webpush: {
              fcm_options: { link },
              notification: { icon: '/icons/icon.svg', badge: '/icons/icon.svg' },
            },
          },
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    const data = (await res.json().catch(() => ({}))) as {
      name?: string;
      error?: { status?: string; message?: string; details?: Array<{ errorCode?: string }> };
    };
    if (!res.ok) {
      const code =
        data.error?.details?.find((d) => d.errorCode)?.errorCode ?? data.error?.status ?? '';
      if (res.status === 404 || code === 'UNREGISTERED' || code === 'INVALID_ARGUMENT')
        throw new DeadToken(`FCM: device token no longer valid (${code || res.status})`);
      throw new Error(`FCM: ${data.error?.message ?? `HTTP ${String(res.status)}`}`);
    }
    return { providerMessageId: data.name ?? null, delivered: false };
  }
}
