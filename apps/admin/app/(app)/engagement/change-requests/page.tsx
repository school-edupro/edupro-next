import { redirect } from 'next/navigation';

/** Replaced by the profile approvals inbox (routing, partial and bulk decisions, 2026-10-01). */
export default function ChangeRequestsPage() {
  redirect('/people/profile-approvals?box=all');
}
