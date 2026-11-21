'use client';
import { Badge, Button, Dialog } from '@edupro/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, useTransition } from 'react';
import {
  ACADEMICS_TAB,
  AUDIENCE_NAME,
  GROUP_NAME_MAX,
  MENU_GROUP_NAME,
  hiddenScreens,
  layoutProblems,
  sameLayout,
  shownTabs,
  when,
  type FamilyAudience,
  type FamilyLayout,
  type FamilyLayoutSetup,
  type FamilyMenuGroup,
} from '@/lib/family-layout';
import { discardLayout, publishLayout, saveLayoutDraft } from './actions';

type Part = Exclude<keyof FamilyLayout, 'menu' | 'hidden'>;

/** One ordered list of the draft: its rows (move up / down, remove) and "Add" from what is not in it yet. */
function OrderedList({
  id,
  title,
  help,
  items,
  labelOf,
  options,
  min,
  max,
  addLabel,
  fixedFirst,
  fixedLast,
  canEdit,
  onChange,
  isHidden,
}: {
  id: string;
  title: string;
  help: string;
  items: string[];
  labelOf: (key: string) => { label: string; sub?: string };
  options: Array<{ key: string; label: string }>;
  min: number;
  max: number;
  addLabel: string;
  fixedFirst?: string;
  fixedLast?: string;
  canEdit: boolean;
  onChange: (next: string[]) => void;
  /** A row about a screen the school hides: marked, as families do not get it. */
  isHidden?: (key: string) => boolean;
}) {
  const free = options.filter((o) => !items.includes(o.key));
  const move = (i: number, j: number) => {
    const next = [...items];
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };
  const count =
    min === max
      ? `${String(items.length)} of ${String(max)}`
      : `${String(items.length)} (${String(min)}–${String(max)})`;
  return (
    <section
      className="ep-card"
      aria-labelledby={`${id}-h`}
      style={{ marginBottom: 'var(--sp-4)' }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 'var(--sp-2)',
          flexWrap: 'wrap',
          alignItems: 'baseline',
        }}
      >
        <h2 id={`${id}-h`} className="ep-cdash__h3" style={{ margin: 0 }}>
          {title}
        </h2>
        <span className="ep-field__help" style={{ margin: 0 }}>
          {count}
        </span>
      </div>
      <p className="ep-field__help" style={{ marginTop: 'var(--sp-1)' }}>
        {help}
      </p>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--sp-1)' }}>
        {fixedFirst ? (
          <li className="ep-field__help" style={{ padding: 'var(--sp-1) 0' }}>
            {fixedFirst}
          </li>
        ) : null}
        {items.map((key, i) => {
          const { label, sub } = labelOf(key);
          return (
            <li
              key={key}
              data-testid={`${id}-row`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--sp-2)',
                flexWrap: 'wrap',
                padding: 'var(--sp-2) var(--sp-3)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                background: 'var(--surface-card)',
              }}
            >
              <span className="ep-field__help" style={{ margin: 0, minWidth: '1.5rem' }}>
                {String(i + 1)}.
              </span>
              <span style={{ flex: '1 1 10rem' }}>
                <strong>{label}</strong>
                {sub ? (
                  <span className="ep-field__help" style={{ display: 'block', margin: 0 }}>
                    {sub}
                  </span>
                ) : null}
              </span>
              {isHidden?.(key) ? <Badge tone="warning">Hidden — left out</Badge> : null}
              {canEdit ? (
                <span style={{ display: 'flex', gap: 'var(--sp-1)', flexWrap: 'wrap' }}>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={i === 0}
                    aria-label={`Move ${label} up`}
                    onClick={() => move(i, i - 1)}
                  >
                    Move up
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={i === items.length - 1}
                    aria-label={`Move ${label} down`}
                    onClick={() => move(i, i + 1)}
                  >
                    Move down
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label={`Remove ${label}`}
                    onClick={() => onChange(items.filter((x) => x !== key))}
                  >
                    Remove
                  </Button>
                </span>
              ) : null}
            </li>
          );
        })}
        {fixedLast ? (
          <li className="ep-field__help" style={{ padding: 'var(--sp-1) 0' }}>
            {fixedLast}
          </li>
        ) : null}
      </ol>
      {canEdit ? (
        <div className="ep-field" style={{ marginTop: 'var(--sp-3)', marginBottom: 0 }}>
          <label className="ep-field__label" htmlFor={`${id}-add`}>
            {addLabel}
          </label>
          <select
            id={`${id}-add`}
            className="ep-select"
            value=""
            disabled={items.length >= max || free.length === 0}
            onChange={(e) => {
              const v = e.target.value;
              if (v && !items.includes(v)) onChange([...items, v]);
            }}
          >
            <option value="">
              {items.length >= max ? `Full (${String(max)})` : 'Choose to add…'}
            </option>
            {free.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}
    </section>
  );
}

