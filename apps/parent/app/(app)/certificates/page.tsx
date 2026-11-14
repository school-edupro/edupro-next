import { FileLinks } from '@/components/FileLinks';
import { Button, Card, PageHeader } from '@edupro/ui';
import { ApiError } from '@edupro/bff';
import { redirect } from 'next/navigation';
import { ChildSwitch } from '@/components/ChildSwitch';
import { chosenChild, familyKids } from '@/lib/child';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import { queueMyCertificatePdf } from '../appointments/actions';
import { askCertificate, registerCertificatePdf, withdrawCertificateRequest } from './actions';

/** What the parent app shows of certificate requests (docs/design/87, phase C). */
interface RequestType {
  code: string;
  name: string;
  audience: 'STUDENT' | 'STAFF';
  purposes: string[];
  maxCopies: number;
  fee: number | null;
  forParents: boolean;
  forStudents: boolean;
}
interface MyRequest {
  id: string;
  typeName: string;
  studentId: string | null;
  person: string;
  purpose: string | null;
  copies: number;
  stage: 'waiting' | 'fee' | 'ready' | 'issued' | 'rejected' | 'withdrawn';
  fee: number | null;
  feePaid: boolean;
  decisionNote: string | null;
  createdAt: string;
}
interface RegisterCert {
  id: string;
  typeName: string;
  number: string;
  copyNo: number;
  issuedOn: string;
  person: string;
  studentId: string | null;
}
interface MineView {
  students: Array<{ id: string; name: string; self: boolean }>;
  types: RequestType[];
  requests: MyRequest[];
  certificates: RegisterCert[];
}
const STAGE: Record<MyRequest['stage'], string> = {
  waiting: 'Waiting for the school',
  fee: 'Approved: please pay the fee',
  ready: 'Approved: being prepared',
  issued: 'Issued',
  rejected: 'Not approved',
  withdrawn: 'Withdrawn',
};
const dmy = (iso: string) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;

interface Certificate {
  id: string;
  student: string;
  serialNo: string;
  title: string;
  text: string | null;
  issuedOn: string;
  template: string;
}

