import { Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { ReceiptForm } from '@/components/purchase/ReceiptForm';
import { apiFetch, ApiError } from '@/lib/api';
import { inr, type ReceiptForm as Form } from '@/lib/purchase';

/** Record what came against a PO, or a service's work done (docs/design/84, part 7). */
export default async function NewReceiptPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const order = sp.order ?? '';
  if (!/^\d{1,18}$/.test(order)) notFound();
  const kind = sp.kind === 'service' ? 'service' : 'goods';
  let form: Form;
  try {
    form = await apiFetch<Form>(`/purchase/receipt-form/${order}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
  const title = kind === 'goods' ? 'Receive goods' : 'Record the work done';
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Purchase', href: '/purchase' },
          { label: 'Goods receipts', href: '/purchase/receipts' },
          { label: 'To receive', href: '/purchase/to-receive' },
          { label: title },
        ]}
      />
      <PageHeader
        kicker={`${form.order.label} · ${form.order.vendor}`}
        title={title}
        description={
          kind === 'goods'
            ? `Count what came against the order and record it as it is: refuse at the door what is damaged, wrong or more than ordered. It then goes for inspection to ${form.inspection === 'committee' ? `the purchase committee (the order is ${inr(form.order.total)}, above its limit)` : `${form.order.department ?? 'the department'}`}; only what is accepted enters the store.`
            : `Record the work the vendor has done; ${form.inspection === 'committee' ? 'the purchase committee' : (form.order.department ?? 'the department')} certifies it.`
        }
      />
      {form.madeByMe ? (
        <p className="ep-alert ep-alert--warning" role="status">
          You made this PO: someone else records what comes against it.
        </p>
      ) : (
        <ReceiptForm form={form} kind={kind} />
      )}
    </>
  );
}
