import { redirect } from 'next/navigation';

/** My attendance is a tab of My leave (Employee Leave / Attendance). */
export default async function MyAttendancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const month = sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? `&month=${sp.month}` : '';
  redirect(`/leave?tab=attendance${month}`);
}
