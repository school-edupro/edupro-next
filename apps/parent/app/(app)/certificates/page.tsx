import { Button, Card, PageHeader } from '@edupro/ui';
import { ApiError } from '@edupro/bff';
import { redirect } from 'next/navigation';
import { AskSearch } from '@/components/certificates/AskSearch';
import { ChildSwitch } from '@/components/ChildSwitch';
import { FileLinks } from '@/components/FileLinks';
import { chosenChild } from '@/lib/child';
import { bff } from '@/lib/bff';
import { currentLang, t, type Lang } from '@/lib/i18n';
import { askCertificate, withdrawCertificateRequest } from './actions';

/** What the parent app shows of certificates and requests (docs/design/87). */
interface RequestType {
  code: string;
  name: string;
  audience: 'STUDENT' | 'STAFF';
  purposes: string[];
  maxCopies: number;
  fee: number | null;
  forParents: boolean;
  forStudents: boolean;
  decidedBy?: string[];
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
  purpose?: string | null;
  revision?: number;
  award?: boolean;
  awardText?: string | null;
  achievementId?: string | null;
}
interface MineView {
  students: Array<{ id: string; name: string; self: boolean }>;
  types: RequestType[];
  requests: MyRequest[];
  certificates: RegisterCert[];
}
/** An achievement certificate of the earlier module (all of them are in the register too, but for any that is not). */
interface AwardRow {
  id: string;
  studentId: string;
  student: string;
  serialNo: string;
  title: string;
  text: string | null;
  issuedOn: string;
}
/** One line of "Your certificates". */
interface Item {
  key: string;
  pdf: string;
  title: string;
  award: boolean;
  person: string;
  meta: string[];
  sort: string;
}

const dmy = (iso: string) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;
const money = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const OPEN = ['waiting', 'fee', 'ready'];

/** The facts of a line, " · " between; the short ones (numbers, dates) never break inside. */
function Facts({ parts }: { parts: string[] }) {
  return (
    <>
      {parts.map((x, i) => (
        <span key={i}>
          {i ? ' · ' : ''}
          <span className={x.length <= 24 ? 'ep-pcert-bit' : undefined}>{x}</span>
        </span>
      ))}
    </>
  );
}

/** The step line of a request: Asked → Approved → Fee (when there is one) → Being made → Ready. */
function steps(r: MyRequest, lang: Lang): Array<{ label: string; state: 'done' | 'now' | 'todo' }> {
  const withFee = !!r.fee;
  const order = ['Asked', 'Approved', ...(withFee ? ['Fee'] : []), 'Being made', 'Ready'];
  // the step the request is at (issued: all done)
  const at =
    r.stage === 'waiting'
      ? 1
      : r.stage === 'fee'
        ? 2
        : r.stage === 'ready'
          ? withFee
            ? 3
            : 2
          : order.length;
  return order.map((label, i) => ({
    label: t(lang, label),
    state: i < at ? 'done' : i === at ? 'now' : 'todo',
  }));
}

/** "the class teacher, then the principal" */
function deciders(list: string[] | undefined, lang: Lang): string {
  const words = (list?.length ? list : ['the school']).map((x) => t(lang, x));
  return words.join(`, ${t(lang, 'then')} `);
}

