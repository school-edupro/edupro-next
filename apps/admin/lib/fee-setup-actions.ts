'use server';
/** Fee set-up, second pass (0098): head printing, class rules, payment modes, a pupil's discounts. */
import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from './api';

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const num = (fd: FormData, k: string): number | null => {
  const v = str(fd, k);
  return v === '' || Number.isNaN(Number(v)) ? null : Number(v);
};
const fail = (path: string, error: unknown): never => {
  if (error instanceof ApiError) {
    const errs = error.problem.errors as Array<{ message?: string }> | undefined;
    const detail =
      (Array.isArray(errs)
        ? errs
            .map((e) => e.message)
            .filter(Boolean)
            .join('; ')
        : '') ||
      (typeof error.problem.detail === 'string' ? error.problem.detail : '') ||
      error.problem.type;
    redirect(
      `${path}${path.includes('?') ? '&' : '?'}error=1&detail=${encodeURIComponent(detail.slice(0, 300))}`,
    );
  }
  throw error;
};
const done = (path: string) => redirect(`${path}${path.includes('?') ? '&' : '?'}ok=1`);

export async function saveHeadPrinting(fd: FormData) {
  const id = str(fd, 'id');
  const path = '/fees/rules';
  try {
    await apiFetch(`/fees/heads/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        printGroup: str(fd, 'printGroup') || null,
        taxCertificate: fd.get('taxCertificate') !== null,
        isOptional: fd.get('isOptional') !== null,
      }),
    });
  } catch (error) {
    fail(path, error);
  }
  done(path);
}

export async function saveClassRules(fd: FormData) {
  const classId = str(fd, 'classId');
  const path = `/fees/rules?classId=${classId}`;
  const periods = fd
    .getAll('periodIds')
    .map(String)
    .map((periodId) => {
      const slabs = [1, 2, 3]
        .map((i) => ({
          on: str(fd, `slabOn${i}:${periodId}`),
          amount: num(fd, `slabAmt${i}:${periodId}`),
        }))
        .filter((s): s is { on: string; amount: number } => s.on !== '' && s.amount !== null);
      return {
        periodId,
        dueOn: str(fd, `dueOn:${periodId}`) || null,
        lateFeeAmount: num(fd, `lateFee:${periodId}`),
        slabs,
        latePerDay: num(fd, `perDay:${periodId}`),
      };
    });
  try {
    await apiFetch(`/fees/class-rules/${classId}`, {
      method: 'PUT',
      body: JSON.stringify({ bounceCharge: num(fd, 'bounceCharge'), periods }),
    });
  } catch (error) {
    fail(path, error);
  }
  done(path);
}

export async function savePaymentMode(fd: FormData) {
  const code = str(fd, 'code');
  const path = '/fees/rules';
  try {
    await apiFetch(`/fees/payment-modes/${code}`, {
      method: 'PUT',
      body: JSON.stringify({
        label: str(fd, 'label'),
        atCounter: fd.get('atCounter') !== null,
        needReference: fd.get('needReference') !== null,
        needInstrumentNo: fd.get('needInstrumentNo') !== null,
        needInstrumentDate: fd.get('needInstrumentDate') !== null,
        needBank: fd.get('needBank') !== null,
      }),
    });
  } catch (error) {
    fail(path, error);
  }
  done(path);
}

/** The pupil's whole discount list goes to the school admin for approval. */
export async function requestDiscountChange(fd: FormData) {
  const studentId = str(fd, 'studentId');
  const path = `/people/students/${studentId}`;
  const discounts = [0, 1, 2, 3, 4]
    .map((i) => ({
      discountId: str(fd, `discountId${i}`),
      fromSeq: Number(str(fd, `fromSeq${i}`) || '1'),
      toSeq: Number(str(fd, `toSeq${i}`) || '12'),
    }))
    .filter((d) => d.discountId !== '');
  try {
    await apiFetch(`/fees/students/${studentId}/profile-changes`, {
      method: 'POST',
      body: JSON.stringify({ discounts, reason: str(fd, 'reason') }),
    });
  } catch (error) {
    fail(path, error);
  }
  done(path);
}
