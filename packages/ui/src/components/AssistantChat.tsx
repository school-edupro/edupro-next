import type { ReactNode } from 'react';
import { Badge } from './Badge';
import { RadioGroup } from './Radio';

/**
 * The assistant's chat for the websites (docs/design/91 phase E), the same as the app's: the start (starter
 * questions, ask again, today's count), the conversation with each answer's records (figures or a short table),
 * the screen to open, the sources and — on the latest answer — what to ask next; switched off, consent and today's
 * limit. A server component: every question chip is a small form posting to the page's own action (no script).
 */

export type AssistantAudience = 'student' | 'parent' | 'teacher' | 'admin';
type Lang = 'en' | 'hi';

export interface AssistantCardView {
  kind: 'figures' | 'table';
  figures?: Array<{ label: string; labelHi?: string; value: string }>;
  columns?: Array<{ key: string; label: string; labelHi?: string; type?: string }>;
  rows?: Array<Record<string, unknown>>;
  more?: number;
}
export interface AssistantLinkView {
  label: string;
  labelHi?: string;
  app?: string | null;
  web?: string | null;
}
export interface AssistantChipView {
  id: string;
  question?: string;
  title?: string;
}
export interface AssistantMessageView {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  refused?: boolean;
  citations?: Array<{ query: string; title: string; rows?: number }>;
  display?: {
    card?: AssistantCardView | null;
    link?: AssistantLinkView | null;
    followUps?: AssistantChipView[];
    didYouMean?: AssistantChipView[];
    suggestions?: AssistantChipView[];
    /** docs/design/93: Claude wrote it (a question EduPro's own rules could not place) */
    by?: 'local' | 'claude';
  } | null;
}
export interface AssistantStartView {
  audience: AssistantAudience;
  on: boolean;
  /** granted · needed (a parent's own) · ask_parent (a student's parent has not consented) · null (staff) */
  consent: 'granted' | 'needed' | 'ask_parent' | null;
  dailyLimit: number;
  askedToday: number;
  starters: Array<{ id: string; question: string; questionHi: string }>;
  recent: Array<{ question: string }>;
}

