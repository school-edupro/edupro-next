'use server';
/**
 * Help for families (0406): the office's edits to the headings and questions parents and students see on Help.
 * Each form posts here and comes back to the page with ?ok (and the row in view) or ?error.
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from '@/lib/api';
import type { FamilyHelpSetup } from '@/lib/family-help';

const PAGE = '/engagement/helpdesk/setup/family-help';
const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const id = (fd: FormData) => {
  const v = str(fd, 'id');
  return /^\d{1,18}$/.test(v) ? v : '';
};
const direction = (fd: FormData) => (str(fd, 'direction') === 'up' ? 'up' : 'down');

function back(error: unknown): never {
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

function done(detail: string, anchor?: string): never {
  revalidatePath(PAGE);
  redirect(`${PAGE}?ok=1&detail=${encodeURIComponent(detail)}${anchor ? `#${anchor}` : ''}`);
}

/** A heading added (no id) or renamed. */
export async function saveHeading(fd: FormData) {
  const hid = id(fd);
  let out: { id?: string } = {};
  try {
    out = await apiFetch<{ id?: string }>(
      hid ? `/helpdesk/family-help/headings/${hid}` : '/helpdesk/family-help/headings',
      {
        method: hid ? 'PUT' : 'POST',
        body: JSON.stringify({ title: str(fd, 'title'), titleHi: str(fd, 'titleHi') }),
      },
    );
  } catch (error) {
    back(error);
  }
  done(hid ? 'Heading saved.' : 'Heading added.', `h-${hid || out.id || ''}`);
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
    back(error);
  }
  done(
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
    back(error);
  }
  done('Order saved.', `h-${hid}`);
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
      qid ? `/helpdesk/family-help/questions/${qid}` : '/helpdesk/family-help/questions',
      { method: qid ? 'PUT' : 'POST', body: JSON.stringify(body) },
    );
  } catch (error) {
    back(error);
  }
  done(
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
    const s = await apiFetch<FamilyHelpSetup>('/helpdesk/family-help');
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
    back(error);
  }
  done(hidden ? 'Question hidden from families.' : 'Question shown to families.', `q-${qid}`);
}

export async function deleteQuestion(fd: FormData) {
  try {
    await apiFetch(`/helpdesk/family-help/questions/${id(fd)}`, { method: 'DELETE' });
  } catch (error) {
    back(error);
  }
  done('Question deleted.');
}

export async function moveQuestion(fd: FormData) {
  const qid = id(fd);
  try {
    await apiFetch(`/helpdesk/family-help/questions/${qid}/move`, {
      method: 'POST',
      body: JSON.stringify({ direction: direction(fd) }),
    });
  } catch (error) {
    back(error);
  }
  done('Order saved.', `q-${qid}`);
}

/** Puts back the standard headings and questions the school deleted. */
export async function restoreStandard() {
  let out = { headings: 0, questions: 0 };
  try {
    out = await apiFetch<{ headings: number; questions: number }>('/helpdesk/family-help/restore', {
      method: 'POST',
      body: '{}',
    });
  } catch (error) {
    back(error);
  }
  done(
    `Put back ${String(out.questions)} standard question(s)${out.headings ? ` and ${String(out.headings)} heading(s)` : ''}.`,
  );
}
