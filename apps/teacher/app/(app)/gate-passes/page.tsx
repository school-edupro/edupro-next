import { Card, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';
import { PASS_KIND, type Pass } from '@/lib/gate-pass';
import { currentLang, t } from '@/lib/i18n';
import { approveGatePass, cancelGatePass, decideGatePass, rejectGatePass } from './actions';
import { GatePassFeed, type PassWords } from './GatePassFeed';

/** The first page of each list: 10; the rest load as the person scrolls. */
const PAGE = 10;

const OK: Record<string, string> = {
  approved: 'Approved at your level.',
  rejected: 'Rejected. The family or the employee has been told.',
  requested: 'Gate pass requested. It has gone for approval.',
  cancelled: 'Gate pass cancelled.',
};
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
  type List = { data: Pass[]; page: { total: number } | null };
  let inbox: List & { waiting: number };
  let mine: List;
  try {
    [inbox, mine] = await Promise.all([
      bff.api.fetch<List & { waiting: number }>(`/gate-passes/inbox?page=1&size=${String(PAGE)}`),
      bff.api.fetch<List>(`/gate-passes/staff?page=1&size=${String(PAGE)}`),
    ]);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    throw error;
  }
  const named = (rows: Pass[]) => rows.map((p) => ({ ...p, stageLabel: t(lang, p.stage) }));
  const words: PassWords = {
    kind: Object.fromEntries(
      (Object.keys(PASS_KIND) as Pass['kind'][]).map((k) => [k, t(lang, PASS_KIND[k])]),
    ) as Record<Pass['kind'], string>,
    adm: t(lang, 'Adm. no.'),
    backBy: t(lang, 'back by'),
    with: t(lang, 'With'),
    items: t(lang, 'item(s) carried out'),
    details: t(lang, 'Details'),
    note: t(lang, 'Note (needed to reject)'),
    approve: t(lang, 'Approve'),
    reject: t(lang, 'Reject'),
    waitingOn: t(lang, 'Waiting on'),
    gateOut: t(lang, 'Gate out'),
    gateIn: t(lang, 'Gate in'),
    pdf: t(lang, 'Download the pass (PDF)'),
    cancel: t(lang, 'Cancel'),
  };
  const foot = {
    more: t(lang, 'Show more'),
    loading: t(lang, 'Loading…'),
    failed: t(lang, 'Could not load more.'),
    end: t(lang, 'That is everything.'),
  };
  const actions = {
    decide: decideGatePass,
    approve: approveGatePass,
    reject: rejectGatePass,
    cancel: cancelGatePass,
  };
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
        {t(lang, 'To approve')} · {String(inbox.waiting)}
      </h2>
      {inbox.data.length === 0 ? (
        <Card style={{ marginBottom: 'var(--sp-3)' }}>{t(lang, 'Nothing waits for you.')}</Card>
      ) : (
        <GatePassFeed
          box="inbox"
          first={named(inbox.data)}
          more={PAGE < (inbox.page?.total ?? 0)}
          words={words}
          foot={foot}
          actions={actions}
        />
      )}
      <h2 id="mine" className="ep-cdash__h3" style={{ marginTop: 'var(--sp-4)' }}>
        {t(lang, 'My gate passes')}
      </h2>
      {mine.data.length === 0 ? (
        <Card>{t(lang, 'You have not asked for a gate pass yet.')}</Card>
      ) : (
        <GatePassFeed
          box="mine"
          first={named(mine.data)}
          more={PAGE < (mine.page?.total ?? 0)}
          words={words}
          foot={foot}
          actions={actions}
        />
      )}
    </main>
  );
}
