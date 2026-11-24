import { HelpEditor } from './HelpEditor';

/**
 * Help for families (Helpdesk set-up, 0406): the headings and questions parents and students see on Help, in the
 * app and on the website.
 */
export default async function FamilyHelpPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  return <HelpEditor app="family" sp={await searchParams} />;
}
