import { Breadcrumbs, Button, Card, InputField, PageHeader, SelectField } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { HostelComplaintForm } from '@/components/hostel/HostelComplaintForm';
import { apiFetch } from '@/lib/api';
import { DESK_LABEL, PRIORITY_LABEL } from '@/lib/helpdesk';
import { raiseTicket } from '@/lib/helpdesk-actions';

const MODULES = [
  'admissions',
  'students',
  'attendance',
  'academics',
  'exams',
  'fees',
  'transport',
  'library',
  'communication',
  'helpdesk',
  'payroll',
  'reports',
  'parent app',
  'teacher app',
  'other',
];

/**
 * Raise a staff query or a ticket to the ERP provider, with attachments; or a hostel complaint with the
 * shared hostel complaint form (the same as on Hostel → Complaints).
 */
export default async function RaisePage({
  params,
  searchParams,
}: {
  params: Promise<{ desk: string }>;
  searchParams: Promise<{ hostel?: string; error?: string; detail?: string }>;
}) {
  const { desk } = await params;
  if (desk !== 'staff' && desk !== 'provider' && desk !== 'hostel') notFound();
  const sp = await searchParams;
  if (desk === 'hostel')
    return (
      <>
        <Breadcrumbs
          items={[
            { label: 'Helpdesk', href: '/engagement/helpdesk' },
            {
              label: DESK_LABEL.hostel ?? 'Hostel complaints',
              href: '/engagement/helpdesk/hostel',
            },
            { label: 'New' },
          ]}
        />
        <PageHeader
          kicker="Helpdesk"
          title="Raise a hostel complaint"
          description="About a room of a hostel, a boarder, or both. It goes to the head warden of that hostel, or to the owner set for the complaint type; you are told when it is answered."
        />
        <Notice params={sp} />
        <Card>
          <HostelComplaintForm hostelId={sp.hostel} pickerPath="/engagement/helpdesk/hostel/new" />
        </Card>
      </>
    );
  const heads = await apiFetch<{
    data: Array<{ code: string; name: string; description: string }>;
  }>(`/helpdesk/heads/${desk}`);
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Helpdesk', href: '/engagement/helpdesk' },
          { label: DESK_LABEL[desk], href: `/engagement/helpdesk/${desk}` },
          { label: 'New' },
        ]}
      />
      <PageHeader
        kicker="Helpdesk"
        title={desk === 'provider' ? 'Raise a ticket to the ERP provider' : 'Raise a staff query'}
        description={
          desk === 'provider'
            ? 'Describe what happened and attach screenshots. The provider replies here and you are told by mail.'
            : 'It goes to the person or role that handles this type of query; you are told when it is answered.'
        }
      />
      <Notice params={sp} />
      <Card>
        <form action={raiseTicket} className="ep-hd__form">
          <input type="hidden" name="desk" value={desk} />
          <SelectField
            id="categoryCode"
            name="categoryCode"
            label="Query type"
            required
            options={[
              { value: '', label: 'Choose…' },
              ...heads.data.map((h) => ({ value: h.code, label: h.name })),
            ]}
          />
          {desk === 'provider' ? (
            <div className="ep-hd__row">
              <SelectField
                id="priority"
                name="priority"
                label="Priority"
                defaultValue="normal"
                options={['urgent', 'high', 'normal', 'low'].map((p) => ({
                  value: p,
                  label: PRIORITY_LABEL[p]!,
                }))}
              />
              <SelectField
                id="module"
                name="module"
                label="ERP module"
                options={[
                  { value: '', label: '—' },
                  ...MODULES.map((m) => ({ value: m, label: m[0]!.toUpperCase() + m.slice(1) })),
                ]}
              />
            </div>
          ) : null}
          <InputField
            id="subject"
            name="subject"
            label="Subject"
            required
            minLength={3}
            maxLength={200}
          />
          <label className="ep-field" htmlFor="body">
            <span className="ep-field__label">Details</span>
            <textarea
              id="body"
              name="body"
              className="ep-input"
              rows={6}
              required
              minLength={3}
              maxLength={5000}
            />
          </label>
          <label className="ep-field" htmlFor="files">
            <span className="ep-field__label">Attachments (optional)</span>
            <input
              id="files"
              name="files"
              type="file"
              className="ep-input"
              multiple
              accept="application/pdf,image/png,image/jpeg,image/webp"
            />
            <span className="ep-field__help">PDF or images, up to 5 files of 5 MB each.</span>
          </label>
          <div>
            <Button type="submit">{desk === 'provider' ? 'Raise ticket' : 'Raise query'}</Button>
          </div>
        </form>
      </Card>
    </>
  );
}
