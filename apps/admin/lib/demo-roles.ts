/** Developer sign-in subjects created by `pnpm --filter @edupro/db seed:demo` (development bypass only). */
export const DEMO_ROLES: Array<{ sub: string; label: string }> = [
  { sub: 'dev-admin', label: 'School Admin (both schools)' },
  { sub: 'dev-group', label: 'Group Admin (both schools, may impersonate)' },
  { sub: 'dev-principal', label: 'Principal (School Admin, Alpha)' },
  { sub: 'dev-coordinator', label: 'Academic Coordinator (Alpha)' },
  { sub: 'dev-teacher', label: 'Class Teacher of VI-A (scoped)' },
  { sub: 'dev-subject', label: 'Subject Teacher VI-A and VI-B (scoped)' },
  { sub: 'dev-auditor', label: 'Auditor (read-only, audit export)' },
  { sub: 'dev-support', label: 'Support Engineer' },
  { sub: 'dev-clerk', label: 'Front Office (school role)' },
  { sub: 'dev-accounts', label: 'Accountant (fee masters and demands)' },
  { sub: 'dev-parent', label: 'Parent (guardian of two children)' },
  { sub: 'dev-student', label: 'Student (VI-A)' },
  { sub: 'dev-nobody', label: 'Member with no roles' },
];
