import { Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { Notice } from '@/components/Notice';
import {
  CertificatesTab,
  ChallansTab,
  DeclarationsTab,
  PerqTab,
  PrevTab,
  ReturnsTab,
  YearTab,
} from '@/components/payroll/tax/TaxTabs';
import { ApiError, apiFetch, getMe } from '@/lib/api';

const TABS = [
  { id: 'declarations', label: 'Declarations' },
  { id: 'prev', label: 'Earlier employers' },
  { id: 'perquisites', label: 'Perquisites' },
  { id: 'challans', label: 'TDS challans' },
  { id: 'returns', label: 'Quarterly return' },
  { id: 'certificates', label: 'Form 16 / 130' },
  { id: 'year', label: 'The year' },
] as const;

function currentFy() {
  const t = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  const y = Number(t.slice(5, 7)) >= 4 ? Number(t.slice(0, 4)) : Number(t.slice(0, 4)) - 1;
  return `${String(y)}-${String((y + 1) % 100).padStart(2, '0')}`;
}

/**
 * Income tax (docs/design/86, phase D; legacy Tax Centre): the year's declarations and proofs, earlier employers,
 * perquisites, TDS challans, the quarterly return files, the certificates (Form 16 / 130) and the year's settings.
 * An employee's year opens from their name.
 */
export default async function PayrollTaxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('payroll.run.view')) notFound();
  const p = me.permissions;
  const tab = TABS.find((t) => t.id === sp.tab)?.id ?? 'declarations';
  const now = currentFy();
  const fy = /^\d{4}-\d{2}$/.test(sp.fy ?? '') ? sp.fy! : now;
  const y = Number(now.slice(0, 4));
  const years = [y - 1, y].map((x) => `${String(x)}-${String((x + 1) % 100).padStart(2, '0')}`);
  const status = ['SUBMITTED', 'VERIFIED', 'REJECTED', 'ALL'].includes(sp.status ?? '')
    ? sp.status!
    : 'SUBMITTED';
  let body: ReactNode;
  try {
    const staff = ['declarations', 'prev', 'perquisites'].includes(tab)
      ? (
          await apiFetch<{ rows: Array<{ id: string; code: string; name: string }> }>(
            `/payroll/inputs/staff?month=${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date()).slice(0, 7)}`,
          )
        ).rows
      : [];
    body =
      tab === 'declarations' ? (
        await DeclarationsTab({ fy, status, staff })
      ) : tab === 'prev' ? (
        await PrevTab({ fy, staff, canManage: p.includes('payroll.run.manage') })
      ) : tab === 'perquisites' ? (
        await PerqTab({ fy, staff })
      ) : tab === 'challans' ? (
        await ChallansTab({ fy })
      ) : tab === 'returns' ? (
        ReturnsTab({ fy, canFile: p.includes('payroll.run.approve') })
      ) : tab === 'certificates' ? (
        p.includes('payroll.run.approve') ? (
          await CertificatesTab({ fy })
        ) : (
          <p className="ep-card">A payroll checker makes and releases the certificates.</p>
        )
      ) : (
        await YearTab({ fy, canCheck: p.includes('payroll.run.approve') })
      );
  } catch (e) {
    if (e instanceof ApiError && (e.status === 403 || e.status === 404)) notFound();
    throw e;
  }
  return (
    <>
      <Breadcrumbs items={[{ label: 'Payroll' }, { label: 'Income tax' }]} />
      <PageHeader
        kicker="Payroll"
        title={`Income tax · ${fy}`}
        description="Declarations and proofs, earlier employers, perquisites, TDS challans, the quarterly return and the certificates. Each employee’s year opens from their name."
      />
      <Notice params={sp} />
      <nav
        aria-label="Financial year"
        className="ep-field__help"
        style={{ marginBottom: 'var(--sp-3)' }}
      >
        {years.map((x, i) => (
          <span key={x}>
            {i ? ' · ' : ''}
            {x === fy ? <strong>{x}</strong> : <a href={`/payroll/tax?fy=${x}&tab=${tab}`}>{x}</a>}
          </span>
        ))}
      </nav>
      <nav className="ep-tabs" aria-label="Income tax">
        {TABS.map((t) => (
          <a
            key={t.id}
            className="ep-tabs__tab"
            href={`/payroll/tax?fy=${fy}&tab=${t.id}`}
            aria-current={t.id === tab ? 'page' : undefined}
          >
            {t.label}
          </a>
        ))}
      </nav>
      {body}
    </>
  );
}
