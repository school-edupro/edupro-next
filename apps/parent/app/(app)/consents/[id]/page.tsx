import { Card, ConsentFill, PageHeader, type ConsentFee, type ConsentField } from '@edupro/ui';
import { ApiError } from '@edupro/bff';
import { notFound, redirect } from 'next/navigation';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import { editConsent, respondConsent } from '../actions';

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
  fee: ConsentFee;
  approval: boolean;
  editUntil: string | null;
  editing: {
    id: string;
    number: string;
    answers: Record<string, string | number | boolean | string[] | null>;
    signedName: string | null;
    signed: string[] | null;
  } | null;
  canEdit: boolean;
}

/** Answering one consent form for one child: the school's text, then the questions, step by step. */
export default async function ConsentFillPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ student?: string; response?: string; error?: string; detail?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const lang = await currentLang();
  if (!/^\d+$/.test(id) || !/^\d+$/.test(sp.student ?? '')) notFound();
  let f: ToFill;
  try {
    const response = /^\d+$/.test(sp.response ?? '') ? `&responseId=${sp.response}` : '';
    f = await bff.api.fetch<ToFill>(
      `/engagement/mine/consent-forms/${id}?studentId=${sp.student}${response}`,
    );
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
      {f.editing ? (
        f.canEdit ? (
          <Card title={`${t(lang, 'Change your answer')} ${f.editing.number}`}>
            <ConsentFill
              fields={f.fields}
              lists={f.lists}
              action={editConsent}
              hidden={{ formId: id, studentId: sp.student!, responseId: f.editing.id }}
              initial={Object.fromEntries(
                Object.entries(f.editing.answers).filter(
                  ([k]) =>
                    !['signature', 'file'].includes(f.fields.find((x) => x.key === k)?.type ?? ''),
                ),
              )}
              keep={{
                signatures: f.editing.signed ?? [],
                files: f.fields
                  .filter((x) => x.type === 'file' && Array.isArray(f.editing!.answers[x.key]))
                  .map((x) => x.key),
              }}
              fee={f.fee}
              feeNote={f.approval ? t(lang, 'to pay after the school approves') : undefined}
              askName={{
                label: t(lang, 'Your name (as the parent signing)'),
                defaultValue: f.editing.signedName ?? me?.user.displayName ?? '',
              }}
              submitLabel={t(lang, 'Save the change')}
            />
          </Card>
        ) : (
          <Card>{t(lang, 'This answer can no longer be changed.')}</Card>
        )
      ) : !f.canAnswer ? (
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
            fee={f.fee}
            feeNote={
              f.approval
                ? t(lang, 'to pay after the school approves')
                : t(lang, 'due once you submit')
            }
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
