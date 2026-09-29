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
import { hypercareReport, hypercareUpdate } from '@/lib/actions';
import { apiFetch } from '@/lib/api';

interface Issue {
  id: string;
  number: string;
  title: string;
  detail: string | null;
  module: string;
  severity: string;
  channel: string;
  status: string;
  reporter: string | null;
  assignedRole: string | null;
  assignedTo: string | null;
  dueAt: string;
  overdue: boolean;
  workaround: string | null;
  resolution: string | null;
  createdAt: string;
}
interface List {
  data: Issue[];
  page: { total: number };
  summary: Array<{ severity: string; open: number; overdue: number }>;
}
const MODULES = [
  'people',
  'admissions',
  'fees',
  'attendance',
  'academics',
  'communication',
  'engagement',
  'exams',
  'transport',
  'library',
  'reports',
  'apps',
  'other',
];
const STATUSES = ['open', 'triaged', 'in_progress', 'fixed', 'verified', 'closed'];
const sevTone = (s: string) =>
  s === 's1' ? 'danger' : s === 's2' ? 'warning' : s === 's3' ? 'info' : 'neutral';

/** Sprint 22: the hypercare board. */
export default async function HypercarePage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    severity?: string;
    module?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  const qs = new URLSearchParams({ size: '100' });
  if (sp.status) qs.set('status', sp.status);
  if (sp.severity) qs.set('severity', sp.severity);
  if (sp.module) qs.set('module', sp.module);
  const [t, o, list] = await Promise.all([
    getTranslations('pages.system_hypercare'),
    getTranslations('ops'),
    apiFetch<List>(`/ops/hypercare/issues?${qs.toString()}`),
  ]);
  return (
    <>
      <PageHeader
        kicker={t('kicker')}
        title={t('title')}
        description={t('description')}
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-1)' }}>
            {list.summary.map((s) => (
              <Badge key={s.severity} tone={sevTone(s.severity)}>
                {s.severity.toUpperCase()} {o('summary', { open: s.open, overdue: s.overdue })}
              </Badge>
            ))}
          </span>
        }
      />
      <Notice params={sp} />
      <Card title={o('report')} style={{ marginBottom: 'var(--sp-4)' }}>
        <form action={hypercareReport}>
          <FormRow columns={4}>
            <InputField
              id="title"
              name="title"
              label={o('title')}
              required
              minLength={3}
              maxLength={200}
            />
            <SelectField
              id="module"
              name="module"
              label={o('module')}
              options={MODULES.map((m) => ({ value: m, label: m }))}
            />
            <SelectField
              id="severity"
              name="severity"
              label={o('severity')}
              defaultValue="s3"
              options={['s1', 's2', 's3', 's4'].map((s) => ({ value: s, label: s.toUpperCase() }))}
            />
            <SelectField
              id="channel"
              name="channel"
              label={o('channel')}
              options={['admin', 'help_desk', 'email', 'phone'].map((c) => ({
                value: c,
                label: c,
              }))}
            />
          </FormRow>
          <InputField id="detail" name="detail" label={o('detail')} maxLength={5000} />
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button type="submit" variant="secondary">
              {o('report')}
            </Button>
          </div>
        </form>
      </Card>
      <Card
        title={o('issues')}
        actions={
          <form
            method="get"
            style={{ display: 'inline-flex', gap: 'var(--sp-2)', alignItems: 'flex-end' }}
          >
            <SelectField
              id="f-status"
              name="status"
              label={o('status')}
              defaultValue={sp.status ?? ''}
              options={[
                { value: '', label: o('all') },
                ...STATUSES.map((s) => ({ value: s, label: s })),
              ]}
            />
            <SelectField
              id="f-sev"
              name="severity"
              label={o('severity')}
              defaultValue={sp.severity ?? ''}
              options={[
                { value: '', label: o('all') },
                ...['s1', 's2', 's3', 's4'].map((s) => ({ value: s, label: s.toUpperCase() })),
              ]}
            />
            <Button type="submit" size="sm" variant="ghost">
              {o('filter')}
            </Button>
          </form>
        }
      >
        <DataTable<Issue>
          caption={`${o('issues')} · ${list.page.total}`}
          density="dense"
          columns={[
            {
              key: 'n',
              header: '#',
              render: (i) => (
                <>
                  <strong>{i.number}</strong>
                  <div className="ep-kicker">
                    {i.createdAt.slice(0, 16).replace('T', ' ')} · {i.channel}
                  </div>
                </>
              ),
            },
            {
              key: 't',
              header: o('title'),
              render: (i) => (
                <>
                  <strong>{i.title}</strong>
                  <div className="ep-kicker">
                    {i.module} · {o('reporter')} {i.reporter ?? ''}
                  </div>
                  {i.detail ? <div>{i.detail}</div> : null}
                  {i.workaround ? (
                    <div className="ep-kicker">
                      {o('workaround')}: {i.workaround}
                    </div>
                  ) : null}
                  {i.resolution ? (
                    <div className="ep-kicker">
                      {o('resolution')}: {i.resolution}
                    </div>
                  ) : null}
                </>
              ),
            },
            {
              key: 's',
              header: o('severity'),
              render: (i) => <Badge tone={sevTone(i.severity)}>{i.severity.toUpperCase()}</Badge>,
            },
            {
              key: 'd',
              header: o('due'),
              render: (i) => (
                <>
                  {i.dueAt.slice(0, 16).replace('T', ' ')}
                  {i.overdue ? (
                    <>
                      {' '}
                      <Badge tone="danger">{o('overdue')}</Badge>
                    </>
                  ) : null}
                </>
              ),
            },
            {
              key: 'st',
              header: o('status'),
              render: (i) => (
                <>
                  <Badge
                    tone={
                      i.status === 'closed' || i.status === 'verified'
                        ? 'success'
                        : i.status === 'open'
                          ? 'warning'
                          : 'info'
                    }
                  >
                    {i.status}
                  </Badge>
                  {i.assignedRole || i.assignedTo ? (
                    <div className="ep-kicker">
                      {o('assigned')} {i.assignedTo ?? i.assignedRole}
                    </div>
                  ) : null}
                </>
              ),
            },
            {
              key: 'a',
              header: '',
              render: (i) =>
                i.status === 'closed' ? null : (
                  <form
                    action={hypercareUpdate}
                    style={{ display: 'grid', gap: 'var(--sp-1)', minWidth: 260 }}
                  >
                    <input type="hidden" name="id" value={i.id} />
                    <SelectField
                      id={`s-${i.id}`}
                      name="status"
                      label={o('status')}
                      defaultValue={i.status}
                      options={STATUSES.map((s) => ({ value: s, label: s }))}
                    />
                    <InputField
                      id={`r-${i.id}`}
                      name="assignedRole"
                      label={o('assigned')}
                      defaultValue={i.assignedRole ?? ''}
                      maxLength={40}
                    />
                    <InputField
                      id={`b-${i.id}`}
                      name="body"
                      label={o('comment')}
                      maxLength={5000}
                    />
                    <InputField
                      id={`w-${i.id}`}
                      name="workaround"
                      label={o('workaround')}
                      maxLength={2000}
                    />
                    <InputField
                      id={`x-${i.id}`}
                      name="resolution"
                      label={o('resolution')}
                      maxLength={5000}
                    />
                    <Button type="submit" size="sm">
                      {o('update')}
                    </Button>
                  </form>
                ),
            },
          ]}
          rows={list.data}
          rowKey={(i) => i.id}
          emptyTitle={o('noIssues')}
        />
      </Card>
    </>
  );
}
