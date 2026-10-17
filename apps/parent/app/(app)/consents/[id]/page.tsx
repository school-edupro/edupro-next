import { Card, ConsentFill, PageHeader, type ConsentField } from '@edupro/ui';
import { ApiError } from '@edupro/bff';
import { notFound, redirect } from 'next/navigation';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import { respondConsent } from '../actions';

interface ToFill {
  id: string;
  title: string;
  description: string | null;
  fields: ConsentField[];
  lists: Record<string, string[]>;
  open: boolean;
  closedWhy: string | null;
  closesAt: string | null;
  about: { id: string; name: string; section: string | null } | null;
  responses: Array<{ id: string; number: string }>;
  canAnswer: boolean;
}

/** Answering one consent form for one child: the school's text, then the questions, step by step. */
export default async function ConsentFillPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ student?: string; error?: string; detail?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const lang = await currentLang();
  if (!/^\d+$/.test(id) || !/^\d+$/.test(sp.student ?? '')) notFound();
  let f: ToFill;
  try {
    f = await bff.api.fetch<ToFill>(`/engagement/mine/consent-forms/${id}?studentId=${sp.student}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
  const me = await bff.api.me().catch(() => null);
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: '48rem', margin: '0 auto' }}>
      <p style={{ margin: '0 0 var(--sp-2)' }}>
        <a href="/consents" style={{ textDecoration: 'underline' }}>
          ← {t(lang, 'Consent forms')}
        </a>
      </p>
      <PageHeader
        kicker={
          f.about ? `${f.about.name}${f.about.section ? ` · ${f.about.section}` : ''}` : 'EduPro'
        }
        title={f.title}
      />
      {sp.error ? (
        <p className="ep-alert ep-alert--danger" role="alert">
          {sp.detail || t(lang, 'That did not work. Please try again.')}
        </p>
      ) : null}
      {!f.canAnswer ? (
        <Card>
          {f.open
            ? `${t(lang, 'Already answered')}: ${f.responses.map((r) => r.number).join(', ')}`
            : `${t(lang, 'This form is closed')}${f.closedWhy ? ` (${f.closedWhy})` : ''}.`}
        </Card>
      ) : (
        <Card>
          <ConsentFill
            fields={f.fields}
            lists={f.lists}
            action={respondConsent}
            hidden={{ formId: id, studentId: sp.student! }}
            askName={{
              label: t(lang, 'Your name (as the parent signing)'),
              defaultValue: me?.user.displayName ?? '',
            }}
            submitLabel={t(lang, 'Submit')}
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
