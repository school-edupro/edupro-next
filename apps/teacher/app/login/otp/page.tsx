import { Card, OtpCodeForm } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { bff } from '@/lib/bff';

/** Sign-in with a code by email (0136): the 6-digit code, after the email or mobile, or after One Auth. */
export default async function OtpPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; resent?: string }>;
}) {
  const sp = await searchParams;
  const pending = await bff.otp.pending.read();
  if (!pending) redirect('/login');
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        background: 'var(--surface-band)',
        padding: 'var(--sp-5)',
      }}
    >
      <Card elevated style={{ width: '100%', maxWidth: '420px' }}>
        <div className="ep-kicker">Mobilise</div>
        <h1 className="ep-page-title" style={{ marginBottom: 'var(--sp-3)' }}>
          EduPro Teacher
        </h1>
        <OtpCodeForm
          sentTo={pending.sentTo}
          screenCode={pending.screenCode}
          secondFactor={pending.purpose === 'second_factor'}
          error={sp.error}
          resent={sp.resent === '1'}
        />
      </Card>
    </main>
  );
}
