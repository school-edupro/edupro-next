import { StaffLeavePage } from './LeavePage';

/** My leave (docs/design/85, 99): the Employee Leave / Attendance page, as the admin's, on My Leave. */
export default function MyLeavePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  return <StaffLeavePage searchParams={searchParams} defaultTab="leave" />;
}
