import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { schoolProfile } from '@/lib/school';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ school: string }>;
}): Promise<Metadata> {
  const s = await schoolProfile((await params).school);
  return s ? { title: { default: s.name, template: `%s · ${s.name}` } } : {};
}

/**
 * A school's pages: the website ones (careers, appointments, visitors, consent, passes) sit in the
 * school's frame through `(site)/layout.tsx`; the admission portal brings its own (docs/design/42).
 */
export default function SchoolLayout({ children }: { children: ReactNode }) {
  return children;
}
