import { redirect } from 'next/navigation';

/** The hostel's gate form is now part of Visitors → Register a visitor (one visitor register). */
export default async function HostelVisitGatePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; student?: string }>;
}) {
  const sp = await searchParams;
  const qs = new URLSearchParams({ kind: 'hostel' });
  if (sp.q) qs.set('q', sp.q.slice(0, 60));
  if (/^\d{1,18}$/.test(sp.student ?? '')) qs.set('student', sp.student!);
  redirect(`/engagement/visitors/new?${qs.toString()}`);
}
