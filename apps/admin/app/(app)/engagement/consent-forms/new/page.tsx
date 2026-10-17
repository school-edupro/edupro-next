import { Breadcrumbs, PageHeader } from '@edupro/ui';
import { Notice } from '@/components/Notice';
import {
  ConsentBuilder,
  type BuilderLists,
  type ConsentDraft,
} from '@/components/consents/ConsentBuilder';
import { saveConsentForm } from '@/lib/consent-actions';
import { apiFetch } from '@/lib/api';

const BLANK: ConsentDraft = {
  title: '',
  description: '',
  respondents: 'family',
  fields: [{ key: 'agree', label: 'I give my consent', type: 'agree', required: true }],
  audience: {
    pupils: 'all',
    classIds: [],
    sectionIds: [],
    houses: [],
    routeIds: [],
    boarders: false,
    studentIds: [],
    admissionNos: [],
    staff: 'all',
    departments: [],
    designations: [],
    employeeIds: [],
    employeeCodes: [],
  },
  settings: { repeat: 'once', officeFill: true },
};

/** A new consent form: the builder, saved as a draft. */
export default async function NewConsentFormPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const lists = await apiFetch<BuilderLists>('/engagement/consent-forms/lists');
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Consent forms', href: '/engagement/consent-forms' },
          { label: 'New form' },
        ]}
      />
      <PageHeader
        kicker="Consent forms"
        title="New form"
        description="Saved as a draft: nobody sees it until you publish it."
      />
      <Notice params={sp} />
      <ConsentBuilder
        initial={BLANK}
        answered={[]}
        lists={lists}
        action={saveConsentForm}
        submitLabel="Save draft"
      />
    </>
  );
}
