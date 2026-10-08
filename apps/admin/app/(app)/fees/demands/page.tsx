import { Badge, Button, Card, DataTable, PageHeader, SelectField } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { generateClassDemand } from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import type { ClassRow, FeeClassSummaryRow, Page } from '@/lib/types';

/** S8-06: class-wise demand generation and per-student totals. */
export default async function FeeDemandsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string; classId?: string }>;
}) {
  const sp = await searchParams;
  const [t, f, me] = await Promise.all([
    getTranslations('pages.fees_demands'),
    getTranslations('fees'),
    getMe(),
  ]);
  const canGenerate = me.permissions.includes('fees.demand.generate');
  const canLedger = me.permissions.includes('fees.ledger.view');
  const [classes, rows] = await Promise.all([
    apiFetch<Page<ClassRow>>('/academics/classes?size=200').then((r) => r.data),
    sp.classId
      ? apiFetch<{ data: FeeClassSummaryRow[] }>(
          `/fees/demands/summary?classId=${sp.classId}`,
        ).then((r) => r.data)
      : Promise.resolve<FeeClassSummaryRow[]>([]),
  ]);
  const cls = classes.find((k) => k.id === sp.classId);
  const total = rows.reduce((s, r) => s + Number(r.net), 0);
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
            marginBottom: 'var(--sp-4)',
          }}
        >
          <SelectField
            id="classId"
            name="classId"
            label={f('chooseClass')}
            defaultValue={sp.classId ?? ''}
            options={[
              { value: '', label: '—' },
              ...classes.map((k) => ({ value: k.id, label: `${k.code} · ${k.name}` })),
            ]}
          />
          <Button type="submit" variant="secondary">
            {f('show')}
          </Button>
          {cls && canGenerate ? (
            <Button type="submit" formAction={generateClassDemand} formMethod="post">
              {f('generateClass')}
            </Button>
          ) : null}
        </form>
        {cls ? (
          <DataTable<FeeClassSummaryRow>
            caption={`${cls.name}: ${f('demand')} · ${f('total')} ₹${total.toFixed(2)}`}
            density="dense"
            columns={[
              { key: 'section', header: f('chooseClass'), render: (r) => r.section },
              { key: 'roll', header: '#', numeric: true, render: (r) => r.rollNo ?? '' },
              {
                key: 'name',
                header: f('student'),
                render: (r) => (
                  <span>
                    <a href={`/people/students/${r.studentId}`}>
                      {r.name} · {r.admissionNo}
                    </a>
                    {canLedger ? (
                      <>
                        {' · '}
                        <a href={`/fees/ledger/${r.studentId}`}>{f('ledger')}</a>
                      </>
                    ) : null}
                  </span>
                ),
              },
              {
                key: 'profile',
                header: f('hasProfile'),
                render: (r) => (
                  <Badge tone={r.hasProfile ? 'success' : 'neutral'}>
                    {r.hasProfile ? '✓' : '—'}
                  </Badge>
                ),
              },
              { key: 'rows', header: f('rows'), numeric: true, render: (r) => r.rows },
              { key: 'net', header: f('net'), numeric: true, render: (r) => r.net },
              { key: 'paid', header: f('paid'), numeric: true, render: (r) => r.paid },
              {
                key: 'balance',
                header: f('balance'),
                numeric: true,
                render: (r) => <strong>{r.balance}</strong>,
              },
            ]}
            rows={rows}
            rowKey={(r) => r.studentId}
            emptyTitle={f('noDemand')}
          />
        ) : null}
      </Card>
    </>
  );
}
