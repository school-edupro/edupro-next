import { Badge, Card, DataTable, PageHeader } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api';

interface GroupRow {
  schoolId: string;
  code: string;
  name: string;
  pupils: number;
  attendanceTodayPct: number | null;
  feesCollectedMonth: string;
  feesOutstanding: string;
  latestExam: string | null;
  passPct: number | null;
  openApprovals: number;
  overdueLoans: number;
}
const money = (v: string) => `₹${Number(v).toLocaleString('en-IN')}`;

/** Sprint 19 (AI track): the Group Admin's view across the schools of the group. */
export default async function GroupPage() {
  const [t, m, rows] = await Promise.all([
    getTranslations('pages.insights_group'),
    getTranslations('mis'),
    apiFetch<{ data: GroupRow[] }>('/insights/group').then((x) => x.data),
  ]);
  return (
    <>
      <PageHeader kicker={t('kicker')} title={t('title')} description={t('description')} />
      <Card>
        <DataTable<GroupRow>
          caption={`${t('title')} · ${rows.length}`}
          density="dense"
          columns={[
            {
              key: 's',
              header: m('school'),
              render: (r) => (
                <>
                  <strong>{r.name}</strong>
                  <div className="ep-kicker">{r.code}</div>
                </>
              ),
            },
            { key: 'p', header: m('pupils'), numeric: true, render: (r) => r.pupils },
            {
              key: 'a',
              header: m('attendance'),
              numeric: true,
              render: (r) => (r.attendanceTodayPct === null ? '—' : `${r.attendanceTodayPct}%`),
            },
            {
              key: 'c',
              header: m('collected'),
              numeric: true,
              render: (r) => money(r.feesCollectedMonth),
            },
            {
              key: 'o',
              header: m('outstanding'),
              numeric: true,
              render: (r) => money(r.feesOutstanding),
            },
            { key: 'e', header: m('latestExam'), render: (r) => r.latestExam ?? '—' },
            {
              key: 'pp',
              header: m('passPct'),
              numeric: true,
              render: (r) => (r.passPct === null ? '—' : `${r.passPct}%`),
            },
            {
              key: 'w',
              header: m('approvals'),
              numeric: true,
              render: (r) =>
                r.openApprovals ? <Badge tone="warning">{r.openApprovals}</Badge> : 0,
            },
            { key: 'l', header: m('overdueLoans'), numeric: true, render: (r) => r.overdueLoans },
          ]}
          rows={rows}
          rowKey={(r) => r.schoolId}
          emptyTitle="—"
        />
      </Card>
    </>
  );
}