const W = {
  title: {
    student: ['Ask about your school day', 'अपने विद्यालय के बारे में पूछें'],
    parent: ['Ask about your children', 'अपने बच्चों के बारे में पूछें'],
    teacher: ['Ask about your classes', 'अपनी कक्षाओं के बारे में पूछें'],
    admin: ['Ask about the school', 'विद्यालय के बारे में पूछें'],
  },
  intro: {
    student: [
      'Your attendance, timetable, homework, exams, results and library books, in English, Hindi or Hinglish. Answers come only from school records and name their source.',
      'आपकी उपस्थिति, समय-सारिणी, गृहकार्य, परीक्षाएँ, परिणाम और पुस्तकालय की पुस्तकें, अंग्रेज़ी, हिन्दी या हिंग्लिश में। उत्तर केवल विद्यालय के अभिलेखों से आते हैं और अपना स्रोत बताते हैं।',
    ],
    parent: [
      'Fees due, attendance, homework and notices of your own children, in English, Hindi or Hinglish. Answers come only from school records and name their source.',
      'अपने बच्चों का बकाया शुल्क, उपस्थिति, गृहकार्य और सूचनाएँ, अंग्रेज़ी, हिन्दी या हिंग्लिश में। उत्तर केवल विद्यालय के अभिलेखों से आते हैं और अपना स्रोत बताते हैं।',
    ],
    teacher: [
      'Your sections’ attendance, homework and marks, and your own attendance, leave and timetable. Answers come only from school records and name their source.',
      'आपके अनुभागों की उपस्थिति, गृहकार्य और अंक, और आपकी अपनी उपस्थिति, अवकाश और समय-सारिणी। उत्तर केवल विद्यालय के अभिलेखों से आते हैं और अपना स्रोत बताते हैं।',
    ],
    admin: [
      'Today’s figures, attendance, fees, admissions and staff, as far as your rights go. Answers come only from school records and name their source.',
      'आज के आँकड़े, उपस्थिति, शुल्क, प्रवेश और कर्मचारी, आपके अधिकारों के अनुसार। उत्तर केवल विद्यालय के अभिलेखों से आते हैं और अपना स्रोत बताते हैं।',
    ],
  },
  hint: {
    student: 'Aaj ki classes? · My homework this week · मेरा परिणाम',
    parent: 'Kitni fees baki hai? · Was my child absent this week? · इस हफ्ते का गृहकार्य',
    teacher: 'Who is absent today? · Marks entry status · मेरा अवकाश शेष',
    admin: 'Today at a glance · Fee defaulters · आज की उपस्थिति',
  },
  off: [
    'Your school has switched the assistant off for you for now.',
    'आपके विद्यालय ने अभी आपके लिए सहायक बंद रखा है।',
  ],
  consent: [
    'The assistant needs your consent (AI assistant) first. Turn it on under Profile → Your consents; you can withdraw it at any time.',
    'सहायक के लिए पहले आपकी सहमति (AI सहायक) चाहिए। प्रोफ़ाइल → आपकी सहमतियाँ में इसे चालू करें; आप इसे कभी भी वापस ले सकते हैं।',
  ],
  askParent: [
    'The assistant needs a parent’s consent first. Ask a parent to turn on “AI assistant” under Profile → Your consents in their app.',
    'सहायक के लिए पहले माता-पिता की सहमति चाहिए। माता-पिता से कहें कि वे अपने ऐप में प्रोफ़ाइल → आपकी सहमतियाँ में “AI सहायक” चालू करें।',
  ],
  openProfile: ['Open profile', 'प्रोफ़ाइल खोलें'],
  you: ['You', 'आप'],
  assistant: ['Assistant', 'सहायक'],
  question: ['Your question', 'आपका प्रश्न'],
  mic: [
    'To speak your question, use your keyboard’s mic or your computer’s dictation.',
    'प्रश्न बोलने के लिए कीबोर्ड का माइक या कंप्यूटर की डिक्टेशन सुविधा उपयोग करें।',
  ],
  language: ['Language', 'भाषा'],
  auto: ['Auto', 'स्वतः'],
  ask: ['Ask', 'पूछें'],
  newConversation: ['New conversation', 'नई बातचीत'],
  tryAsking: ['Try asking', 'ऐसे पूछें'],
  askAgain: ['Ask again', 'फिर पूछें'],
  askNext: ['Ask next', 'आगे पूछें'],
  didYouMean: ['Did you mean', 'क्या आपका मतलब है'],
  youCanAsk: ['You can ask', 'आप पूछ सकते हैं'],
  sources: ['Sources', 'स्रोत'],
  records: ['The records', 'अभिलेख'],
  byClaude: ['Answered with Claude', 'Claude की सहायता से उत्तर'],
} as const;

const pick = (pair: readonly [string, string], lang: Lang) => (lang === 'hi' ? pair[1] : pair[0]);

/** The page's words for the audience (title, intro, the question box's examples), as the app has them. */
export function assistantWords(audience: AssistantAudience, lang: Lang) {
  return {
    title: pick(W.title[audience], lang),
    intro: pick(W.intro[audience], lang),
    hint: W.hint[audience],
  };
}

const limitText = (n: number, lang: Lang) =>
  lang === 'hi'
    ? `आपने आज ${n} प्रश्न पूछे हैं, जितने आपका विद्यालय अनुमति देता है। कल फिर पूछें।`
    : `You have asked ${n} questions today, the most your school allows. Try again tomorrow.`;
const todayText = (asked: number, limit: number, lang: Lang) =>
  lang === 'hi'
    ? `आज ${limit} में से ${asked} प्रश्न पूछे`
    : `${asked} of ${limit} questions asked today`;

const MON_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MON_HI = [
  'जन',
  'फ़र',
  'मार्च',
  'अप्रै',
  'मई',
  'जून',
  'जुला',
  'अग',
  'सित',
  'अक्टू',
  'नव',
  'दिस',
];

