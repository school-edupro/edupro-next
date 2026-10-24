import { Card, PageHeader } from '@edupro/ui';
import { ApiError } from '@edupro/bff';
import { redirect } from 'next/navigation';
import { bff } from '@/lib/bff';
import { clearForDepartment } from '../resignation/actions';

interface Row {
  department: string;
  name: string;
  status: 'pending' | 'cleared';
  check: { due: boolean; detail: string } | null;
  mayClear: boolean;
}
interface Item {
  id: string;
  employee: { name: string; code: string; department: string | null; designation: string | null };
  exitType: string;
  lastDay: string | null;
  clearances: Row[];
}
const dmy = (iso: string | null) => (iso ? iso.split('-').reverse().join('-') : '—');

/** Colleagues leaving whose no-dues waits for a department I clear (docs/design/38, part 6). */
export default async function NoDuesPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  let data: Item[];
  try {
    data = (await bff.api.fetch<{ data: Item[] }>('/people/exits/clearance/mine')).data;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    throw error;
  }
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: '52rem', margin: '0 auto' }}>
      <p style={{ margin: '0 0 var(--sp-2)' }}>
        <a href="/" style={{ textDecoration: 'underline' }}>
          ← Home
        </a>
      </p>
      <PageHeader
        kicker="EduPro staff"
        title="No-dues to clear"
        description="Colleagues leaving the school: clear for your department, or note what they owe."
      />
      {sp.ok ? (
        <p className="ep-alert ep-alert--success" role="status">
          Cleared.
        </p>
      ) : null}
      {sp.error ? (
        <p className="ep-alert ep-alert--danger" role="alert">
          {sp.detail || 'That did not work. Please try again.'}
        </p>
      ) : null}
      {data.length === 0 ? <Card>Nothing waits for you.</Card> : null}
      <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
        {data.map((x) => (
          <Card key={x.id} title={`${x.employee.name} (${x.employee.code})`}>
            <p style={{ marginTop: 0 }}>
              {x.exitType}
              {x.employee.department ? ` · ${x.employee.department}` : ''}
              {x.employee.designation ? ` · ${x.employee.designation}` : ''} · last working day{' '}
              {dmy(x.lastDay)}
            </p>
            {x.clearances
              .filter((r) => r.status === 'pending' && r.mayClear)
              .map((r) => (
                <form
                  key={r.department}
                  action={clearForDepartment}
                  style={{ display: 'grid', gap: 'var(--sp-2)', marginBottom: 'var(--sp-3)' }}
                >
                  <input type="hidden" name="id" value={x.id} />
                  <input type="hidden" name="department" value={r.department} />
                  <strong>{r.name}</strong>
                  {r.check ? (
                    <span className={r.check.due ? 'ep-alert ep-alert--warning' : 'ep-field__help'}>
                      {r.check.detail}
                    </span>
                  ) : null}
                  <label className="ep-field" htmlFor={`nd-dues-${x.id}-${r.department}`}>
                    <span className="ep-field__label">Dues (Rs.), 0 if none</span>
                    <input
                      id={`nd-dues-${x.id}-${r.department}`}
                      name="dues"
                      className="ep-input"
                      type="number"
                      min={0}
                      defaultValue={0}
                    />
                  </label>
                  <label className="ep-field" htmlFor={`nd-note-${x.id}-${r.department}`}>
                    <span className="ep-field__label">Note</span>
                    <input
                      id={`nd-note-${x.id}-${r.department}`}
                      name="note"
                      className="ep-input"
                      maxLength={500}
                      placeholder="What is owed, or hand-over done"
                    />
                  </label>
                  <button type="submit" className="ep-btn ep-btn--primary">
                    Clear for {r.name}
                  </button>
                </form>
              ))}
          </Card>
        ))}
      </div>
    </main>
  );
}
