import {
  Badge,
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
import { recordConsent } from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import type { ConsentPurpose, ConsentView, Membership, Page } from '@/lib/types';

export default async function ConsentsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string; userId?: string }>;
}) {
  const sp = await searchParams;
  const [t, m, me, members] = await Promise.all([
    getTranslations('pages.comms_consents'),
    getTranslations('comms'),
    getMe(),
    apiFetch<Page<Membership>>('/access/memberships?size=200')
      .then((r) => r.data.filter((u) => u.personType === 'guardian' || u.personType === 'student'))
      .catch(() => [] as Membership[]),
  ]);
  const canRecord = me.permissions.includes('comms.consent.manage');
  const view = sp.userId
    ? await apiFetch<ConsentView>(`/comms/consents?userId=${sp.userId}`)
    : null;
  return (
    <>
      <PageHeader kicker={t('kicker')} title={t('title')} description={t('description')} />
      <Notice params={sp} />
      <Card>
        <form
          method="get"
          style={{
            display: 'flex',
            gap: 'var(--sp-3)',
            alignItems: 'flex-end',
            marginBottom: 'var(--sp-3)',
          }}
        >
          <SelectField
            id="userId"
            name="userId"
            label={m('findMember')}
            defaultValue={sp.userId ?? ''}
            options={[
              { value: '', label: '—' },
              ...members.map((u) => ({
                value: u.userId,
                label: `${u.displayName} · ${u.mobile ?? u.email ?? ''}`,
              })),
            ]}
          />
          <Button type="submit" variant="secondary">
            {m('consentFor')}
          </Button>
        </form>
        {!view ? <p className="ep-field__help">{m('chooseMember')}</p> : null}
      </Card>
      {view ? (
        <div
          style={{
            display: 'grid',
            gap: 'var(--sp-5)',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 560px), 1fr))',
            marginTop: 'var(--sp-5)',
          }}
        >
          <Card title={`${m('consentFor')} ${view.user.name}`}>
            <DataTable<ConsentPurpose>
              caption={m('purpose')}
              density="dense"
              columns={[
                {
                  key: 'name',
                  header: m('purpose'),
                  render: (p) => <span title={p.description}>{p.name}</span>,
                },
                { key: 'channel', header: m('channel'), render: (p) => p.channel ?? '' },
                {
                  key: 'status',
                  header: m('status'),
                  render: (p) => (
                    <Badge
                      tone={
                        p.status === 'granted'
                          ? 'success'
                          : p.status === 'withdrawn'
                            ? 'danger'
                            : 'neutral'
                      }
                    >
                      {p.status ? m(p.status) : m('notRecorded')}
                    </Badge>
                  ),
                },
                {
                  key: 'when',
                  header: m('recordedAt'),
                  render: (p) =>
                    p.recordedAt
                      ? `${new Date(p.recordedAt).toLocaleDateString('en-IN')} · ${p.source}`
                      : '',
                },
              ]}
              rows={view.purposes}
              rowKey={(p) => p.code}
              emptyTitle={m('purpose')}
            />
            {canRecord ? (
              <form action={recordConsent} style={{ marginTop: 'var(--sp-4)' }}>
                <input type="hidden" name="userId" value={view.user.id} />
                <p className="ep-field__help">{m('recordHelp')}</p>
                <FormRow columns={3}>
                  <SelectField
                    id="purposeCode"
                    name="purposeCode"
                    label={m('purpose')}
                    options={view.purposes.map((p) => ({ value: p.code, label: p.name }))}
                  />
                  <SelectField
                    id="status"
                    name="status"
                    label={m('status')}
                    options={[
                      { value: 'granted', label: m('granted') },
                      { value: 'withdrawn', label: m('withdrawn') },
                    ]}
                  />
                  <InputField id="note" name="note" label={m('note')} maxLength={300} />
                </FormRow>
                <FormActions>
                  <Button type="submit">{m('record')}</Button>
                </FormActions>
              </form>
            ) : null}
          </Card>
          <Card title={m('history')}>
            <DataTable<ConsentView['history'][number]>
              caption={m('history')}
              density="dense"
              columns={[
                {
                  key: 'when',
                  header: m('recordedAt'),
                  render: (h) => new Date(h.recordedAt).toLocaleString('en-IN'),
                },
                { key: 'purpose', header: m('purpose'), render: (h) => h.purposeCode },
                {
                  key: 'status',
                  header: m('status'),
                  render: (h) => (
                    <Badge tone={h.status === 'granted' ? 'success' : 'danger'}>
                      {m(h.status as 'granted' | 'withdrawn')}
                    </Badge>
                  ),
                },
                { key: 'source', header: m('source'), render: (h) => h.source },
                { key: 'by', header: m('recordedBy'), render: (h) => h.recordedBy ?? '' },
                { key: 'note', header: m('note'), render: (h) => h.note ?? '' },
              ]}
              rows={view.history}
              rowKey={(h) => h.id}
              emptyTitle={m('history')}
            />
          </Card>
        </div>
      ) : null}
    </>
  );
}
