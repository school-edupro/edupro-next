import { Card, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { ProfileEditForm } from '@/components/ProfileEditForm';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import { submitProfileChanges } from '../actions';
import type { PortalProfile } from '../types';

/** One section of the child's profile for the parent to update. */
export default async function EditProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ child?: string; section?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const lang = await currentLang();
  if (!sp.child || !/^\d{1,18}$/.test(sp.child)) redirect('/profile');
  let p: PortalProfile;
  try {
    p = await bff.api.fetch<PortalProfile>(`/engagement/mine/profile/${sp.child}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError) redirect('/profile');
    throw error;
  }
  const section = p.sections.find((s) => s.id === sp.section);
  if (!section) redirect(`/profile?child=${sp.child}`);
  const editable = section.fields.filter(
    (f) => f.level === 'edit_approval' || f.level === 'edit_direct',
  );
  const context = Object.fromEntries(
    p.sections.flatMap((s) => s.fields.map((f) => [f.key, f.value])),
  );
  return (
    <main className="pp-main">
      <PageHeader
        kicker={`${p.name} · ${p.admissionNo}`}
        title={`${t(lang, 'Update')}: ${t(lang, section.title)}`}
        description={t(
          lang,
          'Change only what is different. Changes marked “needs approval” are checked by the school first; you can follow them on your profile.',
        )}
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href={`/profile?child=${sp.child}`}>
            {t(lang, 'Back to profile')}
          </a>
        }
      />
      {sp.error ? (
        <div className="ep-alert ep-alert--danger" role="alert">
          {sp.detail || sp.error}
        </div>
      ) : null}
      {!p.window.open ? (
        <Card>{p.window.message ?? t(lang, 'Profile updates are closed at the moment.')}</Card>
      ) : !editable.length ? (
        <Card>{t(lang, 'The school keeps these details. Contact the office to change them.')}</Card>
      ) : (
        <Card>
          <ProfileEditForm
            action={submitProfileChanges}
            studentId={p.studentId}
            section={section.id}
            fields={editable}
            context={context}
            proofKinds={p.proofKinds}
            geography={p.geography}
            labels={{
              needsApproval: t(lang, 'needs approval'),
              savedAtOnce: t(lang, 'saved at once'),
              waiting: t(
                lang,
                'Waiting for approval. Withdraw it on your profile to send a new value.',
              ),
              attach: t(lang, 'Proof documents'),
              attachHelp: t(
                lang,
                'The school needs these documents for the changes you made. PDF or photo, up to 10 MB.',
              ),
              reason: t(lang, 'Reason (optional)'),
              reasonPlaceholder: t(lang, 'e.g. we moved house in June'),
              send: t(lang, 'Send for approval'),
              save: t(lang, 'Save'),
              cancel: t(lang, 'Cancel'),
              nothing: t(lang, 'No changes yet'),
              proofFor: t(lang, 'for'),
            }}
          />
        </Card>
      )}
    </main>
  );
}
