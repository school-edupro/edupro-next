import { StaffLeavePage } from '../my-leave/LeavePage';

/** My attendance (docs/design/85, 99): the Employee Leave / Attendance page on My Attendance. */
export default function MyAttendancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  return <StaffLeavePage searchParams={searchParams} defaultTab="attendance" />;
}
