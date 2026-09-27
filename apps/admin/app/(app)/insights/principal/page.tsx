import { Alert, Badge, Button, Card, DataTable, InputField, PageHeader } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { refreshMarts } from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import type { PrincipalDashboard } from '@/lib/types';

const Kpi = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
  <Card elevated>
    <div className="ep-kicker">{label}</div>
    <div style={{ fontFamily: 'var(--font-heading)', fontSize: 'var(--fs-h2)', fontWeight: 600 }}>
      {value}
    </div>
    {sub ? <div className="ep-field__help">{sub}</div> : null}
  </Card>
);

const grid = (min: number) => ({
  display: 'grid',
  gap: 'var(--sp-3)',
  gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`,
  marginBottom: 'var(--sp-4)',
});

/** Sprint 12 (AI track): principal dashboard v1 from the reporting marts. */
export default async function PrincipalDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string; date?: string }>;
}) {
  const sp = await searchParams;
  const [t, i, me] = await Promise.all([
    getTranslations('pages.insights_principal'),
    getTranslations('insights'),
    getMe(),
  ]);
  const dash = await apiFetch<PrincipalDashboard>(
    `/insights/principal${sp.date ? `?date=${sp.date}` : ''}`,
  );
  const canRefresh = me.permissions.includes('insights.mart.refresh');
  const a = dash.attendance;
  const fees = dash.fees;
  return (
    <>
      <PageHeader
        kicker={t('kicker')}
        title={`${t('title')} · ${dash.year.code}`}
        description={t('description')}
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', alignItems: 'flex-end' }}>
            <form
              method="get"
              style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'flex-end' }}
            >
              <InputField
                id="date"
                name="date"
                label={i('date')}
                type="date"
                defaultValue={dash.date}
              />
              <Button type="submit" variant="secondary">
                {i('show')}
              </Button>
            </form>
            {canRefresh ? (
              <form action={refreshMarts}>
                <Button type="submit" variant="ghost">
                  {i('refresh')}
                </Button>
              </form>
            ) : null}
          </span>
        }
      />
      <Notice params={sp} />

      <Card title={i('alerts')}>
        {dash.alerts.length ? (
          <div style={{ display: 'grid', gap: 'var(--sp-2)' }}>
            {dash.alerts.map((al) => (
              <Alert key={`${al.code}-${al.message}`} tone={al.severity}>
                {al.href ? (
                  <a href={al.href} style={{ color: 'inherit', textDecoration: 'underline' }}>
                    {al.message}
                  </a>
                ) : (
                  al.message
                )}
              </Alert>
            ))}
          </div>
        ) : (
          <p className="ep-field__help">{i('noAlerts')}</p>
        )}
      </Card>

      <h3
        style={{
          fontFamily: 'var(--font-heading)',
          color: 'var(--text-heading)',
          margin: 'var(--sp-5) 0 var(--sp-3)',
        }}
      >
        {i('attendance')}
      </h3>
      <div style={grid(150)}>
        <Kpi
          label={i('pct')}
          value={a.pct === null ? '—' : `${a.pct}%`}
          sub={`${a.present} / ${a.present + a.absent}`}
        />
        <Kpi label={i('strength')} value={String(a.strength)} />
        <Kpi label={i('present')} value={String(a.present)} />
        <Kpi label={i('absent')} value={String(a.absent)} />
        <Kpi label={i('late')} value={String(a.late)} />
        <Kpi
          label={i('markedSections')}
          value={`${a.markedSections} / ${a.sections}`}
          sub={a.unmarked.length ? `${i('unmarked')}: ${a.unmarked.join(', ')}` : undefined}
        />
      </div>
      <div style={grid(380)}>
        <Card title={i('byClass')}>
          <DataTable<PrincipalDashboard['attendance']['byClass'][number]>
            caption={i('byClass')}
            density="dense"
            columns={[
              { key: 'class', header: i('byClass'), render: (r) => <strong>{r.classCode}</strong> },
              { key: 'strength', header: i('strength'), numeric: true, render: (r) => r.strength },
              { key: 'present', header: i('present'), numeric: true, render: (r) => r.present },
              { key: 'absent', header: i('absent'), numeric: true, render: (r) => r.absent },
              {
                key: 'pct',
                header: i('pct'),
                numeric: true,
                render: (r) =>
                  r.pct === null ? (
                    '—'
                  ) : (
                    <Badge tone={r.pct < 80 ? 'danger' : r.pct < 90 ? 'warning' : 'success'}>
                      {r.pct}%
                    </Badge>
                  ),
              },
            ]}
            rows={a.byClass}
            rowKey={(r) => r.classId}
            emptyTitle={i('unmarked')}
          />
        </Card>
        <Card title={i('trend')}>
          <DataTable<PrincipalDashboard['attendance']['trend'][number]>
            caption={i('trend')}
            density="dense"
            columns={[
              { key: 'date', header: i('date'), render: (r) => r.date },
              { key: 'strength', header: i('strength'), numeric: true, render: (r) => r.strength },
              { key: 'present', header: i('present'), numeric: true, render: (r) => r.present },
              {
                key: 'pct',
                header: i('pct'),
                numeric: true,
                render: (r) => (r.pct === null ? '—' : `${r.pct}%`),
              },
            ]}
            rows={a.trend}
            rowKey={(r) => r.date}
            emptyTitle={i('unmarked')}
          />
        </Card>
      </div>

      <h3
        style={{
          fontFamily: 'var(--font-heading)',
          color: 'var(--text-heading)',
          margin: 'var(--sp-5) 0 var(--sp-3)',
        }}
      >
        {i('fees')}
      </h3>
      <div style={grid(150)}>
        <Kpi label={i('dueTillDate')} value={`₹${fees.dueTillDate}`} />
        <Kpi label={i('collectedTillDate')} value={`₹${fees.collectedTillDate}`} />
        <Kpi label={i('balance')} value={`₹${fees.balance}`} />
        <Kpi label={i('collectedToday')} value={`₹${fees.collectedToday}`} />
        <Kpi
          label={i('collected7d')}
          value={`₹${fees.collected7d}`}
          sub={`${i('previous7d')} ₹${fees.previous7d}`}
        />
        <Kpi label={i('collected30d')} value={`₹${fees.collected30d}`} />
      </div>
      <div style={grid(380)}>
        <Card title={i('ageing')}>
          <DataTable<PrincipalDashboard['fees']['ageing'][number]>
            caption={i('ageing')}
            density="dense"
            columns={[
              { key: 'bucket', header: i('bucket'), render: (r) => <strong>{r.bucket}</strong> },
              { key: 'balance', header: i('balance'), numeric: true, render: (r) => r.balance },
              { key: 'students', header: i('students'), numeric: true, render: (r) => r.students },
            ]}
            rows={fees.ageing}
            rowKey={(r) => r.bucket}
            emptyTitle={i('balance')}
          />
        </Card>
        <Card title={i('byMode')}>
          <DataTable<PrincipalDashboard['fees']['byMode30d'][number]>
            caption={i('byMode')}
            density="dense"
            columns={[
              { key: 'mode', header: i('byMode'), render: (r) => r.mode.toUpperCase() },
              { key: 'amount', header: i('balance'), numeric: true, render: (r) => r.amount },
              { key: 'receipts', header: i('receipts'), numeric: true, render: (r) => r.receipts },
            ]}
            rows={fees.byMode30d}
            rowKey={(r) => r.mode}
            emptyTitle={i('receipts')}
          />
        </Card>
        <Card title={i('defaulters')}>
          <DataTable<PrincipalDashboard['fees']['defaulters'][number]>
            caption={i('defaulters')}
            density="dense"
            columns={[
              {
                key: 'name',
                header: i('students'),
                render: (r) => (
                  <a href={`/fees/ledger/${r.studentId}`}>
                    {r.name} · {r.admissionNo}
                  </a>
                ),
              },
              { key: 'section', header: i('byClass'), render: (r) => r.section ?? '' },
              { key: 'balance', header: i('balance'), numeric: true, render: (r) => r.balance },
              {
                key: 'days',
                header: i('daysOverdue'),
                numeric: true,
                render: (r) => r.daysOverdue,
              },
            ]}
            rows={fees.defaulters}
            rowKey={(r) => r.studentId}
            emptyTitle={i('balance')}
          />
        </Card>
        <Card title={i('feeByClass')}>
          <DataTable<PrincipalDashboard['fees']['byClass'][number]>
            caption={i('feeByClass')}
            density="dense"
            columns={[
              { key: 'class', header: i('byClass'), render: (r) => <strong>{r.classCode}</strong> },
              { key: 'net', header: i('dueTillDate'), numeric: true, render: (r) => r.net },
              { key: 'paid', header: i('collectedTillDate'), numeric: true, render: (r) => r.paid },
              { key: 'balance', header: i('balance'), numeric: true, render: (r) => r.balance },
            ]}
            rows={fees.byClass}
            rowKey={(r) => r.classCode}
            emptyTitle={i('balance')}
          />
        </Card>
      </div>

      <div style={grid(380)}>
        <Card title={i('admissions')}>
          <DataTable<PrincipalDashboard['admissions'][number]>
            caption={i('admissions')}
            density="dense"
            columns={[
              { key: 'cycle', header: i('cycle'), render: (r) => <strong>{r.code}</strong> },
              { key: 'status', header: '', render: (r) => <Badge>{r.status}</Badge> },
              { key: 'total', header: i('total'), numeric: true, render: (r) => r.total },
              {
                key: 'by',
                header: '',
                render: (r) => r.byStatus.map((s) => `${s.status} ${s.count}`).join(' · '),
              },
            ]}
            rows={dash.admissions}
            rowKey={(r) => r.cycleId}
            emptyTitle={i('admissions')}
          />
        </Card>
        <Card
          title={`${i('comms')}${dash.comms.deliveryRate !== null ? ` · ${i('deliveryRate')} ${dash.comms.deliveryRate}%` : ''}`}
        >
          <DataTable<PrincipalDashboard['comms']['last7'][number]>
            caption={i('comms')}
            density="dense"
            columns={[
              { key: 'channel', header: i('channel'), render: (r) => r.channel },
              { key: 'sent', header: i('sent'), numeric: true, render: (r) => r.sent },
              {
                key: 'delivered',
                header: i('delivered'),
                numeric: true,
                render: (r) => r.delivered,
              },
              { key: 'failed', header: i('failed'), numeric: true, render: (r) => r.failed },
              { key: 'queued', header: i('queued'), numeric: true, render: (r) => r.queued },
            ]}
            rows={dash.comms.last7}
            rowKey={(r) => r.channel}
            emptyTitle={i('comms')}
          />
        </Card>
        <Card title={i('approvals')}>
          <div style={grid(120)}>
            <Kpi label={i('approvals')} value={String(dash.approvals.pending)} />
            <Kpi label={i('oldestHours')} value={String(dash.approvals.oldestHours ?? 0)} />
          </div>
          <a href="/workflow/inbox" className="ep-btn ep-btn--ghost ep-btn--sm">
            {i('approvals')} →
          </a>
        </Card>
        <Card title={i('readers')}>
          <DataTable<PrincipalDashboard['readers'][number]>
            caption={i('readers')}
            density="dense"
            columns={[
              { key: 'code', header: i('reader'), render: (r) => `${r.code} · ${r.name}` },
              { key: 'kind', header: '', render: (r) => r.kind },
              {
                key: 'seen',
                header: i('lastSeen'),
                render: (r) => (
                  <Badge
                    tone={r.silentHours === null || r.silentHours >= 24 ? 'danger' : 'success'}
                  >
                    {r.lastSeenAt ? new Date(r.lastSeenAt).toLocaleString('en-IN') : i('never')}
                  </Badge>
                ),
              },
              {
                key: 'silent',
                header: i('silentHours'),
                numeric: true,
                render: (r) => r.silentHours ?? '—',
              },
            ]}
            rows={dash.readers}
            rowKey={(r) => r.code}
            emptyTitle={i('readers')}
          />
        </Card>
      </div>

      <Card title={i('marts')}>
        <p className="ep-field__help">{i('sourceHelp')}</p>
        <DataTable<PrincipalDashboard['marts'][number]>
          caption={i('marts')}
          density="dense"
          columns={[
            { key: 'mart', header: i('mart'), render: (m) => m.mart },
            {
              key: 'at',
              header: i('refreshed'),
              render: (m) => (
                <Badge tone={m.stale ? 'warning' : 'success'}>
                  {m.refreshedAt ? new Date(m.refreshedAt).toLocaleString('en-IN') : i('never')}
                  {m.stale ? ` · ${i('stale')}` : ''}
                </Badge>
              ),
            },
            { key: 'rows', header: i('rows'), numeric: true, render: (m) => m.rows ?? '—' },
            {
              key: 'ms',
              header: i('durationMs'),
              numeric: true,
              render: (m) => m.durationMs ?? '—',
            },
          ]}
          rows={dash.marts}
          rowKey={(m) => m.mart}
          emptyTitle={i('marts')}
        />
      </Card>
    </>
  );
}
