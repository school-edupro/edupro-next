import {
  Badge,
  Button,
  Card,
  DataTable,
  FormActions,
  FormRow,
  InputField,
  PageHeader,
  SelectField,
  toneForStatus,
} from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import {
  createFeeDiscount,
  createFeeHead,
  createTransportSlab,
  generateFeePeriods,
  setFeeHeadStatus,
} from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import type { FeeDiscount, FeeHead, FeePeriod, TransportSlab } from '@/lib/types';

const KINDS = ['regular', 'transport', 'opening_balance', 'late_fee', 'misc'] as const;

/** S8-06: fee heads, periods, transport slabs and discounts of the working year. */
export default async function FeeMastersPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const [t, f, c, me] = await Promise.all([
    getTranslations('pages.fees_masters'),
    getTranslations('fees'),
    getTranslations('common'),
    getMe(),
  ]);
  const canManage = me.permissions.includes('fees.master.manage');
  const [heads, periods, slabs, discounts] = await Promise.all([
    apiFetch<{ data: FeeHead[] }>('/fees/heads').then((r) => r.data),
    apiFetch<{ data: FeePeriod[] }>('/fees/periods').then((r) => r.data),
    apiFetch<{ data: TransportSlab[] }>('/fees/slabs').then((r) => r.data),
    apiFetch<{ data: FeeDiscount[] }>('/fees/discounts').then((r) => r.data),
  ]);
  return (
    <>
      <PageHeader kicker={t('kicker')} title={t('title')} description={t('description')} />
      <Notice params={sp} />
      <div
        style={{
          display: 'grid',
          gap: 'var(--sp-5)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(440px, 1fr))',
        }}
      >
        <Card title={f('heads')}>
          <DataTable<FeeHead>
            caption={f('heads')}
            density="dense"
            columns={[
              { key: 'code', header: f('code'), render: (h) => <strong>{h.code}</strong> },
              { key: 'name', header: f('name'), render: (h) => h.name },
              { key: 'kind', header: f('kind'), render: (h) => f(`kinds.${h.kind}`) },
              {
                key: 'status',
                header: c('status'),
                render: (h) => <Badge tone={toneForStatus(h.status)}>{c(h.status)}</Badge>,
              },
              {
                key: 'actions',
                header: '',
                render: (h) =>
                  canManage ? (
                    <form action={setFeeHeadStatus}>
                      <input type="hidden" name="id" value={h.id} />
                      <input
                        type="hidden"
                        name="status"
                        value={h.status === 'active' ? 'inactive' : 'active'}
                      />
                      <Button type="submit" variant="ghost" size="sm">
                        {h.status === 'active' ? f('deactivate') : f('activate')}
                      </Button>
                    </form>
                  ) : null,
              },
            ]}
            rows={heads}
            rowKey={(h) => h.id}
            emptyTitle={f('noHeads')}
          />
          {canManage ? (
            <form action={createFeeHead} style={{ marginTop: 'var(--sp-4)' }}>
              <FormRow columns={4}>
                <InputField
                  id="hcode"
                  name="code"
                  label={f('code')}
                  required
                  pattern="[A-Za-z0-9_]{2,20}"
                />
                <InputField id="hname" name="name" label={f('name')} required maxLength={80} />
                <SelectField
                  id="hkind"
                  name="kind"
                  label={f('kind')}
                  options={KINDS.map((k) => ({ value: k, label: f(`kinds.${k}`) }))}
                />
                <InputField
                  id="horder"
                  name="sortOrder"
                  label={f('order')}
                  type="number"
                  min={0}
                  defaultValue={heads.length + 1}
                />
              </FormRow>
              <FormActions>
                <Button type="submit" variant="secondary">
                  {f('addHead')}
                </Button>
              </FormActions>
            </form>
          ) : null}
        </Card>
        <Card title={f('periods')}>
          <DataTable<FeePeriod>
            caption={f('periods')}
            density="dense"
            columns={[
              { key: 'seq', header: '#', numeric: true, render: (p) => p.sequence },
              { key: 'name', header: f('period'), render: (p) => p.name },
              { key: 'inst', header: f('instalment'), numeric: true, render: (p) => p.instalment },
              { key: 'due', header: f('dueOn'), render: (p) => p.dueOn },
            ]}
            rows={periods}
            rowKey={(p) => p.id}
            emptyTitle={f('noPeriods')}
          />
          {canManage ? (
            <form action={generateFeePeriods} style={{ marginTop: 'var(--sp-4)' }}>
              <FormRow columns={3}>
                <InputField
                  id="dueDay"
                  name="dueDay"
                  label={f('dueDay')}
                  type="number"
                  min={1}
                  max={28}
                  defaultValue={10}
                />
                <SelectField
                  id="mpi"
                  name="monthsPerInstalment"
                  label={f('monthsPerInstalment')}
                  defaultValue="3"
                  options={[
                    { value: '1', label: '1' },
                    { value: '3', label: '3' },
                    { value: '6', label: '6' },
                    { value: '12', label: '12' },
                  ]}
                />
              </FormRow>
              <FormActions>
                <Button type="submit" variant="secondary">
                  {f('generatePeriods')}
                </Button>
              </FormActions>
            </form>
          ) : null}
        </Card>
        <Card title={f('slabs')}>
          <DataTable<TransportSlab>
            caption={f('slabs')}
            density="dense"
            columns={[
              { key: 'code', header: f('code'), render: (s) => <strong>{s.code}</strong> },
              { key: 'name', header: f('name'), render: (s) => s.name },
              {
                key: 'km',
                header: f('from'),
                render: (s) => `${s.distanceFromKm ?? '…'} – ${s.distanceToKm ?? '…'}`,
              },
              {
                key: 'amount',
                header: f('monthly'),
                numeric: true,
                render: (s) => s.monthlyAmount,
              },
            ]}
            rows={slabs}
            rowKey={(s) => s.id}
            emptyTitle={f('noSlabs')}
          />
          {canManage ? (
            <form action={createTransportSlab} style={{ marginTop: 'var(--sp-4)' }}>
              <FormRow columns={4}>
                <InputField
                  id="scode"
                  name="code"
                  label={f('code')}
                  required
                  pattern="[A-Za-z0-9_]{1,20}"
                />
                <InputField id="sname" name="name" label={f('name')} required maxLength={80} />
                <InputField
                  id="sfrom"
                  name="distanceFromKm"
                  label={f('from')}
                  type="number"
                  min={0}
                  step="0.1"
                />
                <InputField
                  id="sto"
                  name="distanceToKm"
                  label={f('to')}
                  type="number"
                  min={0}
                  step="0.1"
                />
                <InputField
                  id="samount"
                  name="monthlyAmount"
                  label={f('monthly')}
                  type="number"
                  min={0}
                  required
                />
              </FormRow>
              <FormActions>
                <Button type="submit" variant="secondary">
                  {f('addSlab')}
                </Button>
              </FormActions>
            </form>
          ) : null}
        </Card>
        <Card title={f('discounts')}>
          <DataTable<FeeDiscount>
            caption={f('discounts')}
            density="dense"
            columns={[
              { key: 'code', header: f('code'), render: (d) => <strong>{d.code}</strong> },
              { key: 'name', header: f('name'), render: (d) => d.name },
              { key: 'head', header: f('head'), render: (d) => d.headCode ?? f('allHeads') },
              {
                key: 'value',
                header: f('amount'),
                numeric: true,
                render: (d) => (d.percent ? `${d.percent}%` : `₹${d.amount}`),
              },
              {
                key: 'trn',
                header: f('appliesToTransport'),
                render: (d) => (d.appliesToTransport ? c('yes') : c('no')),
              },
            ]}
            rows={discounts}
            rowKey={(d) => d.id}
            emptyTitle={f('noDiscounts')}
          />
          {canManage ? (
            <form action={createFeeDiscount} style={{ marginTop: 'var(--sp-4)' }}>
              <FormRow columns={4}>
                <InputField
                  id="dcode"
                  name="code"
                  label={f('code')}
                  required
                  pattern="[A-Za-z0-9_]{1,20}"
                />
                <InputField id="dname" name="name" label={f('name')} required maxLength={80} />
                <SelectField
                  id="dhead"
                  name="headId"
                  label={f('head')}
                  options={[
                    { value: '', label: f('allHeads') },
                    ...heads
                      .filter((h) => h.kind === 'regular')
                      .map((h) => ({ value: h.id, label: h.code })),
                  ]}
                />
                <SelectField
                  id="dmode"
                  name="mode"
                  label={f('mode')}
                  options={[
                    { value: 'percent', label: f('percent') },
                    { value: 'amount', label: f('amount') },
                  ]}
                />
                <InputField
                  id="dvalue"
                  name="value"
                  label={f('amount')}
                  type="number"
                  min={0}
                  step="0.01"
                  required
                />
              </FormRow>
              <label style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
                <input type="checkbox" name="appliesToTransport" value="1" />{' '}
                {f('appliesToTransport')}
              </label>
              <FormActions>
                <Button type="submit" variant="secondary">
                  {f('addDiscount')}
                </Button>
              </FormActions>
            </form>
          ) : null}
        </Card>
      </div>
    </>
  );
}
