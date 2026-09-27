import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import '@edupro/ui/tokens.css';
import '@edupro/ui/app.css';
import { RegisterSw } from '@/components/RegisterSw';

export const metadata: Metadata = {
  title: 'EduPro Parent',
  description: 'EduPro Parent app by Mobilise',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'EduPro' },
  icons: { icon: '/icons/icon.svg', apple: '/icons/icon.svg' },
};

export const viewport: Viewport = {
  themeColor: '#00265D',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body style={{ background: 'var(--surface-page)' }}>
        <RegisterSw />
        {children}
      </body>
    </html>
  );
}
