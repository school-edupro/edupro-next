import { Badge, Button, Card, InputField, PageHeader, SelectField } from '@edupro/ui';
import { ApiError } from '@edupro/bff';
import { redirect } from 'next/navigation';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import { raiseDataRequest } from './actions';

interface Dsr {
  id: string;
  kind: string;
  principal: string | null;
  status: string;
  receivedOn: string;
  dueOn: string;
  outcome: string | null;
  exportId: string | null;
  exportStatus: string | null;
}
interface Viewer {
  students: Array<{ id: string; name: string }>;
}
const tone = (s: string) =>
  s === 'completed'
    ? 'success'
    : s === 'refused'
      ? 'danger'
      : s === 'in_progress'
        ? 'info'
        : 'warning';

/** Sprint 20: the family's rights under the DPDP Act: what the school holds, corrections, grievances. */
export default async function DataPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string; export?: string }>;
}) {
  const sp = await searchParams;
  const lang = await currentLang();
  let requests: Dsr[];
  let viewer: Viewer;
  try {
    [requests, viewer] = await Promise.all([
      bff.api.fetch<{ data: Dsr[] }>('/privacy/requests/mine').then((r) => r.data),
      bff.api.fetch<Viewer>('/academics/daily-work/viewer').catch(() => ({ students: [] })),
    ]);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && error.status === 403)
      return (
        <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
          <PageHeader kicker="EduPro" title={t(lang, 'Your data')} />
          <Card>
            {t(
              lang,
              'Your account is not linked to a student yet. Please contact the school office.',
            )}
          </Card>
        </main>
      );
    throw error;
  }
  const exportStatus = sp.export
    ? await bff.api
        .fetch<{ export: { id: string; status: string }; download: { url: string } | null }>(
          `/privacy/requests/mine/${sp.export}/export`,
        )
        .catch(() => null)
    : null;
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
      <PageHeader
        kicker={t(lang, 'Profile')}
        title={t(lang, 'Your data')}
        description={t(
          lang,
          'Under the Digital Personal Data Protection Act you may ask what the school holds about you and your children, ask for a correction, or raise a grievance. The school answers within the time the law allows.',
        )}
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/profile">
            {t(lang, 'Profile')}
          </a>
        }
      />
      {sp.ok ? (
        <div
          className="ep-alert ep-alert--success"
          role="status"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {t(lang, 'Your request is recorded. The school office will respond.')}
        </div>
      ) : null}
      {sp.error ? (
        <div
          className="ep-alert ep-alert--danger"
          role="alert"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {sp.detail || sp.error}
        </div>
      ) : null}
      {exportStatus ? (
        <div
          className="ep-alert ep-alert--info"
          role="status"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {exportStatus.download ? (
            <a href={exportStatus.download.url}>{t(lang, 'Download your data report (PDF)')}</a>
          ) : (
            <>
              {t(lang, 'Your report is being prepared.')}{' '}
              <a href={`/profile/data?export=${sp.export}`}>{t(lang, 'Refresh')}</a>
            </>
          )}
        </div>
      ) : null}
      <Card title={t(lang, 'Raise a request')} style={{ marginBottom: 'var(--sp-3)' }}>
        <form action={raiseDataRequest} style={{ display: 'grid', gap: 'var(--sp-2)' }}>
          <SelectField
            id="kind"
            name="kind"
            label={t(lang, 'What do you need?')}
            options={[
              { value: 'access', label: t(lang, 'A copy of the data the school holds') },
              { value: 'correction', label: t(lang, 'A correction to the data') },
              { value: 'grievance', label: t(lang, 'A grievance about how data is used') },
            ]}
          />
          <SelectField
            id="studentId"
            name="studentId"
            label={t(lang, 'About whom?')}
            options={[
              { value: '', label: t(lang, 'Myself') },
              ...viewer.students.map((s) => ({ value: s.id, label: s.name })),
            ]}
          />
          <InputField
            id="detail"
            name="detail"
            label={t(lang, 'Details')}
            required
            minLength={3}
            maxLength={2000}
          />
          <div>
            <Button type="submit">{t(lang, 'Send to the school')}</Button>
          </div>
        </form>
      </Card>
      <Card title={t(lang, 'Your requests')}>
        {requests.length === 0 ? (
          <p className="ep-field__help">{t(lang, 'No requests yet.')}</p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {requests.map((r) => (
              <li
                key={r.id}
                style={{ padding: 'var(--sp-2) 0', borderTop: '1px solid var(--border-subtle)' }}
              >
                <div
                  style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--sp-2)' }}
                >
                  <strong>
                    {t(
                      lang,
                      r.kind === 'access'
                        ? 'Access'
                        : r.kind === 'correction'
                          ? 'Correction'
                          : r.kind === 'erasure'
                            ? 'Erasure'
                            : 'Grievance',
                    )}
                    {r.principal ? ` · ${r.principal}` : ''}
                  </strong>
                  <Badge tone={tone(r.status)}>{r.status.replace('_', ' ')}</Badge>
                </div>
                <div className="ep-kicker">
                  {t(lang, 'Received')} {r.receivedOn} · {t(lang, 'Due by')} {r.dueOn}
                  {r.outcome ? ` · ${r.outcome}` : ''}
                </div>
                {r.status === 'completed' && r.exportId ? (
                  <a
                    className="ep-btn ep-btn--secondary ep-btn--sm"
                    href={`/profile/data?export=${r.id}`}
                    style={{ marginTop: 'var(--sp-1)' }}
                  >
                    {t(lang, 'Download your data report (PDF)')}
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </main>
  );
}
