import { Badge, Button, Card, DataTable, InputField, PageHeader } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api';
import type { AssistantAudit } from '@/lib/types';

const Kpi = ({ label, value }: { label: string; value: string }) => (
  <Card elevated>
    <div className="ep-kicker">{label}</div>
    <div style={{ fontFamily: 'var(--font-heading)', fontSize: 'var(--fs-h2)', fontWeight: 600 }}>
      {value}
    </div>
  </Card>
);

/** Sprint 14: what was asked, what ran and what it cost, with personal data masked. */
export default async function AssistantAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const sp = await searchParams;
  const days = /^\d+$/.test(sp.days ?? '') ? Number(sp.days) : 30;
  const [t, s, audit] = await Promise.all([
    getTranslations('pages.insights_assistant_audit'),
    getTranslations('assistant'),
    apiFetch<AssistantAudit>(`/insights/assistant/audit?days=${days}`),
  ]);
  const k = audit.totals;
  return (
    <>
      <PageHeader
        kicker={t('kicker')}
        title={`${t('title')} · ${audit.provider} / ${audit.model}`}
        description={t('description')}
        actions={
          <form
            method="get"
            style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'flex-end' }}
          >
            <InputField
              id="days"
              name="days"
              label={s('audit.days')}
              type="number"
              min={1}
              max={365}
              defaultValue={days}
            />
            <Button type="submit" variant="secondary">
              {s('ask')}
            </Button>
          </form>
        }
      />
      <div
        style={{
          display: 'grid',
          gap: 'var(--sp-3)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          marginBottom: 'var(--sp-4)',
        }}
      >
        <Kpi label={s('audit.prompts')} value={String(k.prompts)} />
        <Kpi label={s('audit.refusals')} value={String(k.refusals)} />
        <Kpi label={s('audit.toolCalls')} value={String(k.tool_calls)} />
        <Kpi label={s('audit.users')} value={String(k.users)} />
        <Kpi label={s('audit.inputTokens')} value={String(k.input_tokens)} />
        <Kpi label={s('audit.outputTokens')} value={String(k.output_tokens)} />
        <Kpi label={s('audit.costPaise')} value={(Number(k.cost_paise) / 100).toFixed(2)} />
      </div>
      <Card title={t('title')}>
        <DataTable<AssistantAudit['recent'][number]>
          caption={t('title')}
          density="dense"
          columns={[
            {
              key: 'at',
              header: s('audit.when'),
              render: (r) => new Date(r.at).toLocaleString('en-IN'),
            },
            {
              key: 'kind',
              header: s('audit.kind'),
              render: (r) => (
                <Badge
                  tone={
                    r.kind === 'refusal' ? 'warning' : r.kind === 'error' ? 'danger' : 'neutral'
                  }
                >
                  {r.kind}
                </Badge>
              ),
            },
            { key: 'user', header: s('audit.user'), render: (r) => r.user ?? '—' },
            {
              key: 'text',
              header: s('audit.text'),
              render: (r) => <span style={{ whiteSpace: 'pre-wrap' }}>{r.text.slice(0, 300)}</span>,
            },
            {
              key: 'red',
              header: s('audit.redactions'),
              numeric: true,
              render: (r) => r.redactions,
            },
            {
              key: 'cost',
              header: s('audit.costPaise'),
              numeric: true,
              render: (r) => (r.costPaise === null ? '—' : (r.costPaise / 100).toFixed(2)),
            },
          ]}
          rows={audit.recent}
          rowKey={(r) => r.id}
          emptyTitle="—"
        />
      </Card>
    </>
  );
}
