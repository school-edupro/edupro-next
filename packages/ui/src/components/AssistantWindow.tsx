'use client';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import {
  AssistantCard,
  type AssistantAudience,
  type AssistantCardView,
  type AssistantChipView,
  type AssistantLinkView,
} from './AssistantChat';

/**
 * The MobiAI chat window (docs/design/92 phase C): a round button at the bottom right of every page opens a panel
 * with the assistant's name and subtitle, a new-conversation bin, Open full page and close; the topic bar; "Today",
 * the greeting and Your Quick Update; the conversation in bubbles with times (each answer with its records, the
 * screen to open, the source and what to ask next); three dots while it looks; the question box and send; "Powered
 * by Mobilise App Lab Limited". The page's own server actions do the asking (the website's session and rights).
 */

type Lang = 'en' | 'hi';

export type AssistantWindowResult<T> =
  { ok: true; data: T } | { ok: false; status: number; type: string; detail: string };

export interface AssistantWindowStart {
  audience: AssistantAudience;
  on: boolean;
  consent: 'granted' | 'needed' | 'ask_parent' | null;
  dailyLimit: number;
  askedToday: number;
  name: string;
  subtitle: string;
  subtitleHi: string;
  firstName: string | null;
  topics: Array<{
    key: string;
    label: string;
    labelHi: string;
    id: string;
    question: string;
    questionHi: string;
  }>;
  quick: Array<{
    id: string;
    topic: string;
    text: string;
    textHi: string;
    question: string;
    questionHi: string;
  }>;
  starters: Array<{ id: string; question: string; questionHi: string }>;
}

export interface AssistantWindowAnswer {
  conversationId: string;
  answer: string;
  refused: boolean;
  citations?: Array<{ query: string; title: string }>;
  card?: AssistantCardView | null;
  link?: AssistantLinkView | null;
  followUps?: AssistantChipView[];
  didYouMean?: AssistantChipView[];
  suggestions?: AssistantChipView[];
}

export interface AssistantWindowMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt?: string;
  citations?: Array<{ query: string; title: string }>;
  display?: {
    card?: AssistantCardView | null;
    link?: AssistantLinkView | null;
    followUps?: AssistantChipView[];
    didYouMean?: AssistantChipView[];
    suggestions?: AssistantChipView[];
  } | null;
}

export interface AssistantWindowProps {
  lang: Lang;
  /** The website's Assistant page ("Open full page"). */
  fullPageHref: string;
  /** Where a parent turns the consent on. */
  profileHref?: string;
  /** The page's server actions. */
  start: () => Promise<AssistantWindowResult<AssistantWindowStart>>;
  ask: (
    question: string,
    conversationId: string | null,
    language: string | null,
  ) => Promise<AssistantWindowResult<AssistantWindowAnswer>>;
  conversation: (
    id: string,
  ) => Promise<AssistantWindowResult<{ messages: AssistantWindowMessage[] }>>;
}

interface Item {
  key: string;
  role: 'user' | 'assistant';
  text: string;
  at: Date;
  refused?: boolean;
  citations?: Array<{ query: string; title: string }>;
  display?: AssistantWindowMessage['display'];
}

const WORDS = {
  open: ['Ask', 'पूछें'],
  close: ['Close', 'बंद करें'],
  fresh: ['New conversation', 'नई बातचीत'],
  full: ['Open full page', 'पूरा पेज खोलें'],
  topics: ['Topics', 'विषय'],
  today: ['Today', 'आज'],
  quick: ['Your Quick Update', 'आपका त्वरित अपडेट'],
  you: ['You', 'आप'],
  placeholder: ['Type your question…', 'अपना प्रश्न लिखें…'],
  question: ['Your question', 'आपका प्रश्न'],
  send: ['Send', 'भेजें'],
  looking: ['Finding the answer…', 'उत्तर खोजा जा रहा है…'],
  next: ['Ask next', 'आगे पूछें'],
  mean: ['Did you mean', 'क्या आपका मतलब है'],
  instead: ['You can ask', 'आप पूछ सकते हैं'],
  tryAsking: ['Try asking', 'ऐसे पूछें'],
  source: ['Source', 'स्रोत'],
  loading: ['Opening…', 'खुल रहा है…'],
  blocked: [
    'The assistant is not open to you at this school.',
    'इस विद्यालय में सहायक आपके लिए खुला नहीं है।',
  ],
  off: [
    'Your school has switched the assistant off for you for now.',
    'आपके विद्यालय ने अभी आपके लिए सहायक बंद रखा है।',
  ],
  consent: [
    'The assistant needs your consent (AI assistant) first. Turn it on under Profile → Your consents.',
    'सहायक के लिए पहले आपकी सहमति (AI सहायक) चाहिए। इसे प्रोफ़ाइल → आपकी सहमतियाँ में चालू करें।',
  ],
  openProfile: ['Open profile', 'प्रोफ़ाइल खोलें'],
  askParent: [
    'The assistant needs a parent’s consent first. Ask a parent to turn on “AI assistant” in their app.',
    'सहायक के लिए पहले माता-पिता की सहमति चाहिए। माता-पिता से अपने ऐप में “AI सहायक” चालू करने को कहें।',
  ],
  failed: [
    'The assistant could not be reached. Try again.',
    'सहायक तक नहीं पहुँच सके। फिर कोशिश करें।',
  ],
  powered: ['Powered by', 'संचालित:'],
} as const;

