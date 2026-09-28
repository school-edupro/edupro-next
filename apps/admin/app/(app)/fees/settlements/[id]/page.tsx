import { Badge, Breadcrumbs, Card, DataTable, PageHeader } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api';
import type { PaymentSettlement, SettlementLine } from '@/lib/types';

const tone = (s: SettlementLine['status']) =>
  s === 'matched' ? 'success' : s === 'refund' ? 'info' : s === 'unmatched' ? 'warning' : 'danger';

/** Sprint 13: one settlement file, line by line. */
export default async function SettlementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [t, s, settlement] = await Promise.all([
    getTranslations('pages.fees_settlements'),
    getTranslations('settlements'),
    apiFetch<PaymentSettlement>(`/payments/settlements/${id}`),
  ]);
  const kpis: Array<[string, string | number]> = [
    ['gross', settlement.gross],
    ['charges', settlement.charges],
    ['tax', settlement.tax],
    ['net', settlement.net],
    ['rows', settlement.rows],
    ['matched', settlement.matched],
    ['unmatched', settlement.unmatched],
    ['mismatched', settlement.mismatched],
  ];
  return (
    <>
      <Breadcrumbs
        items={[
          { label: t('title'), href: '/fees/settlements' },
          { label: settlement.settlementRef },
        ]}
      />
      <PageHeader
        kicker={t('kicker')}
        title={`${settlement.provider} · ${settlement.settlementRef}`}
        description={`${s('settledOn')} ${settlement.settledOn}${settlement.utr ? ` · ${s('utr')} ${settlement.utr}` : ''}${settlement.uploadedBy ? ` · ${s('uploadedBy')} ${settlement.uploadedBy}` : ''}`}
      />
      <div
        style={{
          display: 'grid',
          gap: 'var(--sp-3)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
          marginBottom: 'var(--sp-4)',
        }}
      >
        {kpis.map(([k, v]) => (
          <Card key={k} elevated>
            <div className="ep-kicker">{s(k)}</div>
            <div
              style={{
                fontFamily: 'var(--font-heading)',
                fontSize: 'var(--fs-h3)',
                fontWeight: 600,
              }}
            >
              {typeof v === 'number' ? v : `₹${v}`}
            </div>
          </Card>
        ))}
      </div>
      <Card title={s('lines')}>
        <DataTable<SettlementLine>
          caption={s('lines')}
          density="dense"
          columns={[
            { key: 'n', header: s('lineNo'), numeric: true, render: (l) => l.lineNo },
            {
              key: 'ref',
              header: s('providerRef'),
              render: (l) => <code>{l.providerRef ?? '—'}</code>,
            },
            { key: 'txn', header: s('txnId'), render: (l) => <code>{l.txnId ?? '—'}</code> },
            { key: 'amount', header: s('amount'), numeric: true, render: (l) => l.amount },
            { key: 'charges', header: s('charges'), numeric: true, render: (l) => l.charges },
            { key: 'tax', header: s('tax'), numeric: true, render: (l) => l.tax },
            { key: 'net', header: s('net'), numeric: true, render: (l) => l.net ?? '—' },
            {
              key: 'status',
              header: s('status'),
              render: (l) => <Badge tone={tone(l.status)}>{s(`statuses.${l.status}`)}</Badge>,
            },
            { key: 'receipt', header: s('receiptNo'), render: (l) => l.receiptNo ?? '—' },
            { key: 'student', header: s('student'), render: (l) => l.studentName ?? '—' },
            { key: 'note', header: s('note'), render: (l) => l.note ?? '' },
          ]}
          rows={settlement.lines ?? []}
          rowKey={(l) => l.id}
          emptyTitle={s('noSettlements')}
        />
      </Card>
    </>
  );
}
