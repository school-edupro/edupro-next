import { Badge, Button, Card, PageHeader } from '@edupro/ui';
import { ApiError } from '@edupro/bff';
import { notFound, redirect } from 'next/navigation';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import { studentLabel, when } from '../../appointments/shared';
import { cancelGatePass } from '../actions';
import { KIND, stateOf, type Pass } from '../shared';

interface Detail extends Pass {
  createdAt: string;
  handoverAt: string | null;
  outAt: string | null;
  inAt: string | null;
  otpNeeded: boolean;
  qr: string | null;
  barcode: string | null;
  approvals: Array<{
    seq: number;
    label: string;
    status: 'waiting' | 'pending' | 'approved' | 'rejected' | 'skipped';
    actedBy: string | null;
    actedAt: string | null;
    note: string | null;
  }>;
}
const svg = (x: string) => `data:image/svg+xml;utf8,${encodeURIComponent(x)}`;
const LEVEL: Record<string, [string, 'warning' | 'success' | 'danger' | 'neutral']> = {
  waiting: ['Waits its turn', 'neutral'],
  pending: ['Deciding now', 'warning'],
  approved: ['Approved', 'success'],
  rejected: ['Rejected', 'danger'],
  skipped: ['Not needed', 'neutral'],
};

/** One gate pass of the family: everything asked, where the approval stands, and the pass once approved. */
export default async function GatePassPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string }>;
}) {
  const { id } = await params;
  const sent = Boolean((await searchParams).ok);
  const lang = await currentLang();
  if (!/^\d{1,18}$/.test(id)) notFound();
  let p: Detail;
  try {
    p = await bff.api.fetch<Detail>(`/gate-passes/mine/${encodeURIComponent(id)}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && [403, 404].includes(error.status)) notFound();
    throw error;
  }
  const [label, tone] = stateOf(p);
  const live = p.passCode && ['approved', 'handed_over'].includes(p.state);
  const facts: Array<[string, string | null]> = [
    [t(lang, 'Child'), studentLabel(p, t(lang, 'Adm. no.'))],
    [t(lang, 'Pass for'), t(lang, KIND[p.kind])],
    [t(lang, 'When'), `${p.onDate}${p.atTime ? `, ${p.atTime}` : ''}`],
    [t(lang, 'Reason'), p.reason],
    [
      t(lang, 'Who takes the child'),
      p.escortName ? `${p.escortName}${p.escortRelation ? ` (${p.escortRelation})` : ''}` : null,
    ],
    [t(lang, 'Requested on'), when(p.createdAt)],
    [t(lang, 'Handed over at the front desk'), p.handoverAt ? when(p.handoverAt) : null],
    [t(lang, 'Left the school'), p.outAt ? when(p.outAt) : null],
    [t(lang, 'Came in'), p.inAt ? when(p.inAt) : null],
    [t(lang, 'Note from the school'), p.decisionNote ?? p.cancelReason],
  ];
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
      <PageHeader
        kicker={`${t(lang, 'Gate pass')} ${p.number}`}
        title={[p.student, t(lang, KIND[p.kind])].filter(Boolean).join(' · ')}
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
            <Badge tone={tone}>{t(lang, label)}</Badge>
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/gate-passes">
              {t(lang, 'Back to gate passes')}
            </a>
          </span>
        }
      />
      {sent ? (
        <div
          className="ep-alert ep-alert--success"
          role="status"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {t(lang, 'Gate pass requested. The school will approve it and send you the pass.')}
        </div>
      ) : null}
      {live && p.qr ? (
        <Card title={t(lang, 'Gate pass')} style={{ marginBottom: 'var(--sp-3)' }}>
          <div className="ep-appt__poster">
            <p className="ep-pass__name">{p.student}</p>
            <p style={{ margin: 0 }}>
              {[p.number, t(lang, KIND[p.kind]), `${p.onDate}${p.atTime ? `, ${p.atTime}` : ''}`]
                .filter(Boolean)
                .join(' · ')}
            </p>
            <img src={svg(p.qr)} alt={t(lang, 'QR code of the gate pass')} />
            {p.barcode ? (
              <img
                className="ep-appt__barcode"
                src={svg(p.barcode)}
                alt={t(lang, 'Barcode of the gate pass')}
              />
            ) : null}
            <p className="ep-field__help">
              {p.kind === 'early_leave'
                ? p.otpNeeded
                  ? t(
                      lang,
                      'The person collecting shows this at the front desk. The school sends a one-time code to your mobile: tell it to them only when the child is being handed over.',
                    )
                  : t(
                      lang,
                      'The person collecting shows this at the front desk; a photo is taken there and the gate lets the child out.',
                    )
                : t(lang, 'Show this at the school gate.')}
            </p>
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href={`/api/gate-pass-card/${p.id}`}>
              {t(lang, 'Download the card (PDF)')}
            </a>
          </div>
        </Card>
      ) : null}
      <Card title={t(lang, 'Details')} style={{ marginBottom: 'var(--sp-3)' }}>
        <dl className="ep-hd__facts">
          {facts
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
        </dl>
        {['pending', 'approved'].includes(p.state) ? (
          <form action={cancelGatePass} style={{ marginTop: 'var(--sp-3)' }}>
            <input type="hidden" name="id" value={p.id} />
            <Button type="submit" variant="ghost" size="sm">
              {t(lang, 'Cancel')}
            </Button>
          </form>
        ) : null}
      </Card>
      <Card title={t(lang, 'Approval by the school')}>
        <ul className="ep-hd__timeline">
          {p.approvals
            .filter((a) => a.status !== 'skipped')
            .map((a) => (
              <li key={a.seq}>
                <span>
                  {a.label}
                  {a.actedBy ? ` · ${a.actedBy}` : ''}
                  {a.note ? ` · ${a.note}` : ''}{' '}
                  <Badge tone={LEVEL[a.status]![1]}>{t(lang, LEVEL[a.status]![0])}</Badge>
                </span>
                <span className="ep-field__help">{a.actedAt ? when(a.actedAt) : ''}</span>
              </li>
            ))}
        </ul>
      </Card>
    </main>
  );
}
