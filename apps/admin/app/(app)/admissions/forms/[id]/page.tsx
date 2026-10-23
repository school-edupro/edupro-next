import { Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { FormBuilder } from '@/components/admissions/FormBuilder';
import { Notice } from '@/components/Notice';
import type { FormDetail, FormMeta } from '@/lib/admission-forms';
import { ApiError, apiFetch, getMe } from '@/lib/api';

/** The form builder: tabs, fields, rules, mapping to the student master, and a live preview. */
export default async function AdmissionFormPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const [{ id }, sp, me] = await Promise.all([params, searchParams, getMe()]);
  if (!me.permissions.includes('admissions.cycle.view') || !/^\d{1,18}$/.test(id)) notFound();
  let form: FormDetail;
  try {
    form = await apiFetch<FormDetail>(`/admissions/forms/${id}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
  const meta = await apiFetch<FormMeta>('/admissions/forms/meta');
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Admissions', href: '/admissions' },
          { label: 'Registration forms', href: '/admissions/forms' },
          { label: form.name },
        ]}
      />
      <PageHeader
        kicker="Registration form"
        title={form.name}
        description={
          form.usedBy.length
            ? `Used by ${form.usedBy.map((u) => `${u.className} (${u.cycle})`).join(', ')}. Changes apply to new registrations; forms already filled keep their version.`
            : 'Not given to any class yet: assign it in the admission session.'
        }
      />
      <Notice params={sp} />
      <FormBuilder
        form={form}
        meta={meta}
        canEdit={me.permissions.includes('admissions.cycle.manage')}
      />
    </>
  );
}
