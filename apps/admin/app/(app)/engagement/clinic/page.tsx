import { Badge, Button, Card, DataTable, FormRow, InputField, PageHeader } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { clinicOut, recordClinicVisit } from '@/lib/actions';
import { apiFetch } from '@/lib/api';

interface Visit {
  id: string;
  student: string;
  admissionNo: string;
  inAt: string;
  outAt: string | null;
  complaint: string;
  treatment: string | null;
  temperatureC: string | null;
  referredTo: string | null;
  sentHome: boolean;
  notifiedAt: string | null;
  attendedBy: string | null;
}
const hm = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '';

/** Sprint 19: the clinic register. */
export default async function ClinicPage({
  searchParams,
}: {
  searchParams: Promise<{ onDate?: string; ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const [t, e, visits] = await Promise.all([
    getTranslations('pages.engagement_clinic'),
    getTranslations('eng19'),
    apiFetch<{ data: Visit[] }>(
      `/engagement/clinic${sp.onDate ? `?onDate=${sp.onDate}` : ''}`,
    ).then((x) => x.data),
  ]);
  return (
    <>
      <PageHeader
        kicker={t('kicker')}
        title={t('title')}
        description={t('description')}
        actions={
          <form
            method="get"
            style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'flex-end' }}
          >
            <InputField
              id="onDate"
              name="onDate"
              label={e('onDate')}
              type="date"
              defaultValue={sp.onDate ?? ''}
            />
            <Button type="submit" variant="secondary" size="sm">
              {e('show')}
            </Button>
          </form>
        }
      />
      <Notice params={sp} />
      <Card title={e('record')} style={{ marginBottom: 'var(--sp-4)' }}>
        <form action={recordClinicVisit}>
          <FormRow columns={4}>
            <InputField
              id="studentId"
              name="studentId"
              label={e('studentId')}
              required
              pattern="\\d+"
            />
            <InputField
              id="complaint"
              name="complaint"
              label={e('complaint')}
              required
              maxLength={300}
            />
            <InputField id="treatment" name="treatment" label={e('treatment')} maxLength={500} />
            <InputField
              id="temperatureC"
              name="temperatureC"
              label={e('temperature')}
              type="number"
              step="0.1"
              min={30}
              max={45}
            />
            <InputField id="referredTo" name="referredTo" label={e('referredTo')} maxLength={120} />
            <label
              style={{
                display: 'inline-flex',
                gap: 'var(--sp-1)',
                alignItems: 'center',
                alignSelf: 'end',
              }}
            >
              <input type="checkbox" name="sentHome" /> {e('sentHome')}
            </label>
            <label
              style={{
                display: 'inline-flex',
                gap: 'var(--sp-1)',
                alignItems: 'center',
                alignSelf: 'end',
              }}
            >
              <input type="checkbox" name="notify" defaultChecked /> {e('notify')}
            </label>
            <div style={{ alignSelf: 'end' }}>
              <Button type="submit">{e('record')}</Button>
            </div>
          </FormRow>
        </form>
      </Card>
      <Card>
        <DataTable<Visit>
          caption={`${t('title')} · ${visits.length}`}
          density="dense"
          columns={[
            {
              key: 's',
              header: e('student'),
              render: (v) => (
                <>
                  <strong>{v.student}</strong>
                  <div className="ep-kicker">{v.admissionNo}</div>
                </>
              ),
            },
            { key: 'i', header: e('inAt'), render: (v) => `${v.inAt.slice(0, 10)} ${hm(v.inAt)}` },
            {
              key: 'c',
              header: e('complaint'),
              render: (v) => (
                <>
                  {v.complaint}
                  {v.treatment ? <div className="ep-kicker">{v.treatment}</div> : null}
                </>
              ),
            },
            {
              key: 'tp',
              header: e('temperature'),
              numeric: true,
              render: (v) => v.temperatureC ?? '',
            },
            {
              key: 'f',
              header: e('status'),
              render: (v) => (
                <>
                  {v.sentHome ? <Badge tone="warning">{e('sentHome')}</Badge> : null}{' '}
                  {v.referredTo ? <Badge tone="info">{v.referredTo}</Badge> : null}{' '}
                  {v.notifiedAt ? <Badge tone="success">WhatsApp</Badge> : null}
                </>
              ),
            },
            {
              key: 'o',
              header: e('outAt'),
              render: (v) =>
                v.outAt ? (
                  hm(v.outAt)
                ) : (
                  <form action={clinicOut}>
                    <input type="hidden" name="id" value={v.id} />
                    <Button type="submit" size="sm" variant="ghost">
                      {e('closeVisit')}
                    </Button>
                  </form>
                ),
            },
          ]}
          rows={visits}
          rowKey={(v) => v.id}
          emptyTitle={e('noRows')}
        />
      </Card>
    </>
  );
}
