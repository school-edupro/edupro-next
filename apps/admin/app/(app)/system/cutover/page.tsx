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
import { cutoverCreateRun } from '@/lib/actions';
import { apiFetch } from '@/lib/api';

interface Run {
  id: string;
  kind: string;
  name: string;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  createdBy: string | null;
  signedOffBy: string | null;
  steps: number;
  doneSteps: number;
  durationS: number;
}
const hms = (s: number) => `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;

/** Sprint 22: cut-over rehearsals and the final run. */
export default async function CutoverPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const [t, o, runs] = await Promise.all([
    getTranslations('pages.system_cutover'),
    getTranslations('ops'),
    apiFetch<{ data: Run[] }>('/ops/cutover/runs').then((r) => r.data),
  ]);
  return (
    <>
      <PageHeader kicker={t('kicker')} title={t('title')} description={t('description')} />
      <Notice params={sp} />
      <Card title={o('newRun')} style={{ marginBottom: 'var(--sp-4)' }}>
        <form action={cutoverCreateRun}>
          <FormRow columns={3}>
            <SelectField
              id="kind"
              name="kind"
              label={o('kind')}
              options={[
                { value: 'rehearsal', label: o('rehearsal') },
                { value: 'final', label: o('final') },
              ]}
            />
            <InputField
              id="name"
              name="name"
              label={o('name')}
              required
              minLength={2}
              maxLength={120}
            />
            <InputField id="notes" name="notes" label={o('notes')} maxLength={2000} />
          </FormRow>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button type="submit">{o('create')}</Button>
          </div>
        </form>
      </Card>
      <Card>
        <DataTable<Run>
          caption={`${t('title')} · ${runs.length}`}
          density="dense"
          columns={[
            {
              key: 'n',
              header: o('name'),
              render: (r) => (
                <a href={`/system/cutover/${r.id}`}>
                  <strong>{r.name}</strong>
                  <div className="ep-kicker">
                    {r.kind === 'final' ? o('final') : o('rehearsal')} · {r.createdAt.slice(0, 10)}{' '}
                    · {r.createdBy ?? ''}
                  </div>
                </a>
              ),
            },
            {
              key: 's',
              header: o('steps'),
              numeric: true,
              render: (r) => `${r.doneSteps} / ${r.steps}`,
            },
            { key: 'e', header: o('elapsed'), render: (r) => hms(r.durationS) },
            {
              key: 'st',
              header: o('status'),
              render: (r) => (
                <>
                  <Badge
                    tone={
                      r.status === 'done'
                        ? 'success'
                        : r.status === 'aborted'
                          ? 'danger'
                          : r.status === 'running'
                            ? 'info'
                            : 'neutral'
                    }
                  >
                    {r.status}
                  </Badge>
                  {r.signedOffBy ? (
                    <div className="ep-kicker">
                      {o('signedOff')} {r.signedOffBy}
                    </div>
                  ) : null}
                </>
              ),
            },
          ]}
          rows={runs}
          rowKey={(r) => r.id}
          emptyTitle={o('noRuns')}
        />
      </Card>
    </>
  );
}
