import { AcrSheet, type AcrReportView } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { PrintButton } from '@/components/PrintButton';
import { apiFetch, getMe } from '@/lib/api';

/**
 * Printed ACRs (one, or every ACR shown on the board, up to 100): each on its own pages, read-only, with
 * the signature lines. Print, or save as PDF from the print dialog.
 */
export default async function AcrPrintPage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string }>;
}) {
  const sp = await searchParams;
  const ids = (sp.ids ?? '')
    .split(',')
    .filter((x) => /^\d{1,18}$/.test(x))
    .slice(0, 100);
  if (!ids.length) notFound();
  const me = await getMe();
  const school = me.memberships.find((m) => m.schoolId === me.school?.id)?.schoolName ?? '';
  const reports = (
    await Promise.all(
      ids.map((id) => apiFetch<AcrReportView>(`/people/acr/reports/${id}`).catch(() => null)),
    )
  ).filter((r): r is AcrReportView => r !== null);
  if (!reports.length) notFound();
  const readOnly = (r: AcrReportView): AcrReportView => ({
    ...r,
    can: {
      self: false,
      level: null,
      sendBack: false,
      acknowledge: false,
      represent: false,
      decide: false,
      manage: false,
    },
  });
  return (
    <>
      <div
        className="ep-noprint"
        style={{
          display: 'flex',
          gap: 'var(--sp-2)',
          marginBottom: 'var(--sp-4)',
          alignItems: 'center',
        }}
      >
        <PrintButton
          label={reports.length > 1 ? `Print ${String(reports.length)} ACRs` : 'Print'}
        />
        <span className="ep-field__help">
          To keep a PDF, choose “Save as PDF” in the print dialog.
        </span>
      </div>
      {reports.map((r) => (
        <article
          key={r.id}
          className="ep-print-sheet ep-acr-print"
          aria-label={`ACR of ${r.employee.name}`}
        >
          <header className="ep-acr-print__head">
            <strong>{school}</strong>
            <span>Annual Confidential Report · Confidential</span>
          </header>
          <AcrSheet report={readOnly(r)} actions={{}} />
          <div className="ep-print-sheet__sign">
            <span>Employee</span>
            {r.levels.map((l) => (
              <span key={l.seq}>{l.label}</span>
            ))}
          </div>
        </article>
      ))}
    </>
  );
}
