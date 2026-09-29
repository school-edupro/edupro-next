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
import { decideGatePass, officeGatePass } from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import type { Page } from '@/lib/types';

interface GatePass {
  id: string;
  student: string;
  admissionNo: string;
  kind: string;
  onDate: string;
  atTime: string | null;
  reason: string;
  escortName: string | null;
  escortRelation: string | null;
  escortMobile: string | null;
  passNo: string | null;
  status: string;
  workflowInstanceId: string | null;
  requestedBy: string | null;
}

/** Sprint 19: gate passes (early leave, late arrival). */
export default async function GatePassesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const [t, e, me, list] = await Promise.all([
    getTranslations('pages.engagement_gate_passes'),
    getTranslations('eng19'),
    getMe(),
    apiFetch<Page<GatePass>>(
      `/engagement/gate-passes?size=100${sp.status ? `&status=${sp.status}` : ''}`,
    ),
  ]);
  const canIssue = me.permissions.includes('engagement.gate_pass.issue');
  return (
    <>
      <PageHeader kicker={t('kicker')} title={t('title')} description={t('description')} />
      <Notice params={sp} />
      {canIssue ? (
        <Card title={e('raise')} style={{ marginBottom: 'var(--sp-4)' }}>
          <form action={officeGatePass}>
            <FormRow columns={4}>
              <InputField
                id="studentId"
                name="studentId"
                label={e('studentId')}
                required
                pattern="\\d+"
              />
              <SelectField
                id="kind"
                name="kind"
                label={e('kind')}
                options={[
                  { value: 'early_leave', label: e('earlyLeave') },
                  { value: 'late_arrival', label: e('lateArrival') },
                ]}
              />
              <InputField id="onDate" name="onDate" label={e('onDate')} type="date" />
              <InputField id="atTime" name="atTime" label={e('atTime')} type="time" />
              <InputField id="reason" name="reason" label={e('reason')} required maxLength={300} />
              <InputField id="escortName" name="escortName" label={e('escort')} maxLength={120} />
              <InputField
                id="escortMobile"
                name="escortMobile"
                label={e('mobile')}
                pattern="\\d{10}"
              />
              <div style={{ alignSelf: 'end' }}>
                <Button type="submit">{e('raise')}</Button>
              </div>
            </FormRow>
          </form>
        </Card>
      ) : null}
      <Card>
        <DataTable<GatePass>
          caption={`${t('title')} · ${list.page.total}`}
          density="dense"
          columns={[
            { key: 'n', header: e('passNo'), render: (p) => <strong>{p.passNo ?? '—'}</strong> },
            {
              key: 's',
              header: e('student'),
              render: (p) => (
                <>
                  {p.student}
                  <div className="ep-kicker">
                    {p.admissionNo} · {p.requestedBy ?? ''}
                  </div>
                </>
              ),
            },
            {
              key: 'k',
              header: e('kind'),
              render: (p) =>
                `${p.kind === 'early_leave' ? e('earlyLeave') : e('lateArrival')} · ${p.onDate}${p.atTime ? ` ${p.atTime}` : ''}`,
            },
            {
              key: 'r',
              header: e('reason'),
              render: (p) => (
                <>
                  {p.reason}
                  {p.escortName ? (
                    <div className="ep-kicker">
                      {e('escort')}: {p.escortName}
                      {p.escortRelation ? ` (${p.escortRelation})` : ''}
                      {p.escortMobile ? ` · ${p.escortMobile}` : ''}
                    </div>
                  ) : null}
                </>
              ),
            },
            {
              key: 'st',
              header: e('status'),
              render: (p) => (
                <Badge
                  tone={
                    p.status === 'approved'
                      ? 'success'
                      : p.status === 'pending'
                        ? 'warning'
                        : 'danger'
                  }
                >
                  {p.status}
                </Badge>
              ),
            },
            {
              key: 'a',
              header: '',
              render: (p) =>
                p.status !== 'pending' ? null : p.workflowInstanceId ? (
                  <a
                    className="ep-btn ep-btn--ghost ep-btn--sm"
                    href={`/workflow/instances/${p.workflowInstanceId}`}
                  >
                    {e('inWorkflow')}
                  </a>
                ) : canIssue ? (
                  <form
                    action={decideGatePass}
                    style={{ display: 'inline-flex', gap: 'var(--sp-1)' }}
                  >
                    <input type="hidden" name="id" value={p.id} />
                    <Button type="submit" name="outcome" value="approved" size="sm">
                      {e('issue')}
                    </Button>
                    <Button type="submit" name="outcome" value="rejected" size="sm" variant="ghost">
                      {e('reject')}
                    </Button>
                  </form>
                ) : null,
            },
          ]}
          rows={list.data}
          rowKey={(p) => p.id}
          emptyTitle={e('noRows')}
        />
      </Card>
    </>
  );
}
