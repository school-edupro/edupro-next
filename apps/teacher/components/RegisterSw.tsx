'use client';
import { useEffect } from 'react';

/** Registers the service worker that caches the app shell so the PWA opens offline (S5-08). */
export function RegisterSw() {
  useEffect(() => {
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }
  }, []);
  return null;
}
