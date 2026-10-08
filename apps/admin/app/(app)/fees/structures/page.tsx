import {
  Button,
  Card,
  DataTable,
  FormActions,
  InputField,
  PageHeader,
  SelectField,
} from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { FeeSetupNav } from '@/components/fees/FeeSetupNav';
import { setFeeStructure } from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import type { ClassRow, FeeHead, FeeStructure, Page } from '@/lib/types';

const FREQ = ['monthly', 'quarterly', 'half_yearly', 'annual', 'one_time'] as const;

/** S8-06: amount per head and frequency for one class. */
export default async function FeeStructuresPage({
  searchParams,
}: {
  searchParams: Promise<{
    ok?: string;
    error?: string;
    detail?: string;
    classId?: string;
    group?: string;
    newGroup?: string;
  }>;
}) {
  const sp = await searchParams;
  const [t, f, me] = await Promise.all([
    getTranslations('pages.fees_structures'),
    getTranslations('fees'),
    getMe(),
  ]);
  const canManage = me.permissions.includes('fees.master.manage');
  const [classes, heads, structure] = await Promise.all([
    apiFetch<Page<ClassRow>>('/academics/classes?size=200').then((r) => r.data),
    apiFetch<{ data: FeeHead[] }>('/fees/heads').then((r) =>
      r.data.filter((h) => h.status === 'active' && (h.kind === 'regular' || h.kind === 'misc')),
    ),
    sp.classId
      ? apiFetch<{ data: FeeStructure[] }>(`/fees/structures?classId=${sp.classId}`).then(
          (r) => r.data,
        )
      : Promise.resolve<FeeStructure[]>([]),
  ]);
  const cls = classes.find((k) => k.id === sp.classId);
  // a class can have several structures: one per fee group (general, staff ward, EWS ...)
  const typed = (sp.newGroup ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z]+/g, '_')
    .replace(/^_|_$/g, '');
  const group = typed || sp.group || 'general';
  const groups = [...new Set(['general', ...structure.map((s) => s.feeGroup), group])];
  const byHead = new Map(structure.filter((s) => s.feeGroup === group).map((s) => [s.headId, s]));
  const yearTotal = structure
    .filter((s) => s.feeGroup === group && s.studentType !== 'new')
    .reduce((sum, s) => sum + Number(s.annual), 0);
  return (
    <>
      <PageHeader kicker={t('kicker')} title={t('title')} description={t('description')} />
      <FeeSetupNav current="/fees/structures" />
      <Notice params={sp} />
      <Card>
        <form method="get" style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'flex-end' }}>
          <SelectField
            id="classId"
            name="classId"
            label={f('chooseClass')}
            defaultValue={sp.classId ?? ''}
            options={[
              { value: '', label: '—' },
              ...classes.map((k) => ({ value: k.id, label: `${k.code} · ${k.name}` })),
            ]}
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
            {f('show')}
          </Button>
        </form>
        {cls ? (
          <p className="ep-field__help">
            Showing the <strong>{group.replace(/_/g, ' ')}</strong> structure of {cls.name}. A pupil
            follows the group chosen on their fee profile; everyone else follows “general”.
          </p>
        ) : null}
        {cls ? (
          <form action={setFeeStructure} style={{ marginTop: 'var(--sp-4)' }}>
            <input type="hidden" name="classId" value={cls.id} />
            <input type="hidden" name="feeGroup" value={group} />
            <DataTable<FeeHead>
              caption={`${cls.name}: ${f('structure')}`}
              density="dense"
              columns={[
                {
                  key: 'head',
                  header: f('head'),
                  render: (h) => (
                    <span>
                      <input type="hidden" name="headIds" value={h.id} />
                      <strong>{h.code}</strong> · {h.name}
                    </span>
                  ),
                },
                {
                  key: 'amount',
                  header: f('amount'),
                  render: (h) =>
                    canManage ? (
                      <input
                        className="ep-input"
                        name={`amount:${h.id}`}
                        type="number"
                        min={0}
                        step="0.01"
                        defaultValue={byHead.get(h.id)?.amount ?? ''}
                        style={{ width: 120 }}
                        aria-label={f('amount')}
                      />
                    ) : (
                      (byHead.get(h.id)?.amount ?? '')
                    ),
                },
                {
                  key: 'frequency',
                  header: f('frequency'),
                  render: (h) =>
                    canManage ? (
                      <select
                        className="ep-select"
                        name={`frequency:${h.id}`}
                        defaultValue={byHead.get(h.id)?.frequency ?? 'monthly'}
                        aria-label={f('frequency')}
                      >
                        {FREQ.map((q) => (
                          <option key={q} value={q}>
                            {f(`frequencies.${q}`)}
                          </option>
                        ))}
                      </select>
                    ) : (
                      f(`frequencies.${byHead.get(h.id)?.frequency ?? 'monthly'}`)
                    ),
                },
                {
                  key: 'type',
                  header: f('studentType'),
                  render: (h) =>
                    canManage ? (
                      <select
                        className="ep-select"
                        name={`studentType:${h.id}`}
                        defaultValue={byHead.get(h.id)?.studentType ?? 'all'}
                        aria-label={f('studentType')}
                      >
                        {(['all', 'new', 'old'] as const).map((s) => (
                          <option key={s} value={s}>
                            {f(`studentTypes.${s}`)}
                          </option>
                        ))}
                      </select>
                    ) : (
                      f(`studentTypes.${byHead.get(h.id)?.studentType ?? 'all'}`)
                    ),
                },
                {
                  key: 'annual',
                  header: f('annual'),
                  numeric: true,
                  render: (h) => byHead.get(h.id)?.annual ?? '',
                },
              ]}
              rows={heads}
              rowKey={(h) => h.id}
              emptyTitle={f('noHeads')}
            />
            <p className="ep-field__help" style={{ marginTop: 'var(--sp-2)' }}>
              {f('yearTotal')}: <strong>₹{yearTotal.toFixed(2)}</strong>
            </p>
            {canManage ? (
              <FormActions>
                <Button type="submit">{f('saveStructure')}</Button>
              </FormActions>
            ) : null}
          </form>
        ) : null}
      </Card>
    </>
  );
}
