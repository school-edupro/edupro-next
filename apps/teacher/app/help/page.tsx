import { Card, PageHeader } from '@edupro/ui';
import { currentLang, t } from '@/lib/i18n';

/** Sprint 22: the help centre of the teacher app: the routine questions, bilingual. */
const FAQ: Array<[string, string]> = [
  [
    'I cannot see a section or subject.',
    'You need a teacher assignment for that section and subject this year; ask the coordinator (Academics → Teacher assignments).',
  ],
  [
    'A pupil tapped at the gate but shows absent.',
    'The tap may be outside the session window or from another route’s reader; mark the pupil present and the office checks the device events.',
  ],
  [
    'I marked the wrong pupil.',
    'Fix it the same day before the session locks; afterwards ask the coordinator to unlock with a reason.',
  ],
  [
    'Marks entry is locked.',
    'The coordinator locked the subject after the entry; a reopen needs a reason and is audited.',
  ],
  [
    'How do I answer a family query?',
    'Queries lists the queries of your sections; reply, add an internal note, or close with a decision. Leave requests are approved the same way.',
  ],
  [
    'Homework posted by mistake.',
    'Delete it from Daily work the same day; families see the update at once.',
  ],
  [
    'A family asks for an appointment.',
    'The request reaches your approvals inbox; confirm a slot and place and the family gets a WhatsApp.',
  ],
  [
    'Something is broken or slow.',
    'Use Report an issue on the home page: the support desk sees it at once, with a severity and a due time.',
  ],
  [
    'How do I change the language?',
    'The हिन्दी / English link on the home page switches every screen.',
  ],
];

export default async function HelpPage() {
  const lang = await currentLang();
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
      <PageHeader
        kicker="EduPro"
        title={t(lang, 'Help')}
        description={t(
          lang,
          'Answers to the common questions; the training pages of the admin help centre go deeper.',
        )}
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/">
            {t(lang, 'Home')}
          </a>
        }
      />
      {FAQ.map(([q, a]) => (
        <Card key={q} title={t(lang, q)} style={{ marginBottom: 'var(--sp-3)' }}>
          <p style={{ margin: 0 }}>{t(lang, a)}</p>
        </Card>
      ))}
    </main>
  );
}
