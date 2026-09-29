import { Badge, Button, Card, DataTable, FormRow, InputField, PageHeader } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { visitorIn, visitorOut } from '@/lib/actions';
import { apiFetch } from '@/lib/api';

interface Visitor {
  id: string;
  visitorName: string;
  mobile: string | null;
  organisation: string | null;
  purpose: string;
  toMeet: string | null;
  idProofKind: string | null;
  badgeNo: string | null;
  inAt: string;
  outAt: string | null;
  loggedBy: string | null;
}

const hm = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '';

/** Sprint 19: the visitor log. */
export default async function VisitorsPage({
  searchParams,
}: {
  searchParams: Promise<{ onDate?: string; ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const [t, e, rows] = await Promise.all([
    getTranslations('pages.engagement_visitors'),
    getTranslations('eng19'),
    apiFetch<{ data: Visitor[] }>(
      `/engagement/visitors${sp.onDate ? `?onDate=${sp.onDate}` : ''}`,
    ).then((x) => x.data),
  ]);
  return (
    <>
      <PageHeader
        kicker={t('kicker')}
        title={t('title')}
        description={t('description')}
        actions={
          <form
            method="get"
            style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'flex-end' }}
          >
            <InputField
              id="onDate"
              name="onDate"
              label={e('onDate')}
              type="date"
              defaultValue={sp.onDate ?? ''}
            />
            <Button type="submit" variant="secondary" size="sm">
              {e('show')}
            </Button>
          </form>
        }
      />
      <Notice params={sp} />
      <Card title={e('signIn')} style={{ marginBottom: 'var(--sp-4)' }}>
        <form action={visitorIn}>
          <FormRow columns={4}>
            <InputField
              id="visitorName"
              name="visitorName"
              label={e('visitorName')}
              required
              minLength={2}
              maxLength={120}
            />
            <InputField id="mobile" name="mobile" label={e('mobile')} pattern="\\d{10}" />
            <InputField
              id="organisation"
              name="organisation"
              label={e('organisation')}
              maxLength={120}
            />
            <InputField id="purpose" name="purpose" label={e('purpose')} required maxLength={300} />
            <InputField id="toMeet" name="toMeet" label={e('toMeet')} maxLength={120} />
            <InputField
              id="idProofKind"
              name="idProofKind"
              label={e('idProofKind')}
              maxLength={40}
            />
            <InputField id="badgeNo" name="badgeNo" label={e('badgeNo')} maxLength={20} />
            <div style={{ alignSelf: 'end' }}>
              <Button type="submit">{e('signIn')}</Button>
            </div>
          </FormRow>
        </form>
      </Card>
      <Card>
        <DataTable<Visitor>
          caption={`${t('title')} · ${rows.length}`}
          density="dense"
          columns={[
            {
              key: 'n',
              header: e('visitorName'),
              render: (v) => (
                <>
                  <strong>{v.visitorName}</strong>
                  <div className="ep-kicker">
                    {v.organisation ?? ''}
                    {v.mobile ? ` · ${v.mobile}` : ''}
                  </div>
                </>
              ),
            },
            {
              key: 'p',
              header: e('purpose'),
              render: (v) => (
                <>
                  {v.purpose}
                  {v.toMeet ? (
                    <div className="ep-kicker">
                      {e('toMeet')}: {v.toMeet}
                    </div>
                  ) : null}
                </>
              ),
            },
            { key: 'b', header: e('badgeNo'), render: (v) => v.badgeNo ?? '' },
            { key: 'i', header: e('inAt'), render: (v) => hm(v.inAt) },
            {
              key: 'o',
              header: e('outAt'),
              render: (v) => (v.outAt ? hm(v.outAt) : <Badge tone="warning">in</Badge>),
            },
            {
              key: 'a',
              header: '',
              render: (v) =>
                v.outAt ? null : (
                  <form action={visitorOut}>
                    <input type="hidden" name="id" value={v.id} />
                    <Button type="submit" size="sm" variant="secondary">
                      {e('signOut')}
                    </Button>
                  </form>
                ),
            },
          ]}
          rows={rows}
          rowKey={(v) => v.id}
          emptyTitle={e('noRows')}
        />
      </Card>
    </>
  );
}
