import { PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { AdmissionSetupEditor } from '@/components/admissions/AdmissionSetupEditor';
import { Notice } from '@/components/Notice';
import type { FormDetail, FormListRow } from '@/lib/admission-forms';
import type { AdmissionSetup } from '@/lib/admission-setup';
import { apiFetch, getMe } from '@/lib/api';

/** Admission set-up (docs/design/39): sign-in channels, receipt series, fee categories (and, part 4, stages). */
export default async function AdmissionSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string; tab?: string }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('admissions.cycle.view')) notFound();
  const [setup, forms] = await Promise.all([
    apiFetch<AdmissionSetup>('/admissions/setup'),
    apiFetch<{ data: FormListRow[] }>('/admissions/forms'),
  ]);
  const details = await Promise.all(
    forms.data
      .filter((f) => f.status === 'active')
      .slice(0, 12)
      .map((f) => apiFetch<FormDetail>(`/admissions/forms/${f.id}`)),
  );
  const fields = new Map<string, string>();
  for (const f of details)
    for (const x of f.def.fields)
      if (
        !['heading', 'note', 'file', 'photo', 'agree', 'address_same'].includes(x.type) &&
        !fields.has(x.key)
      )
        fields.set(x.key, x.label);
  return (
    <>
      <PageHeader
        kicker="Admissions"
        title="Admission set-up"
        description="How candidates sign in, the receipt series of registration and admission fees, and the fee categories decided from the form's answers."
      />
      <Notice params={sp} />
      <AdmissionSetupEditor
        setup={setup}
        formFields={[...fields.entries()].map(([key, label]) => ({ key, label }))}
        canEdit={me.permissions.includes('admissions.setup.manage')}
      />
    </>
  );
}
