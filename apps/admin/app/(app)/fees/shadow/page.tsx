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
import { decideVariance, shadowFeed, shadowReconcile } from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import type { Page, ShadowFeed, ShadowRun, ShadowVariance } from '@/lib/types';

const money = (v: unknown) =>
  `₹${(Number(v ?? 0) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const KINDS = [
  'missing_in_new',
  'missing_in_legacy',
  'amount',
  'date',
  'reversed_in_new',
  'not_reversed',
  'balance',
];

/** Sprint 16: the variance workbench of the shadow run. */
export default async function ShadowPage({
  searchParams,
}: {
  searchParams: Promise<{
    runId?: string;
    status?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  const q = new URLSearchParams({ size: '200' });
  if (sp.runId) q.set('runId', sp.runId);
  if (sp.status) q.set('status', sp.status);
  const [t, s, me, feeds, runs, variances] = await Promise.all([
    getTranslations('pages.fees_shadow'),
    getTranslations('shadow'),
    getMe(),
    apiFetch<{ data: ShadowFeed[] }>('/shadow/feeds').then((x) => x.data),
    apiFetch<{ data: ShadowRun[] }>('/shadow/runs').then((x) => x.data),
    apiFetch<Page<ShadowVariance>>(`/shadow/variances?${q.toString()}`),
  ]);
  const canManage = me.permissions.includes('fees.shadow.manage');
  const kindLabel = (k: string) =>
    k === 'amount' ? s('amount_kind') : KINDS.includes(k) ? s(k) : k;
  const latest = runs[0];
  return (
    <>
      <PageHeader
        kicker={t('kicker')}
        title={t('title')}
        description={t('description')}
        actions={
          latest ? (
            <Badge tone={latest.status === 'zero' ? 'success' : 'danger'}>
              {latest.runDate} ·{' '}
              {latest.status === 'zero'
                ? s('zero')
                : `${latest.openVariances} ${s('open').toLowerCase()} · ${money(latest.varianceAmount)}`}
            </Badge>
          ) : undefined
        }
      />
      <Notice params={sp} />
      <div
        style={{
          display: 'grid',
          gap: 'var(--sp-5)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))',
        }}
      >
        <Card
          title={s('runs')}
          actions={
            canManage ? (
              <form
                action={shadowReconcile}
                style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'flex-end' }}
              >
                <InputField id="from" name="from" label={s('from')} type="date" />
                <InputField id="to" name="to" label={s('to')} type="date" />
                <Button type="submit" size="sm">
                  {s('reconcileNow')}
                </Button>
              </form>
            ) : undefined
          }
        >
          <DataTable<ShadowRun>
            caption={`${s('runs')} · ${runs.length}`}
            density="dense"
            columns={[
              {
                key: 'd',
                header: s('run'),
                render: (r) => (
                  <a href={`/fees/shadow?runId=${r.id}`}>
                    <strong>{r.runDate}</strong>
                    <div className="ep-kicker">
                      {r.fromDate} → {r.toDate}
                    </div>
                  </a>
                ),
              },
              {
                key: 'l',
                header: s('legacy'),
                numeric: true,
                render: (r) => (
                  <>
                    {r.legacyReceipts}
                    <div className="ep-kicker">{money(r.legacyAmount)}</div>
                  </>
                ),
              },
              {
                key: 'n',
                header: s('new'),
                numeric: true,
                render: (r) => (
                  <>
                    {r.newReceipts}
                    <div className="ep-kicker">{money(r.newAmount)}</div>
                  </>
                ),
              },
              { key: 'm', header: s('matched'), numeric: true, render: (r) => r.matched },
              {
                key: 'v',
                header: s('variances'),
                numeric: true,
                render: (r) => `${r.openVariances} / ${r.variances}`,
              },
              {
                key: 'b',
                header: s('balances'),
                numeric: true,
                render: (r) => `${r.balanceVariances} / ${r.balancesCompared}`,
              },
              {
                key: 's',
                header: s('status'),
                render: (r) => (
                  <Badge tone={r.status === 'zero' ? 'success' : 'danger'}>
                    {r.status === 'zero' ? s('zero') : s('variance')}
                  </Badge>
                ),
              },
            ]}
            rows={runs}
            rowKey={(r) => r.id}
            emptyTitle="—"
          />
        </Card>
        <Card title={s('feeds')}>
          {canManage ? (
            <form
              action={shadowFeed}

              style={{ marginBottom: 'var(--sp-3)' }}
            >
              <FormRow columns={2}>
                <SelectField
                  id="kind"
                  name="kind"
                  label={s('kind')}
                  options={[
                    { value: 'receipts', label: s('receipts') },
                    { value: 'balances', label: s('balances') },
                  ]}
                />
                <label className="ep-field">
                  <span className="ep-field__label">{s('file')}</span>
                  <input
                    className="ep-input"
                    type="file"
                    name="file"
                    accept=".csv,.json,text/csv,application/json"
                    required
                  />
                </label>
              </FormRow>
              <p className="ep-field__help">{s('fileHelp')}</p>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 'var(--sp-3)',
                  marginTop: 'var(--sp-2)',
                }}
              >
                <span className="ep-field__help">{s('serviceHint')}</span>
                <Button type="submit" size="sm">
                  {s('uploadBtn')}
                </Button>
              </div>
            </form>
          ) : null}
          <DataTable<ShadowFeed>
            caption={`${s('feeds')} · ${feeds.length}`}
            density="dense"
            columns={[
              {
                key: 'at',
                header: s('at'),
                render: (f) => f.receivedAt.slice(0, 16).replace('T', ' '),
              },
              { key: 'k', header: s('kind'), render: (f) => f.kind },
              {
                key: 'src',
                header: s('source'),
                render: (f) => `${f.source}${f.fileName ? ` · ${f.fileName}` : ''}`,
              },
              { key: 'r', header: s('rows'), numeric: true, render: (f) => f.rows },
              { key: 'p', header: s('posted'), numeric: true, render: (f) => f.posted },
              { key: 'sk', header: s('skipped'), numeric: true, render: (f) => f.skipped },
              {
                key: 'rj',
                header: s('rejected'),
                numeric: true,
                render: (f) => (f.rejected ? <Badge tone="danger">{f.rejected}</Badge> : 0),
              },
              { key: 'by', header: s('by'), render: (f) => f.receivedBy },
            ]}
            rows={feeds}
            rowKey={(f) => f.id}
            emptyTitle="—"
          />
        </Card>
      </div>
      <Card
        title={`${s('varianceList')}${sp.runId ? ` · ${runs.find((r) => r.id === sp.runId)?.runDate ?? ''}` : ''}`}
        style={{ marginTop: 'var(--sp-5)' }}
        actions={
          <form
            method="get"
            style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'flex-end' }}
          >
            {sp.runId ? <input type="hidden" name="runId" value={sp.runId} /> : null}
            <SelectField
              id="status"
              name="status"
              label={s('filterStatus')}
              defaultValue={sp.status ?? ''}
              options={[
                { value: '', label: s('all') },
                { value: 'open', label: s('open') },
                { value: 'explained', label: s('explain') },
                { value: 'resolved', label: s('resolve') },
              ]}
            />
            <Button type="submit" variant="secondary" size="sm">
              {s('filterStatus')}
            </Button>
          </form>
        }
      >
        <DataTable<ShadowVariance>
          caption={`${s('varianceList')} · ${variances.page.total}`}
          density="dense"
          columns={[
            { key: 'd', header: s('run'), render: (v) => v.runDate },
            {
              key: 'k',
              header: s('kindCol'),
              render: (v) => (
                <Badge
                  tone={
                    v.status === 'open'
                      ? 'danger'
                      : v.status === 'explained'
                        ? 'warning'
                        : 'success'
                  }
                >
                  {kindLabel(v.kind)}
                </Badge>
              ),
            },
            { key: 'r', header: s('ref'), render: (v) => <strong>{v.ref}</strong> },
            {
              key: 'l',
              header: s('legacySide'),
              render: (v) =>
                Object.entries(v.legacy)
                  .map(([k, x]) => `${k}: ${String(x)}`)
                  .join(' · '),
            },
            {
              key: 'n',
              header: s('newSide'),
              render: (v) =>
                Object.entries(v.current)
                  .map(([k, x]) => `${k}: ${String(x)}`)
                  .join(' · '),
            },
            { key: 'delta', header: s('delta'), numeric: true, render: (v) => money(v.delta) },
            {
              key: 'x',
              header: s('explanation'),
              render: (v) =>
                v.status !== 'open' ? (
                  <>
                    {v.explanation}
                    <div className="ep-kicker">
                      {s('decided', { by: v.decidedBy ?? '', at: v.decidedAt?.slice(0, 10) ?? '' })}
                    </div>
                    {canManage ? (
                      <form action={decideVariance}>
                        <input type="hidden" name="id" value={v.id} />
                        <input type="hidden" name="runId" value={sp.runId ?? ''} />
                        <input type="hidden" name="status" value="open" />
                        <Button type="submit" size="sm" variant="ghost">
                          {s('reopen')}
                        </Button>
                      </form>
                    ) : null}
                  </>
                ) : canManage ? (
                  <form
                    action={decideVariance}
                    style={{
                      display: 'flex',
                      gap: 'var(--sp-2)',
                      alignItems: 'flex-end',
                      flexWrap: 'wrap',
                    }}
                  >
                    <input type="hidden" name="id" value={v.id} />
                    <input type="hidden" name="runId" value={sp.runId ?? ''} />
                    <InputField
                      id={`x-${v.id}`}
                      name="explanation"
                      label={s('explanation')}
                      maxLength={600}
                      required
                    />
                    <Button
                      type="submit"
                      name="status"
                      value="explained"
                      size="sm"
                      variant="secondary"
                    >
                      {s('explain')}
                    </Button>
                    <Button type="submit" name="status" value="resolved" size="sm">
                      {s('resolve')}
                    </Button>
                  </form>
                ) : null,
            },
          ]}
          rows={variances.data}
          rowKey={(v) => v.id}
          emptyTitle={s('noVariances')}
        />
      </Card>
    </>
  );
}