/**
 * The website's side menu and the app's More list (docs/design/90): the groups in order (move up / down), each with
 * the school's name for it in English and Hindi (empty: the standard name) and its screens in order — moved up / down
 * inside the group or to another group. Every screen stays in one group.
 */
function MenuEditor({
  audience,
  menu,
  hidden,
  labelOf,
  canEdit,
  onChange,
  onHidden,
}: {
  audience: FamilyAudience;
  menu: FamilyMenuGroup[];
  /** The screens hidden one by one (a hidden group hides its screens itself). */
  hidden: string[];
  labelOf: (key: string) => { label: string };
  canEdit: boolean;
  onChange: (next: FamilyMenuGroup[]) => void;
  onHidden: (next: string[]) => void;
}) {
  const allHidden = hiddenScreens({
    tabs: [],
    shortcuts: [],
    cards: [],
    academics: [],
    menu,
    hidden,
  });
  const standard = MENU_GROUP_NAME[audience];
  const nameOf = (g: FamilyMenuGroup) => g.label?.trim() || standard[g.key] || g.key;
  const swap = <T,>(xs: T[], i: number, j: number) => {
    const next = [...xs];
    [next[i], next[j]] = [next[j]!, next[i]!];
    return next;
  };
  const setGroup = (gi: number, g: FamilyMenuGroup) =>
    onChange(menu.map((x, i) => (i === gi ? g : x)));
  const moveTo = (gi: number, href: string, key: string) =>
    onChange(
      menu.map((x, i) =>
        i === gi
          ? { ...x, items: x.items.filter((h) => h !== href) }
          : x.key === key
            ? { ...x, items: [...x.items, href] }
            : x,
      ),
    );
  const name = (v: string) => (v.trim() ? v : null);
  return (
    <section
      className="ep-card"
      aria-labelledby={`fal-menu-${audience}-h`}
      style={{ marginBottom: 'var(--sp-4)' }}
    >
      <h2 id={`fal-menu-${audience}-h`} className="ep-cdash__h3" style={{ margin: 0 }}>
        Website menu and app More
      </h2>
      <p
        data-testid={`fal-menu-${audience}-hidden-count`}
        style={{ margin: 'var(--sp-1) 0 0', fontWeight: 'var(--fw-semibold)' }}
      >
        {`Hidden from families: ${String(allHidden.size)} ${allHidden.size === 1 ? 'screen' : 'screens'}`}
      </p>
      <p className="ep-field__help" style={{ marginTop: 'var(--sp-1)' }}>
        The groups of the website&apos;s side menu and of the app&apos;s More list, in this order,
        with their screens. Home stays first. Every screen is in one group. Hidden screens are left
        out everywhere for families (menu, More, tabs, shortcuts, cards, Academics, Help). To stop
        someone reading data, use Access → Roles.
      </p>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--sp-3)' }}>
        {menu.map((g, gi) => {
          const groupName = nameOf(g);
          const others = menu.filter((x) => x.key !== g.key);
          return (
            <li
              key={g.key}
              data-testid="fal-menu-group"
              style={{
                padding: 'var(--sp-3)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                background: 'var(--surface-card)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--sp-2)',
                  flexWrap: 'wrap',
                }}
              >
                <span className="ep-field__help" style={{ margin: 0, minWidth: '1.5rem' }}>
                  {String(gi + 1)}.
                </span>
                <strong
                  style={{
                    flex: '1 1 10rem',
                    color: g.hidden ? 'var(--text-muted)' : undefined,
                  }}
                >
                  {groupName}
                </strong>
                {g.hidden ? <Badge tone="warning">Hidden from families</Badge> : null}
                {canEdit ? (
                  <span style={{ display: 'flex', gap: 'var(--sp-1)', flexWrap: 'wrap' }}>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      aria-pressed={g.hidden === true}
                      aria-label={`${g.hidden ? 'Show' : 'Hide'} the group ${groupName}`}
                      onClick={() => setGroup(gi, { ...g, hidden: !g.hidden })}
                    >
                      {g.hidden ? 'Show group' : 'Hide group'}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={gi === 0}
                      aria-label={`Move the group ${groupName} up`}
                      onClick={() => onChange(swap(menu, gi, gi - 1))}
                    >
                      Move up
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={gi === menu.length - 1}
                      aria-label={`Move the group ${groupName} down`}
                      onClick={() => onChange(swap(menu, gi, gi + 1))}
                    >
                      Move down
                    </Button>
                  </span>
                ) : null}
              </div>
              {canEdit ? (
                <div
                  style={{
                    display: 'flex',
                    gap: 'var(--sp-3)',
                    flexWrap: 'wrap',
                    marginTop: 'var(--sp-2)',
                  }}
                >
                  <div className="ep-field" style={{ flex: '1 1 12rem', marginBottom: 0 }}>
                    <label
                      className="ep-field__label"
                      htmlFor={`fal-menu-${audience}-${g.key}-name`}
                    >
                      Name
                    </label>
                    <input
                      id={`fal-menu-${audience}-${g.key}-name`}
                      className="ep-input"
                      value={g.label ?? ''}
                      placeholder={standard[g.key]}
                      maxLength={GROUP_NAME_MAX}
                      onChange={(e) => setGroup(gi, { ...g, label: name(e.target.value) })}
                    />
                  </div>
                  <div className="ep-field" style={{ flex: '1 1 12rem', marginBottom: 0 }}>
                    <label className="ep-field__label" htmlFor={`fal-menu-${audience}-${g.key}-hi`}>
                      Name in Hindi (optional)
                    </label>
                    <input
                      id={`fal-menu-${audience}-${g.key}-hi`}
                      className="ep-input"
                      lang="hi"
                      value={g.labelHi ?? ''}
                      maxLength={GROUP_NAME_MAX}
                      onChange={(e) => setGroup(gi, { ...g, labelHi: name(e.target.value) })}
                    />
                  </div>
                </div>
              ) : g.labelHi ? (
                <span className="ep-field__help" style={{ display: 'block', margin: 0 }} lang="hi">
                  {g.labelHi}
                </span>
              ) : null}
              {g.items.length === 0 ? (
                <p className="ep-field__help" style={{ margin: 'var(--sp-2) 0 0' }}>
                  No screens — it does not show.
                </p>
              ) : (
                <ol
                  style={{
                    listStyle: 'none',
                    margin: 'var(--sp-2) 0 0',
                    padding: 0,
                    display: 'grid',
                    gap: 'var(--sp-1)',
                  }}
                >
                  {g.items.map((href, i) => {
                    const { label } = labelOf(href);
                    const own = hidden.includes(href);
                    return (
                      <li
                        key={href}
                        data-testid="fal-menu-row"
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 'var(--sp-2)',
                          flexWrap: 'wrap',
                          padding: 'var(--sp-1) var(--sp-2)',
                          borderTop: i === 0 ? undefined : '1px solid var(--border-subtle)',
                        }}
                      >
                        <span
                          style={{
                            flex: '1 1 10rem',
                            color: g.hidden || own ? 'var(--text-muted)' : undefined,
                          }}
                        >
                          {label}
                          {g.hidden ? (
                            <span
                              className="ep-field__help"
                              style={{ display: 'block', margin: 0 }}
                            >
                              Hidden with its group
                            </span>
                          ) : null}
                        </span>
                        {own ? <Badge tone="warning">Hidden</Badge> : null}
                        {canEdit ? (
                          <span
                            style={{
                              display: 'flex',
                              gap: 'var(--sp-1)',
                              flexWrap: 'wrap',
                              alignItems: 'center',
                            }}
                          >
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              disabled={g.hidden === true}
                              aria-pressed={own}
                              aria-label={`${own ? 'Show' : 'Hide'} ${label}`}
                              onClick={() =>
                                onHidden(own ? hidden.filter((h) => h !== href) : [...hidden, href])
                              }
                            >
                              {own ? 'Show' : 'Hide'}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              disabled={i === 0}
                              aria-label={`Move ${label} up`}
                              onClick={() => setGroup(gi, { ...g, items: swap(g.items, i, i - 1) })}
                            >
                              Move up
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              disabled={i === g.items.length - 1}
                              aria-label={`Move ${label} down`}
                              onClick={() => setGroup(gi, { ...g, items: swap(g.items, i, i + 1) })}
                            >
                              Move down
                            </Button>
                            <select
                              className="ep-select"
                              value=""
                              aria-label={`Move ${label} to another group`}
                              style={{ width: 'auto' }}
                              onChange={(e) => {
                                if (e.target.value) moveTo(gi, href, e.target.value);
                              }}
                            >
                              <option value="">Move to…</option>
                              {others.map((o) => (
                                <option key={o.key} value={o.key}>
                                  {nameOf(o)}
                                </option>
                              ))}
                            </select>
                          </span>
                        ) : null}
                      </li>
                    );
                  })}
                </ol>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** The draft as families would see it: the Home band, the shortcut grid, the cards and the tab bar. */
function Preview({
  audience,
  draft,
  screens,
  labelOf,
  cardLabel,
  cardNeeds,
}: {
  audience: FamilyAudience;
  draft: FamilyLayout;
  /** The audience's screens in the menu's standard order (what a hidden tab's place is filled from). */
  screens: string[];
  labelOf: (key: string) => { label: string };
  cardLabel: (key: string) => string;
  cardNeeds: (key: string) => string | undefined;
}) {
  // what families get: hidden screens left out, a hidden tab's place taken as the API does
  const hidden = hiddenScreens(draft);
  const shortcuts = draft.shortcuts.filter((h) => !hidden.has(h));
  const cards = draft.cards.filter((c) => {
    const needs = cardNeeds(c);
    return !needs || !hidden.has(needs);
  });
  const tabs = shownTabs(draft, screens, hidden);
  const tile = (text: string) => (
    <div
      style={{
        display: 'grid',
        justifyItems: 'center',
        gap: 'var(--sp-1)',
        textAlign: 'center',
        fontSize: 'var(--fs-caption)',
        color: 'var(--text-body)',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          display: 'grid',
          placeItems: 'center',
          width: '2.25rem',
          height: '2.25rem',
          borderRadius: 'var(--radius-md)',
          background: 'var(--surface-subtle)',
          color: 'var(--text-primary)',
          fontWeight: 'var(--fw-semibold)',
        }}
      >
        {text.slice(0, 1)}
      </span>
      <span style={{ lineHeight: 1.2 }}>{text}</span>
    </div>
  );
  return (
    <figure style={{ margin: 0 }} aria-labelledby={`fal-preview-cap-${audience}`}>
      <figcaption
        id={`fal-preview-cap-${audience}`}
        className="ep-field__help"
        style={{ marginBottom: 'var(--sp-2)' }}
      >
        Preview of the {AUDIENCE_NAME[audience].toLowerCase()}&apos; draft (names only; each person
        sees only the screens they can open)
      </figcaption>
      <div
        style={{
          border: '1px solid var(--border-strong)',
          borderRadius: 'var(--radius-lg)',
          overflow: 'hidden',
          background: 'var(--surface-page)',
          boxShadow: 'var(--shadow-card)',
          maxWidth: '22rem',
        }}
      >
        <div
          style={{
            background: 'var(--surface-dark)',
            color: 'var(--text-inverse)',
            padding: 'var(--sp-3) var(--sp-4)',
            fontWeight: 'var(--fw-semibold)',
          }}
        >
          Home
        </div>
        <div style={{ padding: 'var(--sp-3)' }}>
          <div className="ep-field__help" style={{ margin: '0 0 var(--sp-2)' }}>
            Shortcuts
          </div>
          <div
            data-testid="fal-preview-shortcuts"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
              gap: 'var(--sp-3) var(--sp-2)',
            }}
          >
            {shortcuts.map((s) => (
              <div key={s}>{tile(labelOf(s).label)}</div>
            ))}
            <div>{tile('All')}</div>
          </div>
          <div className="ep-field__help" style={{ margin: 'var(--sp-3) 0 var(--sp-2)' }}>
            Cards
          </div>
          <div style={{ display: 'grid', gap: 'var(--sp-2)' }}>
            {cards.map((c) => (
              <div
                key={c}
                style={{
                  background: 'var(--surface-card)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  padding: 'var(--sp-2) var(--sp-3)',
                  fontSize: 'var(--fs-small)',
                  color: 'var(--text-body)',
                }}
              >
                {cardLabel(c)}
              </div>
            ))}
          </div>
        </div>
        <div
          data-testid="fal-preview-tabs"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
            borderTop: '1px solid var(--border-default)',
            background: 'var(--surface-card)',
            padding: 'var(--sp-2) var(--sp-1)',
            textAlign: 'center',
            fontSize: 'var(--fs-caption)',
            color: 'var(--text-body)',
          }}
        >
          {['Home', ...tabs.map((t) => labelOf(t).label), 'More'].map((t, i) => (
            <span key={`${String(i)}-${t}`} style={{ lineHeight: 1.2, overflowWrap: 'anywhere' }}>
              {t}
            </span>
          ))}
        </div>
      </div>
      {draft.menu?.length ? (
        <div
          data-testid="fal-preview-menu"
          style={{
            marginTop: 'var(--sp-3)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--surface-card)',
            padding: 'var(--sp-3)',
            maxWidth: '22rem',
            fontSize: 'var(--fs-small)',
            color: 'var(--text-body)',
          }}
        >
          <div className="ep-field__help" style={{ margin: '0 0 var(--sp-2)' }}>
            Side menu (website) and More (app)
          </div>
          <div style={{ fontWeight: 'var(--fw-semibold)' }}>Home</div>
          {draft.menu
            .map((g) => ({ ...g, items: g.items.filter((h) => !hidden.has(h)) }))
            .filter((g) => g.items.length > 0)
            .map((g) => (
              <div key={g.key} style={{ marginTop: 'var(--sp-2)' }}>
                <div style={{ fontWeight: 'var(--fw-semibold)' }}>
                  {g.label?.trim() || MENU_GROUP_NAME[audience][g.key] || g.key}
                </div>
                <ul style={{ margin: 'var(--sp-1) 0 0', paddingLeft: 'var(--sp-4)' }}>
                  {g.items.map((h) => (
                    <li key={h}>{labelOf(h).label}</li>
                  ))}
                </ul>
              </div>
            ))}
        </div>
      ) : null}
    </figure>
  );
}

