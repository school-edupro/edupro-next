import { Breadcrumbs, KpiTile, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { FoldCard } from '@/components/FoldCard';
import { Notice } from '@/components/Notice';
import { dmy, monthLabel } from '@/components/payroll/people/PeopleTabs';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { money } from '@/lib/payroll';
import { bringTransfer } from '@/lib/payroll-people-actions';

interface Plan {
  employeeId: string;
  imported: boolean;
  packet: {
    onDate: string;
    source: { school: string; tan: string | null; code: string; lastLocked: string | null };
    profile: Record<string, unknown> | null;
    loans: Array<{ id: string; type: string; balance: string; emi: string }>;
    tax: {
      fy: string;
      from: string | null;
      to: string;
      months: number;
      taxable: string;
      pf: string;
      pt: string;
      tds: string;
    };
  };
  structures: Array<{ code: string; amount: string }>;
  dropped: string[];
  writesPrev: boolean;
  writesProfile: boolean;
  notices: string[];
}

/**
 * A transfer from a sister school (docs/design/86, phase E): what payroll brings across, read from the source now —
 * the year's salary and tax there, the pay structure, the loans owed — and the one step that brings it.
 */
export default async function TransferPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d{1,18}$/.test(id)) notFound();
  const me = await getMe();
  if (!me.permissions.includes('payroll.run.approve')) notFound();
  let p: Plan;
  try {
    p = await apiFetch<Plan>(`/payroll/transfers/${id}`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 403 || e.status === 404)) notFound();
    throw e;
  }
  const k = p.packet;
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Payroll' },
          { label: 'Pay changes and leavers', href: '/payroll/people?tab=transfers' },
          { label: `From ${k.source.school}` },
        ]}
      />
      <PageHeader
        kicker="Transfer"
        title={`From ${k.source.school} on ${dmy(k.onDate)}`}
        description={`Their code there ${k.source.code}. ${p.imported ? 'The figures as they were brought across.' : `The figures are read from ${k.source.school} now.`}`}
      />
      <Notice params={sp} />
      <div className="ep-dash-kpis">
        <KpiTile
          label={`Salary there in ${k.tax.fy}`}
          value={`₹${money(k.tax.taxable)}`}
          hint={`${String(k.tax.months)} month(s)`}
        />
        <KpiTile label="Tax deducted there" value={`₹${money(k.tax.tds)}`} />
        <KpiTile label="PF there" value={`₹${money(k.tax.pf)}`} />
        <KpiTile label="Profession tax there" value={`₹${money(k.tax.pt)}`} />
        <KpiTile label="Pay heads" value={String(p.structures.length)} />
        <KpiTile label="Loans owed" value={String(k.loans.length)} />
      </div>
      {p.notices.length ? (
        <div className="ep-alert ep-alert--warning" role="status">
          <ul className="ep-list">
            {p.notices.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <section className="ep-card" aria-labelledby="tr-do">
        <h2 id="tr-do" className="ep-card__title">
          {p.imported ? 'Brought across' : 'Bring it across'}
        </h2>
        {p.imported ? (
          <>
            <ul className="ep-list">
              <li>
                {p.writesPrev
                  ? `The earlier-employer record of ${k.tax.fy}: salary ₹${money(k.tax.taxable)}, tax ₹${money(k.tax.tds)} (in Income tax → Earlier employers).`
                  : 'No earlier-employer record was written.'}
              </li>
              <li>
                {p.writesProfile ? 'The payroll profile.' : 'The payroll profile here was kept.'}
              </li>
              <li>
                The pay structure as drafts:{' '}
                {p.structures.map((s) => `${s.code} ₹${money(s.amount)}`).join(', ') || 'none'} —
                another checker approves them in Payroll drafts to approve.
              </li>
              <li>
                {k.loans.length
                  ? `The loans: ${k.loans.map((l) => `${l.type} ₹${money(l.balance)}`).join(', ')}, closed at ${k.source.school}.`
                  : 'No loan.'}
              </li>
            </ul>
          </>
        ) : (
          <>
            <ul className="ep-list">
              <li>
                {p.writesPrev
                  ? `The earlier-employer record of ${k.tax.fy}${k.source.tan ? ` (TAN ${k.source.tan})` : ''}, verified: ${monthLabel(
                      (k.tax.from ?? k.onDate).slice(0, 7),
                    )} to ${dmy(k.tax.to)}.`
                  : 'No earlier-employer record (none to write, or one is already here).'}
              </li>
              <li>
                {p.writesProfile ? 'The payroll profile.' : 'The payroll profile here is kept.'}
              </li>
              <li>
                The pay structure from {dmy(k.onDate)} as drafts:{' '}
                {p.structures.map((s) => `${s.code} ₹${money(s.amount)}`).join(', ') || 'none'}.
              </li>
              <li>
                {k.loans.length
                  ? `The loans owed (${k.loans.map((l) => `${l.type} ₹${money(l.balance)}`).join(', ')}), closed at the source.`
                  : 'No loan owed.'}
              </li>
            </ul>
            <form action={bringTransfer.bind(null, id)} className="ep-grid__toolbar">
              <button type="submit" className="ep-btn ep-btn--primary">
                Bring it across
              </button>
            </form>
          </>
        )}
      </section>
      {k.profile ? (
        <FoldCard
          id="tr-prof"
          title="The profile there"
          hint="PF, ESI, tax regime, pay level and cell"
        >
          <ul className="ep-list">
            {Object.entries(k.profile)
              .filter(([, v]) => v !== null && v !== '')
              .map(([key, v]) => (
                <li key={key}>
                  {key.replace(/_/g, ' ')}: {String(v)}
                </li>
              ))}
          </ul>
        </FoldCard>
      ) : null}
    </>
  );
}
