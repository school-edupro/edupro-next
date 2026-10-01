'use client';
import { useEffect, useState } from 'react';
import { FileLinks } from './FileLinks';

/**
 * Polls a queued export every 2 s; when the file is ready a PDF shows Open (new tab) and Download,
 * other formats download at once, so the user never has to refresh. After a minute still queued it explains that the workers service
 * renders exports (the usual cause locally is that it is not running).
 */
export function ExportWatcher({
  id,
  format,
  labels,
}: {
  id: string;
  format: string;
  labels: { queued: string; ready: string; pending: string; failed: string; stuck: string };
}) {
  const [state, setState] = useState<'pending' | 'ready' | 'failed' | 'stuck'>('pending');
  const [detail, setDetail] = useState<string | null>(null);
  const download = `/reports/exports/${id}/download`;
  useEffect(() => {
    let stop = false;
    const started = Date.now();
    const tick = async () => {
      if (stop) return;
      try {
        const r = await fetch(`/reports/exports/${id}/status`, { cache: 'no-store' });
        const s = (await r.json()) as { status?: string; ready?: boolean; error?: string | null };
        if (s.ready) {
          setState('ready');
          // spreadsheets and other files download at once; a PDF waits for Open (a browser blocks
          // tabs opened without a click), with Download beside it
          if (format !== 'pdf') window.location.assign(`${download}?save=1`);
          return;
        }
        if (s.status === 'failed') {
          setState('failed');
          setDetail(s.error ?? null);
          return;
        }
      } catch {
        // transient; try again
      }
      if (Date.now() - started > 60_000) setState('stuck');
      setTimeout(tick, 2000);
    };
    void tick();
    return () => {
      stop = true;
    };
  }, [id, download, format]);
  return (
    <div
      className={`ep-alert ${state === 'failed' ? 'ep-alert--danger' : state === 'stuck' ? 'ep-alert--warning' : 'ep-alert--info'}`}
      role="status"
      aria-live="polite"
      style={{ marginBottom: 'var(--sp-3)' }}
    >
      {labels.queued} · {format.toUpperCase()} ·{' '}
      {state === 'ready' ? (
        <FileLinks href={download} label={labels.ready} />
      ) : state === 'failed' ? (
        <span>
          {labels.failed}
          {detail ? ` (${detail})` : ''}
        </span>
      ) : state === 'stuck' ? (
        <span>{labels.stuck}</span>
      ) : (
        <span>{labels.pending}</span>
      )}
    </div>
  );
}
