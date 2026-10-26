import { PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { NumberSeriesEditor } from '@/components/admissions/NumberSeriesEditor';
import type { AdmissionListFields } from '@/lib/admission-list';
import type { NumberSeriesSetup } from '@/lib/admission-scores';
import { apiFetch, getMe } from '@/lib/api';

/**
 * Number series of admission (docs/design/48, part 5): registration and admission numbers per session
 * and class, optionally for registrations with certain answers (round, student type, board).
 */
export default async function NumberSeriesPage() {
  const me = await getMe();
  if (!me.permissions.includes('admissions.cycle.view')) notFound();
  const [data, fields] = await Promise.all([
    apiFetch<NumberSeriesSetup>('/admissions/number-series'),
    apiFetch<AdmissionListFields>('/admissions/registrations/grid/fields'),
  ]);
  // the form's questions (the Admissions dataset's form fields are f_<key>)
  const questions = fields.fields
    .filter((f) => f.key.startsWith('f_'))
    .map((f) => ({
      key: f.key.slice(2),
      label: f.label,
      options: ((f as { options?: string[] | null }).options ?? []).slice(0, 200),
    }));
  return (
    <>
      <PageHeader
        kicker="Admission set-up"
        title="Number series"
        description="How registration and admission numbers are made: a prefix, the next number and its digits, per session and class. A registration takes the most specific series that fits it (its class and answers first, then the class, then the session's); none fits: the default numbers."
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/admissions/setup">
            Admission set-up
          </a>
        }
      />
      <NumberSeriesEditor
        initial={data}
        questions={questions}
        canEdit={me.permissions.includes('admissions.setup.manage')}
      />
    </>
  );
}
