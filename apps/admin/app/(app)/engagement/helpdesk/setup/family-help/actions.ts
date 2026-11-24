'use server';
/**
 * Help for families (0406) and Help for staff (0422): the office's edits to the headings and questions on Help. Each
 * form says which Help (`app`), posts here and comes back to its page with ?ok (and the row in view) or ?error. A
 * heading or question is changed, moved and deleted by its id on either Help.
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from '@/lib/api';
import { HELP_APPS, type FamilyHelpSetup, type HelpApp } from '@/lib/family-help';

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const appOf = (fd: FormData): HelpApp => (str(fd, 'app') === 'staff' ? 'staff' : 'family');
const id = (fd: FormData) => {
  const v = str(fd, 'id');
  return /^\d{1,18}$/.test(v) ? v : '';
};
const direction = (fd: FormData) => (str(fd, 'direction') === 'up' ? 'up' : 'down');

function back(fd: FormData, error: unknown): never {
  const PAGE = HELP_APPS[appOf(fd)].page;
  if (error instanceof ApiError) {
    const errs = error.problem.errors as
      Array<{ path?: string; message?: string }> | Record<string, string> | undefined;
    const detail = Array.isArray(errs)
      ? errs.map((e) => [e.path, e.message].filter(Boolean).join(': ')).join('; ')
      : errs && typeof errs === 'object'
        ? Object.values(errs).join('; ')
        : (error.problem.detail ?? '');
    redirect(
      `${PAGE}?error=${encodeURIComponent(error.problem.type)}&detail=${encodeURIComponent(String(detail).slice(0, 300))}`,
    );
  }
  throw error;
}

function done(fd: FormData, detail: string, anchor?: string): never {
  const PAGE = HELP_APPS[appOf(fd)].page;
  revalidatePath(PAGE);
  redirect(`${PAGE}?ok=1&detail=${encodeURIComponent(detail)}${anchor ? `#${anchor}` : ''}`);
}

/** A heading added (no id) or renamed. */
export async function saveHeading(fd: FormData) {
  const hid = id(fd);
  let out: { id?: string } = {};
  try {
    out = await apiFetch<{ id?: string }>(
      hid ? `/helpdesk/family-help/headings/${hid}` : `${HELP_APPS[appOf(fd)].api}/headings`,
      {
        method: hid ? 'PUT' : 'POST',
        body: JSON.stringify({ title: str(fd, 'title'), titleHi: str(fd, 'titleHi') }),
      },
    );
  } catch (error) {
    back(fd, error);
  }
  done(fd, hid ? 'Heading saved.' : 'Heading added.', `h-${hid || out.id || ''}`);
}

export async function deleteHeading(fd: FormData) {
  let moved = 0;
  try {
    moved = (
      await apiFetch<{ questionsMoved: number }>(`/helpdesk/family-help/headings/${id(fd)}`, {
        method: 'DELETE',
      })
    ).questionsMoved;
  } catch (error) {
    back(fd, error);
  }
  done(
    fd,
    moved
      ? `Heading deleted; its ${String(moved)} question(s) are now under Other questions.`
      : 'Heading deleted.',
  );
}

export async function moveHeading(fd: FormData) {
  const hid = id(fd);
  try {
    await apiFetch(`/helpdesk/family-help/headings/${hid}/move`, {
      method: 'POST',
      body: JSON.stringify({ direction: direction(fd) }),
    });
  } catch (error) {
    back(fd, error);
  }
  done(fd, 'Order saved.', `h-${hid}`);
}

/** A question added (no id) or changed: all its fields as the form has them. */
export async function saveQuestion(fd: FormData) {
  const qid = id(fd);
  const headingId = str(fd, 'headingId');
  const body = {
    headingId: /^\d{1,18}$/.test(headingId) ? headingId : null,
    question: str(fd, 'question'),
    questionHi: str(fd, 'questionHi'),
    answer: str(fd, 'answer'),
    answerHi: str(fd, 'answerHi'),
    audience: ['parent', 'student'].includes(str(fd, 'audience')) ? str(fd, 'audience') : 'both',
    page: str(fd, 'page') || null,
    hidden: fd.get('hidden') === 'on',
  };
  let out: { id?: string; countsRestarted?: boolean } = {};
  try {
    out = await apiFetch<{ id?: string; countsRestarted?: boolean }>(
      qid ? `/helpdesk/family-help/questions/${qid}` : `${HELP_APPS[appOf(fd)].api}/questions`,
      { method: qid ? 'PUT' : 'POST', body: JSON.stringify(body) },
    );
  } catch (error) {
    back(fd, error);
  }
  done(
    fd,
    qid
      ? out.countsRestarted
        ? 'Question saved. The answer changed, so its helpful counts start again.'
        : 'Question saved.'
      : 'Question added.',
    `q-${qid || out.id || ''}`,
  );
}

/** Hide a question from families, or show it again (its other fields as they are). */
export async function toggleQuestion(fd: FormData) {
  const qid = id(fd);
  let hidden = false;
  try {
    const s = await apiFetch<FamilyHelpSetup>(HELP_APPS[appOf(fd)].api);
    const q = s.questions.find((x) => x.id === qid);
    if (!q) throw new ApiError(404, { type: 'not-found', detail: 'Question not found' });
    hidden = !q.hidden;
    await apiFetch(`/helpdesk/family-help/questions/${qid}`, {
      method: 'PUT',
      body: JSON.stringify({
        headingId: q.headingId,
        question: q.question,
        questionHi: q.questionHi ?? '',
        answer: q.answer,
        answerHi: q.answerHi ?? '',
        audience: q.audience,
        page: q.page,
        hidden,
      }),
    });
  } catch (error) {
    back(fd, error);
  }
  const readers = HELP_APPS[appOf(fd)].readers;
  done(
    fd,
    hidden ? `Question hidden from ${readers}.` : `Question shown to ${readers}.`,
    `q-${qid}`,
  );
}

export async function deleteQuestion(fd: FormData) {
  try {
    await apiFetch(`/helpdesk/family-help/questions/${id(fd)}`, { method: 'DELETE' });
  } catch (error) {
    back(fd, error);
  }
  done(fd, 'Question deleted.');
}

export async function moveQuestion(fd: FormData) {
  const qid = id(fd);
  try {
    await apiFetch(`/helpdesk/family-help/questions/${qid}/move`, {
      method: 'POST',
      body: JSON.stringify({ direction: direction(fd) }),
    });
  } catch (error) {
    back(fd, error);
  }
  done(fd, 'Order saved.', `q-${qid}`);
}

/** Puts back the standard headings and questions the school deleted. */
export async function restoreStandard(fd: FormData) {
  let out = { headings: 0, questions: 0 };
  try {
    out = await apiFetch<{ headings: number; questions: number }>(
      `${HELP_APPS[appOf(fd)].api}/restore`,
      {
        method: 'POST',
        body: '{}',
      },
    );
  } catch (error) {
    back(fd, error);
  }
  done(
    fd,
    `Put back ${String(out.questions)} standard question(s)${out.headings ? ` and ${String(out.headings)} heading(s)` : ''}.`,
  );
}
