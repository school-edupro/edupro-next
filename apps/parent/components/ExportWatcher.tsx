'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Keeps an export notice current without a manual refresh: re-renders the page every few seconds
 * while the PDF is being prepared, and starts the download once (per export) when it is ready.
 */
export function ExportWatcher({ id, url }: { id: string; url: string | null }) {
  const router = useRouter();
  useEffect(() => {
    if (url) {
      const key = `edupro.export.${id}`;
      let seen = false;
      try {
        seen = sessionStorage.getItem(key) === '1';
        sessionStorage.setItem(key, '1');
      } catch {
        /* storage blocked: download anyway */
      }
      if (!seen) window.location.assign(url);
      return;
    }
    const timer = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(timer);
  }, [id, url, router]);
  return null;
}
