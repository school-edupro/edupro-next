import { Badge, Button, Card, PageHeader } from '@edupro/ui';
import { ClinicNav } from '@/components/clinic/ClinicNav';
import { Notice } from '@/components/Notice';
import { apiFetch, getMe } from '@/lib/api';
import { saveHealthCamp } from '@/lib/clinic-actions';
import type { Camp, ClinicOptions } from '@/lib/clinic';

interface Detail {
  camp: Camp;
  sections: Array<{
    id: string;
    section: string;
    pupils: number;
    examined: number;
    published: number;
    attention: number;
  }>;
}

/** One health check-up: every class with how far it is, and the check-up's own details. */
export default async function HealthCampPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const [me, d, options] = await Promise.all([
    getMe(),
    apiFetch<Detail>(`/clinic/camps/${id}`),
    apiFetch<ClinicOptions>('/clinic/options'),
  ]);
  const manage = me.permissions.includes('engagement.clinic.manage');
  const c = d.camp;
  const total = d.sections.reduce(
    (a, s) => ({
      pupils: a.pupils + s.pupils,
      examined: a.examined + s.examined,
      published: a.published + s.published,
      attention: a.attention + s.attention,
    }),
    { pupils: 0, examined: 0, published: 0, attention: 0 },
  );
  return (
    <>
      <PageHeader
        kicker="Health check-up"
        title={c.name}
        description={`${String(total.examined)} of ${String(total.pupils)} pupils examined · ${String(total.published)} published · ${String(total.attention)} need attention.`}
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
            <Badge tone={c.status === 'open' ? 'success' : 'neutral'}>
              {c.status === 'open' ? 'Open' : 'Closed'}
            </Badge>
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href={`/api/clinic/camps/${c.id}/report`}
            >
              Excel
            </a>
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/engagement/clinic/checkups">
              All check-ups
            </a>
          </span>
        }
      />
      <ClinicNav current="/engagement/clinic/checkups" permissions={me.permissions} ok={sp.ok} />
      <Notice params={{ error: sp.error, detail: sp.detail }} />
      <Card title="Class by class" style={{ marginBottom: 'var(--sp-4)' }}>
        <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Classes">
          <table className="ep-table ep-table--dense">
            <caption className="ep-sr-only">How far each class is in {c.name}</caption>
            <thead>
              <tr>
                <th scope="col">Class</th>
                <th scope="col" className="ep-num">
                  Pupils
                </th>
                <th scope="col" className="ep-num">
                  Examined
                </th>
                <th scope="col" className="ep-num">
                  Published
                </th>
                <th scope="col" className="ep-num">
                  Need attention
                </th>
                <th scope="col">
                  <span className="ep-sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {d.sections.map((s) => (
                <tr key={s.id}>
                  <th scope="row">{s.section}</th>
                  <td className="ep-num">{s.pupils}</td>
                  <td className="ep-num">
                    {s.examined}{' '}
                    {s.examined === s.pupils && s.pupils ? <Badge tone="success">All</Badge> : null}
                  </td>
                  <td className="ep-num">{s.published}</td>
                  <td className="ep-num">{s.attention || '—'}</td>
                  <td>
                    <a
                      className="ep-btn ep-btn--secondary ep-btn--sm"
                      href={`/engagement/clinic/checkups/${c.id}/${s.id}`}
                      aria-label={`Open ${s.section}`}
                    >
                      {manage && c.status === 'open' ? 'Examine' : 'Open'}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {manage ? (
        <Card title="This check-up">
          <form action={saveHealthCamp} className="ep-hd__row">
            <input type="hidden" name="id" value={c.id} />
            <label className="ep-field" htmlFor="he-name">
              <span className="ep-field__label">Name</span>
              <input
                id="he-name"
                name="name"
                className="ep-input"
                required
                minLength={3}
                maxLength={120}
                defaultValue={c.name}
              />
            </label>
            <label className="ep-field" htmlFor="he-from">
              <span className="ep-field__label">Starts on</span>
              <input
                id="he-from"
                name="startsOn"
                type="date"
                className="ep-input"
                required
                defaultValue={c.startsOn}
              />
            </label>
            <label className="ep-field" htmlFor="he-to">
              <span className="ep-field__label">Ends on</span>
              <input
                id="he-to"
                name="endsOn"
                type="date"
                className="ep-input"
                defaultValue={c.endsOn ?? ''}
              />
            </label>
            <label className="ep-field" htmlFor="he-doc">
              <span className="ep-field__label">Doctor</span>
              <select
                id="he-doc"
                name="doctorId"
                className="ep-select"
                defaultValue={c.doctorId ?? ''}
              >
                <option value="">Choose</option>
                {options.masters
                  .filter((m) => m.kind === 'doctor')
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="ep-field" htmlFor="he-place">
              <span className="ep-field__label">Place</span>
              <input
                id="he-place"
                name="place"
                className="ep-input"
                maxLength={120}
                defaultValue={c.place ?? ''}
              />
            </label>
            <label className="ep-field" htmlFor="he-status">
              <span className="ep-field__label">Status</span>
              <select id="he-status" name="status" className="ep-select" defaultValue={c.status}>
                <option value="open">Open: cards can be filled</option>
                <option value="closed">Closed: nothing more is changed</option>
              </select>
            </label>
            <div>
              <Button type="submit">Save</Button>
            </div>
          </form>
        </Card>
      ) : null}
    </>
  );
}
