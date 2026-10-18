import { redirect } from 'next/navigation';

/** Hypercare issues are tickets to the ERP provider now (helpdesk); they live under Queries → My requests. */
export default function IssuesPage() {
  redirect('/queries?tab=mine');
}
