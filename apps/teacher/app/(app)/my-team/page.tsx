import { StaffLeavePage } from '../my-leave/LeavePage';
import { TeamPunches } from './TeamPunches';

/**
 * My team's attendance (docs/design/85, 99): the Employee Leave / Attendance page on Reporties Attendance; its
 * Punches view (every punch of my team as the machines brought them in) stays here.
 */
export default async function MyTeamPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  if (sp.tab === 'punches') return <TeamPunches sp={sp} />;
  return <StaffLeavePage searchParams={Promise.resolve(sp)} defaultTab="team-attendance" />;
}
