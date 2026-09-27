import { Badge, Button, Card, DataTable, InputField, KpiTile, PageHeader } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api';
import type { AttendanceSummary, AttendanceSummaryRow } from '@/lib/types';

const today = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

/** S9-06: the day's attendance across the sections the viewer may see. */
export default async function AttendanceDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const sp = await searchParams;
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : today();
  const [t, a, summary] = await Promise.all([
    getTranslations('pages.attendance_dashboard'),
    getTranslations('attendance'),
    apiFetch<AttendanceSummary>(`/attendance/summary?date=${date}`),
  ]);
  const rows = summary.sections;
  const marked = rows.filter((r) => r.sessionId);
  const sum = (k: 'strength' | 'present' | 'absent' | 'late') =>
    marked.reduce((s, r) => s + r[k], 0);
  return (
    <>
      <PageHeader kicker={t('kicker')} title={t('title')} description={t('description')} />
      <form
        method="get"
        style={{
          display: 'flex',
          gap: 'var(--sp-3)',
          alignItems: 'flex-end',
          marginBottom: 'var(--sp-4)',
        }}
      >
        <InputField id="date" name="date" label={a('date')} type="date" defaultValue={date} />
        <Button type="submit" variant="secondary">
          {a('show')}
        </Button>
      </form>
      <div
        style={{
          display: 'grid',
          gap: 'var(--sp-4)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          marginBottom: 'var(--sp-5)',
        }}
      >
        <KpiTile
          label={a('section')}
          value={`${marked.length} / ${rows.length}`}
          hint={a('register')}
        />
        <KpiTile
          label={a('present')}
          value={sum('present')}
          hint={`${a('strength')} ${sum('strength')}`}
        />
        <KpiTile label={a('absent')} value={sum('absent')} />
        <KpiTile label={a('late')} value={sum('late')} />
      </div>
      <Card>
        <DataTable<AttendanceSummaryRow>
          caption={`${a('date')} ${date}`}
          density="dense"
          columns={[
            {
              key: 'section',
              header: a('section'),
              render: (r) => (
                <a href={`/attendance/register?classSectionId=${r.classSectionId}&date=${date}`}>
                  <strong>{r.section}</strong>
                </a>
              ),
            },
            { key: 'strength', header: a('strength'), numeric: true, render: (r) => r.strength },
            {
              key: 'present',
              header: a('present'),
              numeric: true,
              render: (r) => (r.sessionId ? r.present : ''),
            },
            {
              key: 'absent',
              header: a('absent'),
              numeric: true,
              render: (r) => (r.sessionId ? r.absent : ''),
            },
            {
              key: 'late',
              header: a('late'),
              numeric: true,
              render: (r) => (r.sessionId ? r.late : ''),
            },
            {
              key: 'status',
              header: a('markedBy'),
              render: (r) =>
                r.sessionId ? (
                  <span
                    style={{ display: 'inline-flex', gap: 'var(--sp-1)', alignItems: 'center' }}
                  >
                    {r.markedBy ?? a(`sources.${r.source ?? 'manual'}`)}
                    {r.source === 'rfid' ? <Badge tone="info">{a('sources.rfid')}</Badge> : null}
                    {r.locked ? <Badge tone="warning">{a('locked')}</Badge> : null}
                  </span>
                ) : (
                  <Badge tone="neutral">{a('notMarked')}</Badge>
                ),
            },
          ]}
          rows={rows}
          rowKey={(r) => r.classSectionId}
          emptyTitle={a('notMarked')}
        />
      </Card>
    </>
  );
}
