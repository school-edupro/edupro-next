import { Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { CondemnationForm } from '@/components/purchase/CondemnationForm';
import { apiFetch, ApiError } from '@/lib/api';
import type { CondemnationCandidates, CondemnationDetail } from '@/lib/purchase';

/** A draft condemnation changed. */
export default async function EditCondemnationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!/^\d{1,18}$/.test(id)) notFound();
  let lists: CondemnationCandidates;
  let k: CondemnationDetail;
  try {
    [lists, k] = await Promise.all([
      apiFetch<CondemnationCandidates>('/purchase/condemnation-candidates'),
      apiFetch<CondemnationDetail>(`/purchase/condemnations/${id}`),
    ]);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 403 || e.status === 404)) notFound();
    throw e;
  }
  if (!k.can.edit) notFound();
  // the proposal's own assets are on it already: offer them too
  const own = k.lineItems
    .filter((l) => l.kind === 'asset' && l.assetId)
    .map((l) => ({
      id: l.assetId!,
      tag: l.tag ?? '',
      item: l.item,
      status: '',
      condition: '',
      bookValue: l.bookValue,
      place: l.store,
    }));
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Purchase', href: '/purchase' },
          { label: 'Condemnation', href: '/purchase/condemnations' },
          { label: k.number, href: `/purchase/condemnations/${k.id}` },
          { label: 'Change' },
        ]}
      />
      <PageHeader kicker="Purchase · Condemnation" title={`Change ${k.number}`} />
      <CondemnationForm lists={{ ...lists, assets: [...own, ...lists.assets] }} existing={k} />
    </>
  );
}
