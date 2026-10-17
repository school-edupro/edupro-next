import { Card, ConsentFill, PageHeader, type ConsentField } from '@edupro/ui';
import { ApiError } from '@edupro/bff';
import { notFound, redirect } from 'next/navigation';
import { bff } from '@/lib/bff';
import { respondConsent } from '../actions';

interface ToFill {
  id: string;
  title: string;
  description: string | null;
  fields: ConsentField[];
  lists: Record<string, string[]>;
  open: boolean;
  closedWhy: string | null;
  responses: Array<{ id: string; number: string }>;
  canAnswer: boolean;
}

/** A staff member answers one form for themself. */
export default async function StaffConsentFillPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; detail?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d+$/.test(id)) notFound();
  let f: ToFill;
  try {
    f = await bff.api.fetch<ToFill>(`/engagement/mine/consent-forms/${id}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
  const me = await bff.api.me().catch(() => null);
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: '52rem', margin: '0 auto' }}>
      <p style={{ margin: '0 0 var(--sp-2)' }}>
        <a href="/consents" style={{ textDecoration: 'underline' }}>
          ← Forms and declarations
        </a>
      </p>
      <PageHeader kicker="EduPro staff" title={f.title} />
      {sp.error ? (
        <p className="ep-alert ep-alert--danger" role="alert">
          {sp.detail || 'That did not work. Please try again.'}
        </p>
      ) : null}
      {!f.canAnswer ? (
        <Card>
          {f.open
            ? `Already answered: ${f.responses.map((r) => r.number).join(', ')}`
            : `This form is closed${f.closedWhy ? ` (${f.closedWhy})` : ''}.`}
        </Card>
      ) : (
        <Card>
          <ConsentFill
            fields={f.fields}
            lists={f.lists}
            action={respondConsent}
            hidden={{ formId: id }}
            askName={{ label: 'Your name', defaultValue: me?.user.displayName ?? '' }}
            intro={
              f.description ? (
                <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{f.description}</p>
              ) : undefined
            }
          />
        </Card>
      )}
    </main>
  );
}