/**
 * Certificates in the parent app (rebuilt 16 Nov 2026): three figures; the child's certificates, awards marked, each
 * opening its PDF straight away; requests with their step line and what to do next; and the list to ask from, each
 * with its fee and who decides, the form opening under the one tapped.
 */
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
  // links of the earlier page (a PDF being made) go to the step that opens it
  if (sp.export && /^\d{1,18}$/.test(sp.export))
    redirect(`/certificates/opening?export=${sp.export}&kind=award`);
  if (sp.cexport && /^\d{1,18}$/.test(sp.cexport))
    redirect(`/certificates/opening?export=${sp.cexport}&kind=register`);
  const lang = await currentLang();
  let awards: AwardRow[];
  try {
    awards = (await bff.api.fetch<{ data: AwardRow[] }>('/engagement/mine/certificates')).data;
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
  const mine = await bff.api
    .fetch<MineView>('/certificate-requests/mine')
    .catch(() => ({ students: [], types: [], requests: [], certificates: [] }) as MineView);
  // one child at a time, as chosen in the switch under the title
  const kid = await chosenChild();
  const me =
    mine.students.find((x) => x.id === kid?.id) ??
    (mine.students.length === 1 ? mine.students[0] : undefined);
  const forMe = (studentId: string | null) => !me || studentId === me.id;

  // ---- Your certificates: the register's, and any achievement record not in it
  const inRegister = new Set(mine.certificates.map((c) => c.achievementId).filter(Boolean));
  const items: Item[] = [
    ...mine.certificates
      .filter((c) => forMe(c.studentId))
      .map((c) => ({
        key: `r${c.id}`,
        pdf: `/api/certificate-pdf?id=${c.id}`,
        title: c.award && c.awardText ? c.awardText : c.typeName,
        award: !!c.award,
        person: c.person,
        meta: [
          ...(c.award && c.awardText ? [c.typeName] : []),
          c.number,
          ...(c.copyNo ? [`${t(lang, 'duplicate')} ${String(c.copyNo)}`] : []),
          dmy(c.issuedOn),
          ...(c.purpose ? [c.purpose] : []),
          ...((c.revision ?? 1) > 1 ? [`${t(lang, 'Revision')} ${String(c.revision)}`] : []),
        ],
        sort: c.issuedOn,
      })),
    ...awards
      .filter((a) => !inRegister.has(a.id) && forMe(a.studentId))
      .map((a) => ({
        key: `a${a.id}`,
        pdf: `/api/certificate-pdf?id=${a.id}&kind=award`,
        title: a.title,
        award: true,
        person: a.student,
        meta: [a.serialNo, dmy(a.issuedOn), ...(a.text ? [a.text] : [])],
        sort: a.issuedOn,
      })),
  ].sort((x, y) => y.sort.localeCompare(x.sort));

  // ---- Requests: open ones first; the closed ones folded
  const myRequests = mine.requests.filter((r) => forMe(r.studentId));
  const open = myRequests.filter((r) => OPEN.includes(r.stage));
  const closed = myRequests.filter((r) => !OPEN.includes(r.stage));
  const toPay = open.filter((r) => r.stage === 'fee');

  // ---- Ask: what this child (or the student themselves) can ask for
  const askable = me
    ? mine.types.filter((x) => x.audience === 'STUDENT' && (me.self ? x.forStudents : x.forParents))
    : [];
  const asking = askable.find((x) => x.code === sp.ask)?.code ?? null;

  const requestRow = (r: MyRequest) => (
    <li key={r.id} data-wrap="">
      <div className="ep-pcert-item">
        <div className="ep-pcert-item__title">
          {r.typeName}
          {r.stage === 'rejected' ? (
            <span className="ep-badge ep-badge--danger">{t(lang, 'Not approved')}</span>
          ) : r.stage === 'withdrawn' ? (
            <span className="ep-badge ep-badge--neutral">{t(lang, 'Withdrawn')}</span>
          ) : r.stage === 'issued' ? (
            <span className="ep-badge ep-badge--success">{t(lang, 'Ready')}</span>
          ) : null}
        </div>
        <div className="ep-pcert-item__meta">
          <Facts
            parts={[
              r.person,
              `${t(lang, 'Asked on')} ${dmy(r.createdAt.slice(0, 10))}`,
              ...(r.purpose ? [r.purpose] : []),
              ...(r.copies > 1 ? [`${String(r.copies)} ${t(lang, 'copies')}`] : []),
            ]}
          />
        </div>
        {OPEN.includes(r.stage) ? (
          <ol className="ep-pcert-track" aria-label={t(lang, 'Where the request is')}>
            {steps(r, lang).map((s) => (
              <li
                key={s.label}
                data-state={s.state}
                aria-current={s.state === 'now' ? 'step' : undefined}
              >
                {s.label}
              </li>
            ))}
          </ol>
        ) : null}
        {r.decisionNote ? (
          <div className="ep-pcert-item__meta">
            {t(lang, 'Note from the school')}: {r.decisionNote}
          </div>
        ) : null}
        {r.stage === 'issued' ? (
          <div className="ep-pcert-item__meta">{t(lang, 'It is under Your certificates.')}</div>
        ) : null}
      </div>
      {r.stage === 'fee' ? (
        <a className="ep-btn ep-btn--primary ep-btn--sm" href="/fees">
          {t(lang, 'Pay the fee')}
          {r.fee ? ` ${money(r.fee * Math.max(1, r.copies))}` : ''}
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
  );

  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
      <PageHeader
        kicker="EduPro"
        title={t(lang, 'Certificates')}
        description={t(
          lang,
          'Certificates from the school, your requests, and asking for a new one.',
        )}
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

      <div className="ep-pcert-figs">
        <div>
          <strong>{String(items.length)}</strong>
          <span>{t(lang, 'Ready')}</span>
        </div>
        <div>
          <strong>{String(open.length - toPay.length)}</strong>
          <span>{t(lang, 'In progress')}</span>
        </div>
        <div data-due={toPay.length ? '' : undefined}>
          <strong>{String(toPay.length)}</strong>
          <span>{t(lang, 'To pay')}</span>
        </div>
      </div>

      <Card title={t(lang, 'Your certificates')}>
        {items.length ? (
          <ul className="ep-pcert-list">
            {items.map((c) => (
              <li key={c.key}>
                <div className="ep-pcert-item">
                  <div className="ep-pcert-item__title">
                    {c.title}
                    {c.award ? (
                      <span className="ep-badge ep-badge--info">{t(lang, 'Award')}</span>
                    ) : null}
                  </div>
                  <div className="ep-pcert-item__meta">
                    <Facts parts={[c.person, ...c.meta]} />
                  </div>
                </div>
                <FileLinks
                  url={c.pdf}
                  saveUrl={`${c.pdf}&save=1`}
                  label={`${c.title} ${c.meta[0] ?? ''}`.trim()}
                  viewLabel={t(lang, 'View')}
                  saveLabel={t(lang, 'Download')}
                  inPlace
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="ep-field__help" style={{ margin: 0 }}>
            {t(lang, 'No certificates yet.')}
            {askable.length ? ` ${t(lang, 'You can ask for one below.')}` : ''}
          </p>
        )}
      </Card>

      {myRequests.length ? (
        <Card title={t(lang, 'Requests')}>
          {open.length ? (
            <ul className="ep-pcert-list">{open.map(requestRow)}</ul>
          ) : (
            <p className="ep-field__help" style={{ margin: 0 }}>
              {t(lang, 'No request in progress.')}
            </p>
          )}
          {closed.length ? (
            <details className="ep-pcert-more">
              <summary>
                {t(lang, 'Earlier requests')} ({String(closed.length)})
              </summary>
              <ul className="ep-pcert-list" style={{ marginTop: 'var(--sp-2)' }}>
                {closed.map(requestRow)}
              </ul>
            </details>
          ) : null}
        </Card>
      ) : null}

      {askable.length && me ? (
        <Card title={t(lang, 'Ask for a certificate')}>
          <p className="ep-field__help" style={{ marginTop: 0 }}>
            {t(lang, 'Tap a certificate to ask for it for')} {me.name}.
          </p>
          {askable.length > 5 ? (
            <AskSearch
              listId="ask-list"
              label={t(lang, 'Find a certificate')}
              none={t(lang, 'No certificate matches.')}
            />
          ) : null}
          <ul className="ep-pcert-ask" id="ask-list">
            {askable.map((x) => (
              <li key={x.code} data-name={`${x.name} ${x.purposes.join(' ')}`.toLowerCase()}>
                <details open={asking === x.code} id={`ask-${x.code}`}>
                  <summary>
                    <span>
                      <span className="ep-pcert-item__title">{x.name}</span>
                      <span className="ep-pcert-item__meta" style={{ display: 'block' }}>
                        {t(lang, 'Decided by')} {deciders(x.decidedBy, lang)}
                        {x.purposes.length
                          ? ` · ${t(lang, 'For')}: ${x.purposes.slice(0, 3).join(', ')}${x.purposes.length > 3 ? '…' : ''}`
                          : ''}
                      </span>
                    </span>
                    <span className="ep-pcert-ask__fee">
                      {x.fee ? `${money(x.fee)} ${t(lang, 'a copy')}` : t(lang, 'Free')}
                    </span>
                  </summary>
                  <form action={askCertificate} className="ep-pcert-ask__form">
                    <input type="hidden" name="type" value={x.code} />
                    <input type="hidden" name="studentId" value={me.id} />
                    <label className="ep-field" htmlFor={`purpose-${x.code}`}>
                      <span className="ep-field__label">{t(lang, 'Purpose')}</span>
                      {x.purposes.length ? (
                        <select
                          id={`purpose-${x.code}`}
                          name="purpose"
                          className="ep-input ep-select"
                          required
                        >
                          {x.purposes.map((p) => (
                            <option key={p} value={p}>
                              {p}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          id={`purpose-${x.code}`}
                          name="purpose"
                          className="ep-input"
                          required
                          minLength={2}
                          maxLength={200}
                          placeholder={t(lang, 'For example: bank account, passport')}
                        />
                      )}
                    </label>
                    {x.maxCopies > 1 ? (
                      <label className="ep-field" htmlFor={`copies-${x.code}`}>
                        <span className="ep-field__label">{t(lang, 'Copies')}</span>
                        <input
                          id={`copies-${x.code}`}
                          name="copies"
                          type="number"
                          min={1}
                          max={x.maxCopies}
                          defaultValue={1}
                          className="ep-input"
                          style={{ maxWidth: '8rem' }}
                        />
                      </label>
                    ) : null}
                    <label className="ep-field" htmlFor={`note-${x.code}`}>
                      <span className="ep-field__label">
                        {t(lang, 'A note for the school (optional)')}
                      </span>
                      <input
                        id={`note-${x.code}`}
                        name="note"
                        className="ep-input"
                        maxLength={500}
                      />
                    </label>
                    <p className="ep-field__help" style={{ margin: 0 }}>
                      {x.fee
                        ? `${t(lang, 'Fee')}: ${money(x.fee)} ${t(lang, 'a copy')} — ${t(lang, 'to pay once the school approves it.')}`
                        : t(lang, 'No fee.')}{' '}
                      {t(lang, 'Decided by')} {deciders(x.decidedBy, lang)}.
                    </p>
                    <div>
                      <Button type="submit">{t(lang, 'Send the request')}</Button>
                    </div>
                  </form>
                </details>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </main>
  );
}
