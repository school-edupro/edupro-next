import { Badge, Button, Card, DataTable, FormRow, InputField, PageHeader } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { saveConsentForm, setConsentFormStatus } from '@/lib/actions';
import { apiFetch } from '@/lib/api';

interface Form {
  id: string;
  code: string;
  title: string;
  description: string | null;
  fields: unknown[];
  feeAmount: string | null;
  opensOn: string | null;
  closesOn: string | null;
  status: string;
  responses: number;
}
interface Response {
  id: string;
  student: string;
  admissionNo: string;
  answers: Record<string, unknown>;
  signedName: string;
  signedAt: string;
  paymentIntentId: string | null;
  paidAt: string | null;
}

/** Sprint 19: consent forms builder and responses. */
export default async function ConsentFormsPage({
  searchParams,
}: {
  searchParams: Promise<{
    form?: string;
    new?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  const [t, e, forms] = await Promise.all([
    getTranslations('pages.engagement_consent_forms'),
    getTranslations('eng19'),
    apiFetch<{ data: Form[] }>('/engagement/consent-forms').then((x) => x.data),
  ]);
  const current = sp.form ? (forms.find((f) => f.id === sp.form) ?? null) : null;
  const responses = current
    ? await apiFetch<{ data: Response[] }>(
        `/engagement/consent-forms/${current.id}/responses`,
      ).then((x) => x.data)
    : [];
  const editing = current ?? null;
  return (
    <>
      <PageHeader
        kicker={t('kicker')}
        title={t('title')}
        description={t('description')}
        actions={
          <a className="ep-btn ep-btn--primary ep-btn--sm" href="/engagement/consent-forms?new=1">
            ＋ {e('newForm')}
          </a>
        }
      />
      <Notice params={sp} />
      <div
        style={{
          display: 'grid',
          gap: 'var(--sp-5)',
          gridTemplateColumns: 'minmax(min(100%, 560px), 1fr) 1fr',
        }}
      >
        <Card title={t('title')}>
          <DataTable<Form>
            caption={t('title')}
            density="dense"
            columns={[
              {
                key: 't',
                header: e('title'),
                render: (f) => (
                  <a href={`/engagement/consent-forms?form=${f.id}`}>
                    <strong>{f.title}</strong>
                    <div className="ep-kicker">
                      {f.code}
                      {f.feeAmount ? ` · ₹${f.feeAmount}` : ''}
                    </div>
                  </a>
                ),
              },
              {
                key: 's',
                header: e('status'),
                render: (f) => (
                  <Badge
                    tone={
                      f.status === 'open'
                        ? 'success'
                        : f.status === 'closed'
                          ? 'neutral'
                          : 'warning'
                    }
                  >
                    {f.status}
                  </Badge>
                ),
              },
              { key: 'r', header: e('responses'), numeric: true, render: (f) => f.responses },
              {
                key: 'a',
                header: '',
                render: (f) => (
                  <form action={setConsentFormStatus}>
                    <input type="hidden" name="id" value={f.id} />
                    <input
                      type="hidden"
                      name="status"
                      value={f.status === 'open' ? 'closed' : 'open'}
                    />
                    <Button type="submit" size="sm" variant="ghost">
                      {f.status === 'open' ? e('close') : e('open')}
                    </Button>
                  </form>
                ),
              },
            ]}
            rows={forms}
            rowKey={(f) => f.id}
            emptyTitle={e('noRows')}
          />
        </Card>
        {sp.new || editing ? (
          <Card title={editing ? `${editing.title}` : e('newForm')}>
            <form action={saveConsentForm}>
              {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
              <FormRow columns={2}>
                <InputField
                  id="code"
                  name="code"
                  label={e('code')}
                  required={!editing}
                  defaultValue={editing?.code ?? ''}
                  readOnly={Boolean(editing)}
                  pattern="[a-z0-9_]{2,40}"
                />
                <InputField
                  id="title"
                  name="title"
                  label={e('title')}
                  required
                  defaultValue={editing?.title ?? ''}
                  maxLength={200}
                />
                <InputField
                  id="feeAmount"
                  name="feeAmount"
                  label={e('feeAmount')}
                  type="number"
                  min={0}
                  step="1"
                  defaultValue={editing?.feeAmount ?? ''}
                />
                <div />
                <InputField
                  id="opensOn"
                  name="opensOn"
                  label={e('opensOn')}
                  type="date"
                  defaultValue={editing?.opensOn ?? ''}
                />
                <InputField
                  id="closesOn"
                  name="closesOn"
                  label={e('closesOn')}
                  type="date"
                  defaultValue={editing?.closesOn ?? ''}
                />
              </FormRow>
              <label className="ep-field">
                <span className="ep-field__label">{e('description')}</span>
                <textarea
                  className="ep-input"
                  name="description"
                  rows={2}
                  defaultValue={editing?.description ?? ''}
                />
              </label>
              <label className="ep-field">
                <span className="ep-field__label">{e('fields')}</span>
                <textarea
                  className="ep-input"
                  name="fields"
                  rows={8}
                  required
                  defaultValue={editing ? JSON.stringify(editing.fields, null, 2) : ''}
                  spellCheck={false}
                />
              </label>
              <p className="ep-field__help">{e('fieldsHelp')}</p>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Button type="submit">{e('save')}</Button>
              </div>
            </form>
            {editing ? (
              <DataTable<Response>
                caption={e('responses')}
                density="dense"
                columns={[
                  {
                    key: 's',
                    header: e('student'),
                    render: (r) => (
                      <>
                        {r.student}
                        <div className="ep-kicker">{r.admissionNo}</div>
                      </>
                    ),
                  },
                  {
                    key: 'a',
                    header: e('answers'),
                    render: (r) =>
                      Object.entries(r.answers)
                        .map(([k, v]) => `${k}: ${String(v)}`)
                        .join(' · '),
                  },
                  {
                    key: 'b',
                    header: e('signedBy'),
                    render: (r) => `${r.signedName} · ${r.signedAt.slice(0, 16).replace('T', ' ')}`,
                  },
                  {
                    key: 'p',
                    header: e('paid'),
                    render: (r) =>
                      r.paymentIntentId ? (
                        <Badge tone={r.paidAt ? 'success' : 'warning'}>
                          {r.paidAt ? e('paid') : 'pending'}
                        </Badge>
                      ) : (
                        ''
                      ),
                  },
                ]}
                rows={responses}
                rowKey={(r) => r.id}
                emptyTitle={e('noRows')}
              />
            ) : null}
          </Card>
        ) : null}
      </div>
    </>
  );
}
