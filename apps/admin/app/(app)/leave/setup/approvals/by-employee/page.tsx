import { redirect } from 'next/navigation';

/** The old address of "Who approves · each employee": it is now the first page of Who approves. */
export default async function OldByEmployee({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (v) q.set(k, v);
  const s = q.toString();
  redirect(`/leave/setup/approvals${s ? `?${s}` : ''}`);
}
