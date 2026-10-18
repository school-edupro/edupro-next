'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Keeps an export notice current without a manual refresh: re-renders the page every few seconds
 * while the PDF is being prepared, until its Open and Download links appear.
 */
export function ExportWatcher({ id, url }: { id: string; url: string | null }) {
  const router = useRouter();
  useEffect(() => {
    // ready: the page shows Open (new tab) and Download; nothing opens by itself, since a browser
    // blocks tabs opened without a click
    if (url) return;
    const timer = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(timer);
  }, [id, url, router]);
  return null;
}
