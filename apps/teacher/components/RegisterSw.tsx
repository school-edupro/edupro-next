'use client';
import { useEffect } from 'react';

/** Registers the service worker that caches the app shell so the PWA opens offline (S5-08). */
export function RegisterSw() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    // Sprint 21: after a sign-out the login page arrives with ?signedOut=1; drop every cached page.
    if (new URLSearchParams(window.location.search).get('signedOut') === '1') {
      navigator.serviceWorker.controller?.postMessage({ type: 'edupro:signed-out' });
      if ('caches' in window)
        caches
          .keys()
          .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
          .catch(() => undefined);
      try {
        sessionStorage.clear();
      } catch {
        /* ignore */
      }
    }
    if (process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }
  }, []);
  return null;
}
