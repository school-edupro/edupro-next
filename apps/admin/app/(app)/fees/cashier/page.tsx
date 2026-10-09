import { Badge, Button, Card, InputField, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { apiFetch } from '@/lib/api';

interface Found {
  id: string;
  name: string;
  admissionNo: string;
  section: string | null;
  father: string | null;
  status: string;
}

/**
 * The fee counter starts here: find the pupil by name or admission number, then open their fee page to
 * take the payment. One exact match opens at once.
 */
export default async function CashierPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    studentId?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  // old links to the counter with a pupil chosen go to the pupil's fee page
  if (sp.studentId && /^\d+$/.test(sp.studentId)) redirect(`/fees/ledger/${sp.studentId}?tab=pay`);
  const q = (sp.q ?? '').trim();
  const found =
    q.length >= 2
      ? await apiFetch<{ data: Found[] }>(`/fees/cashier/search?q=${encodeURIComponent(q)}`).then(
          (r) => r.data,
        )
      : [];
  const exact = found.filter((f) => f.admissionNo.toLowerCase() === q.toLowerCase());
  if (exact.length === 1) redirect(`/fees/ledger/${exact[0]!.id}?tab=pay`);
  return (
    <>
      <PageHeader
        kicker="Fees"
        title="Cashier"
        description="Find the pupil by name or admission number, then take the payment and print the receipt."
      />
      <Notice params={sp} />
      <Card title="Find the pupil">
        <form
          method="get"
          style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'flex-end', flexWrap: 'wrap' }}
        >
          <InputField
            id="q"
            name="q"
            label="Name or admission number"
            defaultValue={q}
            required
            minLength={2}
            maxLength={60}
            autoFocus
            placeholder="e.g. Aarav or A2481"
          />
          <Button type="submit">Search</Button>
        </form>
        {q.length >= 2 ? (
          found.length === 0 ? (
            <p className="ep-field__help" style={{ marginTop: 'var(--sp-3)' }}>
              No pupil found for “{q}”. Try a part of the name, or the admission number from its
              beginning.
            </p>
          ) : (
            <div className="ep-table-wrap" style={{ marginTop: 'var(--sp-4)' }}>
              <table className="ep-table ep-table--dense">
                <caption className="ep-sr-only">Pupils found</caption>
                <thead>
                  <tr>
                    <th scope="col">Admission no.</th>
                    <th scope="col">Student</th>
                    <th scope="col">Class</th>
                    <th scope="col">Father / guardian</th>
                    <th scope="col">
                      <span className="ep-sr-only">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {found.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <strong>{s.admissionNo}</strong>
                      </td>
                      <td>
                        {s.name}{' '}
                        {s.status !== 'active' ? <Badge tone="neutral">{s.status}</Badge> : null}
                      </td>
                      <td>{s.section ?? '—'}</td>
                      <td>{s.father ?? '—'}</td>
                      <td>
                        <a className="ep-btn ep-btn--sm" href={`/fees/ledger/${s.id}?tab=pay`}>
                          Take payment
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {found.length === 40 ? (
                <p className="ep-field__help">Showing the first 40; type more to narrow it.</p>
              ) : null}
            </div>
          )
        ) : null}
      </Card>
    </>
  );
}
