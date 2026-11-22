'use client';
import { Button, Dialog } from '@edupro/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { when } from '@/lib/family-layout';
import {
  CLASSES_TAB,
  sameStaffLayout,
  staffLayoutProblems,
  type StaffLayout,
  type StaffLayoutSetup,
} from '@/lib/staff-layout';
import { OrderedList } from '../family-app-layout/FamilyLayoutEditor';
import { discardStaffLayout, publishStaffLayout, saveStaffLayoutDraft } from './actions';

/** The staff app's Home as the draft has it: the greeting, the four figures, the tiles, the cards and the tab bar. */
function Preview({
  draft,
  firstName,
  labelOf,
  cardLabel,
}: {
  draft: StaffLayout;
  firstName: string;
  labelOf: (key: string) => { label: string };
  cardLabel: (key: string) => string;
}) {
  const tile = (text: string) => (
    <div
      key={text}
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
  const tabs = ['Home', ...draft.tabs.map((t) => labelOf(t).label), 'More'];
  return (
    <figure style={{ margin: 0 }} aria-labelledby="sal-preview-cap">
      <figcaption
        id="sal-preview-cap"
        className="ep-field__help"
        style={{ marginBottom: 'var(--sp-2)' }}
      >
        Preview of the draft (names only; each person sees only the screens they can open)
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
          }}
        >
          <strong data-testid="sal-preview-greeting">
            Good morning{firstName ? `, ${firstName}` : ''}
          </strong>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              gap: 'var(--sp-1)',
              marginTop: 'var(--sp-2)',
              fontSize: 'var(--fs-caption)',
            }}
          >
            {['Periods today', 'Classes to mark', 'Marks to enter', 'Approvals'].map((f) => (
              <span
                key={f}
                style={{
                  background: 'var(--surface-card)',
                  color: 'var(--text-body)',
                  borderRadius: 'var(--radius-sm)',
                  padding: 'var(--sp-1) var(--sp-2)',
                }}
              >
                {f}
              </span>
            ))}
          </div>
        </div>
        <div style={{ padding: 'var(--sp-3)' }}>
          <div className="ep-field__help" style={{ margin: '0 0 var(--sp-2)' }}>
            Shortcuts
          </div>
          <div
            data-testid="sal-preview-shortcuts"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
              gap: 'var(--sp-3) var(--sp-2)',
            }}
          >
            {draft.shortcuts.map((h) => tile(labelOf(h).label))}
            {tile('All')}
          </div>
          <ol
            data-testid="sal-preview-cards"
            style={{
              listStyle: 'none',
              margin: 'var(--sp-3) 0 0',
              padding: 0,
              display: 'grid',
              gap: 'var(--sp-2)',
            }}
          >
            {draft.cards.map((c) => (
              <li
                key={c}
                style={{
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  padding: 'var(--sp-2) var(--sp-3)',
                  background: 'var(--surface-card)',
                  fontSize: 'var(--fs-small)',
                }}
              >
                {cardLabel(c)}
              </li>
            ))}
          </ol>
        </div>
        <div
          data-testid="sal-preview-tabs"
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${String(tabs.length)}, minmax(0, 1fr))`,
            borderTop: '1px solid var(--border-subtle)',
            background: 'var(--surface-dark)',
            color: 'var(--text-inverse)',
            fontSize: 'var(--fs-caption)',
            textAlign: 'center',
          }}
        >
          {tabs.map((t) => (
            <span key={t} style={{ padding: 'var(--sp-2) var(--sp-1)', overflowWrap: 'anywhere' }}>
              {t}
            </span>
          ))}
        </div>
      </div>
    </figure>
  );
}

/**
 * The staff app layout editor (docs/design/94): the bottom tabs (Home and More fixed, three between), the Home
 * shortcuts and the Home work cards, with a preview; Save draft, Publish (asks first), Discard the draft, Start again
 * from the standard layout; leaving with unsaved changes asks first.
 */
export function StaffLayoutEditor({
  initial,
  canEdit,
  firstName,
}: {
  initial: StaffLayoutSetup;
  canEdit: boolean;
  firstName: string;
}) {
  const router = useRouter();
  const [setup, setSetup] = useState(initial);
  const [draft, setDraft] = useState<StaffLayout>(initial.draft);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [ask, setAsk] = useState<'publish' | 'discard' | null>(null);
  const [busy, start] = useTransition();
  const { catalogue } = setup;
  const screenLabel = useMemo(
    () => new Map(catalogue.screens.map((s) => [s.href, s.label])),
    [catalogue.screens],
  );
  const cardOf = useMemo(() => new Map(catalogue.cards.map((c) => [c.key, c])), [catalogue.cards]);
  const labelOf = (key: string) => ({
    label: key === CLASSES_TAB ? 'Classes' : (screenLabel.get(key) ?? key),
    sub: key === CLASSES_TAB ? 'My sections: homework and marks (for those who teach)' : undefined,
  });
  const cardLabel = (key: string) => cardOf.get(key)?.label ?? key;
  const dirty = !sameStaffLayout(draft, setup.draft);
  const problems = staffLayoutProblems(draft, catalogue);
  const screenOptions = catalogue.screens.map((s) => ({ key: s.href, label: s.label }));
  const set = (part: keyof StaffLayout) => (next: string[]) => {
    setMsg(null);
    setDraft({ ...draft, [part]: next });
  };

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const after = (r: Awaited<ReturnType<typeof saveStaffLayoutDraft>>, ok: string) => {
    if (r.ok) {
      setSetup(r.data);
      setDraft(r.data.draft);
      setMsg({ ok: true, text: ok });
      router.refresh();
      return true;
    }
    setMsg({ ok: false, text: r.error });
    return false;
  };
  const save = () =>
    start(async () => {
      after(await saveStaffLayoutDraft(draft), 'Draft saved. Staff get it when you publish.');
    });
  const publish = () =>
    start(async () => {
      if (dirty && !after(await saveStaffLayoutDraft(draft), 'Draft saved.')) {
        setAsk(null);
        return;
      }
      after(await publishStaffLayout(), 'Published. Staff get this layout on their next refresh.');
      setAsk(null);
    });
  const discard = () =>
    start(async () => {
      after(await discardStaffLayout(), 'Draft discarded: back to what staff have now.');
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
        <span data-testid="sal-published">
          {setup.everPublished
            ? `Published ${when(setup.publishedAt)}${setup.publishedBy ? ` by ${setup.publishedBy}` : ''}.`
            : 'Not published yet — staff have the standard layout (the tabs as the app had them).'}
        </span>
        {setup.changed ? (
          <span data-testid="sal-draft-changed">
            {`Draft changed${setup.draftUpdatedBy ? ` by ${setup.draftUpdatedBy}` : ''} ${when(setup.draftUpdatedAt)}, not yet published.`}
          </span>
        ) : (
          <span className="ep-field__help" style={{ margin: 0 }}>
            The draft is the same as what staff have.
          </span>
        )}
        {dirty ? <strong data-testid="sal-unsaved">You have changes not saved yet.</strong> : null}
      </div>
      {msg ? (
        <p
          className={`ep-alert ${msg.ok ? 'ep-alert--success' : 'ep-alert--danger'}`}
          role={msg.ok ? 'status' : 'alert'}
          data-testid="sal-msg"
        >
          {msg.text}
        </p>
      ) : null}
      {problems.length ? (
        <div className="ep-alert ep-alert--warning" role="status" data-testid="sal-problems">
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
            data-testid="sal-save"
          >
            Save draft
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={
              busy || problems.length > 0 || (!dirty && !setup.changed && setup.everPublished)
            }
            onClick={() => setAsk('publish')}
            data-testid="sal-publish"
          >
            {dirty ? 'Save and publish' : 'Publish'}
          </Button>
          {setup.changed || dirty ? (
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => (setup.changed ? setAsk('discard') : setDraft(setup.draft))}
            >
              {setup.changed ? 'Discard the draft' : 'Undo my changes'}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            disabled={busy || sameStaffLayout(draft, catalogue.defaults)}
            onClick={() => {
              setMsg({
                ok: true,
                text: 'The standard layout is in the editor. Save draft to keep it; publish to give it to staff.',
              });
              setDraft(catalogue.defaults);
            }}
          >
            Start again from the standard layout
          </Button>
        </div>
      ) : null}
      <div
        style={{ display: 'flex', gap: 'var(--sp-5)', flexWrap: 'wrap', alignItems: 'flex-start' }}
      >
        <div style={{ flex: '1 1 28rem', minWidth: 0 }}>
          <OrderedList
            id="sal-tabs"
            title="Bottom tabs"
            help="Home is always first and More always last; choose the three in between. A tab someone cannot open gives its place to the next of the shortcuts."
            items={draft.tabs}
            labelOf={labelOf}
            options={[
              { key: CLASSES_TAB, label: 'Classes (my sections: homework and marks)' },
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
            id="sal-shortcuts"
            title="Home shortcuts"
            help="The tiles on Home, four a row; the app adds an All tile that opens More. A tile someone cannot open is left out for them; each person may pin their own instead."
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
            id="sal-cards"
            title="Home work cards"
            help="The cards under the shortcuts, in this order. A card about a screen someone cannot open is left out for them."
            items={draft.cards}
            labelOf={(k) => ({ label: cardLabel(k), sub: cardOf.get(k)?.labelHi })}
            options={catalogue.cards.map((c) => ({
              key: c.key,
              label: `${c.label} — ${c.labelHi}`,
            }))}
            min={catalogue.limits.cards.min}
            max={catalogue.limits.cards.max}
            addLabel="Add a card"
            canEdit={canEdit}
            onChange={set('cards')}
          />
        </div>
        <div style={{ flex: '0 1 22rem', minWidth: 0 }}>
          <Preview draft={draft} firstName={firstName} labelOf={labelOf} cardLabel={cardLabel} />
        </div>
      </div>
      {ask === 'publish' ? (
        <Dialog
          open
          size="sm"
          title="Publish the staff app layout?"
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
            Staff get this layout on their next refresh.
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
          <p>The draft goes back to what staff have now. Changes not saved yet are lost too.</p>
        </Dialog>
      ) : null}
    </>
  );
}
