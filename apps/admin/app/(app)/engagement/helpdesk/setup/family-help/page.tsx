import { Badge, Breadcrumbs, Button, KpiTile, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { ConfirmAction } from '@/components/ConfirmAction';
import { FoldCard } from '@/components/FoldCard';
import { Notice } from '@/components/Notice';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import {
  AUDIENCE_LABEL,
  needsALook,
  type FamilyHelpHeading,
  type FamilyHelpQuestion,
  type FamilyHelpSetup,
} from '@/lib/family-help';
import {
  deleteHeading,
  deleteQuestion,
  moveHeading,
  moveQuestion,
  restoreStandard,
  saveHeading,
  saveQuestion,
  toggleQuestion,
} from './actions';

/**
 * Help for families (Helpdesk set-up, 0406): the headings and questions parents and students see on Help, in the
 * app and on the website — in the school's order, each for parents, students or both, shown or hidden, with the
 * screen it is about and how often families found it helpful; the standard questions can be put back.
 */
export default async function FamilyHelpPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('helpdesk.settings.manage')) notFound();
  let s: FamilyHelpSetup;
  try {
    s = await apiFetch<FamilyHelpSetup>('/helpdesk/family-help');
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) notFound();
    throw e;
  }
  const pageLabel = new Map(s.pages.map((p) => [p.href, p.label]));
  const groups: Array<{ heading: FamilyHelpHeading | null; questions: FamilyHelpQuestion[] }> = [
    ...s.headings.map((h) => ({
      heading: h,
      questions: s.questions.filter((q) => q.headingId === h.id),
    })),
    { heading: null, questions: s.questions.filter((q) => q.headingId === null) },
  ];
  const shown = s.questions.filter((q) => !q.hidden).length;
  const yes = s.questions.reduce((n, q) => n + q.yes, 0);
  const no = s.questions.reduce((n, q) => n + q.no, 0);
  const toLook = s.questions.filter(needsALook);
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Helpdesk set-up', href: '/engagement/helpdesk/setup' },
          { label: 'Help for families' },
        ]}
      />
      <PageHeader
        kicker="Helpdesk"
        title="Help for families"
        description="The questions and answers parents and students see on Help, in the app and on the website. Each heading folds on their Help page; a question about a screen someone cannot open is left out for them."
        actions={
          s.standardMissing > 0 ? (
            <ConfirmAction
              action={restoreStandard}
              fields={{}}
              label={`Restore the standard questions (${String(s.standardMissing)})`}
              title="Restore the standard questions?"
              confirmLabel="Restore"
              variant="ghost"
            >
              <p>
                {`${String(s.standardMissing)} standard heading(s) or question(s) were deleted. They come back at the end of their heading, shown to families; the questions you changed or added stay as they are.`}
              </p>
            </ConfirmAction>
          ) : null
        }
      />
      <Notice params={sp} />
      <div className="ep-dash-kpis">
        <KpiTile label="Headings" value={String(s.headings.length)} />
        <KpiTile label="Questions" value={String(s.questions.length)} />
        <KpiTile label="Shown to families" value={String(shown)} />
        <KpiTile label="Hidden" value={String(s.questions.length - shown)} />
        <KpiTile label="Helpful" value={String(yes)} />
        <KpiTile label="Not helpful" value={String(no)} />
      </div>
      {toLook.length ? (
        <div className="ep-alert ep-alert--warning" role="status">
          <div>
            <strong>To look at</strong>
            <p style={{ margin: 'var(--sp-1) 0 0' }}>
              More families said these answers did not help than that they did:
            </p>
            <ul style={{ margin: 'var(--sp-2) 0 0' }}>
              {toLook.map((q) => (
                <li key={q.id}>
                  <a href={`#q-${q.id}`}>{q.question}</a>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
      <div className="ep-grid-2" style={{ marginBottom: 'var(--sp-4)' }}>
        <FoldCard
          id="fh-add-question"
          title="Add a question"
          hint="A question and its answer, under a heading, for parents, students or both"
        >
          <QuestionForm idPrefix="new" setup={s} />
        </FoldCard>
        <FoldCard id="fh-add-heading" title="Add a heading" hint="A heading folds on the Help page">
          <HeadingForm idPrefix="new" />
        </FoldCard>
      </div>
      {groups.map(({ heading, questions }, gi) =>
        heading === null && questions.length === 0 ? null : (
          <section
            key={heading?.id ?? 'other'}
            id={heading ? `h-${heading.id}` : 'h-other'}
            className="ep-card"
            aria-labelledby={heading ? `ht-${heading.id}` : 'ht-other'}
            style={{ marginBottom: 'var(--sp-4)' }}
          >
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 'var(--sp-3)',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <h2
                  id={heading ? `ht-${heading.id}` : 'ht-other'}
                  className="ep-card__title"
                  style={{ marginBottom: 0 }}
                >
                  {heading ? heading.title : 'Other questions'}
                </h2>
                {heading?.titleHi ? (
                  <p lang="hi" className="ep-field__help" style={{ margin: 0 }}>
                    {heading.titleHi}
                  </p>
                ) : null}
                <p className="ep-field__help" style={{ margin: 'var(--sp-1) 0 0' }}>
                  {heading
                    ? `${String(questions.length)} question(s)${heading.standard ? ' · standard heading' : ''}`
                    : 'Questions with no heading; families see them last.'}
                </p>
              </div>
              {heading ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-2)' }}>
                  <MoveButtons
                    action={moveHeading}
                    id={heading.id}
                    what={heading.title}
                    first={gi === 0}
                    last={gi === s.headings.length - 1}
                  />
                  <details>
                    <summary
                      className="ep-btn ep-btn--secondary ep-btn--sm"
                      aria-label={`Edit the heading ${heading.title}`}
                    >
                      Edit
                    </summary>
                    <div style={{ marginTop: 'var(--sp-3)' }}>
                      <HeadingForm idPrefix={`h${heading.id}`} heading={heading} />
                    </div>
                  </details>
                  <ConfirmAction
                    action={deleteHeading}
                    fields={{ id: heading.id }}
                    label="Delete"
                    title={`Delete the heading “${heading.title}”?`}
                    confirmLabel="Delete the heading"
                    confirmVariant="danger"
                    variant="ghost"
                  >
                    <p>
                      {questions.length
                        ? `Its ${String(questions.length)} question(s) move to Other questions; nothing else is deleted.`
                        : 'It has no questions.'}
                    </p>
                  </ConfirmAction>
                </div>
              ) : null}
            </div>
            {questions.length ? (
              <ol style={{ listStyle: 'none', margin: 'var(--sp-3) 0 0', padding: 0 }}>
                {questions.map((q, i) => (
                  <QuestionRow
                    key={q.id}
                    q={q}
                    setup={s}
                    screen={q.page ? (pageLabel.get(q.page) ?? q.page) : null}
                    first={i === 0}
                    last={i === questions.length - 1}
                  />
                ))}
              </ol>
            ) : (
              <p className="ep-field__help">
                No questions under this heading yet: add one with Add a question.
              </p>
            )}
          </section>
        ),
      )}
    </>
  );
}

function MoveButtons({
  action,
  id,
  what,
  first,
  last,
}: {
  action: (fd: FormData) => Promise<void>;
  id: string;
  what: string;
  first: boolean;
  last: boolean;
}) {
  return (
    <>
      <form action={action} style={{ display: 'inline' }}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="direction" value="up" />
        <Button
          type="submit"
          variant="ghost"
          size="sm"
          disabled={first}
          aria-label={`Move up: ${what}`}
        >
          Move up
        </Button>
      </form>
      <form action={action} style={{ display: 'inline' }}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="direction" value="down" />
        <Button
          type="submit"
          variant="ghost"
          size="sm"
          disabled={last}
          aria-label={`Move down: ${what}`}
        >
          Move down
        </Button>
      </form>
    </>
  );
}

function QuestionRow({
  q,
  setup,
  screen,
  first,
  last,
}: {
  q: FamilyHelpQuestion;
  setup: FamilyHelpSetup;
  screen: string | null;
  first: boolean;
  last: boolean;
}) {
  return (
    <li
      id={`q-${q.id}`}
      style={{
        borderTop: first ? 'none' : '1px solid var(--border-subtle)',
        padding: 'var(--sp-3) 0',
      }}
    >
      <div>
        <strong>{q.question}</strong>
        {q.questionHi ? (
          <div lang="hi" className="ep-field__help" style={{ margin: 0 }}>
            {q.questionHi}
          </div>
        ) : null}
      </div>
      <p style={{ margin: 'var(--sp-1) 0', whiteSpace: 'pre-wrap' }}>{q.answer}</p>
      {q.answerHi ? (
        <p
          lang="hi"
          className="ep-field__help"
          style={{ margin: '0 0 var(--sp-1)', whiteSpace: 'pre-wrap' }}
        >
          {q.answerHi}
        </p>
      ) : null}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-2)', alignItems: 'center' }}>
        <Badge tone="neutral">{AUDIENCE_LABEL[q.audience]}</Badge>
        {screen ? <Badge tone="info">{`Screen: ${screen}`}</Badge> : null}
        {q.hidden ? <Badge tone="warning">Hidden</Badge> : null}
        {q.standard ? <Badge tone="neutral">Standard</Badge> : null}
        {needsALook(q) ? <Badge tone="danger">Needs a look</Badge> : null}
        <span className="ep-field__help" style={{ margin: 0 }}>
          {`Helpful: ${String(q.yes)} · Not helpful: ${String(q.no)}`}
        </span>
      </div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 'var(--sp-2)',
          alignItems: 'flex-start',
          marginTop: 'var(--sp-2)',
        }}
      >
        <MoveButtons action={moveQuestion} id={q.id} what={q.question} first={first} last={last} />
        <details>
          <summary
            className="ep-btn ep-btn--secondary ep-btn--sm"
            aria-label={`Edit: ${q.question}`}
          >
            Edit
          </summary>
          <div style={{ marginTop: 'var(--sp-3)' }}>
            <QuestionForm idPrefix={`q${q.id}`} setup={setup} q={q} />
          </div>
        </details>
        <form action={toggleQuestion} style={{ display: 'inline' }}>
          <input type="hidden" name="id" value={q.id} />
          <Button
            type="submit"
            variant="ghost"
            size="sm"
            aria-label={`${q.hidden ? 'Show to families' : 'Hide from families'}: ${q.question}`}
          >
            {q.hidden ? 'Show' : 'Hide'}
          </Button>
        </form>
        <ConfirmAction
          action={deleteQuestion}
          fields={{ id: q.id }}
          label="Delete"
          title="Delete this question?"
          confirmLabel="Delete the question"
          confirmVariant="danger"
          variant="ghost"
        >
          <p>{`“${q.question}” goes from Help for everyone.${q.standard ? ' Restore the standard questions brings it back as it first was.' : ''}`}</p>
        </ConfirmAction>
      </div>
    </li>
  );
}

