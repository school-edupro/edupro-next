'use client';
import { useEffect, useState } from 'react';

/**
 * Waits for a PDF being made and opens it in this same tab as soon as it is ready (or saves it, for Download). After a
 * minute still waiting it says the background service may be stopped; a failure offers to try again.
 */
export function OpenWhenReady({
  exportId,
  save,
  retry,
}: {
  exportId: string;
  save: boolean;
  retry: string;
}) {
  const [state, setState] = useState<'wait' | 'stuck' | 'failed'>('wait');
  useEffect(() => {
    let stop = false;
    const started = Date.now();
    const tick = async () => {
      if (stop) return;
      try {
        const r = await fetch(`/reports/exports/${exportId}/status`, { cache: 'no-store' });
        const s = (await r.json()) as { status?: string; ready?: boolean };
        if (s.ready) {
          window.location.replace(`/reports/exports/${exportId}/download${save ? '?save=1' : ''}`);
          return;
        }
        if (s.status === 'failed' || s.status === 'expired') {
          setState('failed');
          return;
        }
      } catch {
        // a moment's trouble: ask again
      }
      if (Date.now() - started > 60_000) setState('stuck');
      setTimeout(() => void tick(), 1500);
    };
    void tick();
    return () => {
      stop = true;
    };
  }, [exportId, save]);
  return state === 'failed' ? (
    <div className="ep-alert ep-alert--danger" role="alert">
      The PDF could not be made. <a href={retry}>Try again</a>
    </div>
  ) : (
    <div
      className={`ep-alert ${state === 'stuck' ? 'ep-alert--warning' : 'ep-alert--info'}`}
      role="status"
      aria-live="polite"
    >
      {state === 'stuck'
        ? 'Still waiting: the background service makes the PDFs — check that it is running. This page opens the PDF as soon as it is made.'
        : 'Making the PDF… it opens here by itself in a few seconds.'}
    </div>
  );
}