/**
 * The family app layout editor (docs/design/90): the draft of one audience in four ordered lists with the checks as
 * you edit and a phone-shaped preview; Save draft, Publish (saving first), Discard the draft, Start again from the app
 * as it was.
 */
export function FamilyLayoutEditor({
  audience,
  initial,
  canEdit,
  onDirty,
}: {
  audience: FamilyAudience;
  initial: FamilyLayoutSetup;
  canEdit: boolean;
  /** Tells the page whether this audience has edits not saved yet (the switch marks it, leaving asks first). */
  onDirty?: (audience: FamilyAudience, dirty: boolean) => void;
}) {
  const router = useRouter();
  const [setup, setSetup] = useState(initial);
  const state = setup.layouts[audience];
  const [draft, setDraft] = useState<FamilyLayout>(state.draft);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [ask, setAsk] = useState<'publish' | 'discard' | null>(null);
  const [busy, start] = useTransition();
  const { catalogue } = setup;
  const screens = catalogue.screens[audience];
  const screenLabel = useMemo(() => new Map(screens.map((s) => [s.href, s.label])), [screens]);
  const cardOf = useMemo(() => new Map(catalogue.cards.map((c) => [c.key, c])), [catalogue.cards]);
  const labelOf = (key: string) => ({
    label: key === ACADEMICS_TAB ? 'Academics' : (screenLabel.get(key) ?? key),
    sub: key === ACADEMICS_TAB ? 'Lists the screens of the Academics list below' : undefined,
  });
  const cardLabel = (key: string) => cardOf.get(key)?.label ?? key;
  // what the school hides (one by one and with their groups): marked in every list, left out of the preview
  const hidden = hiddenScreens(draft);
  const academicsShown = draft.academics.some((h) => !hidden.has(h));
  const isHiddenScreen = (key: string) =>
    key === ACADEMICS_TAB ? !academicsShown : hidden.has(key);
  const dirty = !sameLayout(draft, state.draft);
  useEffect(() => onDirty?.(audience, dirty), [onDirty, audience, dirty]);
  const problems = layoutProblems(audience, draft, catalogue);
  const set = (part: Part) => (next: string[]) => {
    setMsg(null);
    setDraft({ ...draft, [part]: next });
  };
  const screenOptions = screens.map((s) => ({ key: s.href, label: s.label }));
  const cardOptions = catalogue.cards
    .filter((c) => !c.parentOnly || audience === 'parent')
    .map((c) => ({ key: c.key, label: `${c.label} — ${c.labelHi}` }));
  const after = (r: Awaited<ReturnType<typeof saveLayoutDraft>>, ok: string) => {
    if (r.ok) {
      setSetup(r.data);
      setDraft(r.data.layouts[audience].draft);
      setMsg({ ok: true, text: ok });
      router.refresh();
      return true;
    }
    setMsg({ ok: false, text: r.error });
    return false;
  };
  const save = () =>
    start(async () => {
      after(
        await saveLayoutDraft(audience, draft),
        'Draft saved. Families get it when you publish.',
      );
    });
  const publish = () =>
    start(async () => {
      if (dirty) {
        const saved = await saveLayoutDraft(audience, draft);
        if (!after(saved, 'Draft saved.')) {
          setAsk(null);
          return;
        }
      }
      after(
        await publishLayout(audience),
        `Published. ${AUDIENCE_NAME[audience]} get this layout on their next refresh.`,
      );
      setAsk(null);
    });
  const discard = () =>
    start(async () => {
      after(await discardLayout(audience), 'Draft discarded: back to what families have now.');
      setAsk(null);
    });

  return (
    <>
      <div
        className="ep-card"
        role="status"
        aria-live="polite"
        style={{ marginBottom: 'var(--sp-4)', display: 'grid', gap: 'var(--sp-1)' }}
      >
        <span data-testid="fal-published">
          {state.everPublished
            ? `Published ${when(state.publishedAt)}${state.publishedBy ? ` by ${state.publishedBy}` : ''}.`
            : 'Not published yet — families have the app as it was.'}
        </span>
        {state.changed ? (
          <span data-testid="fal-draft-changed">
            {`Draft changed${state.draftUpdatedBy ? ` by ${state.draftUpdatedBy}` : ''} ${when(state.draftUpdatedAt)}, not yet published.`}
          </span>
        ) : (
          <span className="ep-field__help" style={{ margin: 0 }}>
            The draft is the same as what families have.
          </span>
        )}
        {dirty ? <strong data-testid="fal-unsaved">You have changes not saved yet.</strong> : null}
      </div>
      {msg ? (
        <p
          className={`ep-alert ${msg.ok ? 'ep-alert--success' : 'ep-alert--danger'}`}
          role={msg.ok ? 'status' : 'alert'}
          data-testid="fal-msg"
        >
          {msg.text}
        </p>
      ) : null}
      {problems.length ? (
        <div className="ep-alert ep-alert--warning" role="status" data-testid="fal-problems">
          <strong>To fix before saving</strong>
          <ul style={{ margin: 'var(--sp-1) 0 0', paddingLeft: 'var(--sp-5)' }}>
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {canEdit ? (
        <div
          style={{
            display: 'flex',
            gap: 'var(--sp-2)',
            flexWrap: 'wrap',
            marginBottom: 'var(--sp-4)',
          }}
        >
          <Button
            type="button"
            variant="secondary"
            disabled={busy || !dirty || problems.length > 0}
            onClick={save}
          >
            Save draft
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={
              busy || problems.length > 0 || (!dirty && !state.changed && state.everPublished)
            }
            onClick={() => setAsk('publish')}
          >
            {dirty ? 'Save and publish' : 'Publish'}
          </Button>
          {state.changed || dirty ? (
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => (state.changed ? setAsk('discard') : setDraft(state.draft))}
            >
              {state.changed ? 'Discard the draft' : 'Undo my changes'}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            disabled={busy || sameLayout(draft, catalogue.defaults[audience])}
            onClick={() => {
              setMsg({
                ok: true,
                text: 'The app as it was is in the editor. Save draft to keep it; publish to give it to families.',
              });
              setDraft(catalogue.defaults[audience]);
            }}
          >
            Start again from the app as it was
          </Button>
        </div>
      ) : null}
      <div
        style={{ display: 'flex', gap: 'var(--sp-5)', flexWrap: 'wrap', alignItems: 'flex-start' }}
      >
        <div style={{ flex: '1 1 28rem', minWidth: 0 }}>
          <OrderedList
            id={`fal-${audience}-tabs`}
            title="Bottom tabs"
            help="Home is always first and More always last; choose the three in between. A tab someone cannot open gives its place to the next of the shortcuts."
            items={draft.tabs}
            labelOf={labelOf}
            options={[
              { key: ACADEMICS_TAB, label: 'Academics (lists the Academics screens)' },
              ...screenOptions,
            ]}
            min={catalogue.limits.tabs}
            max={catalogue.limits.tabs}
            addLabel="Add a tab"
            fixedFirst="Home — always first"
            fixedLast="More — always last"
            canEdit={canEdit}
            onChange={set('tabs')}
            isHidden={isHiddenScreen}
          />
          <OrderedList
            id={`fal-${audience}-shortcuts`}
            title="Home shortcuts"
            help="The tiles on Home, four a row; the app adds an All tile that opens More. Each person may pin their own instead."
            items={draft.shortcuts}
            labelOf={labelOf}
            options={screenOptions}
            min={catalogue.limits.shortcuts.min}
            max={catalogue.limits.shortcuts.max}
            addLabel="Add a shortcut"
            canEdit={canEdit}
            onChange={set('shortcuts')}
            isHidden={isHiddenScreen}
          />
          <OrderedList
            id={`fal-${audience}-cards`}
            title="Home cards"
            help="The cards under the shortcuts, in this order. A card about a screen someone cannot open is left out for them."
            items={draft.cards}
            labelOf={(k) => ({ label: cardLabel(k), sub: cardOf.get(k)?.labelHi })}
            options={cardOptions}
            min={catalogue.limits.cards.min}
            max={catalogue.limits.cards.max}
            addLabel="Add a card"
            canEdit={canEdit}
            onChange={set('cards')}
            isHidden={(k) => {
              const needs = cardOf.get(k)?.needs;
              return !!needs && hidden.has(needs);
            }}
          />
          <OrderedList
            id={`fal-${audience}-academics`}
            title="Academics tab"
            help={
              draft.tabs.includes(ACADEMICS_TAB)
                ? 'The screens the Academics tab lists, in this order.'
                : 'Used only when Academics is one of the tabs.'
            }
            items={draft.academics}
            labelOf={labelOf}
            options={screenOptions}
            min={draft.tabs.includes(ACADEMICS_TAB) ? catalogue.limits.academics.min : 0}
            max={catalogue.limits.academics.max}
            addLabel="Add a screen to the Academics tab"
            canEdit={canEdit}
            onChange={set('academics')}
            isHidden={isHiddenScreen}
          />
          {draft.menu ? (
            <MenuEditor
              audience={audience}
              menu={draft.menu}
              hidden={draft.hidden ?? []}
              labelOf={labelOf}
              canEdit={canEdit}
              onChange={(menu) => {
                setMsg(null);
                setDraft({ ...draft, menu });
              }}
              onHidden={(next) => {
                setMsg(null);
                // in the menu's order, as it is saved
                const order = (draft.menu ?? []).flatMap((g) => g.items);
                setDraft({ ...draft, hidden: order.filter((h) => next.includes(h)) });
              }}
            />
          ) : null}
        </div>
        <div style={{ flex: '0 1 22rem', minWidth: 0 }}>
          <Preview
            audience={audience}
            draft={draft}
            screens={screens.map((x) => x.href)}
            labelOf={labelOf}
            cardLabel={cardLabel}
            cardNeeds={(k) => cardOf.get(k)?.needs}
          />
        </div>
      </div>
      {ask === 'publish' ? (
        <Dialog
          open
          size="sm"
          title={`Publish the ${AUDIENCE_NAME[audience].toLowerCase()}' layout?`}
          onClose={() => {
            if (!busy) setAsk(null);
          }}
          primary={{
            label: dirty ? 'Save and publish' : 'Publish',
            loading: busy,
            onClick: publish,
          }}
        >
          <p>
            Families get this layout on their next refresh.
            {dirty ? ' Your changes are saved first.' : ''}
          </p>
        </Dialog>
      ) : null}
      {ask === 'discard' ? (
        <Dialog
          open
          size="sm"
          title="Discard the draft?"
          onClose={() => {
            if (!busy) setAsk(null);
          }}
          primary={{
            label: 'Discard the draft',
            variant: 'danger',
            loading: busy,
            onClick: discard,
          }}
        >
          <p>The draft goes back to what families have now. Changes not saved yet are lost too.</p>
        </Dialog>
      ) : null}
    </>
  );
}

/**
 * Students | Parents on the page itself: both drafts stay in the editor while switching (nothing unsaved is lost), the
 * switch marks an audience with edits not saved yet, and leaving the page with unsaved edits asks first.
 */
export function FamilyLayoutAudiences({
  initialAudience,
  initial,
  canEdit,
}: {
  initialAudience: FamilyAudience;
  initial: FamilyLayoutSetup;
  canEdit: boolean;
}) {
  const [current, setCurrent] = useState<FamilyAudience>(initialAudience);
  const [unsaved, setUnsaved] = useState<Record<FamilyAudience, boolean>>({
    student: false,
    parent: false,
  });
  const onDirty = useMemo(
    () => (a: FamilyAudience, d: boolean) => setUnsaved((u) => (u[a] === d ? u : { ...u, [a]: d })),
    [],
  );
  const anyUnsaved = unsaved.student || unsaved.parent;
  useEffect(() => {
    if (!anyUnsaved) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [anyUnsaved]);
  return (
    <>
      <nav className="ep-tabs-links" aria-label="Whose app">
        {(['student', 'parent'] as const).map((a) => (
          <a
            key={a}
            href={`/system/settings/family-app-layout?for=${a}`}
            aria-current={a === current ? 'page' : undefined}
            onClick={(e) => {
              e.preventDefault();
              setCurrent(a);
              window.history.replaceState(null, '', `/system/settings/family-app-layout?for=${a}`);
            }}
          >
            {AUDIENCE_NAME[a]}
            {unsaved[a]
              ? ' · not saved'
              : initial.layouts[a].changed
                ? ' · draft not published'
                : ''}
          </a>
        ))}
      </nav>
      {(['student', 'parent'] as const).map((a) => (
        <div key={a} hidden={a !== current}>
          <FamilyLayoutEditor audience={a} initial={initial} canEdit={canEdit} onDirty={onDirty} />
        </div>
      ))}
    </>
  );
}