function HeadingForm({ idPrefix, heading }: { idPrefix: string; heading?: FamilyHelpHeading }) {
  return (
    <form action={saveHeading}>
      {heading ? <input type="hidden" name="id" value={heading.id} /> : null}
      <div className="ep-field">
        <label className="ep-field__label" htmlFor={`${idPrefix}-title`} data-required="true">
          Heading
        </label>
        <input
          id={`${idPrefix}-title`}
          name="title"
          className="ep-input"
          required
          maxLength={80}
          defaultValue={heading?.title ?? ''}
        />
      </div>
      <div className="ep-field">
        <label className="ep-field__label" htmlFor={`${idPrefix}-titleHi`}>
          Heading in Hindi (optional)
        </label>
        <input
          id={`${idPrefix}-titleHi`}
          name="titleHi"
          className="ep-input"
          lang="hi"
          maxLength={80}
          defaultValue={heading?.titleHi ?? ''}
          aria-describedby={`${idPrefix}-titleHi-help`}
        />
        <div className="ep-field__help" id={`${idPrefix}-titleHi-help`}>
          Left empty, the English shows in Hindi too.
        </div>
      </div>
      <div className="ep-form-actions">
        <Button type="submit" size="sm">
          {heading ? 'Save the heading' : 'Add the heading'}
        </Button>
      </div>
    </form>
  );
}

