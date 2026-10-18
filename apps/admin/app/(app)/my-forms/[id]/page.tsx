import { Breadcrumbs, Card, ConsentFill, PageHeader, type ConsentField } from '@edupro/ui';
import { Notice } from '@/components/Notice';
import { answerMyForm, changeMyForm } from '@/lib/consent-actions';
import { apiFetch, getMe } from '@/lib/api';

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
  editing: {
    id: string;
    number: string;
    answers: Record<string, string | number | boolean | string[] | null>;
    signedName: string | null;
    signed: string[] | null;
  } | null;
  canEdit: boolean;
}

/** A staff member answers (or changes) one of their forms in the admin app. */
export default async function MyFormPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ response?: string; error?: string; detail?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const resp = /^\d+$/.test(sp.response ?? '') ? `?responseId=${sp.response}` : '';
  const [f, me] = await Promise.all([
    apiFetch<ToFill>(`/engagement/mine/consent-forms/${id}${resp}`),
    getMe(),
  ]);
  const intro = f.description ? (
    <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{f.description}</p>
  ) : undefined;
  return (
    <>
      <Breadcrumbs items={[{ label: 'My forms', href: '/my-forms' }, { label: f.title }]} />
      <PageHeader kicker="My forms" title={f.title} />
      <Notice params={sp} />
      {f.editing ? (
        f.canEdit ? (
          <Card title={`Change your answer ${f.editing.number}`}>
            <ConsentFill
              fields={f.fields}
              lists={f.lists}
              action={changeMyForm}
              hidden={{ formId: id, responseId: f.editing.id }}
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
              askName={{
                label: 'Your name',
                defaultValue: f.editing.signedName ?? me.user.displayName,
              }}
              submitLabel="Save the change"
            />
          </Card>
        ) : (
          <Card>This answer can no longer be changed.</Card>
        )
      ) : f.canAnswer ? (
        <Card>
          <ConsentFill
            fields={f.fields}
            lists={f.lists}
            action={answerMyForm}
            hidden={{ formId: id }}
            askName={{ label: 'Your name', defaultValue: me.user.displayName }}
            intro={intro}
          />
        </Card>
      ) : (
        <Card>
          {f.open
            ? `Already answered: ${f.responses.map((r) => r.number).join(', ')}`
            : `This form is closed${f.closedWhy ? ` (${f.closedWhy})` : ''}.`}
        </Card>
      )}
    </>
  );
}
