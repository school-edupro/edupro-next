import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { SchoolFrame } from '@/components/SchoolFrame';
import { schoolProfile } from '@/lib/school';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ school: string }>;
}): Promise<Metadata> {
  const s = await schoolProfile((await params).school);
  return s ? { title: { default: s.name, template: `%s · ${s.name}` } } : {};
}

/** Every page of a school (admissions, careers, appointments, visitors, consent, passes) in its frame. */
export default async function SchoolLayout({
  params,
  children,
}: {
  params: Promise<{ school: string }>;
  children: ReactNode;
}) {
  return <SchoolFrame school={await schoolProfile((await params).school)}>{children}</SchoolFrame>;
}
