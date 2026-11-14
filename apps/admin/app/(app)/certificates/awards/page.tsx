import { Badge, Breadcrumbs, Button, Card, DataTable, PageHeader, SelectField } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { Pager, pageSizeOf } from '@/components/Pager';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import {
  addAllotment,
  importAllotments,
  issueAllotments,
  saveAward,
} from '@/lib/certificate-actions';
import { dmy, type CertificateAllotment, type CertificateAward } from '@/lib/certificates';

/**
 * Awards (docs/design/87, phase E): the awards the school gives and the certificate each is printed on; who received
 * them — added one by one or from a CSV; tick and issue their certificates (a batch a certificate type).
 */
export default async function AwardsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('certificate.register.view')) notFound();
  const canIssue = me.permissions.includes('certificate.register.issue');
  const canSetup = me.permissions.includes('certificate.setup.manage');
  const size = pageSizeOf(sp.size);
  const q = new URLSearchParams();
  if (sp.award && /^\d{1,18}$/.test(sp.award)) q.set('award', sp.award);
  if (sp.issued === 'yes' || sp.issued === 'no') q.set('issued', sp.issued);
  if (sp.q) q.set('q', sp.q.slice(0, 80));
  const qs = new URLSearchParams(q);
  qs.set('size', size);
  qs.set('page', String(Math.max(1, Number(sp.page) || 1)));
  let awards: { rows: CertificateAward[]; types: Array<{ code: string; name: string }> };
  let list: { total: number; rows: CertificateAllotment[] };
  try {
    [awards, list] = await Promise.all([
      apiFetch<{ rows: CertificateAward[]; types: Array<{ code: string; name: string }> }>(
        '/certificates/awards',
      ),
      apiFetch<{ total: number; rows: CertificateAllotment[] }>(
        `/certificates/allotments?${qs.toString()}`,
      ),
    ]);
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) notFound();
    throw e;
  }
  const live = awards.rows.filter((a) => a.active);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <>
      <Breadcrumbs
        items={[{ label: 'Certificate register', href: '/certificates' }, { label: 'Awards' }]}
      />
      <PageHeader
        kicker="Certificates"
        title="Awards"
        description="The awards the school gives, who received them, and their certificates."
      />
      <Notice params={sp} />
      <Card title="Who received them">
        <form
          method="get"
          style={{
            display: 'flex',
            gap: 'var(--sp-3)',
            alignItems: 'flex-end',
            flexWrap: 'wrap',
            marginBottom: 'var(--sp-3)',
          }}
        >
          <SelectField
            id="award"
            name="award"
            label="Award"
            defaultValue={q.get('award') ?? ''}
            options={[
              { value: '', label: 'All awards' },
              ...awards.rows.map((a) => ({ value: a.id, label: a.name })),
            ]}
          />
          <SelectField
            id="issued"
            name="issued"
            label="Certificate"
            defaultValue={q.get('issued') ?? ''}
            options={[
              { value: '', label: 'Any' },
              { value: 'no', label: 'Not issued yet' },
              { value: 'yes', label: 'Issued' },
            ]}
          />
          <label className="ep-field" htmlFor="q" style={{ margin: 0 }}>
            <span className="ep-field__label">Student, admission no. or event</span>
            <input id="q" name="q" className="ep-input" defaultValue={sp.q ?? ''} maxLength={80} />
          </label>
          <Button type="submit" variant="secondary">
            Apply
          </Button>
        </form>
        <form action={issueAllotments}>
          <DataTable<CertificateAllotment>
            caption="Who received which award"
            density="dense"
            columns={[
              {
                key: 'pick',
                header: 'Issue',
                render: (x) =>
                  x.certificateId ? (
                    <a href={`/certificates/${x.certificateId}`}>{x.number}</a>
                  ) : canIssue ? (
                    <label className="ep-check" htmlFor={`al${x.id}`}>
                      <input
                        id={`al${x.id}`}
                        type="checkbox"
                        name="allotment"
                        value={x.id}
                        className="ep-check__input"
                      />
                      <span className="ep-check__box" />
                      <span className="ep-sr-only">Issue for {x.name}</span>
                    </label>
                  ) : (
                    '—'
                  ),
              },
              { key: 'award', header: 'Award', render: (x) => x.award },
              { key: 'who', header: 'Student', render: (x) => `${x.name} · ${x.admissionNo}` },
              { key: 'class', header: 'Class', render: (x) => x.classLabel ?? '' },
              {
                key: 'event',
                header: 'Event',
                render: (x) => `${x.event ?? ''}${x.position ? ` · ${x.position}` : ''}`,
              },
              { key: 'on', header: 'Date', render: (x) => dmy(x.awardedOn) },
            ]}
            rows={list.rows}
            rowKey={(x) => x.id}
            emptyTitle="Nobody yet"
          />
          {canIssue ? (
            <div style={{ marginTop: 'var(--sp-3)' }}>
              <Button type="submit">Issue the ticked certificates</Button>
            </div>
          ) : null}
        </form>
        <Pager
          page={Math.max(1, Number(sp.page) || 1)}
          size={Number(size)}
          total={list.total}
          href={(p) => {
            const u = new URLSearchParams(q);
            u.set('page', String(p));
            u.set('size', size);
            return `/certificates/awards?${u.toString()}`;
          }}
          noun="awards given"
        />
      </Card>
      {canIssue && live.length ? (
        <>
          <Card title="Add one">
            <form action={addAllotment} className="ep-cert-fields">
              <SelectField
                id="awardId"
                name="awardId"
                label="Award"
                defaultValue={live[0]!.id}
                options={live.map((a) => ({ value: a.id, label: a.name }))}
              />
              <label className="ep-field" htmlFor="admissionNo">
                <span className="ep-field__label">Admission no. *</span>
                <input
                  id="admissionNo"
                  name="admissionNo"
                  className="ep-input"
                  required
                  maxLength={40}
                />
              </label>
              <label className="ep-field" htmlFor="event">
                <span className="ep-field__label">Event or competition</span>
                <input id="event" name="event" className="ep-input" maxLength={160} />
              </label>
              <label className="ep-field" htmlFor="position">
                <span className="ep-field__label">Place or level</span>
                <input
                  id="position"
                  name="position"
                  className="ep-input"
                  maxLength={40}
                  placeholder="e.g. First"
                />
              </label>
              <label className="ep-field" htmlFor="awardedOn">
                <span className="ep-field__label">Date *</span>
                <input
                  id="awardedOn"
                  name="awardedOn"
                  type="date"
                  className="ep-input"
                  defaultValue={today}
                  required
                />
              </label>
              <label className="ep-field" htmlFor="remarks">
                <span className="ep-field__label">Remarks</span>
                <input id="remarks" name="remarks" className="ep-input" maxLength={300} />
              </label>
              <div>
                <Button type="submit" variant="secondary">
                  Add
                </Button>
              </div>
            </form>
          </Card>
          <Card title="From a CSV">
            <p className="ep-field__help" style={{ marginTop: 0 }}>
              Columns: admission_no, award (its name as above), event, position, date (dd-mm-yyyy),
              remarks. The file is checked first; nothing is saved while a line is wrong.
            </p>
            <form
              action={importAllotments}
              style={{
                display: 'flex',
                gap: 'var(--sp-3)',
                alignItems: 'flex-end',
                flexWrap: 'wrap',
              }}
            >
              <label className="ep-field" htmlFor="file" style={{ margin: 0 }}>
                <span className="ep-field__label">CSV file</span>
                <input
                  id="file"
                  name="file"
                  type="file"
                  accept=".csv,text/csv"
                  className="ep-input"
                  required
                />
              </label>
              <label className="ep-check" htmlFor="save">
                <input id="save" type="checkbox" name="save" className="ep-check__input" />
                <span className="ep-check__box" />
                Save them (leave it unticked to check only)
              </label>
              <Button type="submit" variant="secondary">
                Upload
              </Button>
            </form>
          </Card>
        </>
      ) : null}
      <Card title="The awards">
        <DataTable<CertificateAward>
          caption="The awards"
          density="dense"
          columns={[
            { key: 'n', header: 'Award', render: (a) => <strong>{a.name}</strong> },
            { key: 't', header: 'Printed on', render: (a) => a.typeName ?? a.typeCode },
            {
              key: 'g',
              header: 'Given',
              render: (a) => `${String(a.allotted)} (${String(a.issued)} issued)`,
            },
            {
              key: 's',
              header: '',
              render: (a) => (a.active ? null : <Badge tone="neutral">Off</Badge>),
            },
          ]}
          rows={awards.rows}
          rowKey={(a) => a.id}
          emptyTitle="No awards yet"
        />
        {canSetup ? (
          <form action={saveAward} className="ep-cert-fields" style={{ marginTop: 'var(--sp-3)' }}>
            <label className="ep-field" htmlFor="awName">
              <span className="ep-field__label">A new award *</span>
              <input
                id="awName"
                name="name"
                className="ep-input"
                required
                minLength={2}
                maxLength={120}
              />
            </label>
            <SelectField
              id="awType"
              name="typeCode"
              label="Printed on"
              defaultValue={awards.types[0]?.code ?? ''}
              options={awards.types.map((t) => ({ value: t.code, label: t.name }))}
            />
            <div style={{ alignSelf: 'end' }}>
              <Button type="submit" variant="secondary">
                Add the award
              </Button>
            </div>
          </form>
        ) : null}
      </Card>
    </>
  );
}
