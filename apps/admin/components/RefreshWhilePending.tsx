'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Keeps an export notice current without a manual refresh: re-renders the page every few seconds
 * while the file is being prepared, until its View and Download links appear (`ready`).
 */
export function RefreshWhilePending({ ready }: { ready: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (ready) return;
    const timer = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(timer);
  }, [ready, router]);
  return null;
}
