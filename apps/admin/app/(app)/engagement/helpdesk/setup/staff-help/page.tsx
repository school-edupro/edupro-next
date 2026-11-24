import { HelpEditor } from '../family-help/HelpEditor';

/**
 * Help for staff (Helpdesk set-up, 0422): the headings and questions every staff member sees on Help, in the staff
 * app and on the staff website.
 */
export default async function StaffHelpPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  return <HelpEditor app="staff" sp={await searchParams} />;
}
