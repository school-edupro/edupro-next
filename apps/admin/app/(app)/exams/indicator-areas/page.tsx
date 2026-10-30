import { Badge, Button, Card, FormActions, FormRow, InputField, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { ExamSetupNav } from '@/components/exams/ExamSetupNav';
import { Notice } from '@/components/Notice';
import { apiFetch, getMe } from '@/lib/api';
import { saveIndicatorArea, saveIndicatorScale } from '@/lib/hpc-actions';

interface Area {
  id: string;
  name: string;
  sortOrder: number;
  status: 'active' | 'inactive';
  items: number;
}
interface Scale {
  id: string;
  name: string;
  levels: string[];
  sortOrder: number;
  status: 'active' | 'inactive';
  used: number;
}

/**
 * The lists the indicator set editor picks from (docs/design/65): areas (an HPC domain, a co-scholastic
 * area) in the order cards print them and teachers see them, and level scales (Beginner, Progressing,
 * Proficient; Rarely ... Always). `?area=ID` / `?scale=ID` opens one to change.
 */
export default async function IndicatorListsPage({
  searchParams,
}: {
  searchParams: Promise<{
    area?: string;
    scale?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('exams.master.view')) notFound();
  const canManage = me.permissions.includes('exams.master.manage');
  const [areas, scales] = await Promise.all([
    apiFetch<{ data: Area[] }>('/exams/indicator-areas').then((r) => r.data),
    apiFetch<{ data: Scale[] }>('/exams/indicator-scales').then((r) => r.data),
  ]);
  const area = areas.find((a) => a.id === sp.area) ?? null;
  const scale = scales.find((s) => s.id === sp.scale) ?? null;
  const status = (v: string) => (
    <Badge tone={v === 'active' ? 'success' : 'neutral'}>
      {v === 'active' ? 'In use' : 'Not in use'}
    </Badge>
  );
  const statusField = (id: string, value: string) => (
    <label className="ep-field" htmlFor={id}>
      <span className="ep-field__label">Status</span>
      <select id={id} name="status" className="ep-select" defaultValue={value}>
        <option value="active">In use</option>
        <option value="inactive">Not in use</option>
      </select>
    </label>
  );
  return (
    <>
      <PageHeader
        kicker="Exams"
        title="Areas and level scales"
        description="The lists an indicator set picks from. Areas print on the card, and appear to teachers, in this order; a scale is the levels a set or a section rates on."
      />
      <ExamSetupNav current="/exams/indicator-areas" />
      <Notice params={sp} />
      <div
        style={{
          display: 'grid',
          gap: 'var(--sp-5)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 520px), 1fr))',
        }}
      >
        <Card title="Areas">
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Areas">
            <table className="ep-table ep-table--dense">
              <caption className="ep-sr-only">Areas in print order</caption>
              <thead>
                <tr>
                  <th scope="col" className="is-numeric">
                    Order
                  </th>
                  <th scope="col">Area</th>
                  <th scope="col" className="is-numeric">
                    Items
                  </th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="ep-sr-only">Change</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {areas.map((a) => (
                  <tr key={a.id}>
                    <td className="is-numeric">{a.sortOrder}</td>
                    <td>{a.name}</td>
                    <td className="is-numeric">{a.items}</td>
                    <td>{status(a.status)}</td>
                    <td>
                      {canManage ? (
                        <a
                          className="ep-btn ep-btn--ghost ep-btn--sm"
                          href={`/exams/indicator-areas?area=${a.id}`}
                          aria-label={`Change ${a.name}`}
                        >
                          Change
                        </a>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {canManage ? (
            <form action={saveIndicatorArea} style={{ marginTop: 'var(--sp-3)' }}>
              {area ? <input type="hidden" name="id" value={area.id} /> : null}
              <h4 className="ep-card__title" style={{ marginTop: 0 }}>
                {area ? `Change ${area.name}` : 'Add an area'}
              </h4>
              <FormRow columns={3}>
                <InputField
                  id="areaName"
                  name="name"
                  label="Area"
                  required
                  minLength={2}
                  maxLength={60}
                  defaultValue={area?.name ?? ''}
                />
                <InputField
                  id="areaOrder"
                  name="sortOrder"
                  label="Order"
                  type="number"
                  min={0}
                  max={100000}
                  defaultValue={area ? String(area.sortOrder) : ''}
                  help={area ? undefined : 'Blank: the end of the list'}
                />
                {statusField('areaStatus', area?.status ?? 'active')}
              </FormRow>
              {area && area.items ? (
                <p className="ep-field__help">
                  A new name is the area&rsquo;s name in every set ({area.items} items).
                </p>
              ) : null}
              <FormActions>
                <Button type="submit">{area ? 'Save the area' : 'Add the area'}</Button>
                {area ? (
                  <a className="ep-btn ep-btn--ghost" href="/exams/indicator-areas">
                    Cancel
                  </a>
                ) : null}
              </FormActions>
            </form>
          ) : null}
        </Card>

        <Card title="Level scales">
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Level scales">
            <table className="ep-table ep-table--dense">
              <caption className="ep-sr-only">Level scales</caption>
              <thead>
                <tr>
                  <th scope="col">Scale</th>
                  <th scope="col">Levels, lowest first</th>
                  <th scope="col" className="is-numeric">
                    Used by
                  </th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="ep-sr-only">Change</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {scales.map((s) => (
                  <tr key={s.id}>
                    <td>{s.name}</td>
                    <td>{s.levels.join(', ')}</td>
                    <td className="is-numeric">{s.used}</td>
                    <td>{status(s.status)}</td>
                    <td>
                      {canManage ? (
                        <a
                          className="ep-btn ep-btn--ghost ep-btn--sm"
                          href={`/exams/indicator-areas?scale=${s.id}`}
                          aria-label={`Change ${s.name}`}
                        >
                          Change
                        </a>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {canManage ? (
            <form action={saveIndicatorScale} style={{ marginTop: 'var(--sp-3)' }}>
              {scale ? <input type="hidden" name="id" value={scale.id} /> : null}
              <h4 className="ep-card__title" style={{ marginTop: 0 }}>
                {scale ? `Change ${scale.name}` : 'Add a scale'}
              </h4>
              <FormRow columns={2}>
                <InputField
                  id="scaleName"
                  name="name"
                  label="Scale"
                  required
                  minLength={2}
                  maxLength={60}
                  defaultValue={scale?.name ?? ''}
                />
                {statusField('scaleStatus', scale?.status ?? 'active')}
              </FormRow>
              <InputField
                id="scaleLevels"
                name="levels"
                label="Levels, lowest first (comma between)"
                required
                defaultValue={scale?.levels.join(', ') ?? ''}
                help={
                  scale && scale.used
                    ? `${scale.used} ${scale.used === 1 ? 'set or section rates' : 'sets and sections rate'} on it and change with it. To rename a level, write its new words in its place; a level with saved entries can't be taken out.`
                    : 'Two to ten: Beginner, Progressing, Proficient or Rarely, Sometimes, Mostly, Always.'
                }
              />
              <FormActions>
                <Button type="submit">{scale ? 'Save the scale' : 'Add the scale'}</Button>
                {scale ? (
                  <a className="ep-btn ep-btn--ghost" href="/exams/indicator-areas">
                    Cancel
                  </a>
                ) : null}
              </FormActions>
            </form>
          ) : null}
        </Card>
      </div>
    </>
  );
}
