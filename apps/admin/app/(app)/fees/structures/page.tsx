import {
  Button,
  Card,
  Checkbox,
  FormActions,
  InputField,
  PageHeader,
  SelectField,
} from '@edupro/ui';
import { Notice } from '@/components/Notice';
import { FeeSetupNav } from '@/components/fees/FeeSetupNav';
import { GridTools } from '@/components/fees/GridTools';
import { StructureGridTable, type StructureRow } from '@/components/fees/StructureGridTable';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import {
  cloneStructureGrid,
  createFeeMonths,
  importStructureGrid,
  saveStructureGrid,
} from '@/lib/fee-grid-actions';
import type { ClassRow, Page } from '@/lib/types';

interface Grid {
  classId: string;
  className: string;
  feeGroup: string;
  studentType: 'all' | 'new' | 'old';
  months: Array<{ sequence: number; name: string; instalment: number }>;
  rows: StructureRow[];
  monthTotals: string[];
  total: string;
  groups: string[];
}

const TYPES = [
  { value: 'all', label: 'All students' },
  { value: 'old', label: 'Old students only' },
  { value: 'new', label: 'New students only' },
];

/** Class fee structure: fee heads down, months across, for one class, fee group and student type. */
export default async function FeeStructuresPage({
  searchParams,
}: {
  searchParams: Promise<{
    ok?: string;
    error?: string;
    detail?: string;
    uploaded?: string;
    classId?: string;
    group?: string;
    newGroup?: string;
    studentType?: string;
  }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  const canManage = me.permissions.includes('fees.master.manage');
  const classes = await apiFetch<Page<ClassRow>>('/academics/classes?size=200').then((r) => r.data);
  const typed = (sp.newGroup ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z]+/g, '_')
    .replace(/^_|_$/g, '');
  const group = typed || (/^[a-z_]{1,30}$/.test(sp.group ?? '') ? sp.group! : 'general');
  const studentType = TYPES.some((t) => t.value === sp.studentType) ? sp.studentType! : 'all';
  let grid: Grid | null = null;
  let noMonths = false;
  if (sp.classId) {
    try {
      grid = await apiFetch<Grid>(
        `/fees/grids/structure?classId=${sp.classId}&feeGroup=${group}&studentType=${studentType}`,
      );
    } catch (error) {
      if (error instanceof ApiError && error.problem.type === 'fees.no_periods') noMonths = true;
      else throw error;
    }
  }
  const groups = [...new Set(['general', ...(grid?.groups ?? []), group])];
  const fileHref = grid
    ? `/api/fees/grid-file?kind=structure&classId=${grid.classId}&feeGroup=${group}&studentType=${studentType}`
    : '';
  const hidden: Array<[string, string]> = grid
    ? [
        ['classId', grid.classId],
        ['feeGroup', group],
        ['studentType', studentType],
      ]
    : [];
  return (
    <>
      <PageHeader
        kicker="Fees"
        title="Class fee structure"
        description="The fee of each head for every month, for one class. A class can have several structures: one per fee group (general, staff ward, EWS …) and per student type."
      />
      <FeeSetupNav current="/fees/structures" />
      <Notice params={sp} />
      {sp.uploaded ? (
        <p className="ep-alert ep-alert--success" role="status">
          {sp.uploaded} head(s) saved from the Excel file.
        </p>
      ) : null}
      <Card>
        <form
          method="get"
          style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'flex-end', flexWrap: 'wrap' }}
        >
          <SelectField
            id="classId"
            name="classId"
            label="Class"
            defaultValue={sp.classId ?? ''}
            options={[
              { value: '', label: '—' },
              ...classes.map((k) => ({ value: k.id, label: `${k.code} · ${k.name}` })),
            ]}
          />
          <SelectField
            id="studentType"
            name="studentType"
            label="Student type"
            defaultValue={studentType}
            options={TYPES}
          />
          <SelectField
            id="group"
            name="group"
            label="Fee structure (group)"
            defaultValue={group}
            options={groups.map((g) => ({ value: g, label: g.replace(/_/g, ' ') }))}
          />
          <InputField
            id="newGroup"
            name="newGroup"
            label="Or a new group"
            placeholder="staff ward"
            maxLength={30}
          />
          <Button type="submit" variant="secondary">
            Load grid
          </Button>
        </form>
        {noMonths ? (
          <form action={createFeeMonths} style={{ marginTop: 'var(--sp-4)' }}>
            <input
              type="hidden"
              name="back"
              value={`/fees/structures?classId=${sp.classId ?? ''}`}
            />
            <p className="ep-field__help">
              This year has no fee months yet. Create the twelve months first (quarterly, last date
              the 10th); the dates are then set class by class on the Class rules tab.
            </p>
            {canManage ? <Button type="submit">Create the twelve months</Button> : null}
          </form>
        ) : null}
        {grid ? (
          <>
            <p className="ep-field__help" style={{ marginTop: 'var(--sp-3)' }}>
              {grid.className} · group <strong>{group.replace(/_/g, ' ')}</strong> ·{' '}
              {TYPES.find((t) => t.value === studentType)!.label.toLowerCase()}. Type the amount of
              each month; empty or 0 means the head is not charged that month. “→” copies the first
              month across the year, “↓” copies the first head down a month. A pupil follows the
              group on their fee profile; “old” and “new” rows are added to the “all students” rows.
              Bills already made change only when they are generated again.
            </p>
            <GridTools
              fileHref={fileHref}
              upload={importStructureGrid}
              hidden={hidden}
              canManage={canManage}
            />
            <form action={saveStructureGrid}>
              {hidden.map(([n, v]) => (
                <input key={n} type="hidden" name={n} value={v} />
              ))}
              <StructureGridTable
                months={grid.months}
                rows={grid.rows}
                monthTotals={grid.monthTotals}
                total={grid.total}
                canManage={canManage}
              />
              {canManage ? (
                <FormActions>
                  <Button type="submit">Save the structure</Button>
                </FormActions>
              ) : null}
            </form>
            {canManage ? (
              <form action={cloneStructureGrid} style={{ marginTop: 'var(--sp-5)' }}>
                {hidden.map(([n, v]) => (
                  <input key={n} type="hidden" name={n} value={v} />
                ))}
                <fieldset>
                  <legend className="ep-field__label">
                    Clone the saved structure of {grid.className} to other classes
                  </legend>
                  <div style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
                    {classes
                      .filter((k) => k.id !== grid!.classId)
                      .map((k) => (
                        <Checkbox
                          key={k.id}
                          id={`clone-${k.id}`}
                          name="toClassIds"
                          value={k.id}
                          label={k.code}
                        />
                      ))}
                  </div>
                </fieldset>
                <p className="ep-field__help">
                  Save first. Cloning replaces this group and student type in the ticked classes.
                </p>
                <FormActions>
                  <Button type="submit" variant="secondary">
                    Clone to the ticked classes
                  </Button>
                </FormActions>
              </form>
            ) : null}
          </>
        ) : null}
      </Card>
    </>
  );
}
