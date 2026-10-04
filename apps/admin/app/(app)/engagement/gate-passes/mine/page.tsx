import { Badge, Button, Card, PageHeader } from '@edupro/ui';
import { GatePassNav } from '@/components/gate-passes/GatePassNav';
import { Notice } from '@/components/Notice';
import { apiFetch, getMe } from '@/lib/api';
import { when } from '@/lib/appointments';
import { cancelStaffPass } from '@/lib/gate-pass-actions';
import {
  KIND_LABEL,
  STATE_TONE,
  approvalLine,
  lateBack,
  outsideFor,
  type GatePass,
} from '@/lib/gate-passes';

interface Mine {
  data: GatePass[];
  page: { number: number; size: number; total: number };
}
const PAGE_SIZE = 20;

/** My own gate passes (RGP / NRGP): what I asked, where the approval stands, the pass card once approved. */
export default async function MyGatePassesPage({
  searchParams,
}: {
  searchParams: Promise<{
    state?: string;
    page?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  const state = ['open', 'past'].includes(sp.state ?? '') ? sp.state! : '';
  const page = Math.max(1, Number(sp.page) || 1);
  const [me, list] = await Promise.all([
    getMe(),
    apiFetch<Mine>(
      `/gate-passes/staff?${new URLSearchParams({ ...(state ? { state } : {}), page: String(page), size: String(PAGE_SIZE) }).toString()}`,
    ),
  ]);
  const pages = Math.ceil(list.page.total / PAGE_SIZE);
  const href = (n: number) =>
    `?${new URLSearchParams({ ...(state ? { state } : {}), page: String(n) }).toString()}`;
  return (
    <>
      <PageHeader
        kicker="Gate passes"
        title="My gate passes"
        description="Your own passes to go out during school: RGP (you come back) and NRGP (you do not)."
        actions={
          <a className="ep-btn ep-btn--primary ep-btn--sm" href="/engagement/gate-passes/mine/new">
            Apply for a gate pass
          </a>
        }
      />
      <GatePassNav current="/engagement/gate-passes/mine" permissions={me.permissions} ok={sp.ok} />
      <Notice params={{ error: sp.error, detail: sp.detail }} />
      <nav className="ep-tabs-links" aria-label="Lists" style={{ marginBottom: 'var(--sp-3)' }}>
        {(
          [
            ['', 'All'],
            ['open', 'Running'],
            ['past', 'Over or closed'],
          ] as const
        ).map(([v, label]) => (
          <a key={v} href={v ? `?state=${v}` : '?'} aria-current={state === v ? 'page' : undefined}>
            {label}
          </a>
        ))}
      </nav>
      {list.data.length === 0 ? (
        <Card>
          <p className="ep-field__help" style={{ margin: 0 }}>
            No gate passes here. Use Apply for a gate pass when you need to go out during school.
          </p>
        </Card>
      ) : null}
      {list.data.map((p) => (
        <Card
          key={p.id}
          title={`${p.number} · ${KIND_LABEL[p.kind]}`}
          actions={<Badge tone={STATE_TONE[p.state]}>{p.stage}</Badge>}
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          <p style={{ marginTop: 0 }}>
            {p.onDate}
            {p.atTime ? `, ${p.atTime}` : ''}
            {p.returnBy ? ` · back by ${when(p.returnBy)}` : ''} · {p.reason}
          </p>
          <p className="ep-field__help">
            {[
              p.destination ? `Going to ${p.destination}` : null,
              p.items ? `${String(p.items)} item(s)` : null,
              approvalLine(p),
              p.outAt ? `Gate out ${when(p.outAt)}` : null,
              p.inAt ? `Gate in ${when(p.inAt)}` : null,
              outsideFor(p) ? `${outsideFor(p)!} outside` : null,
              lateBack(p) ? 'back late' : null,
              p.decisionNote ?? p.cancelReason,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <div className="ep-gate__act">
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href={`/engagement/gate-passes/${p.id}`}
              aria-label={`Details of ${p.number}`}
            >
              Details
            </a>
            {p.passNo ? (
              <a
                className="ep-btn ep-btn--secondary ep-btn--sm"
                href={`/api/gate-passes/${p.id}/card`}
                aria-label={`Download the pass ${p.number} as PDF`}
              >
                Download PDF
              </a>
            ) : null}
            {['pending', 'approved'].includes(p.state) ? (
              <form action={cancelStaffPass}>
                <input type="hidden" name="id" value={p.id} />
                <Button
                  type="submit"
                  size="sm"
                  variant="secondary"
                  aria-label={`Cancel ${p.number}`}
                >
                  Cancel
                </Button>
              </form>
            ) : null}
          </div>
        </Card>
      ))}
      {pages > 1 ? (
        <nav
          aria-label="Pages"
          style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'center' }}
        >
          {page > 1 ? (
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href={href(page - 1)}>
              ← Previous
            </a>
          ) : null}
          <span className="ep-field__help">
            Page {page} of {pages}
          </span>
          {page < pages ? (
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href={href(page + 1)}>
              Next →
            </a>
          ) : null}
        </nav>
      ) : null}
    </>
  );
}
