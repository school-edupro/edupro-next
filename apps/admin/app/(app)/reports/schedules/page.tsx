import {
  Badge,
  Button,
  Card,
  DataTable,
  FormRow,
  InputField,
  PageHeader,
  SelectField,
} from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { createSchedule, scheduleRun, scheduleStatus } from '@/lib/actions';
import { apiFetch } from '@/lib/api';

interface Schedule {
  id: string;
  name: string;
  dataset: string;
  datasetTitle: string;
  format: string;
  cron: string;
  recipientRoles: string[];
  recipientAddresses: string[];
  channel: string;
  owner: string | null;
  status: 'active' | 'inactive';
  lastRunAt: string | null;
  lastExportId: string | null;
  nextRunAt: string | null;
}
interface Dataset {
  id: string;
  title: string;
}

/** Sprint 19: scheduled reports. */
export default async function SchedulesPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const [t, s, rows, datasets] = await Promise.all([
    getTranslations('pages.reports_schedules'),
    getTranslations('schedules'),
    apiFetch<{ data: Schedule[] }>('/reports/schedules').then((x) => x.data),
    apiFetch<{ data: Dataset[] }>('/reports/datasets').then((x) => x.data),
  ]);
  const when = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
  return (
    <>
      <PageHeader kicker={t('kicker')} title={t('title')} description={t('description')} />
      <Notice params={sp} />
      <Card title={s('new')} style={{ marginBottom: 'var(--sp-4)' }}>
        <form action={createSchedule}>
          <FormRow columns={3}>
            <InputField
              id="name"
              name="name"
              label={s('name')}
              required
              minLength={2}
              maxLength={120}
            />
            <SelectField
              id="dataset"
              name="dataset"
              label={s('dataset')}
              options={datasets.map((d) => ({ value: d.id, label: `${d.title} (${d.id})` }))}
            />
            <SelectField
              id="format"
              name="format"
              label={s('format')}
              options={['xlsx', 'csv', 'pdf'].map((v) => ({ value: v, label: v }))}
            />
            <InputField
              id="cron"
              name="cron"
              label={s('cron')}
              required
              defaultValue="0 7 * * 1"
              help={s('cronHelp')}
            />
            <InputField
              id="recipientRoles"
              name="recipientRoles"
              label={s('roles')}
              placeholder="school_admin, accountant"
            />
            <InputField id="recipientAddresses" name="recipientAddresses" label={s('addresses')} />
            <SelectField
              id="channel"
              name="channel"
              label={s('channel')}
              options={[
                { value: 'whatsapp', label: 'whatsapp' },
                { value: 'email', label: 'email' },
              ]}
            />
          </FormRow>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button type="submit">{s('create')}</Button>
          </div>
        </form>
      </Card>
      <Card>
        <DataTable<Schedule>
          caption={`${t('title')} · ${rows.length}`}
          density="dense"
          columns={[
            {
              key: 'n',
              header: s('name'),
              render: (r) => (
                <>
                  <strong>{r.name}</strong>
                  <div className="ep-kicker">
                    {r.datasetTitle} · {r.format} · {r.cron}
                  </div>
                </>
              ),
            },
            {
              key: 'r',
              header: s('roles'),
              render: (r) => [...r.recipientRoles, ...r.recipientAddresses].join(', '),
            },
            { key: 'o', header: s('owner'), render: (r) => r.owner ?? '' },
            {
              key: 'l',
              header: s('lastRun'),
              render: (r) =>
                r.lastExportId ? (
                  <a href={`/reports/exports/${r.lastExportId}/download`}>{when(r.lastRunAt)}</a>
                ) : (
                  when(r.lastRunAt)
                ),
            },
            { key: 'x', header: s('nextRun'), render: (r) => when(r.nextRunAt) },
            {
              key: 's',
              header: '',
              render: (r) => (
                <Badge tone={r.status === 'active' ? 'success' : 'neutral'}>{r.status}</Badge>
              ),
            },
            {
              key: 'a',
              header: '',
              render: (r) => (
                <span style={{ display: 'inline-flex', gap: 'var(--sp-1)' }}>
                  <form action={scheduleRun}>
                    <input type="hidden" name="id" value={r.id} />
                    <Button type="submit" size="sm" variant="secondary">
                      {s('runNow')}
                    </Button>
                  </form>
                  <form action={scheduleStatus}>
                    <input type="hidden" name="id" value={r.id} />
                    <input
                      type="hidden"
                      name="status"
                      value={r.status === 'active' ? 'inactive' : 'active'}
                    />
                    <Button type="submit" size="sm" variant="ghost">
                      {r.status === 'active' ? s('pause') : s('resume')}
                    </Button>
                  </form>
                </span>
              ),
            },
          ]}
          rows={rows}
          rowKey={(r) => r.id}
          emptyTitle={s('noRows')}
        />
      </Card>
    </>
  );
}
