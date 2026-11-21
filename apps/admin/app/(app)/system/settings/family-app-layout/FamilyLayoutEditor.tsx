'use client';
import { Button, Dialog } from '@edupro/ui';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import {
  ACADEMICS_TAB,
  AUDIENCE_NAME,
  layoutProblems,
  sameLayout,
  when,
  type FamilyAudience,
  type FamilyLayout,
  type FamilyLayoutSetup,
} from '@/lib/family-layout';
import { discardLayout, publishLayout, saveLayoutDraft } from './actions';

type Part = keyof FamilyLayout;

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

/** The draft as families would see it: the Home band, the shortcut grid, the cards and the tab bar. */
function Preview({
  audience,
  draft,
  labelOf,
  cardLabel,
}: {
  audience: FamilyAudience;
  draft: FamilyLayout;
  labelOf: (key: string) => { label: string };
  cardLabel: (key: string) => string;
}) {
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
    <figure style={{ margin: 0 }} aria-labelledby="fal-preview-cap">
      <figcaption
        id="fal-preview-cap"
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
            {draft.shortcuts.map((s) => (
              <div key={s}>{tile(labelOf(s).label)}</div>
            ))}
            <div>{tile('All')}</div>
          </div>
          <div className="ep-field__help" style={{ margin: 'var(--sp-3) 0 var(--sp-2)' }}>
            Cards
          </div>
          <div style={{ display: 'grid', gap: 'var(--sp-2)' }}>
            {draft.cards.map((c) => (
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
          {['Home', ...draft.tabs.map((t) => labelOf(t).label), 'More'].map((t, i) => (
            <span key={`${String(i)}-${t}`} style={{ lineHeight: 1.2, overflowWrap: 'anywhere' }}>
              {t}
            </span>
          ))}
        </div>
      </div>
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
}: {
  audience: FamilyAudience;
  initial: FamilyLayoutSetup;
  canEdit: boolean;
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
  const dirty = !sameLayout(draft, state.draft);
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
            id="fal-tabs"
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
          />
          <OrderedList
            id="fal-shortcuts"
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
          />
          <OrderedList
            id="fal-cards"
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
          />
          <OrderedList
            id="fal-academics"
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
          />
        </div>
        <div style={{ flex: '0 1 22rem', minWidth: 0 }}>
          <Preview audience={audience} draft={draft} labelOf={labelOf} cardLabel={cardLabel} />
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
