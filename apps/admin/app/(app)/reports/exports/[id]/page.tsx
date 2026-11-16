import { Badge, Breadcrumbs, Button, Card, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { ExportWatcher } from '@/components/ExportWatcher';
import { FileLinks } from '@/components/FileLinks';
import { Notice } from '@/components/Notice';
import { makeExportAgain } from '@/lib/actions';
import { ApiError, apiFetch } from '@/lib/api';
import type { ExportRow } from '@/lib/types';
import { EXPORT_STATUS, EXPORT_TONE } from '../status';

const day = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

/**
 * One file of the export centre (16 Nov 2026): where every View or Download lands when the file cannot open yet —
 * being made (it follows it and opens when ready), could not be made (why, and Try again) or cleared after its seven
 * days (Make it again) — instead of an error.
 */
export default async function ExportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d{1,18}$/.test(id)) notFound();
  let s: { export: ExportRow; download: { url: string } | null };
  try {
    s = await apiFetch<{ export: ExportRow; download: { url: string } | null }>(
      `/reports/exports/${id}`,
    );
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  }
  const x = s.export;
  const fmt = x.format.toUpperCase();
  const again = (label: string) => (
    <form action={makeExportAgain}>
      <input type="hidden" name="id" value={x.id} />
      <Button type="submit">{label}</Button>
    </form>
  );
  return (
    <>
      <Breadcrumbs
        items={[{ label: 'Export centre', href: '/reports/exports' }, { label: x.title }]}
      />
      <PageHeader
        kicker="File"
        title={x.title}
        description={`${fmt} · asked for by ${x.requestedByName ?? 'someone'} on ${day(x.requestedAt)}`}
      />
      {sp.ok === 'again' ? (
        <div className="ep-alert ep-alert--success" role="status">
          Being made again. It opens here when it is ready.
        </div>
      ) : (
        <Notice params={sp} />
      )}
      <Card>
        <p style={{ marginTop: 0 }}>
          <Badge tone={EXPORT_TONE[x.status]}>{EXPORT_STATUS[x.status]}</Badge>
        </p>
        {x.status === 'ready' && s.download ? (
          <>
            <p className="ep-filecell">
              Ready to open.{' '}
              <FileLinks href={`/reports/exports/${x.id}/download`} label={x.title} />
            </p>
            <p className="ep-field__help" style={{ marginBottom: 0 }}>
              Kept until {day(x.expiresAt)}; after that it is cleared and can be made again.
            </p>
          </>
        ) : x.status === 'queued' || x.status === 'running' ? (
          <>
            <ExportWatcher
              id={x.id}
              format={x.format}
              labels={{
                queued: 'Asked for',
                ready: 'Open',
                pending: 'Being made…',
                failed: 'It could not be made',
                stuck:
                  'Still waiting: the background service makes the files; check that it is running.',
              }}
            />
            <p className="ep-field__help" style={{ marginBottom: 0 }}>
              This page follows it: View and Download appear when it is ready.
            </p>
          </>
        ) : x.status === 'failed' ? (
          <>
            <div className="ep-alert ep-alert--danger" role="alert">
              It could not be made{x.error ? `: ${x.error}` : '.'}
            </div>
            {again('Try again')}
          </>
        ) : (
          <>
            <p>
              Files are kept for seven days, then cleared to save space. This one was cleared after{' '}
              {day(x.expiresAt)}.
            </p>
            <p className="ep-field__help">
              {fmt === 'PDF'
                ? 'Make it again to open it: a document prints the same as before.'
                : "Make it again to open it: a list is made again with today's records."}
            </p>
            {again('Make it again')}
          </>
        )}
      </Card>
      <p>
        <a href="/reports/exports">Back to the export centre</a>
      </p>
    </>
  );
}
