import { Badge, Breadcrumbs, KpiTile, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { Pager, PerPage, pageSizeOf } from '@/components/Pager';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { dmy, type ProfileList } from '@/lib/payroll';
import { syncProfiles } from '@/lib/payroll-actions';

const STATUS = { ACTIVE: 'Paid', HOLD: 'On hold', LEFT: 'Left' } as Record<string, string>;
const MODE = { BANK: 'Bank', CASH: 'Cash', CHEQUE: 'Cheque' } as Record<string, string>;

/** Payroll profiles (legacy Employee payroll details): the statutory switches, regime, level and cell of each employee. */
export default async function PayrollProfilesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('payroll.setup.view')) notFound();
  const q = (sp.q ?? '').trim().slice(0, 60);
  const profile = ['missing', 'present'].includes(sp.profile ?? '') ? sp.profile! : 'all';
  const status = ['ACTIVE', 'HOLD', 'LEFT'].includes(sp.status ?? '') ? sp.status! : '';
  const size = Math.min(100, Number(pageSizeOf(sp.size)));
  const sizeQ = [25, 50, 100].includes(size) ? size : 25;
  const page = Math.max(1, Number(sp.page) || 1);
  const qs = (p: number) => {
    const u = new URLSearchParams();
    if (q) u.set('q', q);
    if (profile !== 'all') u.set('profile', profile);
    if (status) u.set('status', status);
    u.set('size', String(sizeQ));
    u.set('page', String(p));
    return u.toString();
  };
  let d: ProfileList;
  try {
    d = await apiFetch<ProfileList>(`/payroll/profiles?${qs(page)}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) notFound();
    throw e;
  }
  const f = d.figures;
  return (
    <>
      <Breadcrumbs
        items={[{ label: 'Payroll set-up', href: '/payroll/setup' }, { label: 'Payroll profiles' }]}
      />
      <PageHeader
        kicker="Payroll set-up"
        title="Payroll profiles"
        description="What payroll needs to know about each employee besides the pay: PF, ESI, profession tax and NPS, the tax regime, the level and cell, how they are paid. Identity, PAN, UAN and bank stay on the employee record."
      />
      <Notice params={sp} />
      <div className="ep-dash-kpis ep-dash-kpis--4">
        <KpiTile label="Active staff" value={String(f.staff)} />
        <KpiTile label="With a profile" value={String(f.profiles)} />
        <KpiTile label="Missing" value={String(f.missing)} />
        <KpiTile label="On hold" value={String(f.hold)} />
      </div>
      <section className="ep-card" aria-labelledby="pp-list">
        <div className="ep-grid__toolbar">
          <h2 id="pp-list" className="ep-card__title">
            Staff
          </h2>
          <span className="ep-grid__spacer" />
          {d.can.manage && f.missing ? (
            <form action={syncProfiles}>
              <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm">
                Make the {f.missing} missing profile(s)
              </button>
            </form>
          ) : null}
        </div>
        <form method="get" className="ep-pfilter ep-grid__toolbar">
          <label className="ep-field" htmlFor="pp-q">
            <span className="ep-field__label">Name or code</span>
            <input id="pp-q" name="q" className="ep-input" defaultValue={q} maxLength={60} />
          </label>
          <label className="ep-field" htmlFor="pp-profile">
            <span className="ep-field__label">Profile</span>
            <select id="pp-profile" name="profile" className="ep-select" defaultValue={profile}>
              <option value="all">All</option>
              <option value="missing">Missing</option>
              <option value="present">Made</option>
            </select>
          </label>
          <label className="ep-field" htmlFor="pp-status">
            <span className="ep-field__label">Payroll status</span>
            <select id="pp-status" name="status" className="ep-select" defaultValue={status}>
              <option value="">Any</option>
              <option value="ACTIVE">Paid</option>
              <option value="HOLD">On hold</option>
              <option value="LEFT">Left</option>
            </select>
          </label>
          <PerPage id="pp-size" value={String(sizeQ)} />
          <button type="submit" className="ep-btn ep-btn--ghost">
            Show
          </button>
        </form>
        <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="pp-list">
          <table className="ep-table ep-table--dense">
            <thead>
              <tr>
                <th scope="col">Employee</th>
                <th scope="col">Department</th>
                <th scope="col">Level · cell</th>
                <th scope="col">Regime</th>
                <th scope="col">PAN · bank</th>
                <th scope="col">Paid by</th>
                <th scope="col">Structure</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {d.rows.length ? (
                d.rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <a href={`/payroll/setup/profiles/${r.id}`}>{r.name}</a>
                      <span className="ep-field__help" style={{ display: 'block', margin: 0 }}>
                        {r.code}
                        {r.designation ? ` · ${r.designation}` : ''}
                      </span>
                    </td>
                    <td>{r.department ?? ''}</td>
                    <td>{r.payLevel ? `${r.payLevel} · ${String(r.payCell ?? '')}` : ''}</td>
                    <td>{r.taxRegime ? (r.taxRegime === 'NEW' ? 'New' : 'Old') : ''}</td>
                    <td>
                      {r.panMasked ?? <Badge tone="warning">No PAN</Badge>}
                      <span className="ep-field__help" style={{ display: 'block', margin: 0 }}>
                        {r.bankMasked ?? 'No bank account'}
                      </span>
                    </td>
                    <td>{r.payMode ? MODE[r.payMode] : ''}</td>
                    <td>
                      {r.structured ? (
                        <a href={`/payroll/setup/structures/${r.id}`}>In force</a>
                      ) : (
                        <a href={`/payroll/setup/structures/${r.id}`}>
                          <Badge tone="neutral">None</Badge>
                        </a>
                      )}
                    </td>
                    <td>
                      {r.hasProfile ? (
                        <Badge
                          tone={
                            r.payrollStatus === 'ACTIVE'
                              ? 'success'
                              : r.payrollStatus === 'HOLD'
                                ? 'warning'
                                : 'neutral'
                          }
                        >
                          {STATUS[r.payrollStatus ?? ''] ?? ''}
                        </Badge>
                      ) : (
                        <Badge tone="danger">No profile</Badge>
                      )}
                      {r.contractEnd ? (
                        <span className="ep-field__help" style={{ display: 'block', margin: 0 }}>
                          Contract to {dmy(r.contractEnd)}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8}>No staff match.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Pager
          page={d.page}
          size={d.size}
          total={d.total}
          href={(p) => `/payroll/setup/profiles?${qs(p)}`}
          noun="staff"
        />
      </section>
    </>
  );
}
