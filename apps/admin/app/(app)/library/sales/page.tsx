import {
  Breadcrumbs,
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
import { librarySell } from '@/lib/actions';
import { apiFetch } from '@/lib/api';

interface Sale {
  id: string;
  accessionNo: string;
  title: string;
  buyerKind: string;
  buyer: string | null;
  price: string;
  receiptRef: string | null;
  soldOn: string;
  soldBy: string | null;
}

/** Sales of withdrawn or damaged copies (Sprint 18; moved off the stock page; rebuilt in part 4 of the library reports). */
export default async function LibrarySalesPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const [s, sales] = await Promise.all([
    getTranslations('stock'),
    apiFetch<{ data: Sale[] }>('/library/sales').then((x) => x.data),
  ]);
  return (
    <>
      <Breadcrumbs items={[{ label: 'Library', href: '/library' }, { label: 'Book sales' }]} />
      <PageHeader
        kicker="Library"
        title="Book sales"
        description="Withdrawn or damaged copies sold, with the receipt reference."
      />
      <Notice params={sp} />
      <Card title={s('sale')}>
        <form action={librarySell}>
          <FormRow columns={3}>
            <InputField
              id="accessionNo"
              name="accessionNo"
              label={s('accessionNo')}
              required
              maxLength={30}
            />
            <SelectField
              id="buyerKind"
              name="buyerKind"
              label={s('buyerKind')}
              options={[
                { value: 'other', label: 'Someone outside the school' },
                { value: 'student', label: 'A pupil' },
                { value: 'employee', label: 'A staff member' },
              ]}
            />
            <InputField id="buyerName" name="buyerName" label={s('buyerName')} maxLength={120} />
            <InputField id="buyerId" name="buyerId" label={s('buyerId')} pattern="\\d*" />
            <InputField
              id="price"
              name="price"
              label={s('price')}
              type="number"
              min={0}
              step="1"
              required
            />
            <InputField id="receiptRef" name="receiptRef" label={s('receiptRef')} maxLength={60} />
          </FormRow>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button type="submit" variant="secondary">
              {s('sell')}
            </Button>
          </div>
        </form>
        <DataTable<Sale>
          caption={s('sales')}
          density="dense"
          columns={[
            { key: 'd', header: s('soldOn'), render: (x) => x.soldOn },
            {
              key: 'a',
              header: s('accessionNo'),
              render: (x) => <strong>{x.accessionNo}</strong>,
            },
            { key: 't', header: s('title'), render: (x) => x.title },
            { key: 'b', header: s('buyer'), render: (x) => `${x.buyer ?? ''} (${x.buyerKind})` },
            { key: 'p', header: s('price'), numeric: true, render: (x) => `₹${x.price}` },
            { key: 'r', header: s('receiptRef'), render: (x) => x.receiptRef ?? '' },
          ]}
          rows={sales}
          rowKey={(x) => x.id}
          emptyTitle={s('noSales')}
        />
      </Card>
    </>
  );
}
