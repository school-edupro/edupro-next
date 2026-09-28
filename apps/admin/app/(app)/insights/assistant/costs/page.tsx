import { Button, Card, DataTable, PageHeader, SelectField } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api';
import type { AssistantCosts } from '@/lib/types';

const paise = (v: number) => `₹${(v / 100).toFixed(2)}`;
const Kpi = ({ label, value }: { label: string; value: string }) => (
  <Card elevated>
    <div className="ep-kicker">{label}</div>
    <div style={{ fontFamily: 'var(--font-heading)', fontSize: 'var(--fs-h2)', fontWeight: 600 }}>
      {value}
    </div>
  </Card>
);

/** Sprint 16 (AI track): the cost dashboard. */
export default async function AssistantCostsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const sp = await searchParams;
  const days = sp.days && /^\d+$/.test(sp.days) ? sp.days : '30';
  const [t, c, costs] = await Promise.all([
    getTranslations('pages.insights_assistant_costs'),
    getTranslations('costs'),
    apiFetch<AssistantCosts>(`/insights/assistant/costs?days=${days}`),
  ]);
  return (
    <>
      <PageHeader
        kicker={t('kicker')}
        title={t('title')}
        description={c('budget', {
          user: costs.budget.perUserDailyTokens.toLocaleString('en-IN'),
          school: costs.budget.perSchoolMonthlyTokens.toLocaleString('en-IN'),
        })}
        actions={
          <form
            method="get"
            style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'flex-end' }}
          >
            <SelectField
              id="days"
              name="days"
              label={c('days')}
              defaultValue={days}
              options={['7', '30', '90'].map((d) => ({ value: d, label: d }))}
            />
            <Button type="submit" variant="secondary" size="sm">
              {c('show')}
            </Button>
          </form>
        }
      />
      <div
        style={{
          display: 'grid',
          gap: 'var(--sp-4)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          marginBottom: 'var(--sp-5)',
        }}
      >
        <Kpi label={c('prompts')} value={String(costs.totals.prompts)} />
        <Kpi
          label={c('refusalRate')}
          value={costs.totals.refusalRatePct === null ? '—' : `${costs.totals.refusalRatePct}%`}
        />
        <Kpi
          label={c('tokens')}
          value={`${costs.totals.inputTokens.toLocaleString('en-IN')} / ${costs.totals.outputTokens.toLocaleString('en-IN')}`}
        />
        <Kpi label={c('cost')} value={paise(costs.totals.costPaise)} />
        <Kpi
          label={c('reports')}
          value={`${costs.reports.count} · ${paise(costs.reports.costPaise)}`}
        />
      </div>
      <div
        style={{
          display: 'grid',
          gap: 'var(--sp-5)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))',
        }}
      >
        <Card title={c('byDay')}>
          <DataTable<AssistantCosts['byDay'][number]>
            caption={c('byDay')}
            density="dense"
            columns={[
              { key: 'd', header: c('day'), render: (x) => x.day },
              { key: 'p', header: c('prompts'), numeric: true, render: (x) => x.prompts },
              { key: 'r', header: c('refusals'), numeric: true, render: (x) => x.refusals },
              {
                key: 't',
                header: c('tokens'),
                numeric: true,
                render: (x) => `${x.inputTokens} / ${x.outputTokens}`,
              },
              { key: 'c', header: c('cost'), numeric: true, render: (x) => paise(x.costPaise) },
            ]}
            rows={costs.byDay}
            rowKey={(x) => x.day}
            emptyTitle="—"
          />
        </Card>
        <Card title={c('bySurface')}>
          <DataTable<AssistantCosts['bySurface'][number]>
            caption={c('bySurface')}
            density="dense"
            columns={[
              { key: 's', header: c('surface'), render: (x) => <strong>{x.surface}</strong> },
              { key: 'p', header: c('prompts'), numeric: true, render: (x) => x.prompts },
              { key: 'r', header: c('refusals'), numeric: true, render: (x) => x.refusals },
              { key: 'u', header: c('users'), numeric: true, render: (x) => x.users },
              { key: 'c', header: c('cost'), numeric: true, render: (x) => paise(x.costPaise) },
            ]}
            rows={costs.bySurface}
            rowKey={(x) => x.surface}
            emptyTitle="—"
          />
          <div className="ep-kicker" style={{ marginTop: 'var(--sp-3)' }}>
            {c('byModel')}
          </div>
          <DataTable<AssistantCosts['byModel'][number]>
            caption={c('byModel')}
            density="dense"
            columns={[
              { key: 'm', header: c('model'), render: (x) => `${x.provider} · ${x.model}` },
              { key: 'p', header: c('prompts'), numeric: true, render: (x) => x.prompts },
              { key: 'c', header: c('cost'), numeric: true, render: (x) => paise(x.costPaise) },
            ]}
            rows={costs.byModel}
            rowKey={(x) => `${x.provider}-${x.model}`}
            emptyTitle="—"
          />
        </Card>
        <Card title={c('byUser')}>
          <DataTable<AssistantCosts['byUser'][number]>
            caption={c('byUser')}
            density="dense"
            columns={[
              { key: 'u', header: c('user'), render: (x) => x.user ?? '—' },
              { key: 'p', header: c('prompts'), numeric: true, render: (x) => x.prompts },
              {
                key: 't',
                header: c('tokens'),
                numeric: true,
                render: (x) => x.tokens.toLocaleString('en-IN'),
              },
              { key: 'c', header: c('cost'), numeric: true, render: (x) => paise(x.costPaise) },
            ]}
            rows={costs.byUser}
            rowKey={(x) => x.user ?? '-'}
            emptyTitle="—"
          />
        </Card>
      </div>
    </>
  );
}
