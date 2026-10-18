import { Badge, Breadcrumbs, Card, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { ConfirmAction } from '@/components/ConfirmAction';
import { Notice } from '@/components/Notice';
import { Icon } from '@/components/nav-icons';
import { apiFetch, getMe } from '@/lib/api';
import type { EmployeeCatalogue } from '@/lib/employee';
import { acceptStaffTransfer, closeStaffTransfer } from '@/lib/employee-actions';
import type { School } from '@/lib/types';

interface StaffTransfer {
  id: string;
  direction: 'incoming' | 'outgoing';
  status: 'requested' | 'accepted' | 'rejected' | 'cancelled';
  employee: {
    id: string;
    name: string;
    code: string;
    designation: string | null;
    department: string | null;
  };
  fromSchool: string;
  toSchool: string;
  onDate: string;
  orderNo: string | null;
  note: string | null;
  requestedBy: string | null;
  requestedAt: string;
  decidedBy: string | null;
  decisionNote: string | null;
  toEmployeeId: string | null;
  carries: {
    values: number;
    documents: number;
    education: number;
    experience: number;
    login: boolean;
  };
}

const OK: Record<string, string> = {
  rejected: 'The transfer is turned down; the other school sees why.',
  cancelled: 'The transfer is cancelled.',
};
const TONE = {
  requested: 'warning',
  accepted: 'success',
  rejected: 'danger',
  cancelled: 'neutral',
} as const;
const dmy = (d: string) => d.slice(0, 10).split('-').reverse().join('-');

/**
 * Staff transfers between schools of the group (docs/design/30-employee-master.md): incoming ones to
 * accept (this school's code, department, designation, type, campus) or turn down, outgoing ones to
 * follow or cancel. Campus moves are made on the employee's page.
 */
export default async function StaffTransfersPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('people.staff_transfer.manage')) notFound();
  const [list, catalogue, school] = await Promise.all([
    apiFetch<{ data: StaffTransfer[] }>('/people/staff-transfers').then((r) => r.data),
    apiFetch<EmployeeCatalogue>('/people/staff/catalogue'),
    apiFetch<School>('/platform/school').catch(() => null),
  ]);
  const incoming = list.filter((x) => x.direction === 'incoming');
  const outgoing = list.filter((x) => x.direction === 'outgoing');
  const opts = (code: string) => [
    { value: '', label: 'Choose…' },
    ...(catalogue.lists[code] ?? []).map((v) => ({ value: v, label: v })),
  ];
  const select = (
    id: string,
    name: string,
    label: string,
    options: Array<{ value: string; label: string }>,
    def = '',
    required = true,
  ) => (
    <label className="ep-field" htmlFor={id}>
      <span className="ep-field__label">{label}</span>
      <select id={id} name={name} className="ep-select" defaultValue={def} required={required}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
  const carries = (t: StaffTransfer) =>
    `${String(t.carries.values)} profile values · ${String(t.carries.education)} education · ${String(t.carries.experience)} experience · ${String(t.carries.documents)} documents${t.carries.login ? ' · login' : ''}`;

  return (
    <>
      <Breadcrumbs
        items={[{ label: 'Employees', href: '/people/employees' }, { label: 'Staff transfers' }]}
      />
      <PageHeader
        kicker="People"
        title="Staff transfers"
        description="Staff moving between schools of the group. Accept an incoming transfer to add the person here with this school's code; the sending school's record closes on the transfer date. Campus moves are made on the employee's page (Transfers and remarks)."
      />
      <Notice params={{ ...sp, detail: sp.ok ? (OK[sp.ok] ?? 'Done.') : sp.detail }} />

      <Card
        title={`Incoming (${String(incoming.filter((x) => x.status === 'requested').length)} waiting)`}
        style={{ marginBottom: 'var(--sp-4)' }}
      >
        {incoming.length ? (
          <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
            {incoming.map((t) => (
              <article key={t.id} className="ep-card" style={{ padding: 'var(--sp-4)' }}>
                <div
                  style={{
                    display: 'flex',
                    gap: 'var(--sp-2)',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <div>
                    <strong>{t.employee.name}</strong>{' '}
                    <span className="ep-field__help">
                      {t.employee.code} · {t.employee.designation ?? ''}
                      {t.employee.department ? `, ${t.employee.department}` : ''} · from{' '}
                      {t.fromSchool}, on {dmy(t.onDate)}
                      {t.orderNo ? ` · order ${t.orderNo}` : ''}
                    </span>
                  </div>
                  <Badge tone={TONE[t.status]}>{t.status}</Badge>
                </div>
                <p className="ep-field__help" style={{ margin: 'var(--sp-2) 0 0' }}>
                  Carries {carries(t)}. Asked by {t.requestedBy ?? '—'} on {dmy(t.requestedAt)}.
                  {t.note ? ` Note: ${t.note}` : ''}
                  {t.decisionNote ? ` · ${t.decisionNote}` : ''}
                </p>
                {t.status === 'accepted' && t.toEmployeeId ? (
                  <p style={{ margin: 'var(--sp-2) 0 0' }}>
                    <a
                      href={`/people/employees/${t.toEmployeeId}`}
                      style={{ textDecoration: 'underline' }}
                    >
                      Open the employee here
                    </a>
                  </p>
                ) : null}
                {t.status === 'requested' ? (
                  <form
                    action={acceptStaffTransfer}
                    className="ep-filter-band"
                    style={{ marginTop: 'var(--sp-3)', marginBottom: 0 }}
                  >
                    <input type="hidden" name="tid" value={t.id} />
                    <label className="ep-field" htmlFor={`code-${t.id}`}>
                      <span className="ep-field__label">Employee code here</span>
                      <input
                        id={`code-${t.id}`}
                        name="code"
                        className="ep-input"
                        defaultValue={catalogue.nextCode}
                        maxLength={30}
                      />
                    </label>
                    {select(
                      `dept-${t.id}`,
                      'department',
                      'Department',
                      opts('Department'),
                      (catalogue.lists.Department ?? []).includes(t.employee.department ?? '')
                        ? (t.employee.department ?? '')
                        : '',
                    )}
                    {select(
                      `desg-${t.id}`,
                      'designation',
                      'Designation',
                      opts('Designation'),
                      (catalogue.lists.Designation ?? []).includes(t.employee.designation ?? '')
                        ? (t.employee.designation ?? '')
                        : '',
                    )}
                    {select(`type-${t.id}`, 'staffType', 'Employee type', opts('EmployeeType'))}
                    {select(
                      `camp-${t.id}`,
                      'campusId',
                      'Campus',
                      [
                        { value: '', label: 'Choose…' },
                        ...(school?.campuses ?? []).map((x) => ({ value: x.id, label: x.name })),
                      ],
                      '',
                      false,
                    )}
                    <button type="submit" className="ep-btn ep-btn--primary">
                      <Icon name="check" size={16} /> Accept
                    </button>
                  </form>
                ) : null}
                {t.status === 'requested' ? (
                  <div style={{ marginTop: 'var(--sp-2)' }}>
                    <ConfirmAction
                      action={closeStaffTransfer}
                      fields={{ tid: t.id, how: 'reject' }}
                      label="Turn down"
                      title={`Turn down the transfer of ${t.employee.name}?`}
                      confirmLabel="Turn down"
                      variant="danger"
                      confirmVariant="danger"
                      reason={{ label: 'Why (the sending school sees it)' }}
                    >
                      The employee stays at {t.fromSchool}.
                    </ConfirmAction>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <p className="ep-field__help" style={{ margin: 0 }}>
            No incoming transfer.
          </p>
        )}
      </Card>

      <Card title={`Outgoing (${String(outgoing.length)})`}>
        {outgoing.length ? (
          <div className="ep-table-wrap">
            <table className="ep-table ep-table--dense">
              <caption className="ep-sr-only">Outgoing staff transfers</caption>
              <thead>
                <tr>
                  <th scope="col">Employee</th>
                  <th scope="col">To</th>
                  <th scope="col">On</th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="ep-sr-only">Cancel</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {outgoing.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <a
                        href={`/people/employees/${t.employee.id}`}
                        style={{ textDecoration: 'underline' }}
                      >
                        {t.employee.name}
                      </a>{' '}
                      <span className="ep-field__help">{t.employee.code}</span>
                    </td>
                    <td>{t.toSchool}</td>
                    <td>{dmy(t.onDate)}</td>
                    <td>
                      <Badge tone={TONE[t.status]}>{t.status}</Badge>
                      {t.decisionNote ? (
                        <div className="ep-field__help">{t.decisionNote}</div>
                      ) : null}
                    </td>
                    <td>
                      {t.status === 'requested' ? (
                        <ConfirmAction
                          action={closeStaffTransfer}
                          fields={{ tid: t.id, how: 'cancel' }}
                          label="Cancel"
                          title={`Cancel the transfer of ${t.employee.name}?`}
                          confirmLabel="Cancel the transfer"
                          reason={{ label: 'Why' }}
                        >
                          The other school no longer sees it as waiting.
                        </ConfirmAction>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="ep-field__help" style={{ margin: 0 }}>
            No outgoing transfer.
          </p>
        )}
      </Card>
    </>
  );
}
