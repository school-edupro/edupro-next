import type { VendorLists } from '@/components/purchase/VendorForm';
import { apiFetch, getMe } from './api';
import type { PaymentTerm } from './purchase';

/**
 * What the vendor form picks from (docs/design/83): payment terms, item categories, and from the
 * school's masters the countries, states, cities and banks, with the code a new vendor gets now.
 */
export async function vendorFormLists(): Promise<VendorLists> {
  const [terms, cats, places, me] = await Promise.all([
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
    apiFetch<Omit<VendorLists, 'terms' | 'categories' | 'links'>>('/purchase/vendors/form-lists'),
    getMe(),
  ]);
  return {
    ...places,
    // a missing city or bank is added in its master (a new tab), for those who keep it
    links: {
      cities: me.permissions.includes('platform.settings.edit'),
      banks: me.permissions.includes('fees.master.manage'),
    },
    terms: terms
      .filter((t) => t.status === 'active')
      .map((t) => ({ id: t.id, label: `${t.name} (${t.words})` })),
    categories: cats
      .filter((c) => !c.parent_id)
      .map((c) => ({ value: c.id, label: `${c.name} (${c.code})` })),
  };
}