const w = (k: keyof typeof WORDS, lang: Lang) => (lang === 'hi' ? WORDS[k][1] : WORDS[k][0]);

/** Line icons (24 grid, currentColor). */
const ICON: Record<string, string> = {
  spark:
    'M12 3l1.8 4.6L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.9L12 3ZM18.5 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2Z',
  chat: 'M4 5h16v11H9l-5 4V5Z',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  close: 'M6 6l12 12M18 6 6 18',
  send: 'M4 12 20 4l-6 16-3-7-7-1Z',
  full: 'M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7',
  attendance:
    'M9 11.5l2 2 4-4.5M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z',
  academics: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5Zm0 16a2 2 0 0 1 2-2h13',
  exams: 'M9 4h6v3H9V4Zm-3 2h1v14h10V6h1M9 12h6M9 16h4',
  fees: 'M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Zm0 0V5a2 2 0 0 1 2-2h11M16 14h5',
  transport:
    'M5 4h14a1 1 0 0 1 1 1v11H4V5a1 1 0 0 1 1-1Zm0 12v3h3v-3m8 0v3h3v-3M4 10h16M8 13h.01M16 13h.01',
  communication: 'M4 5h16v11H9l-5 4V5Z',
  admissions:
    'M15 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M8.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M19 8v6M16 11h6',
  hr: 'M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M21 19v-1a4 4 0 0 0-3-3.87M15 4.13a3.5 3.5 0 0 1 0 6.74',
  school: 'M3 11.5 12 4l9 7.5M5 10v10h5v-6h4v6h5V10',
};

function Icon({ name, size = '1.25rem' }: { name: string; size?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={ICON[name] ?? ICON.chat} />
    </svg>
  );
}

const time = (d: Date) =>
  d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });

function greeting(s: AssistantWindowStart, lang: Lang): string {
  const h = new Date().getHours();
  const part =
    h >= 5 && h < 12
      ? lang === 'hi'
        ? 'सुप्रभात'
        : 'Good morning'
      : h >= 12 && h < 17
        ? lang === 'hi'
          ? 'नमस्कार'
          : 'Good afternoon'
        : lang === 'hi'
          ? 'शुभ संध्या'
          : 'Good evening';
  const who = s.firstName ? `, ${s.firstName}` : '';
  // "Staff and HR" → "staff and HR": only the first letter goes small
  const topics = s.topics.map((t) =>
    lang === 'hi' ? t.labelHi : t.label.charAt(0).toLowerCase() + t.label.slice(1),
  );
  const list = topics.length ? topics.join(', ') : '';
  return lang === 'hi'
    ? `${part}${who}! मैं ${s.name} हूँ।${list ? ` मुझसे पूछें: ${list}।` : ''} अंग्रेज़ी, हिन्दी या हिंग्लिश में।`
    : `${part}${who}! I'm ${s.name}.${list ? ` Ask me about ${list}` : ' Ask me'} — in English, Hindi or Hinglish.`;
}

function storageGet(): { open?: boolean; conv?: string | null } {
  try {
    return JSON.parse(window.sessionStorage.getItem('mobiai') ?? '{}') as {
      open?: boolean;
      conv?: string | null;
    };
  } catch {
    return {};
  }
}
function storageSet(v: { open: boolean; conv: string | null }) {
  try {
    window.sessionStorage.setItem('mobiai', JSON.stringify(v));
  } catch {
    /* private mode: the window simply starts closed next time */
  }
}

