import { ApiError } from '@edupro/bff';
import { Badge, Button, Card, PageHeader } from '@edupro/ui';
import { FileLinks } from '@/components/FileLinks';
import { bff } from '@/lib/bff';
import {
  askMyCertificate,
  myCertificatePdf,
  withdrawMyCertificateRequest,
} from '@/lib/certificate-actions';

interface Mine {
  employee: { id: string; name: string; code: string } | null;
  types: Array<{
    code: string;
    name: string;
    audience: string;
    purposes: string[];
    maxCopies: number;
  }>;
  requests: Array<{
    id: string;
    typeName: string;
    employeeId: string | null;
    purpose: string | null;
    stage: 'waiting' | 'fee' | 'ready' | 'issued' | 'rejected' | 'withdrawn';
    decisionNote: string | null;
    createdAt: string;
  }>;
  certificates: Array<{
    id: string;
    typeName: string;
    number: string;
    copyNo: number;
    issuedOn: string;
  }>;
}
const STAGE: Record<
  Mine['requests'][number]['stage'],
  { label: string; tone: 'warning' | 'info' | 'success' | 'danger' | 'neutral' }
> = {
  waiting: { label: 'Waiting for approval', tone: 'warning' },
  fee: { label: 'Waiting for the fee', tone: 'warning' },
  ready: { label: 'Approved: being prepared', tone: 'info' },
  issued: { label: 'Issued', tone: 'success' },
  rejected: { label: 'Not approved', tone: 'danger' },
  withdrawn: { label: 'Withdrawn', tone: 'neutral' },
};
const dmy = (iso: string) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;

/**
 * My certificates in the staff app (docs/design/87, phase C): ask for an experience, service or visa certificate; see
 * where the request is; download the certificates the school issued me.
 */
