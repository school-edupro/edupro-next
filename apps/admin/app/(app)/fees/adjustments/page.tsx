import { decideAdjustment__outcome, decideProfileChange__outcome } from '@/lib/choice-actions';
import { NoEnterSubmit } from '@/components/NoEnterSubmit';
import { Badge, Button, Card, DataTable, InputField, PageHeader, SelectField } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { decideAdjustment, decideProfileChange } from '@/lib/actions';
import {
  FilterInput,
  FilterRow,
  Pager,
  RegisterBar,
  registerQuery,
  rupees,
} from '@/components/RegisterTools';
import { apiFetch, getMe } from '@/lib/api';
import type { FeeAdjustment, FeeProfileChange, Page } from '@/lib/types';

const STATUSES = ['pending', 'approved', 'rejected', 'cancelled'];
const KINDS = ['waiver', 'reversal', 'bounce'];

const tone = (s: FeeAdjustment['status']) =>
  s === 'approved'
    ? 'success'
    : s === 'rejected'
      ? 'danger'
      : s === 'pending'
        ? 'warning'
        : 'neutral';

/** Sprint 14: adjustments (waiver, reversal, bounce) and category/discount changes with their decisions. */
export default async function AdjustmentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const tab = sp.tab === 'changes' ? 'changes' : 'adjustments';
  const rq = registerQuery(sp, { status: STATUSES, kind: tab === 'adjustments' ? KINDS : [] });
  // the open tab is read with its filters and page; the other only for its count
  const one = 'size=1&page=1';
  const [t, a, f, me, adj, chg, classes] = await Promise.all([
    getTranslations('pages.fees_adjustments'),
    getTranslations('adjustments'),
    getTranslations('fees'),
    getMe(),
    apiFetch<
      Page<FeeAdjustment> & {
        totals: { waived: string; cancelled: string; bounced: string; pending: number };
      }
    >(`/fees/adjustments/register?${tab === 'adjustments' ? rq.list.toString() : one}`),
    apiFetch<Page<FeeProfileChange> & { totals: { pending: number } }>(
      `/fees/profile-changes/register?${tab === 'changes' ? rq.list.toString() : one}`,
    ).catch(() => ({
      data: [] as FeeProfileChange[],
      page: { number: 1, size: 50, total: 0 },
      totals: { pending: 0 },
    })),
    apiFetch<Page<{ id: string; code: string; name: string }>>('/academics/classes?size=200')
      .then((x) => x.data)
      .catch(() => []),
  ]);
  const adjustments = adj.data;
  const changes = chg.data;
  const size = Number(rq.size);
  const shown = tab === 'adjustments' ? adj.page : chg.page;
  const pages = Math.max(1, Math.ceil(shown.total / size));
  const page = Math.min(shown.number, pages);
  const canApprove = me.permissions.includes('fees.adjustment.approve');
  const canDecideChange = me.permissions.includes('fees.profile.manage');
  // month-wise discounts of a change are shown by name and months, not as raw ids
  const [discountNames, monthNames] = changes.some((c) => Array.isArray(c.changes.discounts))
    ? await Promise.all([
        apiFetch<{ data: Array<{ id: string; name: string }> }>('/fees/discounts')
          .then((r) => new Map(r.data.map((d) => [d.id, d.name])))
          .catch(() => new Map<string, string>()),
        apiFetch<{ data: Array<{ sequence: number; name: string }> }>('/fees/periods')
          .then((r) => new Map(r.data.map((p) => [p.sequence, p.name])))
          .catch(() => new Map<number, string>()),
      ])
    : [new Map<string, string>(), new Map<number, string>()];
  const describe = (c: FeeProfileChange) =>
    Object.entries(c.changes)
      .map(([k, v]) => {
        if (k === 'discounts' && Array.isArray(v))
          return `Discounts by month: ${
            v.length === 0
              ? 'none'
              : (v as Array<{ discountId: string; fromSeq: number; toSeq: number }>)
                  .map(
                    (d) =>
                      `${discountNames.get(String(d.discountId)) ?? d.discountId} (${monthNames.get(d.fromSeq) ?? d.fromSeq} to ${monthNames.get(d.toSeq) ?? d.toSeq})`,
                  )
                  .join('; ')
          }`;
        if (k === 'discountId') return `${a('discount')}: ${v === null ? f('none') : String(v)}`;
        if (k === 'hosteller') return `${a('hosteller')}: ${v ? a('yes') : a('no')}`;
        if (k === 'studentType') return `${a('studentType')}: ${String(v)}`;
        if (k === 'feeGroup') return `${a('feeGroup')}: ${String(v)}`;
        return `${k}: ${String(v)}`;
      })
      .join(' · ');
  return (
    <>
      <PageHeader kicker={t('kicker')} title={t('title')} description={t('description')} />
      <Notice params={sp} />
      <div className="ep-tabs">
        <nav className="ep-tabs__list" aria-label="Registers">
          {(
            [
              [
                'adjustments',
                'Waivers, cancellations and bounces',
                adj.page.total,
                adj.totals.pending,
              ],
              ['changes', a('profileChanges'), chg.page.total, chg.totals.pending],
            ] as const
          ).map(([key, label, n, waiting]) => (
            <a
              key={key}
              className="ep-tabs__tab"
              href={`/fees/adjustments?tab=${key}`}
              aria-current={tab === key ? 'page' : undefined}
            >
              {label}
              {tab === key ? ` (${String(n)})` : ''}
              {tab !== key && waiting > 0 ? ` · ${String(waiting)} waiting` : ''}
            </a>
          ))}
        </nav>
      </div>
      <Card>
        <FilterRow clearHref={`/fees/adjustments?tab=${tab}`} hidden={{ tab }}>
          <SelectField
            id="status"
            name="status"
            label={a('status')}
            defaultValue={rq.values.status}
            options={[
              { value: '', label: a('all') },
              ...(['pending', 'approved', 'rejected'] as const).map((s) => ({
                value: s,
                label: a(`statuses.${s}`),
              })),
              { value: 'cancelled', label: 'Cancelled' },
            ]}
          />
          {tab === 'adjustments' ? (
            <SelectField
              id="kind"
              name="kind"
              label="Type"
              defaultValue={rq.values.kind}
              options={[
                { value: '', label: 'All types' },
                ...(['waiver', 'reversal', 'bounce'] as const).map((k) => ({
                  value: k,
                  label: a(`kinds.${k}`),
                })),
              ]}
            />
          ) : null}
          <SelectField
            id="classId"
            name="classId"
            label="Class"
            defaultValue={rq.values.classId}
            options={[
              { value: '', label: 'All classes' },
              ...classes.map((k) => ({ value: k.id, label: k.name || k.code })),
            ]}
          />
          <FilterInput id="from" label="Asked from" type="date" value={rq.values.from} />
          <FilterInput id="to" label="Asked to" type="date" value={rq.values.to} />
          <FilterInput
            id="q"
            label={tab === 'adjustments' ? 'Student or receipt no.' : 'Student or admission no.'}
            value={rq.values.q}
          />
          <SelectField
            id="size"
            name="size"
            label="Per page"
            defaultValue={rq.size}
            options={['25', '50', '100', '200'].map((n) => ({ value: n, label: n }))}
          />
        </FilterRow>
        <RegisterBar
          page={page}
          size={size}
          total={shown.total}
          summary={
            tab === 'adjustments'
              ? `Approved: waived ${rupees(adj.totals.waived)} · cancelled ${rupees(adj.totals.cancelled)} · bounced ${rupees(adj.totals.bounced)} · ${String(adj.totals.pending)} waiting`
              : `${String(chg.totals.pending)} waiting`
          }
          fileHref={`/api/fees/register-file?register=${tab}&${rq.filters.toString()}`}
        />
      </Card>
      {tab === 'adjustments' ? (
        <Card title={t('title')}>
          <p className="ep-field__help">{a('help')}</p>
          <DataTable<FeeAdjustment>
            caption={t('title')}
            density="dense"
            columns={[
              {
                key: 'when',
                header: a('requestedAt'),
                render: (x) =>
                  new Date(x.requestedAt).toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata' }),
              },
              {
                key: 'student',
                header: a('student'),
                render: (x) => (
                  <a href={`/fees/ledger/${x.studentId}`}>
                    {x.studentName} · {x.admissionNo}
                  </a>
                ),
              },
              {
                key: 'kind',
                header: a('kind'),
                render: (x) => <strong>{a(`kinds.${x.kind}`)}</strong>,
              },
              {
                key: 'on',
                header: a('receipt'),
                render: (x) =>
                  x.kind === 'waiver'
                    ? (x.demandLabel ?? x.demandId)
                    : `${x.receiptNo ?? ''} (₹${x.receiptAmount ?? ''})`,
              },
              {
                key: 'amount',
                header: a('amount'),
                numeric: true,
                render: (x) => rupees(x.amount),
              },
              {
                key: 'charge',
                header: a('charge'),
                numeric: true,
                render: (x) => (Number(x.charge) > 0 ? `₹${x.charge}` : '—'),
              },
              { key: 'reason', header: a('reason'), render: (x) => x.reason },
              {
                key: 'status',
                header: a('status'),
                render: (x) => (
                  <span title={x.decisionNote ?? ''}>
                    <Badge tone={tone(x.status)}>{a(`statuses.${x.status}`)}</Badge>
                    {x.decidedBy ? <small> · {x.decidedBy}</small> : null}
                  </span>
                ),
              },
              {
                key: 'decide',
                header: canApprove ? a('decide') : '',
                render: (x) =>
                  x.status === 'pending' && x.workflowInstanceId ? (
                    <span>
                      {x.waitingWith ? `With ${x.waitingWith}. ` : ''}
                      <a href="/workflow/inbox">Approve in My approvals</a>
                    </span>
                  ) : canApprove && x.status === 'pending' ? (
                    <form
                      action={decideAdjustment}
                      style={{ display: 'grid', gap: 'var(--sp-2)', minWidth: 220 }}
                    >
                      <NoEnterSubmit />
                      <input type="hidden" name="id" value={x.id} />
                      <InputField
                        id={`note-${x.id}`}
                        name="note"
                        label={a('note')}
                        maxLength={300}
                      />
                      <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
                        <Button
                          type="submit"
                          formAction={decideAdjustment__outcome.bind(null, 'approved')}
                          size="sm"
                        >
                          {a('approve')}
                        </Button>
                        <Button
                          type="submit"
                          formAction={decideAdjustment__outcome.bind(null, 'rejected')}
                          variant="secondary"
                          size="sm"
                        >
                          {a('reject')}
                        </Button>
                      </div>
                    </form>
                  ) : null,
              },
            ]}
            rows={adjustments}
            rowKey={(x) => x.id}
            emptyTitle={a('noAdjustments')}
          />
          <Pager page={page} pages={pages} hrefFor={(n) => `?${rq.here({ page: String(n) })}`} />
        </Card>
      ) : (
        <Card title={a('profileChanges')}>
          <DataTable<FeeProfileChange>
            caption={a('profileChanges')}
            density="dense"
            columns={[
              {
                key: 'when',
                header: a('requestedAt'),
                render: (x) =>
                  new Date(x.requestedAt).toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata' }),
              },
              {
                key: 'student',
                header: a('student'),
                render: (x) => (
                  <a href={`/people/students/${x.studentId}`}>
                    {x.studentName} · {x.admissionNo}
                  </a>
                ),
              },
              { key: 'changes', header: a('changes'), render: (x) => describe(x) },
              { key: 'reason', header: a('reason'), render: (x) => x.reason },
              {
                key: 'status',
                header: a('status'),
                render: (x) => (
                  <span title={x.decisionNote ?? ''}>
                    <Badge tone={tone(x.status)}>{a(`statuses.${x.status}`)}</Badge>
                    {x.status === 'pending' && x.workflowInstanceId ? (
                      <small>
                        {' '}
                        · <a href="/workflow/inbox">{a('inWorkflow')}</a>
                      </small>
                    ) : null}
                  </span>
                ),
              },
              {
                key: 'decide',
                header: canDecideChange ? a('decide') : '',
                render: (x) =>
                  canDecideChange && x.status === 'pending' && !x.workflowInstanceId ? (
                    <form
                      action={decideProfileChange}
                      style={{ display: 'flex', gap: 'var(--sp-2)' }}
                    >
                      <NoEnterSubmit />
                      <input type="hidden" name="id" value={x.id} />
                      <Button
                        type="submit"
                        formAction={decideProfileChange__outcome.bind(null, 'approved')}
                        size="sm"
                      >
                        {a('statuses.approved')}
                      </Button>
                      <Button
                        type="submit"
                        formAction={decideProfileChange__outcome.bind(null, 'rejected')}
                        variant="secondary"
                        size="sm"
                      >
                        {a('reject')}
                      </Button>
                    </form>
                  ) : null,
              },
            ]}
            rows={changes}
            rowKey={(x) => x.id}
            emptyTitle={a('noChanges')}
          />
          <Pager page={page} pages={pages} hrefFor={(n) => `?${rq.here({ page: String(n) })}`} />
        </Card>
      )}
    </>
  );
}
