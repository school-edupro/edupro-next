import { Alert } from '@edupro/ui';
import { t, type Lang } from '@/lib/i18n';

const OK: Record<string, string> = {
  submitted: 'The file is submitted. It is with the L1 approver now.',
  resubmitted: 'Submitted again. It starts from the L1 approver.',
  approved: 'Approved at your level.',
  returned: 'Sent back to the creator with your remark.',
  rejected: 'Rejected. The creator sees your remark.',
  withdrawn: 'The file is withdrawn.',
};

/** The file movement screens' tabs (as the admin's) and the message a finished action leaves. */
export function FilesNav({ current, ok, lang }: { current: string; ok?: string; lang: Lang }) {
  const tabs: Array<[string, string]> = [
    ['/files', 'Files'],
    ['/files/new', 'Add new approval'],
    ['/files/dashboard', 'Dashboard'],
  ];
  return (
    <>
      <nav
        className="ep-tabs-links"
        aria-label={t(lang, 'File movement')}
        style={{ marginBottom: 'var(--sp-4)' }}
      >
        {tabs.map(([href, label]) => (
          <a key={href} href={href} aria-current={href === current ? 'page' : undefined}>
            {t(lang, label)}
          </a>
        ))}
      </nav>
      {ok && OK[ok] ? (
        <div style={{ marginBottom: 'var(--sp-4)' }}>
          <Alert tone="success">{t(lang, OK[ok])}</Alert>
        </div>
      ) : null}
    </>
  );
}
