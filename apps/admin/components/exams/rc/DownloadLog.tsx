'use client';
import { Badge, Button, Drawer } from '@edupro/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { FileLinks } from '@/components/FileLinks';
import { releaseExports, type ExportLogRow } from '@/lib/report-card-actions';

const TONE: Record<string, 'neutral' | 'warning' | 'success' | 'danger'> = {
  queued: 'neutral',
  running: 'warning',
  ready: 'success',
  failed: 'danger',
  expired: 'neutral',
};

/**
 * The Download Log of a release (legacy Exam Report Card): every PDF made for it, newest first, with who
 * asked, when, what it holds, and View / Download once it is ready.
 */
export function DownloadLog({ releaseId }: { releaseId: string }) {
  const t = useTranslations('rcRelease');
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ExportLogRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    const r = await releaseExports(releaseId);
    setLoading(false);
    if (r.ok) {
      setRows(r.data);
      setError(null);
    } else setError(r.error);
  }, [releaseId]);
  useEffect(() => {
    if (open) void load();
  }, [open, load]);
  const when = (iso: string) =>
    new Intl.DateTimeFormat(`${locale}-IN`, {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(iso));
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        {t('downloadLog')}
      </Button>
      <Drawer
        open={open}
        title={t('downloadLog')}
        onClose={() => setOpen(false)}
        width="lg"
        footer={
          <Button size="sm" variant="secondary" loading={loading} onClick={() => void load()}>
            {t('refresh')}
          </Button>
        }
      >
        {error ? (
          <p className="ep-alert ep-alert--danger" role="alert">
            {error}
          </p>
        ) : null}
        {rows && !rows.length ? <p>{t('logEmpty')}</p> : null}
        {rows?.length ? (
          <div className="ep-table-wrap">
            <table className="ep-table ep-table--dense">
              <caption className="ep-sr-only">{t('downloadLog')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('logWhat')}</th>
                  <th scope="col">{t('logWhen')}</th>
                  <th scope="col">{t('logStatus')}</th>
                  <th scope="col">{t('pdf')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((x) => (
                  <tr key={x.id}>
                    <td>
                      {x.title}
                      {x.error ? <span className="ep-mr-col__desc">{x.error}</span> : null}
                    </td>
                    <td>
                      {when(x.requestedAt)}
                      {x.by ? <span className="ep-mr-col__desc">{x.by}</span> : null}
                    </td>
                    <td>
                      <Badge tone={TONE[x.status] ?? 'neutral'}>
                        {t(`exp_${x.status}` as 'exp_ready')}
                      </Badge>
                    </td>
                    <td>
                      {x.status === 'ready' ? (
                        <FileLinks href={`/reports/exports/${x.id}/download`} label={x.title} />
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <p className="ep-field__help">{t('logHelp')}</p>
      </Drawer>
    </>
  );
}
