import { Breadcrumbs, PageHeader } from '@edupro/ui';
import { Notice } from '@/components/Notice';
import { ConsentBuilder, type BuilderLists } from '@/components/consents/ConsentBuilder';
import type { ConsentForm } from '@/components/consents/types';
import { saveConsentForm } from '@/lib/consent-actions';
import { apiFetch } from '@/lib/api';

/** Changing a form: anything while it is a draft; once answered, only additions and wording. */
export default async function EditConsentFormPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const [f, lists] = await Promise.all([
    apiFetch<ConsentForm>(`/engagement/consent-forms/${id}`),
    apiFetch<BuilderLists>('/engagement/consent-forms/lists'),
  ]);
  // once answered, every question in the form keeps its key and type (the API checks it too)
  const withAnswers =
    f.responses > 0
      ? f.fields.filter((x) => !['heading', 'pagebreak'].includes(x.type)).map((x) => x.key)
      : [];
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Consent forms', href: '/engagement/consent-forms' },
          { label: f.title, href: `/engagement/consent-forms/${id}` },
          { label: 'Change' },
        ]}
      />
      <PageHeader kicker="Consent forms" title={`Change: ${f.title}`} />
      <Notice
        params={{
          ...sp,
          detail: sp.ok === 'copied' ? 'A copy was made as a new draft.' : sp.detail,
        }}
      />
      <ConsentBuilder
        initial={{
          title: f.title,
          description: f.description ?? '',
          respondents: f.respondents,
          fields: f.fields,
          audience: f.audience,
          settings: f.settings,
        }}
        answered={withAnswers}
        lists={lists}
        action={async (fd: FormData) => {
          'use server';
          fd.set('id', id);
          await saveConsentForm(fd);
        }}
        submitLabel="Save changes"
      />
    </>
  );
}
