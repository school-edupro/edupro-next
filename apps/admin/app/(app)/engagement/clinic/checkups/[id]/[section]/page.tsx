import { Alert, Badge, Button, Card, PageHeader } from '@edupro/ui';
import { ClinicNav } from '@/components/clinic/ClinicNav';
import { Notice } from '@/components/Notice';
import { apiFetch, getMe } from '@/lib/api';
import { publishHealthCards, saveHealthCheckup } from '@/lib/clinic-actions';
import {
  BLOOD_GROUPS,
  type Camp,
  type Checkup,
  type ClinicOptions,
  type ClinicSettings,
} from '@/lib/clinic';

interface Sheet {
  camp: Camp;
  section: { id: string; name: string };
  settings: ClinicSettings;
  pupils: Array<{
    id: string;
    name: string;
    admissionNo: string | null;
    rollNo: string | null;
    checkup: Checkup | null;
  }>;
}

/**
 * One class in one health check-up: the pupils with how far each card is, the form of the pupil chosen
 * (saving moves to the next pupil), and Publish, which shows the saved cards to the parents.
 */
export default async function HealthSheetPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; section: string }>;
  searchParams: Promise<{
    student?: string;
    ok?: string;
    n?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const { id, section } = await params;
  const sp = await searchParams;
  const [me, sheet, options] = await Promise.all([
    getMe(),
    apiFetch<Sheet>(`/clinic/camps/${id}/sections/${section}`),
    apiFetch<ClinicOptions>('/clinic/options'),
  ]);
  const manage =
    me.permissions.includes('engagement.clinic.manage') && sheet.camp.status === 'open';
  const base = `/engagement/clinic/checkups/${id}/${section}`;
  const index = sheet.pupils.findIndex((p) => p.id === sp.student);
  const pupil = index >= 0 ? sheet.pupils[index]! : null;
  const next = index >= 0 ? (sheet.pupils[index + 1]?.id ?? '') : '';
  const h = pupil?.checkup ?? null;
  const drafts = sheet.pupils.filter((p) => p.checkup?.status === 'draft').length;
  const hidden = new Set(sheet.settings.checkupHidden);
  const shown = options.fields.filter((f) => !hidden.has(f.key));
  const groups = [...new Set(shown.map((f) => f.group))];
  return (
    <>
      <PageHeader
        kicker={sheet.camp.name}
        title={`Class ${sheet.section.name}`}
        description={`${String(sheet.pupils.filter((p) => p.checkup).length)} of ${String(sheet.pupils.length)} examined · ${String(sheet.pupils.filter((p) => p.checkup?.status === 'published').length)} published.`}
        actions={
          <a
            className="ep-btn ep-btn--secondary ep-btn--sm"
            href={`/engagement/clinic/checkups/${id}`}
          >
            All classes
          </a>
        }
      />
      <ClinicNav current="/engagement/clinic/checkups" permissions={me.permissions} />
      {sp.ok === 'published' ? (
        <div style={{ marginBottom: 'var(--sp-4)' }}>
          <Alert tone="success">
            {sp.n ?? '0'} card(s) published. The parents can now read and download them.
          </Alert>
        </div>
      ) : sp.ok === 'saved' ? (
        <div style={{ marginBottom: 'var(--sp-4)' }}>
          <Alert tone="success">Saved.{pupil ? ` Now: ${pupil.name}.` : ''}</Alert>
        </div>
      ) : null}
      <Notice params={{ error: sp.error, detail: sp.detail }} />
      {pupil ? (
        <Card
          title={`${pupil.name}${pupil.admissionNo ? ` · Adm. no. ${pupil.admissionNo}` : ''}${pupil.rollNo ? ` · Roll ${pupil.rollNo}` : ''}`}
          actions={
            h ? (
              <Badge tone={h.status === 'published' ? 'success' : 'warning'}>
                {h.status === 'published' ? 'Published' : 'Draft'}
              </Badge>
            ) : (
              <Badge tone="neutral">Not examined</Badge>
            )
          }
          style={{ marginBottom: 'var(--sp-4)' }}
        >
          <form action={saveHealthCheckup} className="ep-hd__form">
            <input type="hidden" name="campId" value={id} />
            <input type="hidden" name="sectionId" value={section} />
            <input type="hidden" name="studentId" value={pupil.id} />
            <input type="hidden" name="nextStudentId" value={next} />
            <fieldset disabled={!manage} className="ep-hd__form" style={{ border: 0, padding: 0 }}>
              <div className="ep-hd__row">
                <label className="ep-field" htmlFor="hk-date">
                  <span className="ep-field__label">Date of examination</span>
                  <input
                    id="hk-date"
                    name="examDate"
                    type="date"
                    className="ep-input"
                    defaultValue={h?.examDate ?? ''}
                  />
                </label>
                <label className="ep-field" htmlFor="hk-doc">
                  <span className="ep-field__label">Doctor</span>
                  <select
                    id="hk-doc"
                    name="doctorId"
                    className="ep-select"
                    defaultValue={h?.doctorId ?? sheet.camp.doctorId ?? ''}
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
                <label className="ep-field" htmlFor="hk-place">
                  <span className="ep-field__label">Place</span>
                  <input
                    id="hk-place"
                    name="place"
                    className="ep-input"
                    maxLength={120}
                    defaultValue={h?.place ?? sheet.camp.place ?? ''}
                  />
                </label>
              </div>
              {groups.map((g) => (
                <fieldset key={g} className="ep-slots">
                  <legend className="ep-field__label">{g}</legend>
                  <div className="ep-hd__row">
                    {shown
                      .filter((f) => f.group === g)
                      .map((f) =>
                        f.key === 'height_cm' ? (
                          <label key={f.key} className="ep-field" htmlFor="hk-height">
                            <span className="ep-field__label">Height (cm)</span>
                            <input
                              id="hk-height"
                              name="heightCm"
                              type="number"
                              step="0.1"
                              min={40}
                              max={230}
                              className="ep-input"
                              defaultValue={h?.heightCm ?? ''}
                            />
                          </label>
                        ) : f.key === 'weight_kg' ? (
                          <label key={f.key} className="ep-field" htmlFor="hk-weight">
                            <span className="ep-field__label">Weight (kg)</span>
                            <input
                              id="hk-weight"
                              name="weightKg"
                              type="number"
                              step="0.1"
                              min={5}
                              max={200}
                              className="ep-input"
                              defaultValue={h?.weightKg ?? ''}
                            />
                            {h?.bmi ? (
                              <span className="ep-field__help">BMI {h.bmi}</span>
                            ) : (
                              <span className="ep-field__help">BMI is worked out on saving</span>
                            )}
                          </label>
                        ) : f.key === 'blood_group' ? (
                          <label key={f.key} className="ep-field" htmlFor="hk-blood">
                            <span className="ep-field__label">Blood group</span>
                            <select
                              id="hk-blood"
                              name="bloodGroup"
                              className="ep-select"
                              defaultValue={h?.bloodGroup ?? ''}
                            >
                              <option value="">Not known</option>
                              {BLOOD_GROUPS.map((b) => (
                                <option key={b} value={b}>
                                  {b}
                                </option>
                              ))}
                            </select>
                          </label>
                        ) : f.kind === 'choice' ? (
                          <label key={f.key} className="ep-field" htmlFor={`hk-${f.key}`}>
                            <span className="ep-field__label">{f.label}</span>
                            <select
                              id={`hk-${f.key}`}
                              name={`f.${f.key}`}
                              className="ep-select"
                              defaultValue={h?.findings[f.key] ?? ''}
                            >
                              <option value="">Not examined</option>
                              {f.options.map((o) => (
                                <option key={o} value={o}>
                                  {o}
                                </option>
                              ))}
                            </select>
                          </label>
                        ) : f.kind === 'number' ? (
                          <label key={f.key} className="ep-field" htmlFor={`hk-${f.key}`}>
                            <span className="ep-field__label">
                              {f.label}
                              {f.unit ? ` (${f.unit})` : ''}
                            </span>
                            <input
                              id={`hk-${f.key}`}
                              name={`f.${f.key}`}
                              type="number"
                              step="any"
                              className="ep-input"
                              defaultValue={h?.findings[f.key] ?? ''}
                            />
                          </label>
                        ) : (
                          <label key={f.key} className="ep-field" htmlFor={`hk-${f.key}`}>
                            <span className="ep-field__label">{f.label}</span>
                            <input
                              id={`hk-${f.key}`}
                              name={`f.${f.key}`}
                              className="ep-input"
                              maxLength={120}
                              list="hk-normal"
                              defaultValue={h?.findings[f.key] ?? ''}
                            />
                          </label>
                        ),
                      )}
                  </div>
                </fieldset>
              ))}
              <datalist id="hk-normal">
                <option value="Normal" />
                <option value="NAD" />
                <option value="6/6" />
                <option value="6/9" />
                <option value="Needs attention" />
              </datalist>
              <div className="ep-hd__row">
                <label className="ep-field" htmlFor="hk-disease">
                  <span className="ep-field__label">Specific disease or condition</span>
                  <select
                    id="hk-disease"
                    name="diseaseId"
                    className="ep-select"
                    defaultValue={h?.diseaseId ?? ''}
                  >
                    <option value="">None</option>
                    {options.masters
                      .filter((m) => m.kind === 'disease')
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="ep-field" htmlFor="hk-desc">
                  <span className="ep-field__label">Description</span>
                  <input
                    id="hk-desc"
                    name="description"
                    className="ep-input"
                    maxLength={500}
                    defaultValue={h?.description ?? ''}
                  />
                </label>
              </div>
              <label className="ep-field" htmlFor="hk-remarks">
                <span className="ep-field__label">Remarks for the parents</span>
                <textarea
                  id="hk-remarks"
                  name="remarks"
                  className="ep-input"
                  rows={3}
                  maxLength={500}
                  defaultValue={h?.remarks ?? ''}
                />
              </label>
              <label className="ep-check" htmlFor="hk-attention">
                <input
                  id="hk-attention"
                  name="needsAttention"
                  type="checkbox"
                  defaultChecked={h?.needsAttention ?? false}
                />{' '}
                The parents should see a doctor or specialist about this (shown on the card)
              </label>
            </fieldset>
            <div className="ep-gate__act">
              {manage ? (
                <Button type="submit">{next ? 'Save and go to the next pupil' : 'Save'}</Button>
              ) : null}
              {h ? (
                <a className="ep-btn ep-btn--secondary" href={`/api/clinic/cards/${h.id}`}>
                  Health card (PDF)
                </a>
              ) : null}
              <a className="ep-btn ep-btn--secondary" href={base}>
                Back to the class
              </a>
            </div>
          </form>
        </Card>
      ) : null}
      <Card
        title="Pupils"
        actions={
          manage && drafts ? (
            <form action={publishHealthCards}>
              <input type="hidden" name="campId" value={id} />
              <input type="hidden" name="sectionId" value={section} />
              <Button type="submit" size="sm">
                Publish {drafts} card{drafts === 1 ? '' : 's'} to the parents
              </Button>
            </form>
          ) : null
        }
      >
        <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Pupils of the class">
          <table className="ep-table ep-table--dense">
            <caption className="ep-sr-only">
              Pupils of {sheet.section.name} and their health cards
            </caption>
            <thead>
              <tr>
                <th scope="col">Roll</th>
                <th scope="col">Student</th>
                <th scope="col">Height / weight / BMI</th>
                <th scope="col">Remarks</th>
                <th scope="col">Card</th>
                <th scope="col">
                  <span className="ep-sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {sheet.pupils.map((p) => (
                <tr key={p.id}>
                  <td>{p.rollNo ?? '—'}</td>
                  <td>
                    {p.name}
                    <div className="ep-field__help">
                      {p.admissionNo ? `Adm. no. ${p.admissionNo}` : ''}
                    </div>
                  </td>
                  <td>
                    {p.checkup
                      ? [
                          p.checkup.heightCm ? `${String(p.checkup.heightCm)} cm` : null,
                          p.checkup.weightKg ? `${String(p.checkup.weightKg)} kg` : null,
                          p.checkup.bmi ? `BMI ${String(p.checkup.bmi)}` : null,
                        ]
                          .filter(Boolean)
                          .join(' · ') || '—'
                      : '—'}
                  </td>
                  <td>
                    {p.checkup?.remarks ?? '—'}{' '}
                    {p.checkup?.needsAttention ? <Badge tone="warning">Attention</Badge> : null}
                  </td>
                  <td>
                    {p.checkup ? (
                      <Badge tone={p.checkup.status === 'published' ? 'success' : 'warning'}>
                        {p.checkup.status === 'published' ? 'Published' : 'Draft'}
                      </Badge>
                    ) : (
                      <Badge tone="neutral">Not examined</Badge>
                    )}
                  </td>
                  <td>
                    <a
                      className="ep-btn ep-btn--secondary ep-btn--sm"
                      href={`${base}?student=${p.id}`}
                      aria-label={`${manage ? 'Examine' : 'Open'} ${p.name}`}
                    >
                      {manage ? (p.checkup ? 'Edit' : 'Examine') : 'Open'}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