/** ₹1,200 or ₹1,200.50 in Indian grouping. */
export function assistantMoney(v: unknown): string {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return String(v);
  return `₹${n.toLocaleString('en-IN', {
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

function cell(type: string | undefined, v: unknown, lang: Lang): string {
  if (v === null || v === undefined || v === '') return '—';
  if (type === 'money') return assistantMoney(v);
  if (type === 'date') {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
    if (m) return `${Number(m[3])} ${(lang === 'hi' ? MON_HI : MON_EN)[Number(m[2]) - 1]} ${m[1]}`;
  }
  return String(v);
}

export interface AssistantChatProps {
  lang: Lang;
  /** The start from GET /insights/assistant/start (null: an older API — no starters, no count). */
  start: AssistantStartView | null;
  /** The conversation in use (empty: the start). */
  conversationId?: string | null;
  messages: AssistantMessageView[];
  /** The page's server action: question, conversationId, language. */
  action: (fd: FormData) => void | Promise<void>;
  /** "New conversation" */
  newHref: string;
  /** Where a parent turns the consent on (the website's profile). */
  profileHref?: string;
  /** The website's page for an answer's screen (default: the link's web path, the asking website's own). */
  linkHref?: (link: AssistantLinkView) => string | null;
  /** The refusal the action came back with (?error=type&detail=…). */
  error?: { type: string; detail?: string } | null;
  /** Shown when the conversation could not be read. */
  extra?: ReactNode;
}

/** A question to tap: a small form posting it to the page's action. */
function Chip({
  action,
  question,
  conversationId,
  id,
}: {
  action: AssistantChatProps['action'];
  question: string;
  conversationId?: string | null;
  id: string;
}) {
  return (
    <li style={{ padding: 0, border: 0, background: 'transparent' }}>
      <form action={action}>
        <input type="hidden" name="question" value={question} />
        {conversationId ? (
          <input type="hidden" name="conversationId" value={conversationId} />
        ) : null}
        <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm" data-chip={id}>
          {question}
        </button>
      </form>
    </li>
  );
}

function Chips({
  title,
  questions,
  action,
  conversationId,
  id,
}: {
  title: string;
  questions: string[];
  action: AssistantChatProps['action'];
  conversationId?: string | null;
  id: string;
}) {
  const shown = [...new Set(questions.map((q) => q.trim()).filter(Boolean))];
  if (!shown.length) return null;
  return (
    <section aria-label={title} style={{ marginTop: 'var(--sp-3)' }} data-chips={id}>
      <div className="ep-kicker">{title}</div>
      <ul
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 'var(--sp-2)',
          marginTop: 'var(--sp-1)',
        }}
      >
        {shown.map((q, i) => (
          <Chip
            key={q}
            id={`${id}-${i}`}
            action={action}
            question={q}
            conversationId={conversationId}
          />
        ))}
      </ul>
    </section>
  );
}

/** An answer's records: figures, or a short table with "and n more" (shared with the chat window). */
export function AssistantCard({ card, lang }: { card: AssistantCardView; lang: Lang }) {
  const label = (x: { label: string; labelHi?: string }) =>
    lang === 'hi' ? (x.labelHi ?? x.label) : x.label;
  if (card.kind === 'figures' && card.figures?.length) {
    return (
      <dl
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(9rem, 1fr))',
          gap: 'var(--sp-2)',
          margin: 'var(--sp-2) 0 0',
        }}
      >
        {card.figures.map((f) => (
          <div
            key={f.label}
            style={{
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--sp-2) var(--sp-3)',
              background: 'var(--surface-card)',
            }}
          >
            <dt className="ep-field__help" style={{ margin: 0 }}>
              {label(f)}
            </dt>
            <dd
              style={{
                margin: 0,
                fontWeight: 'var(--fw-semibold)',
                fontSize: 'var(--fs-h4)',
                color: 'var(--text-heading)',
                overflowWrap: 'anywhere',
              }}
            >
              {f.value}
            </dd>
          </div>
        ))}
      </dl>
    );
  }
  if (card.kind === 'table' && card.columns?.length && card.rows?.length) {
    const cols = card.columns;
    return (
      // a wide table scrolls sideways: reachable with the keyboard, named for screen readers
      <div
        style={{ overflowX: 'auto', marginTop: 'var(--sp-2)' }}
        tabIndex={0}
        role="region"
        aria-label={pick(W.records, lang)}
      >
        <table className="ep-table">
          <caption className="ep-sr-only">{pick(W.records, lang)}</caption>
          <thead>
            <tr>
              {cols.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={c.type === 'money' || c.type === 'number' ? 'is-numeric' : undefined}
                >
                  {label(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {card.rows.map((r, i) => (
              <tr key={i}>
                {cols.map((c) => (
                  <td
                    key={c.key}
                    className={c.type === 'money' || c.type === 'number' ? 'is-numeric' : undefined}
                  >
                    {cell(c.type, r[c.key], lang)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {card.more ? (
          <p className="ep-field__help" style={{ marginTop: 'var(--sp-1)' }}>
            {lang === 'hi' ? `और ${card.more}` : `and ${card.more} more`}
          </p>
        ) : null}
      </div>
    );
  }
  return null;
}

export function AssistantChat({
  lang,
  start,
  conversationId,
  messages,
  action,
  newHref,
  profileHref,
  linkHref = (l) => l.web ?? null,
  error,
  extra,
}: AssistantChatProps) {
  const audience = start?.audience ?? 'parent';
  const on = start ? start.on && error?.type !== 'assistant-off' : error?.type !== 'assistant-off';
  const consent =
    error?.type === 'consent-required'
      ? audience === 'student'
        ? 'ask_parent'
        : 'needed'
      : (start?.consent ?? null);
  const waiting = consent === 'needed' || consent === 'ask_parent';
  const limitHit =
    error?.type === 'ai.daily_limit' ||
    (start ? start.dailyLimit > 0 && start.askedToday >= start.dailyLimit : false);
  const limitN = start?.dailyLimit ?? Number(/\d+/.exec(error?.detail ?? '')?.[0] ?? 0);
  const canAsk = on && !waiting && !limitHit;
  const other =
    error &&
    !['assistant-off', 'consent-required', 'ai.daily_limit'].includes(error.type) &&
    error.type
      ? error
      : null;
  const last = messages.map((m) => m.role).lastIndexOf('assistant');
  const chipQ = (x: AssistantChipView) => x.question ?? x.title ?? '';

  return (
    <div data-assistant-chat={audience}>
      {!on ? (
        <div className="ep-alert ep-alert--warning" role="status" data-banner="off">
          {pick(W.off, lang)}
        </div>
      ) : consent === 'needed' ? (
        <div className="ep-alert ep-alert--warning" role="status" data-banner="consent">
          <div style={{ flex: 1 }}>
            {pick(W.consent, lang)}{' '}
            {profileHref ? <a href={profileHref}>{pick(W.openProfile, lang)}</a> : null}
          </div>
        </div>
      ) : consent === 'ask_parent' ? (
        <div className="ep-alert ep-alert--warning" role="status" data-banner="ask-parent">
          {pick(W.askParent, lang)}
        </div>
      ) : limitHit ? (
        <div className="ep-alert ep-alert--warning" role="status" data-banner="limit">
          {limitText(limitN || (start?.askedToday ?? 0), lang)}
        </div>
      ) : null}
      {other ? (
        <div
          className="ep-alert ep-alert--danger"
          role="alert"
          style={{ marginTop: 'var(--sp-2)' }}
        >
          {other.detail || other.type}
        </div>
      ) : null}

      <section
        className="ep-card"
        style={{ marginTop: 'var(--sp-3)' }}
        aria-label={pick(W.assistant, lang)}
      >
        {extra}
        {messages.length ? (
          <div style={{ display: 'grid', gap: 'var(--sp-3)' }} data-thread="">
            {messages.map((m, i) => {
              const d = m.display ?? null;
              const href = d?.link ? linkHref(d.link) : null;
              return (
                <article
                  key={m.id ?? i}
                  style={{
                    borderLeft: `var(--sp-1) solid ${m.role === 'user' ? 'var(--border-default)' : 'var(--border-accent)'}`,
                    paddingLeft: 'var(--sp-3)',
                  }}
                >
                  <div className="ep-kicker">
                    {m.role === 'user' ? pick(W.you, lang) : pick(W.assistant, lang)}
                  </div>
                  <div style={{ whiteSpace: 'pre-wrap' }}>{m.content}</div>
                  {m.role === 'assistant' && d?.card ? (
                    <AssistantCard card={d.card} lang={lang} />
                  ) : null}
                  {m.role === 'assistant' && d?.link && href ? (
                    <p style={{ margin: 'var(--sp-2) 0 0' }}>
                      <a className="ep-btn ep-btn--secondary ep-btn--sm" href={href}>
                        {lang === 'hi'
                          ? `${d.link.labelHi ?? d.link.label} खोलें`
                          : `Open ${d.link.label}`}
                      </a>
                    </p>
                  ) : null}
                  {m.role === 'assistant' && d?.by === 'claude' ? (
                    <p style={{ margin: 'var(--sp-2) 0 0' }}>
                      <Badge tone="info" data-by="claude">
                        {pick(W.byClaude, lang)}
                      </Badge>
                    </p>
                  ) : null}
                  {m.citations?.length ? (
                    <div
                      style={{
                        display: 'flex',
                        gap: 'var(--sp-2)',
                        flexWrap: 'wrap',
                        alignItems: 'center',
                        marginTop: 'var(--sp-2)',
                      }}
                    >
                      <small className="ep-field__help">{pick(W.sources, lang)}:</small>
                      {m.citations.map((c, k) => (
                        <Badge key={`${c.query}-${k}`} tone="neutral">
                          {c.title}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                  {i === last && canAsk ? (
                    <>
                      <Chips
                        id="next"
                        title={pick(W.askNext, lang)}
                        questions={(d?.followUps ?? []).map(chipQ)}
                        action={action}
                        conversationId={conversationId}
                      />
                      <Chips
                        id="mean"
                        title={pick(W.didYouMean, lang)}
                        questions={(d?.didYouMean ?? []).map(chipQ)}
                        action={action}
                        conversationId={conversationId}
                      />
                      {!(d?.followUps ?? []).length && !(d?.didYouMean ?? []).length ? (
                        <Chips
                          id="instead"
                          title={pick(W.youCanAsk, lang)}
                          questions={(d?.suggestions ?? []).map(chipQ)}
                          action={action}
                          conversationId={conversationId}
                        />
                      ) : null}
                    </>
                  ) : null}
                </article>
              );
            })}
          </div>
        ) : canAsk && start ? (
          <>
            <Chips
              id="start"
              title={pick(W.tryAsking, lang)}
              questions={start.starters.map((x) => (lang === 'hi' ? x.questionHi : x.question))}
              action={action}
            />
            <Chips
              id="again"
              title={pick(W.askAgain, lang)}
              questions={start.recent.map((x) => x.question)}
              action={action}
            />
          </>
        ) : null}

        {canAsk ? (
          <form action={action} style={{ marginTop: 'var(--sp-4)' }}>
            {conversationId ? (
              <input type="hidden" name="conversationId" value={conversationId} />
            ) : null}
            <label className="ep-field">
              <span className="ep-field__label">{pick(W.question, lang)}</span>
              <textarea
                className="ep-input"
                name="question"
                rows={3}
                minLength={2}
                maxLength={1000}
                required
                placeholder={W.hint[audience]}
                aria-describedby="asst-mic"
              />
              <span className="ep-field__help" id="asst-mic">
                {pick(W.mic, lang)}
              </span>
            </label>
            <div
              style={{
                display: 'flex',
                gap: 'var(--sp-3)',
                alignItems: 'flex-end',
                flexWrap: 'wrap',
                marginTop: 'var(--sp-2)',
              }}
            >
              <RadioGroup
                name="language"
                legend={pick(W.language, lang)}
                inline
                defaultValue=""
                options={[
                  { value: '', label: pick(W.auto, lang) },
                  { value: 'en', label: 'English' },
                  { value: 'hi', label: 'हिन्दी' },
                  { value: 'hinglish', label: 'Hinglish' },
                ]}
              />
              <button type="submit" className="ep-btn ep-btn--primary">
                {pick(W.ask, lang)}
              </button>
              {conversationId ? (
                <a className="ep-btn ep-btn--ghost" href={newHref}>
                  {pick(W.newConversation, lang)}
                </a>
              ) : null}
            </div>
          </form>
        ) : conversationId ? (
          <p style={{ marginTop: 'var(--sp-3)' }}>
            <a className="ep-btn ep-btn--ghost" href={newHref}>
              {pick(W.newConversation, lang)}
            </a>
          </p>
        ) : null}
        {start && on && start.dailyLimit > 0 ? (
          <p className="ep-field__help" style={{ marginTop: 'var(--sp-2)' }} data-count="">
            {todayText(start.askedToday, start.dailyLimit, lang)}
          </p>
        ) : null}
      </section>
    </div>
  );
}
