import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '@edupro/ui/tokens.css';
import '@edupro/ui/app.css';

export const metadata: Metadata = {
  title: 'EduPro Next',
  description: 'Multi-school, multi-year School ERP by Mobilise',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
