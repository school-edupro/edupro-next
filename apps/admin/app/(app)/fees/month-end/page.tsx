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
import { monthEndClose, monthEndReopen, periodLock } from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';

interface Check {
  code: string;
  label: string;
  value: string;
  ok: boolean;
  blocking?: boolean;
}
interface MonthEnd {
  month: string;
  start: string;
  end: string;
  byLedgerAndMode: Array<{ ledger: string; mode: string; count: number; amount: string }>;
  checks: Check[];
  blocking: string[];
  lockedThrough: string | null;
  close: {
    status: string;
    closedAt: string | null;
    closedBy: string | null;
    note: string | null;
    packExportIds: string[];
  };
}
interface Lock {
  id: string;
  ledger: string | null;
  lockedThrough: string;
  note: string | null;
  lockedAt: string;
  lockedBy: string | null;
  releasedAt: string | null;
  releasedBy: string | null;
  releaseReason: string | null;
}
const money = (v: string) => `₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

/** Sprint 23: the first live month-end fee close. */
export default async function MonthEndPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const now = new Date();
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? '') ? sp.month! : prev.toISOString().slice(0, 7);
  const [t, o, me, state, locks] = await Promise.all([
    getTranslations('pages.fees_month_end'),
    getTranslations('ops'),
    getMe(),
    apiFetch<MonthEnd>(`/fees/month-end/${month}`),
    apiFetch<{ data: Lock[] }>('/fees/period-locks').then((r) => r.data),
  ]);
  const canLock = me.permissions.includes('fees.period.lock');
  const closed = state.close.status === 'closed';
  return (
    <>
      <PageHeader
        kicker={t('kicker')}
        title={t('title')}
        description={t('description')}
        actions={
          <form
            method="get"
            style={{ display: 'inline-flex', gap: 'var(--sp-2)', alignItems: 'flex-end' }}
          >
            <InputField
              id="month"
              name="month"
              label={o('month')}
              type="month"
              defaultValue={month}
            />
            <Button type="submit" size="sm" variant="secondary">
              {o('show')}
            </Button>
          </form>
        }
      />
      <Notice params={sp} />
      <div
        style={{
          display: 'grid',
          gap: 'var(--sp-5)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))',
          marginBottom: 'var(--sp-4)',
        }}
      >
        <Card
          title={`${o('checks')} · ${month}`}
          actions={
            <Badge tone={closed ? 'success' : state.blocking.length ? 'danger' : 'warning'}>
              {closed ? o('closed') : `${state.blocking.length} ${o('blocking').toLowerCase()}`}
            </Badge>
          }
        >
          <DataTable<Check>
            caption={o('checks')}
            density="dense"
            columns={[
              { key: 'l', header: o('check'), render: (c) => c.label },
              { key: 'v', header: o('value'), numeric: true, render: (c) => c.value },
              {
                key: 's',
                header: '',
                render: (c) =>
                  c.ok ? (
                    <Badge tone="success">✓</Badge>
                  ) : (
                    <Badge tone={c.blocking ? 'danger' : 'warning'}>
                      {c.blocking ? o('blocking') : '!'}
                    </Badge>
                  ),
              },
            ]}
            rows={state.checks}
            rowKey={(c) => c.code}
            emptyTitle="—"
          />
          {closed ? (
            <>
              <p className="ep-kicker" style={{ marginTop: 'var(--sp-3)' }}>
                {o('closed')} · {state.close.closedBy ?? ''} ·{' '}
                {state.close.closedAt?.slice(0, 16).replace('T', ' ')}
                {state.close.note ? ` · ${state.close.note}` : ''}
              </p>
              {state.close.packExportIds.length ? (
                <p className="ep-kicker">
                  {o('packExports')}:{' '}
                  {state.close.packExportIds.map((id) => (
                    <a
                      key={id}
                      href={`/reports/exports/${id}/download`}
                      style={{ marginRight: 'var(--sp-2)' }}
                    >
                      #{id}
                    </a>
                  ))}
                </p>
              ) : null}
              {canLock ? (
                <form
                  action={monthEndReopen}
                  style={{
                    display: 'flex',
                    gap: 'var(--sp-2)',
                    alignItems: 'flex-end',
                    marginTop: 'var(--sp-2)',
                  }}
                >
                  <input type="hidden" name="month" value={month} />
                  <InputField
                    id="reason"
                    name="reason"
                    label={o('reopenReason')}
                    required
                    minLength={5}
                    maxLength={1000}
                  />
                  <Button type="submit" size="sm" variant="ghost">
                    {o('reopen')}
                  </Button>
                </form>
              ) : null}
            </>
          ) : canLock ? (
            <form
              action={monthEndClose}
              style={{ marginTop: 'var(--sp-3)', display: 'grid', gap: 'var(--sp-2)' }}
            >
              <input type="hidden" name="month" value={month} />
              <InputField id="note" name="note" label={o('closeNote')} maxLength={1000} />
              <label style={{ display: 'inline-flex', gap: 'var(--sp-1)', alignItems: 'center' }}>
                <input type="checkbox" name="pack" defaultChecked /> {o('pack')}
              </label>
              {state.blocking.length ? <p className="ep-field__help">{o('clearFirst')}</p> : null}
              <div>
                <Button type="submit" disabled={state.blocking.length > 0}>
                  {o('close')}
                </Button>
              </div>
            </form>
          ) : null}
        </Card>
        <Card title={o('byLedger')}>
          <DataTable<MonthEnd['byLedgerAndMode'][number]>
            caption={o('byLedger')}
            density="dense"
            columns={[
              { key: 'l', header: o('ledger'), render: (r) => r.ledger },
              { key: 'm', header: 'Mode', render: (r) => r.mode },
              { key: 'c', header: o('count'), numeric: true, render: (r) => r.count },
              { key: 'a', header: o('amount'), numeric: true, render: (r) => money(r.amount) },
            ]}
            rows={state.byLedgerAndMode}
            rowKey={(r) => `${r.ledger}-${r.mode}`}
            emptyTitle="—"
          />
        </Card>
      </div>
      <Card
        title={o('locks')}
        actions={
          state.lockedThrough ? (
            <Badge tone="info">
              {o('lockThrough')} {state.lockedThrough}
            </Badge>
          ) : undefined
        }
      >
        {canLock ? (
          <form action={periodLock} style={{ marginBottom: 'var(--sp-3)' }}>
            <FormRow columns={4}>
              <SelectField
                id="ledger"
                name="ledger"
                label={o('ledger')}
                options={[
                  { value: '', label: o('allLedgers') },
                  { value: 'school', label: 'school' },
                  { value: 'hostel', label: 'hostel' },
                  { value: 'misc', label: 'misc' },
                ]}
              />
              <InputField
                id="lockedThrough"
                name="lockedThrough"
                label={o('lockThrough')}
                type="date"
                required
              />
              <InputField id="lnote" name="note" label={o('note')} maxLength={1000} />
              <div style={{ alignSelf: 'end' }}>
                <Button type="submit" variant="secondary">
                  {o('lock')}
                </Button>
              </div>
            </FormRow>
          </form>
        ) : null}
        <DataTable<Lock>
          caption={o('locks')}
          density="dense"
          columns={[
            { key: 'l', header: o('ledger'), render: (l) => l.ledger ?? o('allLedgers') },
            { key: 't', header: o('lockThrough'), render: (l) => l.lockedThrough },
            {
              key: 'b',
              header: o('lockedBy'),
              render: (l) =>
                `${l.lockedBy ?? ''} · ${l.lockedAt.slice(0, 16).replace('T', ' ')}${l.note ? ` · ${l.note}` : ''}`,
            },
            {
              key: 'r',
              header: o('released'),
              render: (l) =>
                l.releasedAt ? (
                  `${l.releasedBy ?? ''} · ${l.releasedAt.slice(0, 16).replace('T', ' ')} · ${l.releaseReason ?? ''}`
                ) : (
                  <Badge tone="success">active</Badge>
                ),
            },
          ]}
          rows={locks}
          rowKey={(l) => l.id}
          emptyTitle="—"
        />
      </Card>
    </>
  );
}
