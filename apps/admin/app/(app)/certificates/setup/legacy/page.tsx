import { Badge, Breadcrumbs, Button, Card, DataTable, KpiTile, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { ConfirmAction } from '@/components/ConfirmAction';
import { Notice } from '@/components/Notice';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { legacyBring, legacyRead, legacySaveMap } from '@/lib/certificate-setup-actions';
import { dmy } from '@/lib/certificates';

interface Legacy {
  read: { requestedAt: string | null; at: string | null; error: string | null; rows: number };
  groups: Array<{
    key: string;
    name: string;
    staff: boolean;
    rows: number;
    cancelled: number;
    matched: number;
    brought: number;
    guessed: string | null;
    mapped: string | null;
  }>;
  types: Array<{ code: string; name: string; audience: string }>;
  brought: { at: string | null; by: string | null; counts: Record<string, number> };
  series: Array<{ typeCode: string; yearCode: string; oldLast: number; current: number }>;
  book: { oldLast: number; current: number };
  check: { read: number; brought: number; left: number; ok: boolean };
}
type G = Legacy['groups'][number];
type S = Legacy['series'][number];

/**
 * From the old system (docs/design/87, phase F): the old register read by the server, each old certificate name with
 * its type, a check run, the bring (history under the old numbers), the numbers that carry on, the count check.
 */
export default async function LegacyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('certificate.setup.manage')) notFound();
  let x: Legacy;
  try {
    x = await apiFetch<Legacy>('/certificates/setup/legacy');
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) notFound();
    throw e;
  }
  const at = (v: string | null) => (v ? `${dmy(v.slice(0, 10))} ${v.slice(11, 16)} UTC` : '—');
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Certificate set-up', href: '/certificates/setup' },
          { label: 'From the old system' },
        ]}
      />
      <PageHeader
        kicker="Certificate set-up"
        title="From the old system"
        description="The old system's certificates as read-only history under their own numbers; each series and the TC book carry on after its last number."
      />
      {sp.ok && sp.detail ? (
        <div className="ep-alert ep-alert--success" role="status">
          {sp.detail}
        </div>
      ) : sp.ok === 'read' ? (
        <div className="ep-alert ep-alert--info" role="status">
          Asked the workers to read the old register; this page shows it once read.
        </div>
      ) : sp.ok === 'map' ? (
        <div className="ep-alert ep-alert--success" role="status">
          Saved.
        </div>
      ) : (
        <Notice params={sp} />
      )}
      <div className="ep-dash-kpis">
        <KpiTile label="Read from the old register" value={String(x.read.rows)} />
        <KpiTile label="Brought" value={String(x.check.brought)} />
        <KpiTile label="Left out" value={String(x.check.left)} />
        <KpiTile label="Old names" value={String(x.groups.length)} />
        <KpiTile label="Old TC book's last Sl. No." value={String(x.book.oldLast)} />
        <KpiTile
          label="Count check"
          value={x.read.rows ? (x.check.ok ? 'Adds up' : 'To bring') : '—'}
        />
      </div>
      <Card title="1. Read the old register">
        <p style={{ marginTop: 0 }}>
          Last read: {at(x.read.at)}
          {x.read.requestedAt ? ` · asked ${at(x.read.requestedAt)}` : ''}
        </p>
        {x.read.error ? (
          <div className="ep-alert ep-alert--warning" role="status">
            {x.read.error}
          </div>
        ) : null}
        <p className="ep-field__help">
          The server reads the old database through its own connection (set by IT, never typed
          here), read only. Read again before bringing, so the newest certificates come too.
        </p>
        <form action={legacyRead}>
          <Button type="submit" variant="secondary">
            Read the old register
          </Button>
        </form>
      </Card>
      <Card title="2. Each old certificate name and its type">
        {x.groups.length ? (
          <form action={legacySaveMap}>
            <DataTable<G>
              caption="Old certificate names"
              density="dense"
              columns={[
                { key: 'n', header: 'Old name', render: (g) => <strong>{g.key}</strong> },
                {
                  key: 'r',
                  header: 'Rows',
                  render: (g) =>
                    `${String(g.rows)}${g.cancelled ? ` (${String(g.cancelled)} deleted)` : ''}`,
                },
                {
                  key: 'm',
                  header: 'Person found',
                  render: (g) => `${String(g.matched)} of ${String(g.rows)}`,
                },
                {
                  key: 't',
                  header: 'Comes as',
                  render: (g) => (
                    <select
                      aria-label={`Type for ${g.key}`}
                      name={`map:${g.key}`}
                      className="ep-select"
                      defaultValue={g.mapped ?? ''}
                    >
                      <option value="">Not brought</option>
                      {x.types
                        .filter((t) =>
                          g.staff ? t.audience === 'STAFF' : t.audience === 'STUDENT',
                        )
                        .map((t) => (
                          <option key={t.code} value={t.code}>
                            {t.name}
                          </option>
                        ))}
                    </select>
                  ),
                },
                {
                  key: 'b',
                  header: 'Brought',
                  render: (g) => (
                    <Badge tone={g.brought === g.rows ? 'success' : g.brought ? 'info' : 'neutral'}>
                      {String(g.brought)}
                    </Badge>
                  ),
                },
              ]}
              rows={x.groups}
              rowKey={(g) => g.key}
              emptyTitle="Nothing read yet"
            />
            <div style={{ marginTop: 'var(--sp-3)' }}>
              <Button type="submit" variant="secondary">
                Save the types
              </Button>
            </div>
          </form>
        ) : (
          <p className="ep-field__help" style={{ margin: 0 }}>
            Nothing read yet.
          </p>
        )}
      </Card>
      <Card title="3. Bring them">
        <p className="ep-field__help" style={{ marginTop: 0 }}>
          Each old certificate comes once, under its old number and date, linked to the student
          (admission no.) or the employee (employee code); one the old system deleted comes
          cancelled. A reprint prints its old record and says it comes from the old system. Brought
          again, nothing comes twice.
          {x.brought.at
            ? ` Last brought ${at(x.brought.at)}${x.brought.by ? ` by ${x.brought.by}` : ''}.`
            : ''}
        </p>
        <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
          <form action={legacyBring}>
            <input type="hidden" name="dryRun" value="1" />
            <Button type="submit" size="sm" variant="secondary" disabled={!x.read.rows}>
              Check first (nothing saved)
            </Button>
          </form>
          {x.read.rows ? (
            <ConfirmAction
              action={legacyBring}
              fields={{ dryRun: '0' }}
              label="Bring them"
              title="Bring the old certificates"
              confirmLabel="Bring them"
            >
              The certificates come as read-only history; each type&apos;s series and the TC book
              carry on after the old system&apos;s last number.
            </ConfirmAction>
          ) : null}
        </div>
      </Card>
      <Card title="4. The numbers that carry on">
        <DataTable<S>
          caption="Series that carry on"
          density="dense"
          columns={[
            {
              key: 't',
              header: 'Type',
              render: (r) => x.types.find((t) => t.code === r.typeCode)?.name ?? r.typeCode,
            },
            { key: 'y', header: 'Year', render: (r) => r.yearCode },
            { key: 'o', header: "Old system's last", render: (r) => String(r.oldLast) },
            {
              key: 'c',
              header: 'Next here',
              render: (r) => (
                <>
                  {String(Math.max(r.current, r.oldLast) + 1)}{' '}
                  {r.current >= r.oldLast ? (
                    <Badge tone="success">Carries on</Badge>
                  ) : (
                    <Badge tone="warning">After the bring</Badge>
                  )}
                </>
              ),
            },
          ]}
          rows={x.series}
          rowKey={(r) => `${r.typeCode}-${r.yearCode}`}
          emptyTitle="Nothing read yet"
        />
        <p className="ep-field__help">
          TC book: the old system&apos;s last Sl. No. {String(x.book.oldLast)}; the next here is{' '}
          {String(Math.max(x.book.current, x.book.oldLast) + 1)}
          {x.book.current >= x.book.oldLast ? '' : ' (after the bring)'}.
        </p>
      </Card>
      <Card title="5. The count check">
        <p style={{ margin: 0 }}>
          Read {String(x.check.read)} · brought {String(x.check.brought)} · left out{' '}
          {String(x.check.left)}
          {x.brought.counts.noType || x.brought.counts.noPerson
            ? ` (${String(x.brought.counts.noType ?? 0)} with no type, ${String(x.brought.counts.noPerson ?? 0)} with no student or employee found)`
            : ''}{' '}
          <Badge tone={x.check.ok ? 'success' : 'warning'}>
            {x.check.ok ? 'Adds up' : 'Bring, then check again'}
          </Badge>
        </p>
      </Card>
    </>
  );
}
