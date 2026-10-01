import { Badge, Button, Card, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';
import { currentLang, t, type Lang } from '@/lib/i18n';
import { setConsent } from '../queries/actions';
import { cancelProfileRequest, downloadProfilePdf } from './actions';
import { applies, shown, type PortalProfile, type PortalRequest } from './types';

interface Family {
  children: Array<{ id: string; name: string; section: string | null }>;
  consents: Array<{
    code: string;
    name: string;
    description: string;
    status: 'granted' | 'withdrawn' | null;
    isRequired: boolean;
    recordedAt: string | null;
  }>;
}

const OK_TEXT: Record<string, string> = {
  sent: 'Sent to the school for approval. You can follow it below.',
  saved: 'Saved. The profile is updated.',
  both: 'Some changes are saved; the rest are waiting for the school’s approval.',
  withdrawn: 'The request was withdrawn.',
  consent: 'Your choice has been recorded.',
};
const STATUS: Record<
  PortalRequest['status'],
  { label: string; tone: 'warning' | 'success' | 'danger' | 'info' | 'neutral' }
> = {
  pending: { label: 'Waiting', tone: 'warning' },
  approved: { label: 'Approved', tone: 'success' },
  rejected: { label: 'Not approved', tone: 'danger' },
  partially_approved: { label: 'Partly approved', tone: 'info' },
  cancelled: { label: 'Withdrawn', tone: 'neutral' },
};

function Photo({
  child,
  party,
  has,
  label,
}: {
  child: string;
  party: string;
  has: boolean;
  label: string;
}) {
  return has ? (
    <img className="pp-photo" src={`/api/photo/${child}/${party}`} alt={label} />
  ) : (
    <span className="pp-photo pp-photo--empty" role="img" aria-label={`${label}: no photo`}>
      {label.slice(0, 1)}
    </span>
  );
}

function Requests({ rows, child, lang }: { rows: PortalRequest[]; child: string; lang: Lang }) {
  if (!rows.length) return null;
  return (
    <Card title={t(lang, 'My requests')} style={{ marginBottom: 'var(--sp-3)' }}>
      <ul className="pp-reqs" id="requests">
        {rows.map((r) => (
          <li key={r.id}>
            <div className="pp-req__head">
              <Badge tone={r.autoApplied ? 'success' : STATUS[r.status].tone}>
                {r.autoApplied ? t(lang, 'Saved') : t(lang, STATUS[r.status].label)}
              </Badge>
              <span className="ep-kicker">
                {new Date(r.createdAt).toLocaleDateString('en-IN')}
                {r.requestedBy ? ` · ${r.requestedBy}` : ''}
                {r.status === 'pending' && r.waitingFor
                  ? ` · ${t(lang, 'with')} ${r.waitingFor}${r.levels > 1 ? ` (${t(lang, 'step')} ${r.level}/${r.levels})` : ''}`
                  : ''}
              </span>
            </div>
            <ul className="pp-req__items">
              {r.items.map((it) => (
                <li key={it.key}>
                  {it.label}: <strong>{shown(it.to) || t(lang, '(clear)')}</strong>{' '}
                  {it.status === 'approved' ? (
                    <Badge tone="success">{t(lang, 'approved')}</Badge>
                  ) : it.status === 'rejected' ? (
                    <Badge tone="danger">{t(lang, 'not approved')}</Badge>
                  ) : null}
                  {it.note ? <div className="ep-kicker">{it.note}</div> : null}
                </li>
              ))}
            </ul>
            {r.decisionNote && r.status !== 'pending' ? (
              <div className="ep-kicker">
                {t(lang, 'School note')}: {r.decisionNote}
              </div>
            ) : null}
            {r.status === 'pending' && r.mine ? (
              <form action={cancelProfileRequest}>
                <input type="hidden" name="id" value={r.id} />
                <input type="hidden" name="child" value={child} />
                <Button type="submit" size="sm" variant="ghost">
                  {t(lang, 'Withdraw')}
                </Button>
              </form>
            ) : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** The child's profile as the school shows it, with updates, the PDF and the family's requests. */
export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{
    child?: string;
    ok?: string;
    error?: string;
    detail?: string;
    export?: string;
  }>;
}) {
  const sp = await searchParams;
  const lang = await currentLang();
  const notLinked = (
    <main className="pp-main">
      <PageHeader kicker="EduPro" title={t(lang, 'Profile')} />
      <Card>
        {t(lang, 'Your account is not linked to a student yet. Please contact the school office.')}
      </Card>
    </main>
  );
  let fam: Family;
  try {
    fam = await bff.api.fetch<Family>('/engagement/family');
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && (error.status === 403 || error.status === 409))
      return notLinked;
    throw error;
  }
  const child = fam.children.find((c) => c.id === sp.child) ?? fam.children[0];
  if (!child) return notLinked;
  const [p, reqs, exp] = await Promise.all([
    bff.api.fetch<PortalProfile>(`/engagement/mine/profile/${child.id}`),
    bff.api
      .fetch<{ data: PortalRequest[] }>(`/engagement/mine/profile/${child.id}/requests`)
      .then((r) => r.data)
      .catch(() => [] as PortalRequest[]),
    sp.export
      ? bff.api
          .fetch<{ export: { id: string; status: string }; download: { url: string } | null }>(
            `/engagement/mine/exports/${sp.export}`,
          )
          .catch(() => null)
      : Promise.resolve(null),
  ]);
  const all = p.sections.flatMap((s) => s.fields);
  const values = Object.fromEntries(all.map((f) => [f.key, f.value]));
  const fact = (key: string) => all.find((f) => f.key === key)?.value ?? null;
  const pendingCount = reqs.filter((r) => r.status === 'pending').length;
  const parents: Array<{
    party: string;
    label: string;
    name: unknown;
    mobile: unknown;
    has: boolean;
  }> = [
    {
      party: 'father',
      label: t(lang, 'Father'),
      name: fact('father_name'),
      mobile: fact('father_mobile'),
      has: p.photos.father,
    },
    {
      party: 'mother',
      label: t(lang, 'Mother'),
      name: fact('mother_name'),
      mobile: fact('mother_mobile'),
      has: p.photos.mother,
    },
  ];

  return (
    <main className="pp-main">
      <PageHeader
        kicker={t(lang, 'Profile')}
        title={p.name}
        description={`${p.enrolment ? `${p.enrolment.className} ${p.enrolment.section} · ` : ''}${t(lang, 'Admission no')} ${p.admissionNo}`}
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/">
            {t(lang, 'Home')}
          </a>
        }
      />
      {fam.children.length > 1 ? (
        <nav className="pp-kids" aria-label={t(lang, 'Choose a child')}>
          {fam.children.map((c) => (
            <a
              key={c.id}
              href={`/profile?child=${c.id}`}
              aria-current={c.id === child.id ? 'page' : undefined}
            >
              {c.name}
              {c.section ? <span> · {c.section}</span> : null}
            </a>
          ))}
        </nav>
      ) : null}
      {sp.ok && OK_TEXT[sp.ok] ? (
        <div className="ep-alert ep-alert--success" role="status">
          {t(lang, OK_TEXT[sp.ok] ?? '')}
        </div>
      ) : null}
      {sp.error ? (
        <div className="ep-alert ep-alert--danger" role="alert">
          {sp.detail || sp.error}
        </div>
      ) : null}
      {exp ? (
        <div className="ep-alert ep-alert--info" role="status">
          {exp.download ? (
            <a href={exp.download.url}>{t(lang, 'Download the profile PDF')}</a>
          ) : exp.export.status === 'failed' ? (
            t(lang, 'The PDF could not be prepared. Please try again.')
          ) : (
            <>
              {t(lang, 'Your PDF is being prepared.')}{' '}
              <a href={`/profile?child=${child.id}&export=${exp.export.id}`}>
                {t(lang, 'Refresh')}
              </a>
            </>
          )}
        </div>
      ) : null}

      <Card style={{ marginBottom: 'var(--sp-3)' }}>
        <div className="pp-hero">
          <Photo child={child.id} party="student" has={p.photos.student} label={p.name} />
          <div className="pp-hero__body">
            <h2 className="pp-hero__name">{p.name}</h2>
            <dl className="pp-facts">
              {p.enrolment ? (
                <div>
                  <dt>{t(lang, 'Class')}</dt>
                  <dd>
                    {p.enrolment.className} {p.enrolment.section}
                    {p.enrolment.rollNo ? ` · ${t(lang, 'Roll no')} ${p.enrolment.rollNo}` : ''}
                  </dd>
                </div>
              ) : null}
              <div>
                <dt>{t(lang, 'Admission no')}</dt>
                <dd>{p.admissionNo}</dd>
              </div>
              {p.classTeacher ? (
                <div>
                  <dt>{t(lang, 'Class teacher')}</dt>
                  <dd>{p.classTeacher}</dd>
                </div>
              ) : null}
              <div>
                <dt>{t(lang, 'Profile complete')}</dt>
                <dd>
                  <span className="pp-meter" aria-hidden="true">
                    <span style={{ width: `${p.completeness}%` }} />
                  </span>{' '}
                  {p.completeness}%
                </dd>
              </div>
            </dl>
            <div className="pp-hero__actions">
              <form action={downloadProfilePdf}>
                <input type="hidden" name="child" value={child.id} />
                <Button type="submit" variant="secondary" size="sm">
                  {t(lang, 'Download profile (PDF)')}
                </Button>
              </form>
              {pendingCount ? (
                <a className="ep-btn ep-btn--ghost ep-btn--sm" href="#requests">
                  {pendingCount} {t(lang, 'waiting for approval')}
                </a>
              ) : null}
            </div>
          </div>
        </div>
        {p.audience === 'parent' ? (
          <div className="pp-parents">
            {parents.map((w) => (
              <div key={w.party} className="pp-parent">
                <Photo child={child.id} party={w.party} has={w.has} label={w.label} />
                <div>
                  <div className="ep-kicker">{w.label}</div>
                  <strong>{w.name ? String(w.name) : '—'}</strong>
                  {w.mobile ? <div>{String(w.mobile)}</div> : null}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </Card>

      {!p.window.open ? (
        <div className="ep-alert ep-alert--warning" role="status">
          {p.window.message ?? t(lang, 'Profile updates are closed at the moment.')}
        </div>
      ) : p.window.message || p.window.until ? (
        <div className="ep-alert ep-alert--info" role="status">
          {p.window.message ?? ''}
          {p.window.until ? ` ${t(lang, 'Updates are open until')} ${p.window.until}.` : ''}
        </div>
      ) : null}

      <Requests rows={reqs} child={child.id} lang={lang} />

      {p.sections.map((s) => {
        const fields = s.fields.filter((f) => applies(f, values));
        if (!fields.length) return null;
        const editable =
          p.window.open &&
          fields.some((f) => f.level === 'edit_approval' || f.level === 'edit_direct');
        return (
          <Card
            key={s.id}
            title={t(lang, s.title)}
            style={{ marginBottom: 'var(--sp-3)' }}
            actions={
              editable ? (
                <a
                  className="ep-btn ep-btn--secondary ep-btn--sm"
                  href={`/profile/edit?child=${child.id}&section=${s.id}`}
                  aria-label={`${t(lang, 'Update')}: ${t(lang, s.title)}`}
                >
                  {t(lang, 'Update')}
                </a>
              ) : undefined
            }
          >
            <dl className="pp-kv">
              {fields.map((f) => (
                <div key={f.key}>
                  <dt>{f.label}</dt>
                  <dd>
                    {shown(f.value) || <span className="pp-empty">{t(lang, 'Not given')}</span>}
                    {f.pending ? (
                      <div className="pp-pending">
                        <Badge tone="warning">{t(lang, 'Waiting for approval')}</Badge>{' '}
                        {shown(f.pending.to) || t(lang, '(clear)')}
                      </div>
                    ) : null}
                  </dd>
                </div>
              ))}
            </dl>
          </Card>
        );
      })}

      <Card
        title={t(lang, 'Your data')}
        style={{ marginBottom: 'var(--sp-3)' }}
        actions={
          <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/profile/data">
            {t(lang, 'Open your data')}
          </a>
        }
      >
        <p className="ep-field__help" style={{ margin: 0 }}>
          {t(
            lang,
            'Ask for a copy of the data the school holds, a correction, or raise a grievance.',
          )}
        </p>
      </Card>
      <Card title={t(lang, 'Your consents')} style={{ marginBottom: 'var(--sp-3)' }}>
        <p className="ep-field__help">
          {t(
            lang,
            'Under the Digital Personal Data Protection Act you choose what the school may send you. Fee, attendance and safety messages are always sent.',
          )}
        </p>
        {fam.consents.map((c) => (
          <div key={c.code} className="pp-consent">
            <div>
              <div>
                <strong>{c.name}</strong>{' '}
                <Badge
                  tone={
                    c.status === 'granted'
                      ? 'success'
                      : c.status === 'withdrawn'
                        ? 'danger'
                        : 'neutral'
                  }
                >
                  {c.status ? t(lang, c.status) : t(lang, 'not recorded')}
                </Badge>
              </div>
              <div className="ep-kicker">{c.description}</div>
            </div>
            <form action={setConsent}>
              <input type="hidden" name="purposeCode" value={c.code} />
              <input
                type="hidden"
                name="status"
                value={c.status === 'granted' ? 'withdrawn' : 'granted'}
              />
              <Button
                type="submit"
                variant="ghost"
                size="sm"
                disabled={c.isRequired && c.status === 'granted'}
              >
                {c.status === 'granted' ? t(lang, 'Withdraw') : t(lang, 'Allow')}
              </Button>
            </form>
          </div>
        ))}
      </Card>
    </main>
  );
}
