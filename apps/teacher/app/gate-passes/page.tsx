import { Badge, Button, Card, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import { cancelGatePass, decideGatePass } from './actions';

interface Pass {
  id: string;
  number: string;
  audience: 'student' | 'staff';
  kind: 'early_leave' | 'late_arrival' | 'rgp' | 'nrgp';
  state: string;
  stage: string;
  onDate: string;
  atTime: string | null;
  returnBy: string | null;
  reason: string;
  destination: string | null;
  student: string | null;
  section: string | null;
  admissionNo: string | null;
  employee: string | null;
  employeeCode: string | null;
  escortName: string | null;
  escortRelation: string | null;
  approvedLevels: number;
  levels: number;
  approvalMode: 'sequence' | 'any';
  approvalNeed: number;
  waitingOn: string | null;
  passNo: string | null;
  items: number;
  decisionNote: string | null;
  outAt: string | null;
  inAt: string | null;
}
const KIND: Record<Pass['kind'], string> = {
  early_leave: 'Early leave',
  late_arrival: 'Late arrival',
  rgp: 'RGP · returnable',
  nrgp: 'NRGP · non-returnable',
};
const TONE: Record<string, 'warning' | 'success' | 'danger' | 'info' | 'neutral'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  cancelled: 'neutral',
  handed_over: 'info',
  out: 'info',
  returned: 'neutral',
};
const OK: Record<string, string> = {
  approved: 'Approved at your level.',
  rejected: 'Rejected. The family or the employee has been told.',
  requested: 'Gate pass requested. It has gone for approval.',
  cancelled: 'Gate pass cancelled.',
};
const timeOf = (v: string) =>
  new Date(v).toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
  });
const who = (p: Pass, adm: string) =>
  p.audience === 'student'
    ? `${p.student ?? ''}${p.section ? ` (${p.section})` : ''}${p.admissionNo ? ` · ${adm} ${p.admissionNo}` : ''}`
    : `${p.employee ?? ''}${p.employeeCode ? ` · ${p.employeeCode}` : ''}`;

/**
 * Gate passes in the teacher app (0069): the passes that wait for my approval (as class teacher,
 * coordinator, vice principal or principal), and my own passes to go out during school (RGP / NRGP).
 */
export default async function GatePassesPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const lang = await currentLang();
  let inbox: Pass[];
  let mine: Pass[];
  try {
    [inbox, mine] = await Promise.all([
      bff.api.fetch<{ data: Pass[] }>('/gate-passes/inbox').then((r) => r.data),
      bff.api.fetch<{ data: Pass[] }>('/gate-passes/staff?size=20').then((r) => r.data),
    ]);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    throw error;
  }
  const adm = t(lang, 'Adm. no.');
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 820, margin: '0 auto' }}>
      <PageHeader
        kicker={t(lang, 'Gate passes')}
        title={t(lang, 'Gate passes')}
        description={t(lang, 'Approve the passes that wait on you, and ask for your own.')}
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            <a className="ep-btn ep-btn--primary ep-btn--sm" href="/gate-passes/new">
              {t(lang, 'Apply for a gate pass')}
            </a>
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/">
              {t(lang, 'Home')}
            </a>
          </span>
        }
      />
      {sp.ok && OK[sp.ok] ? (
        <div
          className="ep-alert ep-alert--success"
          role="status"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {t(lang, OK[sp.ok]!)}
        </div>
      ) : null}
      {sp.error ? (
        <div
          className="ep-alert ep-alert--danger"
          role="alert"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {sp.detail || sp.error}
        </div>
      ) : null}
      <h2 className="ep-cdash__h3">
        {t(lang, 'To approve')} · {String(inbox.length)}
      </h2>
      {inbox.length === 0 ? (
        <Card style={{ marginBottom: 'var(--sp-3)' }}>{t(lang, 'Nothing waits for you.')}</Card>
      ) : null}
      {inbox.map((p) => (
        <Card
          key={p.id}
          title={who(p, adm)}
          actions={<Badge tone="warning">{t(lang, KIND[p.kind])}</Badge>}
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          <p style={{ marginTop: 0 }}>
            {p.onDate}
            {p.atTime ? `, ${p.atTime}` : ''}
            {p.returnBy ? ` · ${t(lang, 'back by')} ${timeOf(p.returnBy)}` : ''} · {p.reason}
          </p>
          <p className="ep-field__help">
            {[
              p.escortName
                ? `${t(lang, 'With')} ${p.escortName}${p.escortRelation ? ` (${p.escortRelation})` : ''}`
                : null,
              p.destination,
              p.items ? `${String(p.items)} ${t(lang, 'item(s) carried out')}` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <form action={decideGatePass} style={{ display: 'grid', gap: 'var(--sp-2)' }}>
            <input type="hidden" name="id" value={p.id} />
            <label className="ep-field" htmlFor={`n-${p.id}`}>
              <span className="ep-field__label">{t(lang, 'Note (needed to reject)')}</span>
              <input id={`n-${p.id}`} name="note" className="ep-input" maxLength={300} />
            </label>
            <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
              <Button type="submit" name="outcome" value="approved" size="sm">
                {t(lang, 'Approve')}
              </Button>
              <Button type="submit" name="outcome" value="rejected" size="sm" variant="secondary">
                {t(lang, 'Reject')}
              </Button>
            </div>
          </form>
        </Card>
      ))}
      <h2 className="ep-cdash__h3" style={{ marginTop: 'var(--sp-4)' }}>
        {t(lang, 'My gate passes')}
      </h2>
      {mine.length === 0 ? <Card>{t(lang, 'You have not asked for a gate pass yet.')}</Card> : null}
      {mine.map((p) => (
        <Card
          key={p.id}
          title={`${p.number} · ${t(lang, KIND[p.kind])}`}
          actions={<Badge tone={TONE[p.state] ?? 'neutral'}>{t(lang, p.stage)}</Badge>}
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          <p style={{ marginTop: 0 }}>
            {p.onDate}
            {p.atTime ? `, ${p.atTime}` : ''}
            {p.returnBy ? ` · ${t(lang, 'back by')} ${timeOf(p.returnBy)}` : ''} · {p.reason}
          </p>
          <p className="ep-field__help">
            {[
              p.destination,
              p.items ? `${String(p.items)} ${t(lang, 'item(s) carried out')}` : null,
              p.state === 'pending' && p.waitingOn
                ? `${t(lang, 'Waiting on')} ${p.waitingOn}`
                : null,
              p.outAt ? `${t(lang, 'Gate out')} ${timeOf(p.outAt)}` : null,
              p.inAt ? `${t(lang, 'Gate in')} ${timeOf(p.inAt)}` : null,
              p.decisionNote,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            {p.passNo ? (
              <a
                className="ep-btn ep-btn--secondary ep-btn--sm"
                href={`/api/gate-pass-card/${p.id}`}
                aria-label={`${t(lang, 'Download the pass (PDF)')} ${p.number}`}
              >
                {t(lang, 'Download the pass (PDF)')}
              </a>
            ) : null}
            {['pending', 'approved'].includes(p.state) ? (
              <form action={cancelGatePass}>
                <input type="hidden" name="id" value={p.id} />
                <Button
                  type="submit"
                  size="sm"
                  variant="secondary"
                  aria-label={`${t(lang, 'Cancel')} ${p.number}`}
                >
                  {t(lang, 'Cancel')}
                </Button>
              </form>
            ) : null}
          </div>
        </Card>
      ))}
    </main>
  );
}
