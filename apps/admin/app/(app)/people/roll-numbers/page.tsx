import { Card, PageHeader } from '@edupro/ui';
import { Notice } from '@/components/Notice';
import { RollNumbersEditor } from '@/components/RollNumbersEditor';
import { moveToSection } from '@/lib/actions';
import { apiFetch } from '@/lib/api';

interface SectionData {
  section: { id: string; label: string };
  students: Array<{
    studentId: string;
    name: string;
    admissionNo: string;
    gender: string;
    rollNo: number | null;
  }>;
  otherSections: Array<{ id: string; label: string }>;
  canRenumber: boolean;
  canMove: boolean;
}

/** Roll numbers and sections: class teachers renumber their own section; coordinators also move students. */
export default async function RollNumbersPage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string; ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const sections = await apiFetch<{ data: Array<{ id: string; label: string; students: number }> }>(
    '/people/sections',
  ).then((r) => r.data);
  const chosen =
    sections.find((s) => s.id === sp.section) ?? (sections.length === 1 ? sections[0] : undefined);
  const data = chosen ? await apiFetch<SectionData>(`/people/sections/${chosen.id}/roll`) : null;
  return (
    <>
      <PageHeader
        kicker="People"
        title="Roll numbers and sections"
        description="Renumber a section's roll numbers; coordinators can also move a student to another section of the same class. Fees do not change (they are set per class)."
      />
      <Notice params={sp} />
      <Card style={{ marginBottom: 'var(--sp-4)' }}>
        <form method="get" className="ep-wd__form" style={{ marginTop: 0 }}>
          <label className="ep-field" htmlFor="rn-section">
            <span className="ep-field__label">Section</span>
            <select
              id="rn-section"
              name="section"
              className="ep-select"
              defaultValue={chosen?.id ?? ''}
            >
              <option value="">Choose…</option>
              {sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label} ({s.students})
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
            Open
          </button>
        </form>
        {!sections.length ? (
          <p className="ep-field__help">You are not class teacher of a section in this session.</p>
        ) : null}
      </Card>
      {data ? (
        <div className="ep-wd__end">
          <Card title={`Roll numbers · ${data.section.label}`}>
            <RollNumbersEditor
              key={data.section.id}
              sectionId={data.section.id}
              students={data.students}
              disabled={!data.canRenumber}
            />
          </Card>
          {data.canMove && data.otherSections.length ? (
            <Card title="Move to another section">
              <p className="ep-field__help" style={{ marginTop: 0 }}>
                Same class only; the student takes the next free roll number there.
              </p>
              <form action={moveToSection} className="ep-wd__form">
                <input type="hidden" name="sectionId" value={data.section.id} />
                <label className="ep-field ep-wd__wide" htmlFor="mv-student">
                  <span className="ep-field__label">Student</span>
                  <select
                    id="mv-student"
                    name="studentId"
                    className="ep-select"
                    required
                    defaultValue=""
                  >
                    <option value="">Choose…</option>
                    {data.students.map((s) => (
                      <option key={s.studentId} value={s.studentId}>
                        {s.rollNo ? `${String(s.rollNo)}. ` : ''}
                        {s.name} · {s.admissionNo}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="ep-field" htmlFor="mv-to">
                  <span className="ep-field__label">To section</span>
                  <select
                    id="mv-to"
                    name="toSectionId"
                    className="ep-select"
                    required
                    defaultValue=""
                  >
                    <option value="">Choose…</option>
                    {data.otherSections.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
                  Move
                </button>
              </form>
            </Card>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
