import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { SearchableSelects } from '@edupro/ui';
import '@edupro/ui/tokens.css';
import '@edupro/ui/app.css';

export const metadata: Metadata = {
  title: 'EduPro Admissions',
  description: 'Online admission application',
};

export const viewport: Viewport = { themeColor: '#00265D', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ background: 'var(--surface-page)' }}>
        <SearchableSelects />
        {/* a school's pages bring its frame (app/[school]/layout.tsx); the home page its own main */}
        {children}
      </body>
    </html>
  );
}
