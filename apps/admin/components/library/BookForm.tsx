'use client';
import { FormActions, FormRow, FormSection, InputField, SelectField } from '@edupro/ui';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { matchBooks, saveBook, suggestNames } from '@/lib/library-books-actions';
import { ROLES, type BookSetup, type BookView, type Role } from '@/lib/library-books';
import { CopyFields, copyPayload, emptyCopy, type CopyState } from './CopyFields';

interface Person {
  key: string;
  name: string;
  role: Role;
}
interface TitleState {
  title: string;
  subtitle: string;
  people: Person[];
  materialTypeId: string;
  subjectId: string;
  subSubject: string;
  callNo: string;
  keywords: string;
  classId: string;
  publisher: string;
  publicationPlace: string;
  year: string;
  edition: string;
  volume: string;
  pages: string;
  isbn: string;
  languageId: string;
  price: string;
  isReference: boolean;
  notes: string;
}
type Match = Awaited<ReturnType<typeof matchBooks>>[number];

let seq = 0;
const key = () => `p${String((seq += 1))}`;

function fromView(setup: BookSetup, v?: BookView, clone = false): TitleState {
  const english = setup.languages.find((l) => l.name.toLowerCase() === 'english')?.id ?? '';
  return {
    title: v?.title ?? '',
    subtitle: v?.subtitle ?? '',
    people: v?.people.length
      ? v.people.map((p) => ({ key: key(), name: p.name, role: p.role }))
      : [{ key: key(), name: '', role: 'Author' }],
    materialTypeId: v?.materialTypeId ?? setup.materialTypes[0]?.id ?? '',
    subjectId: v?.subjectId ?? '',
    subSubject: v?.subSubject ?? '',
    callNo: v?.callNo ?? '',
    keywords: v?.keywords.join(', ') ?? '',
    classId: v?.classId ?? '',
    publisher: v?.publisher ?? '',
    publicationPlace: v?.publicationPlace ?? '',
    year: v?.year ? String(v.year) : '',
    edition: v?.edition ?? '',
    volume: v?.volume ?? '',
    pages: v?.pages ? String(v.pages) : '',
    // a clone is another edition or volume: its own ISBN
    isbn: clone ? '' : (v?.isbn ?? ''),
    languageId: v?.languageId ?? english,
    price: v?.price ?? '',
    isReference: v?.isReference ?? false,
    notes: v?.notes ?? '',
  };
}

/** Names from the masters as one types (a datalist), asked a moment after the last key. */
function useNames(kind: 'author' | 'publisher') {
  const [names, setNames] = useState<string[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ask = (q: string) => {
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 2) return;
    timer.current = setTimeout(() => {
      void suggestNames(kind, q.trim()).then(setNames);
    }, 250);
  };
  return [names, ask] as const;
}

/**
 * The book form (docs/design/36-library.md, part 2): a title entered once with its people in order
 * (authors, editors, translators, illustrators; a new name joins the Authors master), its material,
 * subject and call number, its publication, and for a new book its first copies. A title already in the
 * catalogue (the same ISBN or title) is shown before it is entered twice. Edit changes the title only;
 * clone starts a new title from this one (another edition or volume).
 */
