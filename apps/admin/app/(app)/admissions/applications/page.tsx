import { Badge, Button, Card, DataTable, InputField, PageHeader, SelectField } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { apiFetch } from '@/lib/api';
import { applicationTone as tone } from '@/lib/admissions';
import type { AdmissionApplication, AdmissionCycle, ApplicationStatus, Page } from '@/lib/types';

const STATUSES: ApplicationStatus[] = [
  'submitted',
  'under_review',
  'shortlisted',
  'selected',
  'waitlisted',
  'rejected',
  'withdrawn',
];
/** S8-04: the intake desk list. */
export default async function ApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<{
    ok?: string;
    error?: string;
    detail?: string;
    cycleId?: string;
    status?: string;
    q?: string;
    duplicates?: string;
  }>;
}) {
  const sp = await searchParams;
  const [t, a, c] = await Promise.all([
    getTranslations('pages.admissions_applications'),
    getTranslations('admissions'),
    getTranslations('common'),
  ]);
  const query = new URLSearchParams({ size: '100' });
  if (sp.cycleId) query.set('cycleId', sp.cycleId);
  if (sp.status) query.set('status', sp.status);
  if (sp.q) query.set('q', sp.q);
  if (sp.duplicates) query.set('duplicates', 'true');
  const [cycles, list] = await Promise.all([
    apiFetch<{ data: AdmissionCycle[] }>('/admissions/cycles').then((r) => r.data),
    apiFetch<Page<AdmissionApplication>>(`/admissions/applications?${query.toString()}`),
  ]);
  return (
    <>
      <PageHeader
        kicker={t('kicker')}
        title={t('title')}
        description={`${t('description')} (${list.page.total})`}
      />
      <Notice params={sp} />
      <Card>
        <form
          method="get"
          style={{
            display: 'flex',
            gap: 'var(--sp-3)',
            alignItems: 'flex-end',
            flexWrap: 'wrap',
            marginBottom: 'var(--sp-4)',
          }}
        >
          <SelectField
            id="cycleId"
            name="cycleId"
            label={a('cycle')}
            defaultValue={sp.cycleId ?? ''}
            options={[
              { value: '', label: a('allCycles') },
              ...cycles.map((x) => ({ value: x.id, label: x.code })),
            ]}
          />
          <SelectField
            id="status"
            name="status"
            label={a('status')}
            defaultValue={sp.status ?? ''}
            options={[
              { value: '', label: c('all') },
              ...STATUSES.map((s) => ({ value: s, label: a(`statusLabels.${s}`) })),
            ]}
          />
          <InputField id="q" name="q" label={a('search')} defaultValue={sp.q ?? ''} />
          <label style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
            <input type="checkbox" name="duplicates" value="1" defaultChecked={!!sp.duplicates} />{' '}
            {a('onlyDuplicates')}
          </label>
          <Button type="submit" variant="secondary">
            {c('apply')}
          </Button>
        </form>
        <DataTable<AdmissionApplication>
          caption={t('title')}
          density="dense"
          columns={[
            {
              key: 'no',
              header: a('applicationNo'),
              render: (x) => (
                <a href={`/admissions/applications/${x.id}`}>{x.applicationNo ?? x.id}</a>
              ),
            },
            { key: 'child', header: a('child'), render: (x) => `${x.childName} (${x.childDob})` },
            { key: 'class', header: a('class'), render: (x) => x.classCode },
            {
              key: 'applicant',
              header: a('applicant'),
              render: (x) => `${x.applicantName ?? ''} · ${x.applicantMobile}`,
            },
            { key: 'score', header: a('score'), numeric: true, render: (x) => x.score ?? '' },
            {
              key: 'submitted',
              header: a('submittedOn'),
              render: (x) =>
                x.submittedAt ? new Date(x.submittedAt).toLocaleDateString('en-IN') : '',
            },
            {
              key: 'status',
              header: a('status'),
              render: (x) => (
                <span style={{ display: 'inline-flex', gap: 'var(--sp-1)' }}>
                  <Badge tone={tone(x.status)}>{a(`statusLabels.${x.status}`)}</Badge>
                  {x.possibleDuplicateOf ? <Badge tone="warning">{a('duplicate')}</Badge> : null}
                </span>
              ),
            },
          ]}
          rows={list.data}
          rowKey={(x) => x.id}
          emptyTitle={a('noApplications')}
        />
      </Card>
    </>
  );
}
