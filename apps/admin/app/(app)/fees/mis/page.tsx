import { redirect } from 'next/navigation';

/** The MIS reports live in the Reports centre now; an old address opens the same report there. */
export default async function FeeMisPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (v) q.set(k, v);
  redirect(`/fees/reports${q.size ? `?${q.toString()}` : ''}`);
}
