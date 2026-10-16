import { Button, Card, PageHeader } from '@edupro/ui';
import { HostelReportView } from '@/components/hostel/HostelReportView';
import { HostelNav } from '@/components/hostel/HostelNav';
import { Notice } from '@/components/Notice';
import { apiFetch, getMe } from '@/lib/api';

const STATUSES = [
  ['open', 'Open'],
  ['requested', 'Waiting for approval'],
  ['completed', 'Left the hostel'],
  ['rejected', 'Not approved'],
  ['cancelled', 'Cancelled'],
  ['all', 'All'],
] as const;

/**
 * Hostel withdrawals: pupils leaving the hostel (and staying in school), step by step. "Waiting for me"
 * shows those whose current step this person clears; the register goes out as Excel or PDF.
 */
export default async function HostelWithdrawalsPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    mine?: string;
    hostelId?: string;
    leavingFrom?: string;
    leavingTo?: string;
    q?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  const status = STATUSES.some(([k]) => k === sp.status) ? sp.status! : 'open';
  const [me, hostels] = await Promise.all([
    getMe(),
    apiFetch<{ data: Array<{ id: string; name: string }> }>('/hostel/hostels').then((r) => r.data),
  ]);
  // the report reads the same filters (leaving from/to as from/to)
  const query = new URLSearchParams({
    status,
    ...(sp.mine === '1' ? { mine: 'true' } : {}),
    ...(sp.hostelId ? { hostelId: sp.hostelId } : {}),
    ...(sp.leavingFrom ? { from: sp.leavingFrom } : {}),
    ...(sp.leavingTo ? { to: sp.leavingTo } : {}),
    ...(sp.q ? { q: sp.q } : {}),
  });
  const can = (p: string) => me.permissions.includes(p);
  const link = (patch: Record<string, string | null>) => {
    const u = new URLSearchParams({
      status,
      ...(sp.mine === '1' ? { mine: '1' } : {}),
      ...(sp.hostelId ? { hostelId: sp.hostelId } : {}),
      ...(sp.leavingFrom ? { leavingFrom: sp.leavingFrom } : {}),
      ...(sp.leavingTo ? { leavingTo: sp.leavingTo } : {}),
      ...(sp.q ? { q: sp.q } : {}),
    });
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) u.delete(k);
      else u.set(k, v);
    }
    return `/hostel/withdrawals?${u.toString()}`;
  };
  return (
    <>
      <PageHeader
        kicker="Hostel"
        title="Hostel withdrawals"
        description="Pupils leaving the hostel and staying in school. Each goes through the approval levels of Fee setup → Approval levels; the last approval gives up the bed and settles the hostel fee. A pupil leaving the school is cleared by the hostel inside the school withdrawal."
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            {can('hostel.withdrawal.manage') ? (
              <a className="ep-btn ep-btn--primary ep-btn--sm" href="/hostel/withdrawals/new">
                New withdrawal
              </a>
            ) : null}
            {can('hostel.setup.manage') ? (
              <a
                className="ep-btn ep-btn--secondary ep-btn--sm"
                href="/hostel/withdrawals/settings"
              >
                Steps and notice
              </a>
            ) : null}
          </span>
        }
      />
      <HostelNav current="/hostel/withdrawals" permissions={me.permissions} />
      <Notice params={sp} />
      <nav className="ep-tabs-links" aria-label="Status" style={{ marginBottom: 'var(--sp-3)' }}>
        <a
          href={link({ mine: '1', status: 'open' })}
          aria-current={sp.mine === '1' ? 'page' : undefined}
        >
          Waiting for me
        </a>
        {STATUSES.map(([k, label]) => (
          <a
            key={k}
            href={link({ status: k, mine: null })}
            aria-current={sp.mine !== '1' && status === k ? 'page' : undefined}
          >
            {label}
          </a>
        ))}
      </nav>
      <Card style={{ marginBottom: 'var(--sp-4)' }}>
        <form method="get" className="ep-hd__row">
          <input type="hidden" name="status" value={status} />
          {sp.mine === '1' ? <input type="hidden" name="mine" value="1" /> : null}
          <label className="ep-field" htmlFor="hw-q">
            <span className="ep-field__label">Pupil</span>
            <input
              id="hw-q"
              name="q"
              type="search"
              className="ep-input"
              defaultValue={sp.q ?? ''}
              placeholder="Name or admission no."
            />
          </label>
          <label className="ep-field" htmlFor="hw-h">
            <span className="ep-field__label">Hostel</span>
            <select
              id="hw-h"
              name="hostelId"
              className="ep-select"
              defaultValue={sp.hostelId ?? ''}
            >
              <option value="">All</option>
              {hostels.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          </label>
          <label className="ep-field" htmlFor="hw-f">
            <span className="ep-field__label">Leaving from</span>
            <input
              id="hw-f"
              name="leavingFrom"
              type="date"
              className="ep-input"
              defaultValue={sp.leavingFrom ?? ''}
            />
          </label>
          <label className="ep-field" htmlFor="hw-t">
            <span className="ep-field__label">to</span>
            <input
              id="hw-t"
              name="leavingTo"
              type="date"
              className="ep-input"
              defaultValue={sp.leavingTo ?? ''}
            />
          </label>
          <Button type="submit" variant="secondary">
            Apply
          </Button>
        </form>
      </Card>
      <HostelReportView report="withdrawals" query={query} back={link({})} />
    </>
  );
}
