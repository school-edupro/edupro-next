import type { ReactNode } from 'react';
import { SchoolFrame } from '@/components/SchoolFrame';
import { schoolProfile } from '@/lib/school';

/** The school's website pages (careers, appointments, visitors, consent, passes) in its frame. */
export default async function SchoolSiteLayout({
  params,
  children,
}: {
  params: Promise<{ school: string }>;
  children: ReactNode;
}) {
  return <SchoolFrame school={await schoolProfile((await params).school)}>{children}</SchoolFrame>;
}
