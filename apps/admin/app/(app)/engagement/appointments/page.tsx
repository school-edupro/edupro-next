import { Badge, Button, Card, DataTable, InputField, PageHeader } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { decideAppointment } from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import type { Page } from '@/lib/types';

interface Appointment {
  id: string;
  student: string;
  withKind: string;
  withName: string | null;
  purpose: string;
  preferredSlots: string[];
  confirmedAt: string | null;
  location: string | null;
  status: string;
  decisionNote: string | null;
  workflowInstanceId: string | null;
  requestedBy: string | null;
  createdAt: string;
}

const tone = (s: string) => (s === 'approved' ? 'success' : s === 'rejected' || s === 'cancelled' ? 'danger' : 'warning');

/** Sprint 19: appointment requests. */
export default async function AppointmentsPage({ searchParams }: { searchParams: Promise<{ status?: string; ok?: string; error?: string; detail?: string }> }) {
  const sp = await searchParams;
  const [t, e, me, list] = await Promise.all([
    getTranslations('pages.engagement_appointments'),
    getTranslations('eng19'),
    getMe(),
    apiFetch<Page<Appointment>>(`/engagement/appointments?size=100${sp.status ? `&status=${sp.status}` : ''}`),
  ]);
  const canDecide = me.permissions.includes('engagement.appointment.decide');
  return (
    <>
      <PageHeader kicker={t('kicker')} title={t('title')} description={t('description')} />
      <Notice params={sp} />
      <Card>
        <DataTable<Appointment>
          caption={`${t('title')} · ${list.page.total}`}
          density="dense"
          columns={[
            { key: 's', header: e('student'), render: (a) => <><strong>{a.student}</strong><div className="ep-kicker">{e('requestedBy')} {a.requestedBy ?? ''} · {a.createdAt.slice(0, 10)}</div></> },
            { key: 'w', header: e('with'), render: (a) => `${a.withKind}${a.withName ? ` · ${a.withName}` : ''}` },
            { key: 'p', header: e('purpose'), render: (a) => a.purpose },
            { key: 'sl', header: e('slots'), render: (a) => a.preferredSlots.map((x) => x.replace('T', ' ')).join(', ') },
            { key: 'st', header: e('status'), render: (a) => <><Badge tone={tone(a.status)}>{a.status}</Badge>{a.confirmedAt ? <div className="ep-kicker">{a.confirmedAt.slice(0, 16).replace('T', ' ')}{a.location ? ` · ${a.location}` : ''}</div> : null}</> },
            {
              key: 'a',
              header: '',
              render: (a) =>
                a.status !== 'pending' ? null : a.workflowInstanceId ? (
                  <a className="ep-btn ep-btn--ghost ep-btn--sm" href={`/workflow/instances/${a.workflowInstanceId}`}>{e('inWorkflow')}</a>
                ) : canDecide ? (
                  <form action={decideAppointment} style={{ display: 'inline-flex', gap: 'var(--sp-1)', alignItems: 'flex-end' }}>
                    <input type="hidden" name="id" value={a.id} />
                    <InputField id={`c-${a.id}`} name="confirmedAt" label={e('confirmedAt')} type="datetime-local" />
                    <InputField id={`l-${a.id}`} name="location" label={e('location')} maxLength={120} />
                    <Button type="submit" name="outcome" value="approved" size="sm">{e('confirm')}</Button>
                    <Button type="submit" name="outcome" value="rejected" size="sm" variant="ghost">{e('decline')}</Button>
                  </form>
                ) : null,
            },
          ]}
          rows={list.data}
          rowKey={(a) => a.id}
          emptyTitle={e('noRows')}
        />
      </Card>
    </>
  );
}
