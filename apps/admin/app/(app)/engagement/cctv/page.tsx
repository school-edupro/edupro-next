import { Badge, Button, Card, DataTable, FormRow, InputField, PageHeader } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { decideCctv, requestCctv } from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import type { Page } from '@/lib/types';

interface Cctv {
  id: string;
  requestedBy: string | null;
  student: string | null;
  camera: string;
  fromAt: string;
  toAt: string;
  reason: string;
  status: string;
  decisionNote: string | null;
  workflowInstanceId: string | null;
  createdAt: string;
}

/** Sprint 19: CCTV footage requests on the workflow. */
export default async function CctvPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string; detail?: string }> }) {
  const sp = await searchParams;
  const [t, e, me, list] = await Promise.all([
    getTranslations('pages.engagement_cctv'),
    getTranslations('eng19'),
    getMe(),
    apiFetch<Page<Cctv>>('/engagement/cctv?size=100'),
  ]);
  const canDecide = me.permissions.includes('engagement.cctv.decide');
  return (
    <>
      <PageHeader kicker={t('kicker')} title={t('title')} description={t('description')} />
      <Notice params={sp} />
      {me.permissions.includes('engagement.cctv.request') ? (
        <Card title={e('request')} style={{ marginBottom: 'var(--sp-4)' }}>
          <form action={requestCctv}>
            <FormRow columns={4}>
              <InputField id="camera" name="camera" label={e('camera')} required maxLength={120} />
              <InputField id="fromAt" name="fromAt" label={e('fromAt')} type="datetime-local" required />
              <InputField id="toAt" name="toAt" label={e('toAt')} type="datetime-local" required />
              <InputField id="studentId" name="studentId" label={e('studentId')} pattern="\\d*" />
              <InputField id="reason" name="reason" label={e('reason')} required minLength={5} maxLength={500} />
              <div style={{ alignSelf: 'end' }}><Button type="submit">{e('request')}</Button></div>
            </FormRow>
          </form>
        </Card>
      ) : null}
      <Card>
        <DataTable<Cctv>
          caption={`${t('title')} · ${list.page.total}`}
          density="dense"
          columns={[
            { key: 'c', header: e('camera'), render: (r) => <><strong>{r.camera}</strong><div className="ep-kicker">{r.fromAt.slice(0, 16).replace('T', ' ')} → {r.toAt.slice(0, 16).replace('T', ' ')}</div></> },
            { key: 'r', header: e('reason'), render: (r) => <>{r.reason}<div className="ep-kicker">{r.requestedBy ?? ''}{r.student ? ` · ${r.student}` : ''}</div></> },
            { key: 's', header: e('status'), render: (r) => <><Badge tone={r.status === 'approved' ? 'success' : r.status === 'pending' ? 'warning' : 'danger'}>{r.status}</Badge>{r.decisionNote ? <div className="ep-kicker">{r.decisionNote}</div> : null}</> },
            {
              key: 'a',
              header: '',
              render: (r) =>
                r.status !== 'pending' ? null : r.workflowInstanceId ? (
                  <a className="ep-btn ep-btn--ghost ep-btn--sm" href={`/workflow/instances/${r.workflowInstanceId}`}>{e('inWorkflow')}</a>
                ) : canDecide ? (
                  <form action={decideCctv} style={{ display: 'inline-flex', gap: 'var(--sp-1)', alignItems: 'flex-end' }}>
                    <input type="hidden" name="id" value={r.id} />
                    <InputField id={`n-${r.id}`} name="note" label={e('note')} maxLength={500} />
                    <Button type="submit" name="outcome" value="approved" size="sm">{e('approve')}</Button>
                    <Button type="submit" name="outcome" value="rejected" size="sm" variant="ghost">{e('reject')}</Button>
                  </form>
                ) : null,
            },
          ]}
          rows={list.data}
          rowKey={(r) => r.id}
          emptyTitle={e('noRows')}
        />
      </Card>
    </>
  );
}
