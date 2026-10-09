import { Badge, Button, Card, DataTable, InputField, PageHeader, SelectField } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { generateClassDemand } from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import type { ClassRow, FeeClassSummaryRow, Page } from '@/lib/types';

/** S8-06: class-wise demand generation and per-student totals. */
export default async function FeeDemandsPage({
  searchParams,
}: {
  searchParams: Promise<{
    ok?: string;
    error?: string;
    detail?: string;
    classId?: string;
    generated?: string;
    skippedCount?: string;
    skipped?: string;
  }>;
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
      {sp.generated !== undefined ? (
        <p
          className={`ep-alert ${Number(sp.skippedCount) > 0 ? 'ep-alert--warning' : 'ep-alert--success'}`}
          role="status"
        >
          Bills made for {sp.generated} pupil(s).
          {Number(sp.skippedCount) > 0
            ? ` ${sp.skippedCount} pupil(s) could not be done: ${sp.skipped ?? ''}`
            : ''}
        </p>
      ) : null}
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
          <form
            method="get"
            action="/fees/bills"
            style={{
              display: 'flex',
              gap: 'var(--sp-3)',
              alignItems: 'flex-end',
              marginBottom: 'var(--sp-4)',
            }}
          >
            <input type="hidden" name="classId" value={cls.id} />
            <InputField
              id="upTo"
              name="upTo"
              label="Fee bills: dues up to"
              type="date"
              defaultValue={new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10)}
            />
            <Button type="submit" variant="secondary">
              Print fee bills of {cls.name}
            </Button>
          </form>
        ) : null}
        {cls ? (
          <p className="ep-field__help">
            Net = Fee + Transport + Previous / other − Discount. Totals differ between pupils
            because of: old or new student, fee group, discounts, transport, dues or advance carried
            from last year, hostel, and lines already paid (a paid line keeps the amount it was paid
            at). Open the ledger’s “Head and month” tab to see one pupil line by line.
          </p>
        ) : null}
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
                key: 'why',
                header: 'Type · group · discount',
                render: (r) => (
                  <span>
                    {r.studentType === 'new' ? 'New' : 'Old'}
                    {r.feeGroup !== 'general' ? ` · ${r.feeGroup.replace(/_/g, ' ')}` : ''}
                    {r.discounts ? ` · ${r.discounts}` : ''}{' '}
                    {r.stale ? <Badge tone="warning">Bill older than the structure</Badge> : null}
                    {Number(r.paid) > 0 ? (
                      <span className="ep-field__help"> paid lines keep their old amounts</span>
                    ) : null}
                  </span>
                ),
              },
              { key: 'fee', header: 'Fee', numeric: true, render: (r) => r.fee },
              { key: 'transport', header: 'Transport', numeric: true, render: (r) => r.transport },
              { key: 'other', header: 'Previous / other', numeric: true, render: (r) => r.other },
              { key: 'discount', header: 'Discount', numeric: true, render: (r) => r.discount },
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