/** Sprint 19: certificates issued to the family's children, each downloadable as its own PDF. */
export default async function CertificatesPage({
  searchParams,
}: {
  searchParams: Promise<{
    export?: string;
    cexport?: string;
    ask?: string;
    asked?: string;
    withdrawn?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  const lang = await currentLang();
  let rows: Certificate[];
  try {
    rows = (await bff.api.fetch<{ data: Certificate[] }>('/engagement/mine/certificates')).data;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && error.status === 403)
      return (
        <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
          <PageHeader kicker="EduPro" title={t(lang, 'Certificates')} />
          <Card>
            {t(
              lang,
              'Your account is not linked to a student yet. Please contact the school office.',
            )}
          </Card>
        </main>
      );
    throw error;
  }
  // rows carry the child's name: one child at a time, as chosen in the switch under the title
  const kid = await chosenChild();
  const names = new Set((await familyKids()).map((k) => k.name));
  if (kid && rows.some((r) => names.has(r.student)))
    rows = rows.filter((r) => r.student === kid.name);
  // certificates from the register, and requests (docs/design/87, phase C)
  const mine = await bff.api
    .fetch<MineView>('/certificate-requests/mine')
    .catch(() => ({ students: [], types: [], requests: [], certificates: [] }) as MineView);
  const me =
    mine.students.find((x) => x.id === kid?.id) ??
    (mine.students.length === 1 ? mine.students[0] : undefined);
  const askable = me
    ? mine.types.filter((x) => x.audience === 'STUDENT' && (me.self ? x.forStudents : x.forParents))
    : [];
  const asking = askable.find((x) => x.code === sp.ask) ?? null;
  const myRequests = mine.requests.filter((r) => !me || r.studentId === me.id);
  const myCerts = mine.certificates.filter((x) => !me || x.studentId === me.id);
  const regExport =
    sp.cexport && /^\d{1,18}$/.test(sp.cexport)
      ? await bff.api
          .fetch<{
            export: { id: string; status: string };
            download: { url: string; saveUrl?: string } | null;
          }>(`/certificate-requests/mine/exports/${sp.cexport}`)
          .catch(() => null)
      : null;
  const exportStatus = sp.export
    ? await bff.api
        .fetch<{
          export: { id: string; status: string };
          download: { url: string; saveUrl?: string } | null;
        }>(`/fees/mine/exports/${sp.export}`)
        .catch(() => null)
    : null;
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
      <PageHeader
        kicker="EduPro"
        title={t(lang, 'Certificates')}
        description={t(lang, 'Certificates the school has issued to your children.')}
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/">
            {t(lang, 'Home')}
          </a>
        }
      />
      <ChildSwitch lang={lang} back="/certificates" />
      {sp.error ? (
        <div
          className="ep-alert ep-alert--danger"
          role="alert"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {sp.detail || sp.error}
        </div>
      ) : null}
      {exportStatus ? (
        <div
          className="ep-alert ep-alert--info"
          role="status"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {exportStatus.download ? (
            <span className="ep-filecell">
              {t(lang, 'Certificate PDF')}
              <FileLinks
                url={exportStatus.download.url}
                saveUrl={exportStatus.download.saveUrl}
                label={t(lang, 'Certificate PDF')}
                viewLabel={t(lang, 'View')}
                saveLabel={t(lang, 'Download')}
              />
            </span>
          ) : (
            <>
              {t(lang, 'Your PDF is being prepared.')}{' '}
              <a href={`/certificates?export=${exportStatus.export.id}`}>{t(lang, 'Refresh')}</a>
            </>
          )}
        </div>
      ) : null}
      {sp.asked ? (
        <div
          className="ep-alert ep-alert--success"
          role="status"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {t(lang, 'Your request is sent to the school. You will see here when it is ready.')}
        </div>
      ) : sp.withdrawn ? (
        <div
          className="ep-alert ep-alert--info"
          role="status"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {t(lang, 'Request withdrawn.')}
        </div>
      ) : null}
      {regExport ? (
        <div
          className="ep-alert ep-alert--info"
          role="status"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {regExport.download ? (
            <span className="ep-filecell">
              {t(lang, 'Certificate PDF')}
              <FileLinks
                url={regExport.download.url}
                saveUrl={regExport.download.saveUrl}
                label={t(lang, 'Certificate PDF')}
                viewLabel={t(lang, 'View')}
                saveLabel={t(lang, 'Download')}
              />
            </span>
          ) : (
            <>
              {t(lang, 'Your PDF is being prepared.')}{' '}
              <a href={`/certificates?cexport=${regExport.export.id}`}>{t(lang, 'Refresh')}</a>
            </>
          )}
        </div>
      ) : null}
      {askable.length && me ? (
        <Card title={t(lang, 'Ask for a certificate')}>
          {asking ? (
            <form action={askCertificate} style={{ display: 'grid', gap: 'var(--sp-3)' }}>
              <input type="hidden" name="type" value={asking.code} />
              <input type="hidden" name="studentId" value={me.id} />
              <p style={{ margin: 0 }}>
                <strong>{asking.name}</strong> · {me.name}{' '}
                <a href="/certificates" className="ep-field__help">
                  {t(lang, 'Change')}
                </a>
              </p>
              {asking.purposes.length ? (
                <label className="ep-field" htmlFor="purpose">
                  <span className="ep-field__label">{t(lang, 'Purpose')}</span>
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
                  <span className="ep-field__label">{t(lang, 'Purpose')}</span>
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
                  <span className="ep-field__label">{t(lang, 'Copies')}</span>
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
                <span className="ep-field__label">
                  {t(lang, 'A note for the school (optional)')}
                </span>
                <input id="note" name="note" className="ep-input" maxLength={500} />
              </label>
              {asking.fee ? (
                <p className="ep-field__help" style={{ margin: 0 }}>
                  {t(lang, 'Fee a copy')}: ₹{asking.fee.toFixed(2)} —{' '}
                  {t(lang, 'to pay once the school approves it.')}
                </p>
              ) : null}
              <div>
                <Button type="submit">{t(lang, 'Send the request')}</Button>
              </div>
            </form>
          ) : (
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
              {askable.map((x) => (
                <li key={x.code}>
                  <a
                    className="ep-btn ep-btn--secondary ep-btn--sm"
                    href={`/certificates?ask=${x.code}`}
                  >
                    {x.name}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}
      {myRequests.length ? (
        <Card title={t(lang, 'Your requests')}>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {myRequests.map((r) => (
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
                  <strong>{r.typeName}</strong> · {r.person}
                  <div className="ep-kicker">
                    {dmy(r.createdAt.slice(0, 10))} · {t(lang, STAGE[r.stage])}
                    {r.stage === 'fee' && r.fee ? ` · ₹${r.fee.toFixed(2)}` : ''}
                    {r.decisionNote ? ` · ${r.decisionNote}` : ''}
                  </div>
                </div>
                {r.stage === 'fee' ? (
                  <a className="ep-btn ep-btn--primary ep-btn--sm" href="/fees">
                    {t(lang, 'Pay the fee')}
                  </a>
                ) : r.stage === 'waiting' || r.stage === 'ready' ? (
                  <form action={withdrawCertificateRequest}>
                    <input type="hidden" name="id" value={r.id} />
                    <Button type="submit" size="sm" variant="ghost">
                      {t(lang, 'Withdraw')}
                    </Button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {myCerts.length ? (
        <Card title={t(lang, 'Issued by the school')}>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {myCerts.map((c) => (
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
                  <strong>{c.typeName}</strong> · {c.person}
                  <div className="ep-kicker">
                    {c.number}
                    {c.copyNo ? ` · ${t(lang, 'duplicate')} ${String(c.copyNo)}` : ''} ·{' '}
                    {dmy(c.issuedOn)}
                  </div>
                </div>
                <form action={registerCertificatePdf}>
                  <input type="hidden" name="id" value={c.id} />
                  <Button type="submit" size="sm" variant="secondary">
                    PDF
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      <Card title={t(lang, 'Awards and achievements')}>
        {rows.length === 0 ? (
          <p className="ep-field__help">{t(lang, 'No certificates yet.')}</p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {rows.map((c) => (
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
                  <strong>{c.title}</strong> · {c.student}
                  <div className="ep-kicker">
                    {c.serialNo} · {c.issuedOn}
                    {c.text ? ` · ${c.text}` : ''}
                  </div>
                </div>
                <form action={queueMyCertificatePdf}>
                  <input type="hidden" name="id" value={c.id} />
                  <Button type="submit" size="sm" variant="secondary">
                    PDF
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </main>
  );
}
