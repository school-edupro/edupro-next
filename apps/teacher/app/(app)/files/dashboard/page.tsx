import { BarChart, Badge, Card, DonutChart, PageHeader, ProgressRows } from '@edupro/ui';
import { ApiError } from '@edupro/bff';
import { notFound, redirect } from 'next/navigation';
import { FilesNav } from '@/components/FilesNav';
import { bff } from '@/lib/bff';
import { FILE_TONE, fileWhen, type FileDashboard } from '@/lib/file-movement';
import { currentLang, t } from '@/lib/i18n';

/**
 * File movement dashboard on the staff website, as the admin's: how many files, in which state, month by month, who holds what and the
 * oldest files still open. The office sees every file; others see their own and those sent to them.
 */
export default async function StaffFilesDashboardPage() {
  const lang = await currentLang();
  let d: FileDashboard;
  try {
    d = await bff.api.fetch<FileDashboard>('/file-movement/dashboard');
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && error.status === 403) notFound();
    throw error;
  }
  const c = d.counts;
  const kpis: Array<[string, string, string, string]> = [
    [
      'Files',
      String(c.total),
      d.seesAll ? 'every file of the school' : 'raised by you or sent to you',
      '/files?box=all',
    ],
    ['In approval', String(c.pending), 'with an approver now', '/files?box=all&status=pending'],
    [
      'Sent back',
      String(c.returned),
      'waiting for the creator to correct',
      '/files?box=all&status=returned',
    ],
    [
      'Approved',
      String(c.approved),
      d.averageHours === null
        ? 'none approved yet'
        : `in ${String(d.averageHours)} hours on average`,
      '/files?box=all&status=approved',
    ],
    [
      'Rejected',
      String(c.rejected),
      `${String(c.withdrawn)} withdrawn`,
      '/files?box=all&status=rejected',
    ],
  ];
  const most = Math.max(1, ...d.holders.map((h) => h.count));
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: '72rem', margin: '0 auto' }}>
      <PageHeader
        kicker={t(lang, 'File movement')}
        title={t(lang, 'Dashboard')}
        description={t(lang, 'Files by status, month by month, and who is holding them.')}
        actions={
          <>
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href="/api/file-movement/export?box=all&format=xlsx"
            >
              Excel
            </a>
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href="/api/file-movement/export?box=all&format=pdf"
            >
              PDF
            </a>
          </>
        }
      />
      <FilesNav current="/files/dashboard" lang={lang} />
      <div className="ep-cdash__kpis">
        {kpis.map(([title, value, help, href]) => (
          <Card key={title} title={t(lang, title)}>
            <div className="ep-cdash__big">
              <a className="ep-cdash__num" href={href} aria-label={`${title}: ${value}`}>
                {value}
              </a>
            </div>
            <div className="ep-field__help">{t(lang, help)}</div>
          </Card>
        ))}
      </div>
      <div className="ep-chart__grid2" style={{ marginTop: 'var(--sp-4)' }}>
        <Card title={t(lang, 'Last six months')}>
          <BarChart
            title="Files raised, approved and rejected in each of the last six months"
            series={[
              { label: 'Raised', tone: 'navy' },
              { label: 'Approved', tone: 'success' },
              { label: 'Rejected', tone: 'danger' },
            ]}
            data={d.months.map((m) => ({
              label: new Date(`${m.m}-01T00:00:00Z`).toLocaleDateString('en-IN', {
                month: 'short',
                timeZone: 'UTC',
              }),
              values: [m.raised, m.approved, m.rejected],
            }))}
          />
        </Card>
        <Card title={t(lang, 'By status')}>
          <DonutChart
            title="Files by status"
            centre={String(c.total)}
            caption="files"
            parts={[
              { label: 'Approved', tone: 'success', value: c.approved },
              { label: 'In approval', tone: 'warning', value: c.pending },
              { label: 'Sent back', tone: 'info', value: c.returned },
              { label: 'Rejected', tone: 'danger', value: c.rejected },
              { label: 'Withdrawn', tone: 'muted', value: c.withdrawn },
            ]}
          />
        </Card>
      </div>
      <div className="ep-chart__grid2">
        <Card title={t(lang, 'Who is holding files')}>
          {d.holders.length === 0 ? (
            <p className="ep-field__help" style={{ margin: 0 }}>
              {t(lang, 'No file is waiting with anyone.')}
            </p>
          ) : (
            <ProgressRows
              label="Files waiting with each approver"
              rows={d.holders.map((h) => ({
                name: h.name,
                value: h.count,
                of: most,
                tone: 'warning' as const,
                text: `${String(h.count)} · oldest ${fileWhen(h.oldest)}`,
              }))}
            />
          )}
        </Card>
        <Card title={t(lang, 'Oldest files still in approval')}>
          {d.oldest.length === 0 ? (
            <p className="ep-field__help" style={{ margin: 0 }}>
              {t(lang, 'Nothing is in approval.')}
            </p>
          ) : (
            <ul className="ep-cdash__list">
              {d.oldest.map((n) => (
                <li key={n.id}>
                  <a href={`/files/${n.id}`} style={{ textDecoration: 'underline' }}>
                    {n.number}
                  </a>{' '}
                  {n.subject}{' '}
                  <Badge tone={FILE_TONE[n.status] ?? 'neutral'}>
                    {n.waitingOn ?? n.statusLabel}
                  </Badge>
                  <div className="ep-field__help">
                    {n.createdBy} · since {fileWhen(n.submittedAt)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </main>
  );
}
