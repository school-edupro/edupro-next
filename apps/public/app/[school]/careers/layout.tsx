import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Careers',
  description: 'Open posts and online application',
};

export default function CareersLayout({ children }: { children: ReactNode }) {
  return children;
}
