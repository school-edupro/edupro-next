'use client';
import { useEffect, useState } from 'react';
import { getPushConfig, registerPushDevice, removePushDevice } from './push-actions';

const KEY = 'edupro-push-token';
type State =
  'checking' | 'unsupported' | 'off' | 'on' | 'denied' | 'not-set-up' | 'busy' | 'failed';

/**
 * Turn on push notifications for this device (Firebase): asks the browser's permission, registers the
 * app's service worker, gets the device token and tells the school. Works in Chrome / Edge / Firefox
 * and on iPhone when the app is added to the Home Screen.
 */
export function EnablePush({
  labels,
}: {
  labels: {
    on: string;
    off: string;
    turnOn: string;
    turnOff: string;
    denied: string;
    unsupported: string;
    notSetUp: string;
    failed: string;
  };
}) {
  const [state, setState] = useState<State>('checking');
  useEffect(() => {
    if (
      !('Notification' in window) ||
      !('serviceWorker' in navigator) ||
      !('PushManager' in window)
    ) {
      setState('unsupported');
      return;
    }
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(KEY);
    } catch {
      saved = null;
    }
    if (Notification.permission === 'denied') setState('denied');
    else setState(Notification.permission === 'granted' && saved ? 'on' : 'off');
  }, []);

  const turnOn = async () => {
    setState('busy');
    try {
      const config = await getPushConfig();
      if (!config.enabled) {
        setState('not-set-up');
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'denied' : 'off');
        return;
      }
      const registration = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const { getApps, initializeApp } = await import('firebase/app');
      const { getMessaging, getToken, isSupported } = await import('firebase/messaging');
      if (!(await isSupported())) {
        setState('unsupported');
        return;
      }
      const app = getApps()[0] ?? initializeApp(config.firebase);
      const token = await getToken(getMessaging(app), {
        vapidKey: config.vapidKey,
        serviceWorkerRegistration: registration,
      });
      const r = await registerPushDevice(token, 'parent', navigator.userAgent);
      if (!r.ok) {
        setState('failed');
        return;
      }
      try {
        localStorage.setItem(KEY, token);
      } catch {
        /* the token is registered with the school anyway */
      }
      setState('on');
    } catch {
      setState('failed');
    }
  };

  const turnOff = async () => {
    let token: string | null = null;
    try {
      token = localStorage.getItem(KEY);
      localStorage.removeItem(KEY);
    } catch {
      token = null;
    }
    if (token) await removePushDevice(token, 'parent');
    setState('off');
  };

  if (state === 'checking') return null;
  return (
    <div className="fp-push" role="status">
      {state === 'on' ? (
        <>
          <span>{labels.on}</span>
          <button
            type="button"
            className="ep-btn ep-btn--ghost ep-btn--sm"
            onClick={() => void turnOff()}
          >
            {labels.turnOff}
          </button>
        </>
      ) : state === 'off' || state === 'busy' || state === 'failed' || state === 'not-set-up' ? (
        <>
          <span>
            {state === 'failed'
              ? labels.failed
              : state === 'not-set-up'
                ? labels.notSetUp
                : labels.off}
          </span>
          {state !== 'not-set-up' ? (
            <button
              type="button"
              className="ep-btn ep-btn--primary ep-btn--sm"
              disabled={state === 'busy'}
              onClick={() => void turnOn()}
            >
              {labels.turnOn}
            </button>
          ) : null}
        </>
      ) : (
        <span>{state === 'denied' ? labels.denied : labels.unsupported}</span>
      )}
    </div>
  );
}
