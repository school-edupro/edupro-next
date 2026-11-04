import { Breadcrumbs, Button, Card, PageHeader } from '@edupro/ui';
import { Notice } from '@/components/Notice';
import { RegistersList } from '@/components/exams/RegistersList';
import { RegistersSwitch } from '@/components/exams/RegistersSwitch';
import { createMarkScheme } from '@/lib/exam-entry-actions';
import { apiFetch, getMe } from '@/lib/api';
import type { RegisterRow, SchemePreset } from '@/lib/mark-schemes';
import type { ClassRow, Exam, Page } from '@/lib/types';

/**
 * Mark registers (docs/design/68), the school's Term Mark Register, under the Registers switch
 * (docs/design/69: Mark · Remark · Attendance · Height & Weight): the registers the person may use
 * (a manager sees every one), each with Run, Edit, Versions, Copy, Assign, Lock and Delete; a new one is
 * built in six steps, or started from a ready-made scheme with its exams mapped.
 */
export default async function MarkRegistersPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const [me, list, presets, exams, classes] = await Promise.all([
    getMe(),
    apiFetch<{ data: RegisterRow[]; canCreate: boolean; canAssign: boolean }>('/exams/schemes'),
    apiFetch<{ data: SchemePreset[] }>('/exams/schemes/presets').then((r) => r.data),
    apiFetch<{ data: Exam[] }>('/exams').then((r) => r.data),
    apiFetch<Page<ClassRow>>('/academics/classes?size=200').then((r) => r.data),
  ]);
  const preset = presets.find((p) => p.code === sp.preset) ?? null;
  return (
    <>
      <Breadcrumbs items={[{ label: 'Exams', href: '/exams' }, { label: 'Mark registers' }]} />
      <PageHeader
        kicker="Exams"
        title="Term mark registers"
        description="Set up once how a class's marks are worked out — subjects, each subject's columns, codes, grades, divisions — then Run it for any section: the marks come from the exam entry, the totals, %, grade, rank and result are worked out, and the sheet prints as PDF or Excel."
      />
      <RegistersSwitch current="mark" permissions={me.permissions} />
      <Notice params={sp} />
      <Card elevated>
        <RegistersList
          rows={list.data}
          classes={classes.map((k) => ({ id: k.id, code: k.code }))}
          canCreate={list.canCreate}
          canAssign={list.canAssign}
        />
      </Card>
      {list.canCreate ? (
        <Card elevated title="Start from a ready-made scheme" style={{ marginTop: 'var(--sp-4)' }}>
          <form method="get" style={{ marginBottom: 'var(--sp-3)' }}>
            <label className="ep-field">
              <span className="ep-field__label">Ready-made scheme</span>
              <select className="ep-select" name="preset" defaultValue={preset?.code ?? ''}>
                <option value="">Choose one</option>
                {presets.map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="ep-form-actions">
              <Button type="submit" variant="secondary" size="sm">
                Choose
              </Button>
            </div>
          </form>
          {preset ? (
            <>
              <p className="ep-field__help" style={{ marginTop: 0 }}>
                {preset.description} Columns: {preset.columns.join(', ')}. Every subject of the
                classes gets these columns (a one-language choice group becomes a slot); change any
                of them in the builder after.
              </p>
              <form action={createMarkScheme} className="ep-rp__act">
                <input type="hidden" name="preset" value={preset.code} />
                <label className="ep-field">
                  <span className="ep-field__label">Name</span>
                  <input
                    className="ep-input"
                    name="name"
                    required
                    minLength={2}
                    maxLength={120}
                    defaultValue={`${preset.name} register`}
                  />
                </label>
                <div className="ep-rp__row">
                  <label className="ep-field">
                    <span className="ep-field__label">Kind</span>
                    <select className="ep-select" name="purpose" defaultValue="register">
                      <option value="register">A register</option>
                      <option value="result">The term result (report cards, promotion)</option>
                    </select>
                  </label>
                  <label className="ep-field">
                    <span className="ep-field__label">Term (for a result)</span>
                    <input className="ep-input" name="termCode" maxLength={12} placeholder="T1" />
                  </label>
                </div>
                <fieldset className="ep-field" style={{ border: 0, padding: 0, margin: 0 }}>
                  <legend className="ep-field__label">Classes</legend>
                  <div className="ep-mr-tiles">
                    {classes.map((k) => (
                      <label key={k.id} className="ep-mr-tile" htmlFor={`cls-${k.id}`}>
                        <input id={`cls-${k.id}`} type="checkbox" name="classId" value={k.id} />
                        <span>{k.code}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                {preset.examKeys.map((k) => (
                  <label key={k.key} className="ep-field">
                    <span className="ep-field__label">
                      {k.key}: {k.label}
                    </span>
                    <select className="ep-select" name={`map:${k.key}`} required defaultValue="">
                      <option value="">Choose the exam</option>
                      {exams.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.code} · {e.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
                <div className="ep-form-actions">
                  <Button type="submit">Make the register</Button>
                </div>
              </form>
            </>
          ) : null}
        </Card>
      ) : null}
    </>
  );
}
