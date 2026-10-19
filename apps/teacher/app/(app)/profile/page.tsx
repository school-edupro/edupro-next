import { PageHeader } from '@edupro/ui';
import { ExportWatcher } from '@/components/ExportWatcher';
import { FileLinks } from '@/components/FileLinks';
import { MyPhoto } from '@/components/MyPhoto';
import { MyProfileLists } from '@/components/MyProfileLists';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import { editable, shown, type MyProfile } from '@/lib/my-profile';
import { myProfilePdf, removeRow, sendPhoto, withdrawRequest } from './actions';

const STATUS: Record<string, string> = {
  pending: 'Waiting for approval',
  approved: 'Approved',
  rejected: 'Refused',
  partially_approved: 'Partly approved',
  cancelled: 'Withdrawn',
};

/** My profile (docs/design/33-people-dashboards.md): what the school shows me, update, PDF, my requests. */
export default async function MyProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ export?: string; ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const lang = await currentLang();
  const [p, exp] = await Promise.all([
    bff.api.fetch<MyProfile>('/me/employee-profile'),
    sp.export && /^\d{1,18}$/.test(sp.export)
      ? bff.api
          .fetch<{
            export: { id: string; status: string };
            download: { url: string; saveUrl?: string } | null;
          }>(`/me/exports/${sp.export}`)
          .catch(() => null)
      : Promise.resolve(null),
  ]);
  const waiting = p.requests.filter((r) => r.status === 'pending').length;
  return (
    <main>
      <PageHeader
        kicker={t(lang, 'My profile')}
        title={p.employee.name}
        description={`${t(lang, 'Employee code')} ${p.employee.code} · ${t(lang, 'profile')} ${String(p.completeness.percent)}% ${t(lang, 'complete')}`}
        actions={
          <form action={myProfilePdf}>
            <button type="submit" className="ep-btn ep-btn--secondary">
              {t(lang, 'Download PDF')}
            </button>
          </form>
        }
      />
      {sp.ok ? (
        <div className="ep-alert ep-alert--success" role="status">
          {sp.detail ?? t(lang, 'Saved.')}
        </div>
      ) : null}
      {sp.error ? (
        <div className="ep-alert ep-alert--danger" role="alert">
          {sp.detail || t(lang, 'That did not go through.')}
        </div>
      ) : null}
      {exp ? (
        <div className="ep-alert ep-alert--info" role="status">
          {exp.export.status !== 'failed' ? (
            <ExportWatcher id={exp.export.id} url={exp.download?.url ?? null} />
          ) : null}
          {exp.download ? (
            <span className="ep-filecell">
              {t(lang, 'My profile (PDF)')}
              <FileLinks
                url={exp.download.url}
                saveUrl={exp.download.saveUrl}
                label={t(lang, 'My profile (PDF)')}
                viewLabel={t(lang, 'View')}
                saveLabel={t(lang, 'Download')}
              />
            </span>
          ) : exp.export.status === 'failed' ? (
            t(lang, 'The PDF could not be prepared. Please try again.')
          ) : (
            <>
              {t(lang, 'Your PDF is being prepared.')}{' '}
              <a href={`/profile?export=${exp.export.id}`}>{t(lang, 'Refresh')}</a>
            </>
          )}
        </div>
      ) : null}
      {!p.window.open || p.window.message ? (
        <div className={`ep-alert ep-alert--${p.window.open ? 'info' : 'warning'}`} role="status">
          {p.window.message ?? t(lang, 'Profile updates are closed at the moment.')}
        </div>
      ) : null}
      <MyPhoto
        name={p.employee.name}
        photo={p.photo}
        canEdit={p.canEdit}
        src="/api/my-photo"
        action={sendPhoto}
        tr={(x) => t(lang, x)}
        badge={(text) => <span className="ep-badge ep-badge--warning">{text}</span>}
        button={(label) => (
          <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
            {label}
          </button>
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
                {t(lang, s.title)}
              </h2>
              {canUpdate ? (
                <a
                  className="ep-btn ep-btn--ghost ep-btn--sm"
                  href={`/profile/edit?section=${s.id}`}
                >
                  {t(lang, 'Update')}
                </a>
              ) : null}
            </div>
            <dl className="ep-myprofile">
              {s.fields.map((f) => (
                <div key={f.key}>
                  <dt>{t(lang, f.label)}</dt>
                  <dd>
                    {shown(f.value)}
                    {f.pending !== undefined ? (
                      <span
                        className="ep-badge ep-badge--warning"
                        style={{ marginLeft: 'var(--sp-2)' }}
                      >
                        {t(lang, 'Waiting for approval')}: {shown(f.pending ?? null)}
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
        editBase="/profile/edit"
        removeAction={removeRow}
        fileLink={(fileId, label) => (
          <FileLinks
            url={`/api/my-file/${fileId}`}
            label={label}
            viewLabel={t(lang, 'View')}
            viewOnly
          />
        )}
      />

      <details className="ep-card ep-acr-card" open={waiting > 0}>
        <summary>
          <strong>{t(lang, 'My requests')}</strong> ({p.requests.length}
          {waiting ? `, ${String(waiting)} ${t(lang, 'waiting')}` : ''})
        </summary>
        {p.requests.length ? (
          <ul className="ep-acr-events" style={{ marginTop: 'var(--sp-3)' }}>
            {p.requests.map((r) => (
              <li key={r.id} style={{ marginBottom: 'var(--sp-3)' }}>
                <strong>
                  {t(lang, r.autoApplied ? 'Saved at once' : (STATUS[r.status] ?? r.status))}
                </strong>
                <span className="ep-field__help">
                  {' '}
                  · {new Date(r.createdAt).toLocaleDateString('en-IN')}
                  {r.step
                    ? ` · ${t(lang, 'with')} ${r.step.with} (${String(r.step.at)}/${String(r.step.of)})`
                    : ''}
                </span>
                <ul>
                  {r.fields.map((f) => (
                    <li key={f.key}>
                      {t(lang, f.label)}: {shown(f.from)} → <strong>{shown(f.to)}</strong>
                      {f.file ? (
                        <FileLinks
                          url={`/api/my-file/${f.file}`}
                          label={t(lang, f.label)}
                          viewLabel={t(lang, 'View')}
                          viewOnly
                        />
                      ) : null}
                      {f.status === 'rejected'
                        ? ` (${t(lang, 'refused')}${f.note ? `: ${f.note}` : ''})`
                        : ''}
                    </li>
                  ))}
                </ul>
                {r.note && r.status !== 'pending' ? (
                  <p className="ep-field__help">{r.note}</p>
                ) : null}
                {r.status === 'pending' ? (
                  <form action={withdrawRequest}>
                    <input type="hidden" name="id" value={r.id} />
                    <button type="submit" className="ep-btn ep-btn--ghost ep-btn--sm">
                      {t(lang, 'Withdraw')}
                    </button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="ep-field__help">{t(lang, 'No requests yet.')}</p>
        )}
      </details>
    </main>
  );
}
