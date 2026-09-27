import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
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
        <main style={{ padding: 'var(--sp-4)', maxWidth: 820, margin: '0 auto' }}>{children}</main>
      </body>
    </html>
  );
}
