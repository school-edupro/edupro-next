import { apiFetch } from './api';
import type { PaymentTerm } from './purchase';

/** What the vendor form picks from: payment terms and item categories (docs/design/83). */
export async function vendorFormLists() {
  const [terms, cats] = await Promise.all([
    apiFetch<{ data: PaymentTerm[] }>('/purchase/payment-terms').then((r) => r.data),
    apiFetch<{
      data: Array<{
        id: string;
        code: string;
        name: string;
        parent_id: string | null;
        status: string;
      }>;
    }>('/masters/purchase_item_categories/rows?status=active&size=500').then((r) => r.data),
  ]);
  return {
    terms: terms
      .filter((t) => t.status === 'active')
      .map((t) => ({ id: t.id, label: `${t.name} (${t.words})` })),
    categories: cats
      .filter((c) => !c.parent_id)
      .map((c) => ({ value: c.id, label: `${c.name} (${c.code})` })),
  };
}
