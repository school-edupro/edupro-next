import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '@edupro/ui/tokens.css';
import '@edupro/ui/app.css';

export const metadata: Metadata = {
  title: 'EduPro Next',
  description: 'Multi-school, multi-year School ERP by Mobilise',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  // suppressHydrationWarning: browser extensions add attributes to <html> before React hydrates, which
  // otherwise raises a hydration mismatch in development. Only this element is affected.
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