export function BookForm({
  setup,
  initial,
  mode,
}: {
  setup: BookSetup;
  initial?: BookView;
  mode: 'new' | 'edit' | 'clone';
}) {
  const router = useRouter();
  const [t, setT] = useState<TitleState>(() => fromView(setup, initial, mode === 'clone'));
  const [withCopies, setWithCopies] = useState(mode !== 'edit');
  const [copy, setCopy] = useState<CopyState>(() => emptyCopy(setup));
  const [error, setError] = useState<string | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [pending, start] = useTransition();
  const [authors, askAuthors] = useNames('author');
  const [publishers, askPublishers] = useNames('publisher');
  const top = useRef<HTMLDivElement>(null);
  const set = (patch: Partial<TitleState>) => setT((x) => ({ ...x, ...patch }));
  const subject = setup.subjects.find((s) => s.id === t.subjectId);
  const material = setup.materialTypes.find((m) => m.id === t.materialTypeId);

  const check = () => {
    if (mode === 'edit' || (!t.isbn.trim() && t.title.trim().length < 3)) return;
    void matchBooks({ isbn: t.isbn.trim() || undefined, title: t.title.trim() || undefined }).then(
      setMatches,
    );
  };
  const setPerson = (k: string, patch: Partial<Person>) =>
    set({ people: t.people.map((p) => (p.key === k ? { ...p, ...patch } : p)) });
  const movePerson = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= t.people.length) return;
    const next = [...t.people];
    [next[i], next[j]] = [next[j]!, next[i]!];
    set({ people: next });
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const num = (s: string) => (s.trim() ? Number(s) : undefined);
    const body: Record<string, unknown> = {
      title: t.title.trim(),
      subtitle: t.subtitle.trim() || undefined,
      people: t.people
        .filter((p) => p.name.trim())
        .map((p) => ({ name: p.name.trim(), role: p.role })),
      materialTypeId: t.materialTypeId,
      subjectId: t.subjectId || undefined,
      subSubject: t.subSubject || undefined,
      callNo: t.callNo.trim() || undefined,
      keywords: t.keywords
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean),
      classId: t.classId || undefined,
      publisher: t.publisher.trim() || undefined,
      publicationPlace: t.publicationPlace.trim() || undefined,
      year: num(t.year),
      edition: t.edition.trim() || undefined,
      volume: t.volume.trim() || undefined,
      pages: num(t.pages),
      isbn: t.isbn.trim() || undefined,
      languageId: t.languageId || undefined,
      price: num(t.price),
      isReference: t.isReference,
      notes: t.notes.trim() || undefined,
    };
    if (mode !== 'edit' && withCopies) body.copies = copyPayload(copy, 'new');
    start(async () => {
      const r = await saveBook(body, mode === 'edit' ? initial?.id : undefined);
      if (!r.ok) {
        setError(r.error);
        top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      const detail =
        mode === 'edit'
          ? 'Saved: every copy shows the change.'
          : r.accessionNos.length
            ? `Added with ${String(r.accessionNos.length)} cop${r.accessionNos.length > 1 ? 'ies' : 'y'}: ${r.accessionNos.join(', ')}.`
            : 'Added. Add its copies below.';
      router.push(`/library/books/${r.id}?ok=1&detail=${encodeURIComponent(detail)}`);
    });
  };

  return (
    <form onSubmit={submit} noValidate={false}>
      <div ref={top} />
      {error ? (
        <p className="ep-alert ep-alert--danger" role="alert">
          <span>Not saved. {error}</span>
        </p>
      ) : null}
      {matches.length ? (
        <div
          className="ep-alert ep-alert--warning"
          role="status"
          style={{ marginBottom: 'var(--sp-4)' }}
        >
          <div>
            <strong>Already in the catalogue</strong>
            <ul style={{ margin: 'var(--sp-1) 0 0', paddingLeft: 'var(--sp-4)' }}>
              {matches.map((m) => (
                <li key={m.id}>
                  <a href={`/library/books/${m.id}`}>{m.title}</a>
                  {[m.author, m.edition ? `${m.edition} edition` : null, m.year]
                    .filter(Boolean)
                    .map((x) => ` · ${String(x)}`)
                    .join('')}{' '}
                  · {m.copies} cop{m.copies === 1 ? 'y' : 'ies'} (
                  {m.by === 'isbn' ? 'same ISBN' : 'same title'}). Add copies there instead, unless
                  this is another edition or volume.
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      <FormSection title="The book">
        <FormRow columns={2}>
          <InputField
            id="bk-title"
            label="Title"
            required
            maxLength={250}
            value={t.title}
            onChange={(e) => set({ title: e.target.value })}
            onBlur={check}
          />
          <InputField
            id="bk-subtitle"
            label="Subtitle"
            maxLength={250}
            value={t.subtitle}
            onChange={(e) => set({ subtitle: e.target.value })}
          />
        </FormRow>
        <FormRow columns={3}>
          <SelectField
            id="bk-material"
            label="Material type"
            required
            value={t.materialTypeId}
            onChange={(e) => set({ materialTypeId: e.target.value })}
            options={setup.materialTypes.map((m) => ({
              value: m.id,
              label: `${m.name}${m.issuable ? '' : ' (not issued)'}`,
            }))}
          />
          <SelectField
            id="bk-subject"
            label="Subject"
            value={t.subjectId}
            onChange={(e) => {
              const s = setup.subjects.find((x) => x.id === e.target.value);
              set({
                subjectId: e.target.value,
                subSubject: '',
                callNo: t.callNo || s?.classNo || '',
              });
            }}
            options={[
              { value: '', label: setup.subjects.length ? '—' : 'Add subjects in Library setup' },
              ...setup.subjects.map((s) => ({
                value: s.id,
                label: `${s.name}${s.classNo ? ` (${s.classNo})` : ''}`,
              })),
            ]}
          />
          {subject?.subSubjects.length ? (
            <SelectField
              id="bk-sub"
              label="Sub-subject"
              value={t.subSubject}
              onChange={(e) => set({ subSubject: e.target.value })}
              options={[
                { value: '', label: '—' },
                ...subject.subSubjects.map((x) => ({ value: x, label: x })),
              ]}
            />
          ) : (
            <InputField
              id="bk-sub"
              label="Sub-subject"
              disabled
              value=""
              help="The subject has none"
            />
          )}
        </FormRow>
        <FormRow columns={3}>
          <InputField
            id="bk-call"
            label="Call number"
            maxLength={40}
            value={t.callNo}
            onChange={(e) => set({ callNo: e.target.value })}
            help="Dewey class and the author mark, e.g. 823 NAR"
          />
          <SelectField
            id="bk-class"
            label="For class"
            value={t.classId}
            onChange={(e) => set({ classId: e.target.value })}
            options={[
              { value: '', label: '—' },
              ...setup.classes.map((c) => ({ value: c.id, label: c.name })),
            ]}
            help="Textbooks: the class they are for"
          />
          <InputField
            id="bk-keywords"
            label="Keywords"
            maxLength={500}
            value={t.keywords}
            onChange={(e) => set({ keywords: e.target.value })}
            help="Comma separated; the search finds them"
          />
        </FormRow>
      </FormSection>

      <FormSection
        title="Authors and others"
        description="In the order printed on the title page. A name not yet in Library setup → Authors is added there."
      >
        <datalist id="bk-author-names">
          {authors.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
        {t.people.map((p, i) => (
          <div key={p.key} className="ep-book__person">
            <InputField
              id={`bk-person-${p.key}`}
              label={`Name ${String(i + 1)}`}
              list="bk-author-names"
              autoComplete="off"
              maxLength={120}
              value={p.name}
              onChange={(e) => {
                setPerson(p.key, { name: e.target.value });
                askAuthors(e.target.value);
              }}
            />
            <SelectField
              id={`bk-role-${p.key}`}
              label="As"
              value={p.role}
              onChange={(e) => setPerson(p.key, { role: e.target.value as Role })}
              options={ROLES.map((r) => ({ value: r, label: r }))}
            />
            <span className="ep-book__moves">
              <button
                type="button"
                className="ep-btn ep-btn--ghost ep-btn--sm"
                aria-label={`Move name ${String(i + 1)} up`}
                disabled={i === 0}
                onClick={() => movePerson(i, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                className="ep-btn ep-btn--ghost ep-btn--sm"
                aria-label={`Remove name ${String(i + 1)}`}
                onClick={() => set({ people: t.people.filter((x) => x.key !== p.key) })}
              >
                ×
              </button>
            </span>
          </div>
        ))}
        <div>
          <button
            type="button"
            className="ep-btn ep-btn--ghost ep-btn--sm"
            disabled={t.people.length >= 20}
            onClick={() => set({ people: [...t.people, { key: key(), name: '', role: 'Author' }] })}
          >
            + Add a name
          </button>
        </div>
      </FormSection>

      <FormSection title="Publication">
        <datalist id="bk-publisher-names">
          {publishers.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
        <FormRow columns={3}>
          <InputField
            id="bk-publisher"
            label="Publisher"
            list="bk-publisher-names"
            autoComplete="off"
            maxLength={120}
            value={t.publisher}
            onChange={(e) => {
              set({ publisher: e.target.value });
              askPublishers(e.target.value);
            }}
            help="A new name is added to Library setup → Publishers"
          />
          <InputField
            id="bk-place"
            label="Place of publication"
            maxLength={80}
            value={t.publicationPlace}
            onChange={(e) => set({ publicationPlace: e.target.value })}
          />
          <InputField
            id="bk-year"
            label="Year"
            type="number"
            min={1500}
            max={new Date().getFullYear() + 1}
            value={t.year}
            onChange={(e) => set({ year: e.target.value })}
          />
        </FormRow>
        <FormRow columns={4}>
          <InputField
            id="bk-edition"
            label="Edition"
            maxLength={40}
            value={t.edition}
            onChange={(e) => set({ edition: e.target.value })}
          />
          <InputField
            id="bk-volume"
            label="Volume"
            maxLength={40}
            value={t.volume}
            onChange={(e) => set({ volume: e.target.value })}
          />
          <InputField
            id="bk-pages"
            label="Pages"
            type="number"
            min={1}
            max={20000}
            value={t.pages}
            onChange={(e) => set({ pages: e.target.value })}
          />
          <InputField
            id="bk-isbn"
            label="ISBN"
            maxLength={20}
            pattern="[0-9Xx\s\-]{10,17}"
            value={t.isbn}
            onChange={(e) => set({ isbn: e.target.value })}
            onBlur={check}
            help="10 or 13 digits; hyphens allowed"
          />
        </FormRow>
        <FormRow columns={3}>
          <SelectField
            id="bk-language"
            label="Language"
            value={t.languageId}
            onChange={(e) => set({ languageId: e.target.value })}
            options={[
              { value: '', label: '—' },
              ...setup.languages.map((l) => ({ value: l.id, label: l.name })),
            ]}
          />
          <InputField
            id="bk-price"
            label="Price (₹)"
            type="number"
            min={0}
            step="0.01"
            value={t.price}
            onChange={(e) => set({ price: e.target.value })}
            help="As printed; each copy may have its own"
          />
          <label className="ep-check" htmlFor="bk-ref" style={{ alignSelf: 'end' }}>
            <input
              id="bk-ref"
              type="checkbox"
              checked={t.isReference || (material ? !material.issuable : false)}
              disabled={material ? !material.issuable : false}
              onChange={(e) => set({ isReference: e.target.checked })}
            />{' '}
            Reference only: read in the library, not issued
          </label>
        </FormRow>
        <InputField
          id="bk-notes"
          label="Notes"
          maxLength={1000}
          value={t.notes}
          onChange={(e) => set({ notes: e.target.value })}
        />
      </FormSection>

      {mode !== 'edit' ? (
        <FormSection
          title="Copies"
          description="Each copy gets its accession number; one title can have many copies in several libraries."
        >
          <label className="ep-check" htmlFor="bk-with-copies">
            <input
              id="bk-with-copies"
              type="checkbox"
              checked={withCopies}
              onChange={(e) => setWithCopies(e.target.checked)}
            />{' '}
            Add copies now
          </label>
          {withCopies ? (
            <CopyFields
              setup={setup}
              value={copy}
              onChange={setCopy}
              mode="new"
              materialTypeId={t.materialTypeId}
              idPrefix="bk-copy"
            />
          ) : null}
        </FormSection>
      ) : null}

      <FormActions sticky>
        <button type="submit" className="ep-btn ep-btn--primary" disabled={pending}>
          {pending ? 'Saving…' : mode === 'edit' ? 'Save the changes' : 'Add the book'}
        </button>
        <a
          className="ep-btn ep-btn--ghost"
          href={mode === 'edit' && initial ? `/library/books/${initial.id}` : '/library'}
        >
          Cancel
        </a>
      </FormActions>
    </form>
  );
}
