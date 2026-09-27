import type { Meta, StoryObj } from '@storybook/react';

const meta: Meta = {
  title: 'Foundations/Typography',
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
};
export default meta;

const scale: Array<{ label: string; className: string; style?: React.CSSProperties }> = [
  { label: 'Page title', className: 'ep-page-title' },
  { label: 'Card title', className: 'ep-card__title' },
  { label: 'Body', className: '' },
  { label: 'Small', className: '', style: { fontSize: 'var(--fs-small)' } },
  { label: 'Caption', className: '', style: { fontSize: 'var(--fs-caption)' } },
];

const samples = {
  en: {
    title: 'Fee collection for Session 2026-27',
    body: 'Dear guardian, the second instalment of ₹12,500 for Aarav Sharma (VI-A) is due on 10 October.',
  },
  hi: {
    title: 'सत्र 2026-27 के लिए शुल्क संग्रह',
    body: 'प्रिय अभिभावक, आरव शर्मा (VI-A) की ₹12,500 की दूसरी किस्त 10 अक्टूबर को देय है।',
  },
};

/** Type scale in English and Hindi side by side; Devanagari must not clip ascenders or overflow at any step (S4-01). */
export const EnglishAndHindi: StoryObj = {
  render: () => (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-5)' }}>
      {(['en', 'hi'] as const).map((lang) => (
        <div key={lang} lang={lang} style={{ display: 'grid', gap: 'var(--sp-4)' }}>
          <div className="ep-kicker">{lang === 'en' ? 'English' : 'हिन्दी'}</div>
          {scale.map((s) => (
            <div key={s.label}>
              <div className="ep-field__help">{s.label}</div>
              <div className={s.className} style={{ ...s.style, margin: 0, lineHeight: 1.4 }}>
                {s.label === 'Body' || s.label === 'Small' || s.label === 'Caption'
                  ? samples[lang].body
                  : samples[lang].title}
              </div>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            <span className="ep-badge ep-badge--success">
              {lang === 'en' ? 'active' : 'सक्रिय'}
            </span>
            <span className="ep-badge ep-badge--warning">{lang === 'en' ? 'locked' : 'लॉक'}</span>
            <button type="button" className="ep-btn ep-btn--primary ep-btn--sm">
              {lang === 'en' ? 'Collect fee' : 'शुल्क लें'}
            </button>
          </div>
        </div>
      ))}
    </div>
  ),
};
