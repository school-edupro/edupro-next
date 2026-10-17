import { Badge, Breadcrumbs, Card, PageHeader } from '@edupro/ui';
import { FileLinks } from '@/components/FileLinks';
import { Notice } from '@/components/Notice';
import { type ConsentAnswered, type ConsentForm } from '@/components/consents/types';
import { apiFetch } from '@/lib/api';

type Full = ConsentAnswered & {
  files: Array<{ fileId: string; name: string | null }>;
  signed: string[] | null;
};
const BY = {
  family: 'the family',
  staff: 'the staff member',
  office: 'the school office',
  public: 'the public link',
} as const;

/** One response in full: every answer, the signature, the files, and its PDF copy. */
export default async function ConsentResponsePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; rid: string }>;
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const { id, rid } = await params;
  const sp = await searchParams;
  const [f, r] = await Promise.all([
    apiFetch<ConsentForm>(`/engagement/consent-forms/${id}`),
    apiFetch<Full>(`/engagement/consent-forms/${id}/responses/${rid}`),
  ]);
  const text = (v: unknown, type: string) => {
    if (v === undefined || v === null || v === '') return '—';
    if (type === 'yesno') return v === true ? 'Yes' : 'No';
    if (type === 'agree') return v === true ? 'Agreed' : '—';
    return Array.isArray(v) ? v.join(', ') : String(v);
  };
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Consent forms', href: '/engagement/consent-forms' },
          { label: f.title, href: `/engagement/consent-forms/${id}` },
          { label: r.number ?? 'Response' },
        ]}
      />
      <PageHeader
        kicker={f.title}
        title={`${r.student ?? r.employee ?? ''} · ${r.number ?? ''}`}
        description={`${r.section ? `${r.section} · ` : ''}Answered by ${r.byUser ?? r.signedName ?? '—'} (${BY[r.respondent]}) on ${new Date(r.signedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`}
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
            {r.respondent === 'office' ? <Badge tone="info">Entered by the office</Badge> : null}
            <span className="ep-field__help">PDF copy</span>
            <FileLinks
              href={`/api/consent-forms/file?kind=pdf&id=${id}&rid=${rid}`}
              label={`PDF copy of ${r.number ?? 'the response'}`}
            />
          </span>
        }
      />
      <Notice
        params={{ ...sp, detail: sp.ok === 'filled' ? `Saved as ${r.number ?? ''}.` : sp.detail }}
      />
      <Card>
        <dl className="ep-cf__answers">
          {r.signedName ? (
            <>
              <dt>Name as signed</dt>
              <dd>{r.signedName}</dd>
            </>
          ) : null}
          {f.fields.map((x) => {
            if (x.type === 'pagebreak') return null;
            if (x.type === 'heading')
              return (
                <dt key={x.key} className="ep-cf__ah">
                  {x.label}
                </dt>
              );
            const v = r.answers[x.key];
            if (v === undefined) return null;
            return (
              <div key={x.key} style={{ display: 'contents' }}>
                <dt>{x.label}</dt>
                <dd>
                  {x.type === 'signature' && r.signed?.includes(x.key) ? (
                    <img
                      className="ep-cf__sigimg"
                      src={`/api/consent-forms/file?kind=signature&id=${id}&rid=${rid}&key=${x.key}`}
                      alt={`Signature: ${x.label}`}
                    />
                  ) : x.type === 'file' && Array.isArray(v) ? (
                    <span style={{ display: 'inline-flex', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
                      {(v as string[]).map((fid, i) => (
                        <FileLinks
                          key={fid}
                          href={`/api/files/${fid}/download`}
                          label={r.files.find((y) => y.fileId === fid)?.name ?? `file ${i + 1}`}
                        />
                      ))}
                    </span>
                  ) : (
                    text(v, x.type)
                  )}
                </dd>
              </div>
            );
          })}
        </dl>
      </Card>
    </>
  );
}