function QuestionForm({
  idPrefix,
  setup,
  q,
}: {
  idPrefix: string;
  setup: FamilyHelpSetup;
  q?: FamilyHelpQuestion;
}) {
  const f = (k: string) => `${idPrefix}-${k}`;
  return (
    <form action={saveQuestion}>
      {q ? <input type="hidden" name="id" value={q.id} /> : null}
      <div className="ep-field">
        <label className="ep-field__label" htmlFor={f('heading')}>
          Heading
        </label>
        <select
          id={f('heading')}
          name="headingId"
          className="ep-select"
          defaultValue={q ? (q.headingId ?? '') : (setup.headings[0]?.id ?? '')}
        >
          {setup.headings.map((h) => (
            <option key={h.id} value={h.id}>
              {h.title}
            </option>
          ))}
          <option value="">Other questions (no heading)</option>
        </select>
      </div>
      <div className="ep-field">
        <label className="ep-field__label" htmlFor={f('question')} data-required="true">
          Question
        </label>
        <input
          id={f('question')}
          name="question"
          className="ep-input"
          required
          minLength={3}
          maxLength={200}
          defaultValue={q?.question ?? ''}
        />
      </div>
      <div className="ep-field">
        <label className="ep-field__label" htmlFor={f('questionHi')}>
          Question in Hindi (optional)
        </label>
        <input
          id={f('questionHi')}
          name="questionHi"
          className="ep-input"
          lang="hi"
          maxLength={200}
          defaultValue={q?.questionHi ?? ''}
        />
      </div>
      <div className="ep-field">
        <label className="ep-field__label" htmlFor={f('answer')} data-required="true">
          Answer
        </label>
        <textarea
          id={f('answer')}
          name="answer"
          className="ep-input"
          required
          minLength={3}
          maxLength={2000}
          rows={4}
          defaultValue={q?.answer ?? ''}
          aria-describedby={f('answer-help')}
        />
        <div className="ep-field__help" id={f('answer-help')}>
          Plain text; a new line starts a new line. Changing the answer starts the helpful counts
          again.
        </div>
      </div>
      <div className="ep-field">
        <label className="ep-field__label" htmlFor={f('answerHi')}>
          Answer in Hindi (optional)
        </label>
        <textarea
          id={f('answerHi')}
          name="answerHi"
          className="ep-input"
          lang="hi"
          maxLength={2000}
          rows={3}
          defaultValue={q?.answerHi ?? ''}
          aria-describedby={f('answerHi-help')}
        />
        <div className="ep-field__help" id={f('answerHi-help')}>
          Left empty, families reading in Hindi see the English.
        </div>
      </div>
      <fieldset className="ep-radio-group" data-inline="true">
        <legend className="ep-field__label">For</legend>
        {(['both', 'parent', 'student'] as const).map((a) => (
          <label key={a} className="ep-radio" htmlFor={f(`aud-${a}`)}>
            <input
              id={f(`aud-${a}`)}
              type="radio"
              className="ep-radio__input"
              name="audience"
              value={a}
              defaultChecked={(q?.audience ?? 'both') === a}
            />
            <span className="ep-radio__dot" aria-hidden="true" />
            <span className="ep-check__text">{AUDIENCE_LABEL[a]}</span>
          </label>
        ))}
      </fieldset>
      <div className="ep-field">
        <label className="ep-field__label" htmlFor={f('page')}>
          Screen it is about
        </label>
        <select
          id={f('page')}
          name="page"
          className="ep-select"
          defaultValue={q?.page ?? ''}
          aria-describedby={f('page-help')}
        >
          <option value="">None</option>
          {setup.pages.map((p) => (
            <option key={p.href} value={p.href}>
              {p.label}
            </option>
          ))}
        </select>
        <div className="ep-field__help" id={f('page-help')}>
          Families get a button that opens it; a person who cannot open that screen does not see the
          question.
        </div>
      </div>
      <label className="ep-check" htmlFor={f('hidden')}>
        <input
          id={f('hidden')}
          type="checkbox"
          name="hidden"
          className="ep-check__input"
          defaultChecked={q?.hidden ?? false}
        />
        <span className="ep-check__box" aria-hidden="true" />
        <span className="ep-check__text">Hidden from families (kept here to show later)</span>
      </label>
      <div className="ep-form-actions">
        <Button type="submit" size="sm">
          {q ? 'Save the question' : 'Add the question'}
        </Button>
      </div>
    </form>
  );
}
