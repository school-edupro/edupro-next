import { Badge, Breadcrumbs, Card, PageHeader } from '@edupro/ui';
import { FileLinks } from '@/components/FileLinks';
import { Notice } from '@/components/Notice';
import { type ConsentAnswered, type ConsentForm } from '@/components/consents/types';
import { decideConsent } from '@/lib/consent-actions';
import { apiFetch } from '@/lib/api';

type Full = ConsentAnswered & {
  files: Array<{ fileId: string; name: string | null }>;
  signed: string[] | null;
  lineStatus: string | null;
  decidedAt: string | null;
  editedAt: string | null;
  versions: Array<{
    id: string;
    answers: Record<string, unknown>;
    signedName: string | null;
    fee: string;
    writtenAt: string;
    replacedAt: string;
    replacedBy: string | null;
  }>;
};
const OK: Record<string, string> = {
  filled: 'Saved.',
  approved: 'Approved at your level.',
  rejected: 'Not approved: the family is told.',
};
const when = (s: string) => new Date(s).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
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
  const [f, r, mine] = await Promise.all([
    apiFetch<ConsentForm>(`/engagement/consent-forms/${id}`),
    apiFetch<Full>(`/engagement/consent-forms/${id}/responses/${rid}`),
    // is this answer waiting for me?
    apiFetch<{ data: Array<{ stepId: string; responseId: string; level: string }> }>(
      '/engagement/mine/consent-approvals',
    )
      .then((x) => x.data.find((y) => y.responseId === rid) ?? null)
      .catch(() => null),
  ]);
  const fee = Number(r.fee ?? 0);
  const paid = Number(r.paid ?? 0);
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
      <Notice params={{ ...sp, detail: sp.ok ? (OK[sp.ok] ?? 'Done.') : sp.detail }} />
      <Card style={{ marginBottom: 'var(--sp-4)' }}>
        <div
          style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-3)', alignItems: 'center' }}
        >
          {r.waitingWith ? (
            <Badge tone="warning">Waiting for approval: {r.waitingWith}</Badge>
          ) : r.status === 'approved' ? (
            <Badge tone="success">Approved{r.decidedAt ? ` on ${when(r.decidedAt)}` : ''}</Badge>
          ) : r.status === 'rejected' ? (
            <Badge tone="danger">Not approved</Badge>
          ) : (
            <Badge tone="info">Answered</Badge>
          )}
          {r.decidedNote ? <span>Note: {r.decidedNote}</span> : null}
          {fee > 0 ? (
            <span>
              Fee ₹{fee.toLocaleString('en-IN')}
              {r.paid !== null && r.paid !== undefined
                ? ` · paid ₹${paid.toLocaleString('en-IN')} (the pupil's line on the form's misc fee)`
                : r.status === 'rejected'
                  ? ' · not raised'
                  : ' · raised after approval'}
            </span>
          ) : null}
          {r.edits ? (
            <span className="ep-field__help">
              Changed {r.edits} time{r.edits === 1 ? '' : 's'}
              {r.editedAt ? `, last on ${when(r.editedAt)}` : ''}
            </span>
          ) : null}
        </div>
        {mine ? (
          <form
            action={decideConsent}
            className="ep-filter-band"
            style={{ marginTop: 'var(--sp-3)' }}
          >
            <input type="hidden" name="formId" value={id} />
            <input type="hidden" name="responseId" value={rid} />
            <input type="hidden" name="stepId" value={mine.stepId} />
            <input type="hidden" name="decision" value="approved" />
            <label className="ep-field" htmlFor="dec-note">
              <span className="ep-field__label">Note to the family ({mine.level})</span>
              <input id="dec-note" name="note" className="ep-input" maxLength={500} />
            </label>
            <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm">
              Approve
            </button>
          </form>
        ) : null}
        {mine ? (
          <form action={decideConsent} style={{ marginTop: 'var(--sp-2)' }}>
            <input type="hidden" name="formId" value={id} />
            <input type="hidden" name="responseId" value={rid} />
            <input type="hidden" name="stepId" value={mine.stepId} />
            <input type="hidden" name="decision" value="rejected" />
            <label className="ep-field" htmlFor="dec-why">
              <span className="ep-field__label">Or not approve, saying why</span>
              <input id="dec-why" name="note" className="ep-input" maxLength={500} required />
            </label>
            <button
              type="submit"
              className="ep-btn ep-btn--danger ep-btn--sm"
              style={{ marginTop: 'var(--sp-2)' }}
            >
              Do not approve
            </button>
          </form>
        ) : null}
      </Card>
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
      {r.versions.length ? (
        <Card title="Earlier versions" style={{ marginTop: 'var(--sp-4)' }}>
          {r.versions.map((v) => (
            <details key={v.id} style={{ marginBottom: 'var(--sp-2)' }}>
              <summary>
                As answered on {when(v.writtenAt)} (changed on {when(v.replacedAt)}
                {v.replacedBy ? ` by ${v.replacedBy}` : ''})
                {Number(v.fee) > 0 ? ` · fee ₹${Number(v.fee)}` : ''}
              </summary>
              <dl className="ep-cf__answers" style={{ marginTop: 'var(--sp-2)' }}>
                {f.fields
                  .filter(
                    (x) =>
                      v.answers[x.key] !== undefined && !['heading', 'pagebreak'].includes(x.type),
                  )
                  .map((x) => (
                    <div key={x.key} style={{ display: 'contents' }}>
                      <dt>{x.label}</dt>
                      <dd>{x.type === 'signature' ? 'Signed' : text(v.answers[x.key], x.type)}</dd>
                    </div>
                  ))}
              </dl>
            </details>
          ))}
        </Card>
      ) : null}
    </>
  );
}
