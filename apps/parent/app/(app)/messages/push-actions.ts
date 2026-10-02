'use server';
import { bff } from '@/lib/bff';

export type PushConfig =
  | { enabled: false }
  | {
      enabled: true;
      firebase: {
        apiKey: string;
        authDomain?: string;
        projectId: string;
        messagingSenderId: string;
        appId: string;
      };
      vapidKey: string;
    };

/** Firebase web config of the school (no secrets), or enabled: false when push is not set up. */
export async function getPushConfig(): Promise<PushConfig> {
  try {
    return await bff.api.fetch<PushConfig>('/comms/push/config');
  } catch {
    return { enabled: false };
  }
}

export async function registerPushDevice(
  token: string,
  app: 'parent' | 'teacher',
  userAgent: string,
) {
  try {
    await bff.api.fetch('/comms/push/devices', {
      method: 'POST',
      body: JSON.stringify({ token, app, userAgent: userAgent.slice(0, 300) }),
    });
    return { ok: true as const };
  } catch {
    return { ok: false as const };
  }
}

export async function removePushDevice(token: string, app: 'parent' | 'teacher') {
  try {
    await bff.api.fetch('/comms/push/devices/remove', {
      method: 'POST',
      body: JSON.stringify({ token, app }),
    });
  } catch {
    // nothing to undo
  }
}
