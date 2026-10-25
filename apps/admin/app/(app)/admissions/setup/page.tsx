import { PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { AdmissionSetupEditor } from '@/components/admissions/AdmissionSetupEditor';
import { EnquiryDeskEditor } from '@/components/admissions/EnquiryDeskEditor';
import { EnquirySourcesEditor } from '@/components/admissions/EnquirySourcesEditor';
import { ProcessEditor } from '@/components/admissions/ProcessEditor';
import { Notice } from '@/components/Notice';
import type { EnquiryMeta } from '@/lib/admission-enquiry';
import type { FormDetail, FormListRow } from '@/lib/admission-forms';
import type { ProcessSetup } from '@/lib/admission-process';
import type { AdmissionSetup } from '@/lib/admission-setup';
import { apiFetch, getMe } from '@/lib/api';
import type { CommsTemplate } from '@/lib/comms';

/** Admission set-up (docs/design/39): sign-in channels, receipt series, fee categories (and, part 4, stages). */
export default async function AdmissionSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string; tab?: string }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('admissions.cycle.view')) notFound();
  const [setup, forms, process] = await Promise.all([
    apiFetch<AdmissionSetup>('/admissions/setup'),
    apiFetch<{ data: FormListRow[] }>('/admissions/forms'),
    apiFetch<ProcessSetup>('/admissions/process-setup'),
  ]);
  // the automatic messages of online admission (their templates live in Communication)
  const templates = await apiFetch<{ data: CommsTemplate[] }>('/comms/templates')
    .then((r) => r.data.filter((t) => t.code.startsWith('admission_') && t.channel !== 'push'))
    .catch(() => [] as CommsTemplate[]);
  const WHEN: Record<string, string> = {
    admission_otp: 'Sign-in code',
    admission_received: 'Form submitted, registration fee due',
    admission_registered: 'Registered (form and receipt attached)',
    admission_correction: 'Sent back for correction',
    admission_schedule: 'Test or interview scheduled',
    admission_result: 'Not selected, or on the waiting list',
    admission_offer: 'Admission offered with the fee and last date',
    admission_fee_paid: 'Admission fee received',
    admission_admitted: 'Admitted',
    admission_cancelled: 'Admission cancelled',
    admission_message: 'Other messages',
  };
  const enquiryMeta = me.permissions.includes('admissions.enquiry.manage')
    ? await apiFetch<EnquiryMeta>('/admissions/enquiries/meta').catch(() => null)
    : null;
  const sources = enquiryMeta?.sources ?? null;
  const byCode = new Map<string, CommsTemplate[]>();
  for (const t of templates) byCode.set(t.code, [...(byCode.get(t.code) ?? []), t]);
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
        description="How candidates sign in, the receipt series of registration and admission fees, the fee categories decided from the form's answers, and the stages and approval process each class follows."
      />
      <Notice params={sp} />
      <AdmissionSetupEditor
        setup={setup}
        formFields={[...fields.entries()].map(([key, label]) => ({ key, label }))}
        canEdit={me.permissions.includes('admissions.setup.manage')}
      />
      <div style={{ marginTop: 'var(--sp-4)' }}>
        <ProcessEditor
          setup={process}
          canEdit={me.permissions.includes('admissions.setup.manage')}
        />
      </div>
      {enquiryMeta?.desk ? (
        <div style={{ marginTop: 'var(--sp-4)' }}>
          <EnquiryDeskEditor
            initial={enquiryMeta.desk}
            counsellors={enquiryMeta.counsellors}
            canEdit={me.permissions.includes('admissions.setup.manage')}
          />
        </div>
      ) : null}
      {sources ? (
        <div style={{ marginTop: 'var(--sp-4)' }}>
          <EnquirySourcesEditor
            initial={sources}
            canEdit={me.permissions.includes('admissions.setup.manage')}
          />
        </div>
      ) : null}
      <section
        className="ep-card ep-as__card"
        aria-labelledby="as-mails"
        style={{ marginTop: 'var(--sp-4)' }}
      >
        <h2 id="as-mails" className="ep-as__h">
          Automatic messages
        </h2>
        <p className="ep-field__help" style={{ margin: 0 }}>
          Sent to the family by themselves at each step, and kept in their admission portal under
          Messages. The email goes always; SMS and WhatsApp go when the template is approved. Edit
          the wording in Communication.
        </p>
        {byCode.size === 0 ? (
          <p style={{ margin: 0 }}>The templates are made with the first registration.</p>
        ) : (
          <div className="ep-table-wrap">
            <table className="ep-table">
              <caption className="ep-sr-only">Automatic messages</caption>
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Templates</th>
                </tr>
              </thead>
              <tbody>
                {[...byCode.entries()].map(([code, list]) => (
                  <tr key={code}>
                    <td>{WHEN[code] ?? code}</td>
                    <td>
                      <span
                        style={{ display: 'inline-flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}
                      >
                        {list.map((t) => (
                          <a key={t.id} href={`/comms/templates/${t.id}`}>
                            {t.channel === 'email'
                              ? 'Email'
                              : t.channel === 'sms'
                                ? 'SMS'
                                : 'WhatsApp'}
                          </a>
                        ))}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
