'use client';
import { useEffect, useState } from 'react';

/**
 * Waits for a certificate PDF being made and opens it in this same tab once it is ready (or saves it, for Download).
 * After a minute it says the school is still making it; a failure offers to try again.
 */
export function OpenCertificate({
  exportId,
  kind,
  save,
  retry,
  words,
}: {
  exportId: string;
  kind: 'register' | 'award';
  save: boolean;
  retry: string;
  words: { wait: string; stuck: string; failed: string; again: string; saved: string };
}) {
  const [state, setState] = useState<'wait' | 'stuck' | 'failed' | 'saved'>('wait');
  useEffect(() => {
    let stop = false;
    const started = Date.now();
    const tick = async () => {
      if (stop) return;
      try {
        const r = await fetch(`/api/certificate-export?id=${exportId}&kind=${kind}`, {
          cache: 'no-store',
        });
        const s = (await r.json()) as {
          status?: string;
          url?: string | null;
          saveUrl?: string | null;
        };
        const to = save ? (s.saveUrl ?? s.url) : s.url;
        if (s.status === 'ready' && to) {
          window.location.replace(to);
          // a download leaves this page where it is
          if (save) setState('saved');
          return;
        }
        if (s.status === 'failed' || s.status === 'expired' || s.status === 'error') {
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
  }, [exportId, kind, save]);
  if (state === 'failed')
    return (
      <div className="ep-alert ep-alert--danger" role="alert">
        {words.failed} <a href={retry}>{words.again}</a>
      </div>
    );
  return (
    <div
      className={`ep-alert ${state === 'stuck' ? 'ep-alert--warning' : state === 'saved' ? 'ep-alert--success' : 'ep-alert--info'}`}
      role="status"
      aria-live="polite"
    >
      {state === 'stuck' ? words.stuck : state === 'saved' ? words.saved : words.wait}
    </div>
  );
}
