'use server';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';

const str = (fd: FormData, key: string): string => String(fd.get(key) ?? '').trim();

function fail(back: string, error: unknown): never {
  if (error instanceof ApiError) {
    const errs = error.problem.errors as Array<{ message?: string }> | undefined;
    const detail = Array.isArray(errs)
      ? errs
          .map((e) => e.message)
          .filter(Boolean)
          .join('; ')
      : typeof error.problem.detail === 'string'
        ? error.problem.detail
        : '';
    redirect(
      `${back}${back.includes('?') ? '&' : '?'}error=${encodeURIComponent(error.problem.type)}&detail=${encodeURIComponent(detail.slice(0, 200))}`,
    );
  }
  throw error;
}

/** A parent adds a visitor to the child's list (with a small photo); a warden approves. */
export async function addVisitor(fd: FormData) {
  const studentId = str(fd, 'studentId');
  const back = `/hostel?student=${encodeURIComponent(studentId)}`;
  let photo: string | undefined;
  const file = fd.get('photo');
  if (file instanceof File && file.size) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 300_000)
      redirect(
        `${back}&error=validation-failed&detail=${encodeURIComponent('Choose a JPEG or PNG photo under 300 KB')}`,
      );
    photo = `data:${file.type};base64,${Buffer.from(await file.arrayBuffer()).toString('base64')}`;
  }
  try {
    await bff.api.fetch('/hostel/mine/visitors', {
      method: 'POST',
      body: JSON.stringify({
        studentId,
        name: str(fd, 'name'),
        relation: str(fd, 'relation'),
        mobile: str(fd, 'mobile'),
        photo,
      }),
    });
  } catch (error) {
    fail(back, error);
  }
  redirect(`${back}&ok=added`);
}

export async function removeVisitor(fd: FormData) {
  const back = `/hostel?student=${encodeURIComponent(str(fd, 'studentId'))}`;
  try {
    await bff.api.fetch(`/hostel/mine/visitors/${str(fd, 'id')}`, { method: 'DELETE' });
  } catch (error) {
    fail(back, error);
  }
  redirect(`${back}&ok=removed`);
}

/** A parent's complaint about the child's room; it goes to the head warden. */
export async function raiseComplaint(fd: FormData) {
  const studentId = str(fd, 'studentId');
  const back = `/hostel?student=${encodeURIComponent(studentId)}`;
  try {
    await bff.api.fetch('/hostel/mine/complaints', {
      method: 'POST',
      body: JSON.stringify({
        studentId,
        categoryCode: str(fd, 'categoryCode'),
        subject: str(fd, 'subject'),
        body: str(fd, 'body'),
      }),
    });
  } catch (error) {
    fail(back, error);
  }
  redirect(`${back}&ok=complaint`);
}

/** The family rates a meal the child had (1 to 5, with a comment); a later rating replaces it. */
export async function rateMeal(fd: FormData) {
  const studentId = str(fd, 'studentId');
  const back = `/hostel?student=${encodeURIComponent(studentId)}`;
  try {
    await bff.api.fetch('/hostel/mine/feedback', {
      method: 'POST',
      body: JSON.stringify({
        studentId,
        mealId: str(fd, 'mealId'),
        onDate: str(fd, 'onDate'),
        rating: Number(str(fd, 'rating')),
        comment: str(fd, 'comment'),
      }),
    });
  } catch (error) {
    fail(back, error);
  }
  redirect(`${back}&ok=rated`);
}

/** A parent asks for the child to leave the hostel; the hostel office starts it or answers. */
export async function askHostelExit(fd: FormData) {
  const studentId = str(fd, 'studentId');
  const back = `/hostel?student=${encodeURIComponent(studentId)}`;
  try {
    await bff.api.fetch('/hostel/mine/exit', {
      method: 'POST',
      body: JSON.stringify({
        studentId,
        leavingOn: str(fd, 'leavingOn'),
        reason: str(fd, 'reason') || 'parent_request',
        note: str(fd, 'note') || undefined,
      }),
    });
  } catch (error) {
    fail(back, error);
  }
  redirect(`${back}&ok=exit`);
}

/** The parent takes back a request the office has not acted on. */
export async function withdrawHostelExit(fd: FormData) {
  const studentId = str(fd, 'studentId');
  const back = `/hostel?student=${encodeURIComponent(studentId)}`;
  try {
    await bff.api.fetch(`/hostel/mine/exit/${str(fd, 'id')}/withdraw`, {
      method: 'POST',
      body: '{}',
    });
  } catch (error) {
    fail(back, error);
  }
  redirect(`${back}&ok=exit-withdrawn`);
}