export default async function MyCertificatesPage({
  searchParams,
}: {
  searchParams: Promise<{
    ask?: string;
    asked?: string;
    withdrawn?: string;
    export?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  let d: Mine;
  try {
    d = await bff.api.fetch<Mine>('/certificate-requests/mine');
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) throw error;
    throw error;
  }
  const types = d.types.filter((t) => t.audience === 'STAFF');
  const asking = types.find((t) => t.code === sp.ask) ?? null;
  const requests = d.requests.filter((r) => r.employeeId && r.employeeId === d.employee?.id);
  const exp =
    sp.export && /^\d{1,18}$/.test(sp.export)
      ? await bff.api
          .fetch<{
            export: { id: string; status: string };
            download: { url: string; saveUrl?: string } | null;
          }>(`/certificate-requests/mine/exports/${sp.export}`)
          .catch(() => null)
      : null;
  return (
    <>
      <PageHeader
        kicker="Office"
        title="My certificates"
        description="Ask the school for an experience, service or visa certificate, and download the ones issued to you."
      />
      {sp.error ? (
        <div className="ep-alert ep-alert--danger" role="alert">
          {sp.detail || sp.error}
        </div>
      ) : sp.asked ? (
        <div className="ep-alert ep-alert--success" role="status">
          Your request is sent. You will see here when it is ready.
        </div>
      ) : sp.withdrawn ? (
        <div className="ep-alert ep-alert--info" role="status">
          Request withdrawn.
        </div>
      ) : null}
      {exp ? (
        <div className="ep-alert ep-alert--info" role="status">
          {exp.download ? (
            <span className="ep-filecell">
              Certificate PDF{' '}
              <FileLinks
                url={exp.download.url}
                saveUrl={exp.download.saveUrl}
                label="Certificate PDF"
              />
            </span>
          ) : (
            <>
              Your PDF is being prepared.{' '}
              <a href={`/my-certificates?export=${exp.export.id}`}>Refresh</a>
            </>
          )}
        </div>
      ) : null}
      {!d.employee ? (
        <Card>
          <p className="ep-field__help" style={{ margin: 0 }}>
            Your sign-in is not linked to a staff record.
          </p>
        </Card>
      ) : (
        <Card title="Ask for a certificate">
          {asking ? (
            <form action={askMyCertificate} style={{ display: 'grid', gap: 'var(--sp-3)' }}>
              <input type="hidden" name="type" value={asking.code} />
              <p style={{ margin: 0 }}>
                <strong>{asking.name}</strong>{' '}
                <a href="/my-certificates" className="ep-field__help">
                  Change
                </a>
              </p>
              {asking.purposes.length ? (
                <label className="ep-field" htmlFor="purpose">
                  <span className="ep-field__label">Purpose</span>
                  <select id="purpose" name="purpose" className="ep-input" required>
                    {asking.purposes.map((x) => (
                      <option key={x} value={x}>
                        {x}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <label className="ep-field" htmlFor="purpose">
                  <span className="ep-field__label">Purpose</span>
                  <input
                    id="purpose"
                    name="purpose"
                    className="ep-input"
                    required
                    minLength={2}
                    maxLength={200}
                  />
                </label>
              )}
              {asking.maxCopies > 1 ? (
                <label className="ep-field" htmlFor="copies">
                  <span className="ep-field__label">Copies</span>
                  <input
                    id="copies"
                    name="copies"
                    type="number"
                    min={1}
                    max={asking.maxCopies}
                    defaultValue={1}
                    className="ep-input"
                  />
                </label>
              ) : null}
              <label className="ep-field" htmlFor="note">
                <span className="ep-field__label">A note for the office (optional)</span>
                <input id="note" name="note" className="ep-input" maxLength={500} />
              </label>
              <div>
                <Button type="submit">Send the request</Button>
              </div>
            </form>
          ) : types.length ? (
            <ul
              style={{
                listStyle: 'none',
                margin: 0,
                padding: 0,
                display: 'flex',
                flexWrap: 'wrap',
                gap: 'var(--sp-2)',
              }}
            >
              {types.map((t) => (
                <li key={t.code}>
                  <a
                    className="ep-btn ep-btn--secondary ep-btn--sm"
                    href={`/my-certificates?ask=${t.code}`}
                  >
                    {t.name}
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="ep-field__help" style={{ margin: 0 }}>
              The school has not opened any certificate to requests.
            </p>
          )}
        </Card>
      )}
      {requests.length ? (
        <Card title="My requests">
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {requests.map((r) => (
              <li
                key={r.id}
                style={{
                  padding: 'var(--sp-2) 0',
                  borderTop: '1px solid var(--border-subtle)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 'var(--sp-2)',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                }}
              >
                <div>
                  <strong>{r.typeName}</strong> · {dmy(r.createdAt.slice(0, 10))}{' '}
                  <Badge tone={STAGE[r.stage].tone}>{STAGE[r.stage].label}</Badge>
                  {r.decisionNote ? (
                    <div className="ep-field__help" style={{ margin: 0 }}>
                      {r.decisionNote}
                    </div>
                  ) : null}
                </div>
                {r.stage === 'waiting' || r.stage === 'ready' ? (
                  <form action={withdrawMyCertificateRequest}>
                    <input type="hidden" name="id" value={r.id} />
                    <Button type="submit" size="sm" variant="ghost">
                      Withdraw
                    </Button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      <Card title="Issued to me">
        {d.certificates.length ? (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {d.certificates.map((c) => (
              <li
                key={c.id}
                style={{
                  padding: 'var(--sp-2) 0',
                  borderTop: '1px solid var(--border-subtle)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 'var(--sp-2)',
                  alignItems: 'center',
                }}
              >
                <div>
                  <strong>{c.typeName}</strong>
                  <div className="ep-field__help" style={{ margin: 0 }}>
                    {c.number}
                    {c.copyNo ? ` · duplicate ${String(c.copyNo)}` : ''} · {dmy(c.issuedOn)}
                  </div>
                </div>
                <form action={myCertificatePdf}>
                  <input type="hidden" name="id" value={c.id} />
                  <Button type="submit" size="sm" variant="secondary">
                    PDF
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        ) : (
          <p className="ep-field__help" style={{ margin: 0 }}>
            No certificate issued to you yet.
          </p>
        )}
      </Card>
    </>
  );
}
