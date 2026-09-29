import {
  Badge,
  Breadcrumbs,
  Button,
  Card,
  DataTable,
  FormActions,
  FormRow,
  InputField,
  PageHeader,
  SelectField,
} from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import {
  admitApplication,
  requestApplicationApproval,
  scoreApplication,
  setApplicationStatus,
} from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import type { AdmissionApplication, AdmissionCycle } from '@/lib/types';
import { applicationTone as tone } from '@/lib/admissions';

const NEXT = [
  'under_review',
  'shortlisted',
  'selected',
  'waitlisted',
  'rejected',
  'withdrawn',
] as const;

export default async function ApplicationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const [t, a, me, app] = await Promise.all([
    getTranslations('pages.admissions_applications'),
    getTranslations('admissions'),
    getMe(),
    apiFetch<AdmissionApplication>(`/admissions/applications/${id}`),
  ]);
  const cycle = await apiFetch<AdmissionCycle>(`/admissions/cycles/${app.cycleId}`);
  const canReview = me.permissions.includes('admissions.application.review');
  const canAdmit = me.permissions.includes('admissions.application.admit');
  const offer = app.offer ?? null;
  const manual = cycle.scoreCriteria.filter((s) => !s.autoRule);
  const awarded = new Set(app.scoreBreakdown.map((b) => b.code));
  const fieldLabel = (key: string) => cycle.formSchema.find((f) => f.key === key)?.label ?? key;
  return (
    <>
      <Breadcrumbs
        items={[
          { label: t('kicker'), href: '/admissions' },
          { label: t('title'), href: '/admissions/applications' },
          { label: app.applicationNo ?? app.id },
        ]}
      />
      <PageHeader
        kicker={t('kicker')}
        title={`${app.applicationNo ?? ''} · ${app.childName}`}
        description={`${a('class')} ${app.classCode} · ${a('dob')} ${app.childDob} · ${app.childGender} · ${a('applicant')} ${app.applicantName ?? ''} ${app.applicantMobile}`}
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-1)' }}>
            <Badge tone={tone(app.status)}>{a(`statusLabels.${app.status}`)}</Badge>
            {app.possibleDuplicateOf ? (
              <a href={`/admissions/applications/${app.possibleDuplicateOf}`}>
                <Badge tone="warning">{a('duplicate')}</Badge>
              </a>
            ) : null}
          </span>
        }
      />
      <Notice params={sp} />
      <div
        style={{
          display: 'grid',
          gap: 'var(--sp-5)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 560px), 1fr))',
        }}
      >
        <Card title={a('answers')}>
          <DataTable<[string, unknown]>
            caption={a('answers')}
            density="dense"
            columns={[
              { key: 'k', header: a('name'), render: ([k]) => fieldLabel(k) },
              {
                key: 'v',
                header: '',
                render: ([, v]) => (typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v ?? '')),
              },
            ]}
            rows={Object.entries(app.data)}
            rowKey={([k]) => k}
            emptyTitle={a('answers')}
          />
        </Card>
        <div style={{ display: 'grid', gap: 'var(--sp-5)' }}>
          <Card title={`${a('score')}: ${app.score ?? '—'}`}>
            <DataTable<AdmissionApplication['scoreBreakdown'][number]>
              caption={a('score')}
              density="dense"
              columns={[
                { key: 'name', header: a('name'), render: (b) => b.name },
                { key: 'points', header: a('points'), numeric: true, render: (b) => b.points },
                { key: 'source', header: a('autoRule'), render: (b) => b.source },
              ]}
              rows={app.scoreBreakdown}
              rowKey={(b) => b.code}
              emptyTitle={a('score')}
            />
            {canReview && app.status !== 'draft' ? (
              <form action={scoreApplication} style={{ marginTop: 'var(--sp-3)' }}>
                <input type="hidden" name="id" value={app.id} />
                {manual.length ? <p className="ep-field__help">{a('awardManual')}</p> : null}
                {manual.map((m) => (
                  <label
                    key={m.code}
                    style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}
                  >
                    <input
                      type="checkbox"
                      name="award"
                      value={m.code}
                      defaultChecked={awarded.has(m.code)}
                    />{' '}
                    {m.name} ({m.points})
                  </label>
                ))}
                <FormActions>
                  <Button type="submit" variant="secondary">
                    {a('recompute')}
                  </Button>
                </FormActions>
              </form>
            ) : null}
          </Card>
          {app.status !== 'draft' ? (
            <Card title={a('approval')}>
              {app.workflowInstanceId ? (
                <p>
                  <a href="/workflow/instances?entityType=application">{a('openInbox')}</a>
                </p>
              ) : canReview && ['submitted', 'shortlisted', 'under_review'].includes(app.status) ? (
                <form action={requestApplicationApproval}>
                  <input type="hidden" name="id" value={app.id} />
                  <Button type="submit" variant="secondary">
                    {a('requestApproval')}
                  </Button>
                </form>
              ) : null}
              {offer ? (
                <p style={{ marginTop: 'var(--sp-3)' }}>
                  <strong>{a('offer')}</strong>: {a(`offers.${offer.status}`)} · {a('admissionFee')}{' '}
                  ₹{offer.admissionFee} ·{' '}
                  <Badge tone={app.feePaidAt ? 'success' : 'warning'}>
                    {app.feePaidAt ? a('feePaid') : a('feePending')}
                  </Badge>
                  {offer.payment ? (
                    <span className="ep-kicker" style={{ display: 'block' }}>
                      {a('paymentStatus')}: {offer.payment.status} ·{' '}
                      <code>{offer.payment.txnId}</code>
                    </span>
                  ) : null}
                </p>
              ) : null}
              {app.status === 'admitted' && app.studentId ? (
                <p style={{ marginTop: 'var(--sp-3)' }}>
                  <a href={`/people/students/${app.studentId}`}>{a('admittedAs')}</a>
                </p>
              ) : null}
              {canAdmit && app.status === 'selected' ? (
                <form action={admitApplication} style={{ marginTop: 'var(--sp-3)' }}>
                  <input type="hidden" name="id" value={app.id} />
                  <p className="ep-field__help">{a('admitHelp')}</p>
                  <FormRow columns={2}>
                    <InputField
                      id="rollNo"
                      name="rollNo"
                      label={a('rollNo')}
                      type="number"
                      min={1}
                    />
                    <label
                      style={{
                        display: 'flex',
                        gap: 'var(--sp-2)',
                        alignItems: 'center',
                        alignSelf: 'end',
                      }}
                    >
                      <input type="checkbox" name="waiveFeeCheck" /> {a('waiveFee')}
                    </label>
                  </FormRow>
                  <FormActions>
                    <Button type="submit">{a('admit')}</Button>
                  </FormActions>
                </form>
              ) : null}
            </Card>
          ) : null}
          {canReview && app.status !== 'draft' && app.status !== 'admitted' ? (
            <Card title={a('decide')}>
              <form action={setApplicationStatus}>
                <input type="hidden" name="id" value={app.id} />
                <FormRow columns={2}>
                  <SelectField
                    id="status"
                    name="status"
                    label={a('status')}
                    options={NEXT.map((s) => ({ value: s, label: a(`statusLabels.${s}`) }))}
                  />
                  <InputField id="note" name="note" label={a('note')} maxLength={500} />
                </FormRow>
                <FormActions>
                  <Button type="submit">{a('move')}</Button>
                </FormActions>
              </form>
            </Card>
          ) : null}
          <Card title={a('history')}>
            <DataTable<NonNullable<AdmissionApplication['events']>[number]>
              caption={a('history')}
              density="dense"
              columns={[
                {
                  key: 'when',
                  header: a('submittedOn'),
                  render: (e) => new Date(e.createdAt).toLocaleString('en-IN'),
                },
                { key: 'to', header: a('status'), render: (e) => a(`statusLabels.${e.toStatus}`) },
                { key: 'note', header: a('note'), render: (e) => e.note ?? '' },
                { key: 'actor', header: a('applicant'), render: (e) => e.actor ?? '' },
              ]}
              rows={app.events ?? []}
              rowKey={(e) => e.id}
              emptyTitle={a('history')}
            />
            {app.remarks ? (
              <p className="ep-field__help" style={{ marginTop: 'var(--sp-2)' }}>
                {a('remarks')}: {app.remarks}
              </p>
            ) : null}
          </Card>
        </div>
      </div>
    </>
  );
}
