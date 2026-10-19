import { Alert, Badge, Button, PageHeader } from '@edupro/ui';
import { MyPhoto } from '@/components/MyPhoto';
import { getTranslations } from 'next-intl/server';
import { FileLinks } from '@/components/FileLinks';
import { MyProfileLists } from '@/components/MyProfileLists';
import { Notice } from '@/components/Notice';
import { RefreshWhilePending } from '@/components/RefreshWhilePending';
import { ApiError, apiFetch } from '@/lib/api';
import { editable, REQUEST_STATUS, shown, type MyProfile } from '@/lib/my-profile';
import {
  myProfilePdf,
  removeMyRow,
  sendMyPhoto,
  withdrawMyRequest,
} from '@/lib/my-profile-actions';

/**
 * My profile for staff who work in the admin app (docs/design/33-people-dashboards.md): the same
 * screen the staff app shows under Office → My profile. Sections as the school shows them, an Update
 * per section (at once or for approval, with proofs), my own PDF, my requests with Withdraw.
 */
export default async function MyProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ export?: string; ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const t = await getTranslations('pages.me_profile');
  let p: MyProfile | null = null;
  let notStaff = false;
  try {
    p = await apiFetch<MyProfile>('/me/employee-profile');
  } catch (error) {
    if (error instanceof ApiError && error.problem.type === 'people.not_staff') notStaff = true;
    else throw error;
  }
  const exp =
    p && sp.export && /^\d{1,18}$/.test(sp.export)
      ? await apiFetch<{
          export: { id: string; status: string; error?: string | null };
          download: { url: string; saveUrl?: string } | null;
        }>(`/me/exports/${sp.export}`).catch(() => null)
      : null;
  if (!p) {
    return (
      <>
        <PageHeader kicker={t('kicker')} title={t('title')} description={t('description')} />
        <Alert tone="info">
          {notStaff
            ? 'Your login is not linked to an employee record, so there is no profile to show. The office links logins under Employee management → Employees.'
            : 'The profile could not be loaded.'}
        </Alert>
      </>
    );
  }
  const waiting = p.requests.filter((r) => r.status === 'pending').length;
  return (
    <>
      <PageHeader
        kicker={t('kicker')}
        title={p.employee.name}
        description={`Employee code ${p.employee.code} · profile ${String(p.completeness.percent)}% complete`}
        actions={
          <form action={myProfilePdf}>
            <Button type="submit" variant="secondary">
              Download PDF
            </Button>
          </form>
        }
      />
      <Notice params={sp} />
      {exp ? (
        <div style={{ marginBottom: 'var(--sp-4)' }}>
          <Alert tone={exp.export.status === 'failed' ? 'danger' : 'info'}>
            <RefreshWhilePending ready={Boolean(exp.download) || exp.export.status === 'failed'} />
            {exp.download ? (
              <span className="ep-filecell">
                My profile (PDF)
                <FileLinks href={`/me/exports/${exp.export.id}/file`} label="My profile (PDF)" />
              </span>
            ) : exp.export.status === 'failed' ? (
              `The PDF could not be prepared${exp.export.error ? `: ${exp.export.error}` : ''}. Please try again.`
            ) : (
              <>
                Your PDF is being prepared by the workers service.{' '}
                <a href={`/me/profile?export=${exp.export.id}`}>Refresh</a>
              </>
            )}
          </Alert>
        </div>
      ) : null}
      {!p.window.open || p.window.message ? (
        <div style={{ marginBottom: 'var(--sp-4)' }}>
          <Alert tone={p.window.open ? 'info' : 'warning'}>
            {p.window.message ?? 'Profile updates are closed at the moment.'}
          </Alert>
        </div>
      ) : null}
      <MyPhoto
        name={p.employee.name}
        photo={p.photo}
        canEdit={p.canEdit}
        src="/api/me/photo"
        action={sendMyPhoto}
        badge={(text) => <Badge tone="warning">{text}</Badge>}
        button={(label) => (
          <Button type="submit" variant="secondary" size="sm">
            {label}
          </Button>
        )}
      />

      {p.sections.map((s) => {
        const canUpdate = p.canEdit && s.fields.some(editable);
        return (
          <section
            key={s.id}
            className="ep-card ep-acr-card"
            aria-labelledby={`sec-${s.id}`}
            style={{ marginBottom: 'var(--sp-3)' }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 'var(--sp-2)',
                alignItems: 'center',
              }}
            >
              <h2 id={`sec-${s.id}`} className="ep-card__title" style={{ margin: 0 }}>
                {s.title}
              </h2>
              {canUpdate ? (
                <a
                  className="ep-btn ep-btn--ghost ep-btn--sm"
                  href={`/me/profile/edit?section=${s.id}`}
                >
                  Update
                </a>
              ) : null}
            </div>
            <dl className="ep-myprofile">
              {s.fields.map((f) => (
                <div key={f.key}>
                  <dt>{f.label}</dt>
                  <dd>
                    {shown(f.value)}
                    {f.pending !== undefined ? (
                      <span
                        className="ep-badge ep-badge--warning"
                        style={{ marginLeft: 'var(--sp-2)' }}
                      >
                        Waiting for approval: {shown(f.pending ?? null)}
                      </span>
                    ) : null}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        );
      })}

      <MyProfileLists
        lists={p.lists ?? []}
        canEdit={p.canEdit}
        editBase="/me/profile/edit"
        removeAction={removeMyRow}
      />

      <details className="ep-card ep-acr-card" open={waiting > 0}>
        <summary>
          <strong>My requests</strong> ({p.requests.length}
          {waiting ? `, ${String(waiting)} waiting` : ''})
        </summary>
        {p.requests.length ? (
          <ul className="ep-acr-events" style={{ marginTop: 'var(--sp-3)' }}>
            {p.requests.map((r) => (
              <li key={r.id} style={{ marginBottom: 'var(--sp-3)' }}>
                <strong>
                  {r.autoApplied ? 'Saved at once' : (REQUEST_STATUS[r.status] ?? r.status)}
                </strong>
                <span className="ep-field__help">
                  {' '}
                  · {new Date(r.createdAt).toLocaleDateString('en-IN')}
                  {r.step
                    ? ` · with ${r.step.with} (${String(r.step.at)}/${String(r.step.of)})`
                    : ''}
                </span>
                <ul>
                  {r.fields.map((f) => (
                    <li key={f.key}>
                      {f.label}: {shown(f.from)} → <strong>{shown(f.to)}</strong>
                      {f.status === 'rejected' ? ` (refused${f.note ? `: ${f.note}` : ''})` : ''}
                    </li>
                  ))}
                </ul>
                {r.note && r.status !== 'pending' ? (
                  <p className="ep-field__help">{r.note}</p>
                ) : null}
                {r.status === 'pending' ? (
                  <form action={withdrawMyRequest}>
                    <input type="hidden" name="id" value={r.id} />
                    <Button type="submit" variant="ghost" size="sm">
                      Withdraw
                    </Button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="ep-field__help">No requests yet.</p>
        )}
      </details>
    </>
  );
}