export function AssistantWindow({
  lang,
  fullPageHref,
  profileHref,
  start: loadStart,
  ask: askAction,
  conversation: loadConversation,
}: AssistantWindowProps) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState<AssistantWindowStart | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [failed, setFailed] = useState(false);
  const [conv, setConv] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<{ type: string; detail: string } | null>(null);
  const [text, setText] = useState('');
  const restored = useRef(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const panelId = useId();

  // the window stays open, with its conversation, while the person moves between pages
  useEffect(() => {
    const s = storageGet();
    if (s.conv) setConv(s.conv);
    if (s.open) setOpen(true);
    restored.current = true;
  }, []);
  useEffect(() => {
    if (restored.current) storageSet({ open, conv });
  }, [open, conv]);

  const begin = useCallback(
    async (conversationId: string | null) => {
      setFailed(false);
      try {
        const r = await loadStart();
        if (r.ok) setStart(r.data);
        else if (r.status === 403) setBlocked(true);
        else setFailed(true);
        if (r.ok && conversationId) {
          const c = await loadConversation(conversationId);
          if (c.ok)
            setItems(
              c.data.messages.map((m) => ({
                key: m.id,
                role: m.role,
                text: m.content,
                at: m.createdAt ? new Date(m.createdAt) : new Date(),
                citations: m.citations,
                display: m.display ?? null,
              })),
            );
          else setConv(null);
        }
      } catch {
        setFailed(true);
      }
    },
    [loadStart, loadConversation],
  );

  useEffect(() => {
    if (open && !start && !blocked) void begin(conv);
    // the first open (or a restored one) reads the start and the conversation in use
  }, [open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open, start]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items, busy, start, refusal]);

  // closed: the focus goes back to the round button
  const wasOpen = useRef(false);
  useEffect(() => {
    if (!open && wasOpen.current) toggleRef.current?.focus();
    wasOpen.current = open;
  }, [open]);
  const close = () => setOpen(false);

  const ask = async (q: string) => {
    const question = q.trim();
    if (question.length < 2 || busy) return;
    setRefusal(null);
    setItems((x) => [
      ...x,
      { key: `u${String(Date.now())}`, role: 'user', text: question, at: new Date() },
    ]);
    setText('');
    setBusy(true);
    try {
      const r = await askAction(question, conv, lang === 'hi' ? 'hi' : null);
      if (r.ok) {
        const a = r.data;
        setConv(a.conversationId);
        setItems((x) => [
          ...x,
          {
            key: `a${String(Date.now())}`,
            role: 'assistant',
            text: a.answer,
            at: new Date(),
            refused: a.refused,
            citations: a.citations,
            display: {
              card: a.card ?? null,
              link: a.link ?? null,
              followUps: a.followUps ?? [],
              didYouMean: a.didYouMean ?? [],
              suggestions: a.suggestions ?? [],
            },
          },
        ]);
        setStart((s) => (s ? { ...s, askedToday: s.askedToday + 1 } : s));
      } else if (['consent-required', 'ai.daily_limit', 'assistant-off'].includes(r.type)) {
        setRefusal({ type: r.type, detail: r.detail });
      } else {
        setItems((x) => [
          ...x,
          {
            key: `e${String(Date.now())}`,
            role: 'assistant',
            text: r.detail || w('failed', lang),
            at: new Date(),
            refused: true,
          },
        ]);
      }
    } catch {
      setItems((x) => [
        ...x,
        {
          key: `e${String(Date.now())}`,
          role: 'assistant',
          text: w('failed', lang),
          at: new Date(),
          refused: true,
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  const fresh = () => {
    setConv(null);
    setItems([]);
    setRefusal(null);
    setStart(null);
    void begin(null);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void ask(text);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };

  const audience = start?.audience ?? 'parent';
  const on = start ? start.on && refusal?.type !== 'assistant-off' : true;
  const consent =
    refusal?.type === 'consent-required'
      ? audience === 'student'
        ? 'ask_parent'
        : 'needed'
      : (start?.consent ?? null);
  const waiting = consent === 'needed' || consent === 'ask_parent';
  const limitHit =
    refusal?.type === 'ai.daily_limit' ||
    (start ? start.dailyLimit > 0 && start.askedToday >= start.dailyLimit : false);
  const canAsk = !!start && on && !waiting && !limitHit;
  const name = start?.name ?? 'MobiAI';
  const subtitle = start ? (lang === 'hi' ? start.subtitleHi : start.subtitle) : '';
  const lastBot = items.map((i) => i.role).lastIndexOf('assistant');
  const chipQ = (x: AssistantChipView) => x.question ?? x.title ?? '';

  const chips = (id: string, title: string, list: string[]) => {
    const shown = [...new Set(list.map((q) => q.trim()).filter(Boolean))];
    if (!shown.length) return null;
    return (
      <div className="mobiai__chips" data-chips={id}>
        <span className="mobiai__chips-title">{title}</span>
        <ul>
          {shown.map((q, i) => (
            <li key={q}>
              <button
                type="button"
                className="mobiai__chip"
                data-chip={`${id}-${String(i)}`}
                disabled={!canAsk || busy}
                onClick={() => void ask(q)}
              >
                {q}
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  };

  return (
    <div className="mobiai" data-mobiai="">
      {open ? (
        <section
          id={panelId}
          className="mobiai__panel"
          role="dialog"
          aria-modal="false"
          aria-labelledby={titleId}
          onKeyDown={onKey}
        >
          <header className="mobiai__head">
            <span className="mobiai__avatar" aria-hidden="true">
              <Icon name="spark" size="1.5rem" />
            </span>
            <span className="mobiai__who">
              <strong id={titleId} className="mobiai__name">
                {name}
              </strong>
              {subtitle ? (
                <span className="mobiai__sub">
                  <span className="mobiai__dot" aria-hidden="true" />
                  {subtitle}
                </span>
              ) : null}
            </span>
            <span className="mobiai__tools">
              <a
                className="mobiai__tool"
                href={fullPageHref}
                title={w('full', lang)}
                aria-label={w('full', lang)}
              >
                <Icon name="full" />
              </a>
              <button
                type="button"
                className="mobiai__tool"
                title={w('fresh', lang)}
                aria-label={w('fresh', lang)}
                onClick={fresh}
                disabled={busy}
              >
                <Icon name="trash" />
              </button>
              <button
                type="button"
                className="mobiai__tool"
                title={w('close', lang)}
                aria-label={w('close', lang)}
                onClick={close}
              >
                <Icon name="close" />
              </button>
            </span>
          </header>

          {start && canAsk && start.topics.length ? (
            <nav className="mobiai__topics" aria-label={w('topics', lang)}>
              {start.topics.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  className="mobiai__topic"
                  disabled={busy}
                  onClick={() => void ask(lang === 'hi' ? t.questionHi : t.question)}
                >
                  <Icon name={t.key} size="1rem" />
                  {lang === 'hi' ? t.labelHi : t.label}
                </button>
              ))}
            </nav>
          ) : null}

          <div className="mobiai__log" ref={logRef} role="log" aria-live="polite">
            <p className="mobiai__day">
              <span>{w('today', lang)}</span>
            </p>
            {blocked ? (
              <div className="ep-alert ep-alert--warning" role="status">
                {w('blocked', lang)}
              </div>
            ) : failed ? (
              <div className="ep-alert ep-alert--danger" role="alert">
                {w('failed', lang)}{' '}
                <button type="button" className="mobiai__link" onClick={() => void begin(conv)}>
                  ↻
                </button>
              </div>
            ) : !start ? (
              <p className="mobiai__loading">{w('loading', lang)}</p>
            ) : (
              <>
                <div className="mobiai__msg">
                  <span className="mobiai__mini" aria-hidden="true">
                    <Icon name="spark" size="0.9rem" />
                  </span>
                  <div className="mobiai__bubble">
                    <p>{greeting(start, lang)}</p>
                    {items.length === 0 && canAsk
                      ? chips(
                          'start',
                          w('tryAsking', lang),
                          start.starters
                            .slice(0, 4)
                            .map((x) => (lang === 'hi' ? x.questionHi : x.question)),
                        )
                      : null}
                  </div>
                </div>
                {start.quick.length ? (
                  <div className="mobiai__msg" data-quick="">
                    <span className="mobiai__mini" aria-hidden="true">
                      <Icon name="spark" size="0.9rem" />
                    </span>
                    <div className="mobiai__bubble">
                      <strong className="mobiai__quick-title">{w('quick', lang)}</strong>
                      <ul className="mobiai__quick">
                        {start.quick.map((q) => (
                          <li key={q.id}>
                            <Icon name={q.topic} size="1rem" />
                            <span>{lang === 'hi' ? q.textHi : q.text}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ) : null}
                {items.map((m, i) => {
                  const d = m.display ?? null;
                  return m.role === 'user' ? (
                    <div key={m.key} className="mobiai__msg mobiai__msg--user">
                      <div className="mobiai__bubble mobiai__bubble--user">
                        <span className="ep-sr-only">{w('you', lang)}: </span>
                        <p>{m.text}</p>
                        <span className="mobiai__time">{time(m.at)}</span>
                      </div>
                    </div>
                  ) : (
                    <div key={m.key} className="mobiai__msg">
                      <span className="mobiai__mini" aria-hidden="true">
                        <Icon name="spark" size="0.9rem" />
                      </span>
                      <div
                        className={`mobiai__bubble${m.refused ? ' mobiai__bubble--refused' : ''}`}
                      >
                        <span className="ep-sr-only">{name}: </span>
                        <p>{m.text}</p>
                        {d?.card ? <AssistantCard card={d.card} lang={lang} /> : null}
                        {d?.link?.web ? (
                          <a className="mobiai__open" href={d.link.web}>
                            {lang === 'hi'
                              ? `${d.link.labelHi ?? d.link.label} खोलें`
                              : `Open ${d.link.label}`}
                          </a>
                        ) : null}
                        {m.citations?.length ? (
                          <span className="mobiai__src">
                            {w('source', lang)}: {m.citations.map((c) => c.title).join(', ')}
                          </span>
                        ) : null}
                        {i === lastBot && canAsk ? (
                          <>
                            {chips('next', w('next', lang), (d?.followUps ?? []).map(chipQ))}
                            {chips('mean', w('mean', lang), (d?.didYouMean ?? []).map(chipQ))}
                            {!(d?.followUps ?? []).length && !(d?.didYouMean ?? []).length
                              ? chips(
                                  'instead',
                                  w('instead', lang),
                                  (d?.suggestions ?? []).map(chipQ),
                                )
                              : null}
                          </>
                        ) : null}
                        <span className="mobiai__time">{time(m.at)}</span>
                      </div>
                    </div>
                  );
                })}
                {busy ? (
                  <div className="mobiai__msg">
                    <span className="mobiai__mini" aria-hidden="true">
                      <Icon name="spark" size="0.9rem" />
                    </span>
                    <div className="mobiai__bubble mobiai__typing">
                      <span className="ep-sr-only">{w('looking', lang)}</span>
                      <span className="mobiai__dots" aria-hidden="true">
                        <i />
                        <i />
                        <i />
                      </span>
                    </div>
                  </div>
                ) : null}
                {!on ? (
                  <div className="ep-alert ep-alert--warning" role="status" data-banner="off">
                    {w('off', lang)}
                  </div>
                ) : consent === 'needed' ? (
                  <div className="ep-alert ep-alert--warning" role="status" data-banner="consent">
                    <div>
                      {w('consent', lang)}{' '}
                      {profileHref ? <a href={profileHref}>{w('openProfile', lang)}</a> : null}
                    </div>
                  </div>
                ) : consent === 'ask_parent' ? (
                  <div
                    className="ep-alert ep-alert--warning"
                    role="status"
                    data-banner="ask-parent"
                  >
                    {w('askParent', lang)}
                  </div>
                ) : limitHit ? (
                  <div className="ep-alert ep-alert--warning" role="status" data-banner="limit">
                    {lang === 'hi'
                      ? `आपने आज ${String(start.dailyLimit)} प्रश्न पूछे हैं, जितने आपका विद्यालय अनुमति देता है। कल फिर पूछें।`
                      : `You have asked ${String(start.dailyLimit)} questions today, the most your school allows. Try again tomorrow.`}
                  </div>
                ) : null}
              </>
            )}
          </div>

          {canAsk ? (
            <form className="mobiai__form" onSubmit={onSubmit}>
              <label className="ep-sr-only" htmlFor={`${panelId}-q`}>
                {w('question', lang)}
              </label>
              <input
                ref={inputRef}
                id={`${panelId}-q`}
                className="ep-input mobiai__input"
                value={text}
                maxLength={1000}
                autoComplete="off"
                placeholder={w('placeholder', lang)}
                onChange={(e) => setText(e.target.value)}
              />
              <button
                type="submit"
                className="mobiai__send"
                aria-label={w('send', lang)}
                title={w('send', lang)}
                disabled={busy || text.trim().length < 2}
              >
                <Icon name="send" />
              </button>
            </form>
          ) : null}
          <p className="mobiai__foot">
            {w('powered', lang)} <strong>Mobilise App Lab Limited</strong>
          </p>
        </section>
      ) : null}
      {open ? null : (
        <button
          ref={toggleRef}
          type="button"
          className="mobiai__toggle"
          aria-expanded={false}
          aria-label={`${w('open', lang)} ${name}`}
          title={`${w('open', lang)} ${name}`}
          onClick={() => setOpen(true)}
        >
          <Icon name="chat" size="1.6rem" />
        </button>
      )}
    </div>
  );
}
