import { Badge, Breadcrumbs, KpiTile, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { SetupListBar } from '@/components/payroll/SetupListBar';
import { ApiError, getMe } from '@/lib/api';
import { setupList, type SetupList, type SetupListNav } from '@/lib/payroll-lists';
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
  let list: SetupList<ProfileList['rows'][number]>;
  let nav: SetupListNav;
  try {
    ({ list, nav } = await setupList<ProfileList['rows'][number]>(
      'profiles',
      '/payroll/setup/profiles',
      sp,
    ));
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) notFound();
    throw e;
  }
  const d = {
    figures: (list.extra?.figures ?? {
      staff: 0,
      profiles: 0,
      missing: 0,
      hold: 0,
    }) as ProfileList['figures'],
    can: { manage: me.permissions.includes('payroll.setup.manage') },
  };
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
        <SetupListBar list={list} nav={nav} id="pp">
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
                {list.rows.length ? (
                  list.rows.map((r) => (
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
        </SetupListBar>
      </section>
    </>
  );
}
