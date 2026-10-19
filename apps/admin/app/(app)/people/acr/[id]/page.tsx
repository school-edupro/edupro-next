import { Breadcrumbs, PageHeader, type AcrReportView } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { AcrReport } from '@/components/acr/AcrReport';
import { ExportWatcher } from '@/components/ExportWatcher';
import { Notice } from '@/components/Notice';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { ACR_PDF_LABELS, type AcrSetup } from '@/lib/acr';
import { acrDecide, acrOffice, acrSetPeople, requestAcrPdf } from '@/lib/acr-actions';

/** One employee ACR (docs/design/32-employee-acr.md): the sheet, and the school's controls. */
export default async function AcrReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; detail?: string; export?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d{1,18}$/.test(id)) notFound();
  const me = await getMe();
  const report = await apiFetch<AcrReportView>(`/people/acr/reports/${id}`).catch((e: unknown) => {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  });
  const manage = report.can.manage && me.permissions.includes('people.acr.manage');
  const staff = manage ? (await apiFetch<AcrSetup>('/people/acr/setup')).staff : [];
  const open = report.levels.filter((l) => l.status !== 'done');
  const o = report.self.office;

  const extra = manage ? (
    <section className="ep-card ep-acr-card" aria-labelledby="acr-school-h">
      <h2 id="acr-school-h" className="ep-card__title">
        For the school
      </h2>
      <div className="ep-grid-2">
        <form action={acrOffice}>
          <input type="hidden" name="id" value={id} />
          <h3 className="ep-field__label">Leave taken this year (office)</h3>
          <div className="ep-fit-row">
            {(
              [
                ['cl', 'CL', o.cl],
                ['el', 'EL', o.el],
                ['other', 'Other leave', o.other],
                ['absent', 'Total absence', o.absent],
              ] as const
            ).map(([k, label, v]) => (
              <label key={k} className="ep-field" htmlFor={`of-${k}`}>
                <span className="ep-field__label">{label}</span>
                <input
                  id={`of-${k}`}
                  name={k}
                  type="number"
                  min={0}
                  max={366}
                  step="0.5"
                  className="ep-input"
                  defaultValue={v ?? ''}
                />
              </label>
            ))}
          </div>
          <label className="ep-field" htmlFor="of-note">
            <span className="ep-field__label">Note</span>
            <input
              id="of-note"
              name="note"
              className="ep-input"
              maxLength={500}
              defaultValue={o.note ?? ''}
            />
          </label>
          <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
            Save leave
          </button>
        </form>
        {open.length ? (
          <div>
            {open.map((l) => (
              <form key={l.seq} action={acrSetPeople} style={{ marginBottom: 'var(--sp-3)' }}>
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="seq" value={l.seq} />
                <label className="ep-field" htmlFor={`pp-${String(l.seq)}`}>
                  <span className="ep-field__label">
                    Who fills level {l.seq}, {l.label} (hold Ctrl or ⌘ for several)
                  </span>
                  <select
                    id={`pp-${String(l.seq)}`}
                    name="employeeIds"
                    className="ep-select"
                    multiple
                    size={5}
                    defaultValue={l.people?.map((p) => p.id) ?? []}
                  >
                    {staff
                      .filter((s) => s.id !== report.employee.id)
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} ({s.code})
                        </option>
                      ))}
                  </select>
                </label>
                <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
                  Save people of level {l.seq}
                </button>
              </form>
            ))}
          </div>
        ) : null}
      </div>
      {report.can.decide ? (
        <form action={acrDecide} className="ep-acr-note">
          <input type="hidden" name="id" value={id} />
          <h3 className="ep-field__label">Decide the objection</h3>
          <div className="ep-fit-row">
            <label className="ep-field" htmlFor="dc-decision">
              <span className="ep-field__label">Decision *</span>
              <select id="dc-decision" name="decision" className="ep-select" defaultValue="upheld">
                <option value="upheld">Keep the grade ({report.result?.grade ?? ''})</option>
                <option value="revised">Revise the grade</option>
              </select>
            </label>
            <label className="ep-field" htmlFor="dc-grade">
              <span className="ep-field__label">Revised grade</span>
              <select id="dc-grade" name="grade" className="ep-select" defaultValue="">
                <option value="">—</option>
                {report.bands.map((b) => (
                  <option key={b.label} value={b.label}>
                    {b.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="ep-field" htmlFor="dc-note">
            <span className="ep-field__label">Reasons (shown to the employee) *</span>
            <textarea
              id="dc-note"
              name="note"
              className="ep-input"
              rows={3}
              minLength={5}
              maxLength={2000}
              required
            />
          </label>
          <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm">
            Save the decision
          </button>
        </form>
      ) : null}
    </section>
  ) : null;

  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Employee management', href: '/people/employees' },
          { label: 'Employee ACR', href: `/people/acr?cycle=${report.cycle.id}` },
          { label: report.employee.name },
        ]}
      />
      <PageHeader
        kicker="Employee ACR"
        title={report.employee.name}
        description={`Annual confidential report · ${report.employee.code}`}
        actions={
          <span style={{ display: 'flex', gap: 'var(--sp-2)' }}>
            <form action={requestAcrPdf}>
              <input type="hidden" name="ids" value={id} />
              <input type="hidden" name="back" value={`/people/acr/${id}`} />
              <button type="submit" className="ep-btn ep-btn--primary">
                PDF
              </button>
            </form>
            <a
              className="ep-btn ep-btn--secondary"
              href={`/people/acr/print?ids=${id}`}
              target="_blank"
              rel="noopener"
            >
              Print view
            </a>
            <a
              className="ep-btn ep-btn--ghost"
              href={`/people/employees/${report.employee.id}?tab=acr`}
            >
              Employee
            </a>
          </span>
        }
      />
      <Notice params={sp} />
      {sp.export && /^\d{1,18}$/.test(sp.export) ? (
        <ExportWatcher id={sp.export} format="pdf" labels={ACR_PDF_LABELS} />
      ) : null}
      <AcrReport report={report} />
      {extra ? <div style={{ marginTop: 'var(--sp-4)' }}>{extra}</div> : null}
    </>
  );
}
