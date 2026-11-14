import { Badge, Breadcrumbs, Button, Card, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { saveCertificateSettings } from '@/lib/certificate-setup-actions';
import type { CertificateEmployeeHit, CertificateSettings } from '@/lib/certificates';

/**
 * Who signs certificates (docs/design/87, phase B): the signatory (an employee: their name, Emp. ID, designation and
 * the signature image on their record), the title of their box, whether the image prints, whether the issuer prints,
 * and a line at the foot.
 */
export default async function CertificateSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('certificate.setup.manage')) notFound();
  let s: CertificateSettings;
  try {
    s = await apiFetch<CertificateSettings>('/certificates/setup/settings');
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) notFound();
    throw e;
  }
  const eq = (sp.eq ?? '').trim().slice(0, 80);
  const hits =
    eq.length >= 2
      ? await apiFetch<{ rows: CertificateEmployeeHit[] }>(
          `/certificates/employees?q=${encodeURIComponent(eq)}`,
        )
          .then((r) => r.rows)
          .catch(() => [])
      : [];
  const chosen = /^\d{1,18}$/.test(sp.signatory ?? '')
    ? (hits.find((h) => h.id === sp.signatory) ?? null)
    : null;
  const signatoryId =
    sp.signatory && /^\d{1,18}$/.test(sp.signatory) ? sp.signatory : (s.signatory?.id ?? '');
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Certificate set-up', href: '/certificates/setup' },
          { label: 'Signatory and print' },
        ]}
      />
      <PageHeader
        kicker="Certificate set-up"
        title="Signatory and print"
        description="Who signs certificates, and what prints in the signature boxes and at the foot."
      />
      {sp.ok === 'saved' ? (
        <div className="ep-alert ep-alert--success" role="status">
          Saved. Certificates issued from now print it; those already issued keep what they printed.
        </div>
      ) : (
        <Notice params={sp} />
      )}
      <Card title="The signatory">
        <p style={{ marginTop: 0 }}>
          {chosen ? (
            <>
              Chosen: <strong>{chosen.name}</strong> · {chosen.code}
              {chosen.designation ? ` · ${chosen.designation}` : ''} (save below)
            </>
          ) : s.signatory ? (
            <>
              <strong>{s.signatory.name}</strong> · {s.signatory.code}
              {s.signatory.designation ? ` · ${s.signatory.designation}` : ''}{' '}
              <Badge tone={s.signatory.hasSignature ? 'success' : 'warning'}>
                {s.signatory.hasSignature
                  ? 'Signature image on record'
                  : 'No signature image on record'}
              </Badge>
            </>
          ) : (
            'Not set: the principal box prints without a name or signature.'
          )}
        </p>
        <form
          method="get"
          style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'flex-end', flexWrap: 'wrap' }}
        >
          <label className="ep-field" htmlFor="eq" style={{ margin: 0 }}>
            <span className="ep-field__label">Find an employee (name or employee code)</span>
            <input
              id="eq"
              name="eq"
              className="ep-input"
              defaultValue={eq}
              minLength={2}
              maxLength={80}
            />
          </label>
          <Button type="submit" variant="secondary">
            Find
          </Button>
        </form>
        {eq.length >= 2 ? (
          hits.length ? (
            <ul className="ep-cert-hits" aria-label="Employees found">
              {hits.map((h) => (
                <li key={h.id}>
                  <a
                    href={`/certificates/setup/settings?eq=${encodeURIComponent(eq)}&signatory=${h.id}`}
                    aria-current={h.id === signatoryId ? 'true' : undefined}
                  >
                    <strong>{h.name}</strong> · {h.code}
                    {h.designation ? ` · ${h.designation}` : ''}
                  </a>{' '}
                  {h.left ? <Badge tone="neutral">Left</Badge> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="ep-field__help">No employee matches “{eq}”.</p>
          )
        ) : null}
        <p className="ep-field__help">
          The signature image comes from the employee record (People → Employees → the employee →
          Signature).
        </p>
      </Card>
      <Card title="What prints">
        <form action={saveCertificateSettings} className="ep-cert-fields">
          <input type="hidden" name="signatoryEmployeeId" value={signatoryId} />
          <label className="ep-field" htmlFor="stTitle">
            <span className="ep-field__label">Title of the signatory's box *</span>
            <input
              id="stTitle"
              name="signatoryTitle"
              className="ep-input"
              defaultValue={s.signatoryTitle}
              required
              minLength={2}
              maxLength={60}
            />
          </label>
          <label className="ep-field" htmlFor="stFoot">
            <span className="ep-field__label">A line at the foot (optional)</span>
            <input
              id="stFoot"
              name="footerNote"
              className="ep-input"
              defaultValue={s.footerNote}
              maxLength={200}
              placeholder="e.g. Not valid without the school seal"
            />
          </label>
          <label className="ep-check" htmlFor="stSig">
            <input
              id="stSig"
              type="checkbox"
              name="printSignature"
              className="ep-check__input"
              defaultChecked={s.printSignature}
            />
            <span className="ep-check__box" />
            Print the signatory&apos;s signature image (else the box is signed by hand)
          </label>
          <label className="ep-check" htmlFor="stPrep">
            <input
              id="stPrep"
              type="checkbox"
              name="printPreparer"
              className="ep-check__input"
              defaultChecked={s.printPreparer}
            />
            <span className="ep-check__box" />
            Print who issued it in the Prepared by box (name, Emp. ID, date and time)
          </label>
          <div>
            <Button type="submit">Save</Button>
          </div>
        </form>
      </Card>
    </>
  );
}
