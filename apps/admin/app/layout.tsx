import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale } from 'next-intl/server';
import type { ReactNode } from 'react';
import '@edupro/ui/tokens.css';
import '@edupro/ui/app.css';

export const metadata: Metadata = {
  title: 'EduPro Next',
  description: 'Multi-school, multi-year School ERP by Mobilise',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  // suppressHydrationWarning: browser extensions add attributes to <html> before React hydrates, which
  // otherwise raises a hydration mismatch in development. Only this element is affected.
  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        {locale === 'hi' ? (
          <link
            rel="stylesheet"
            href="https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@400;600&display=swap"
          />
        ) : null}
      </head>
      <body data-locale={locale}>
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
