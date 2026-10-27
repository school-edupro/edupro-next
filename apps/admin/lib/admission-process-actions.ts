'use server';
/** The approval process of online admission (docs/design/39, part 4). */
import { revalidatePath } from 'next/cache';
import { ApiError, apiFetch } from './api';
import type { Process, ProcessStep, SlotDetail, Stage } from './admission-process';

type Out<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string; confirm?: { affected: number; sample: string[] } };
const okId = (id: string) => /^\d{1,18}$/.test(id);

function problem(e: unknown): {
  ok: false;
  error: string;
  confirm?: { affected: number; sample: string[] };
} {
  if (e instanceof ApiError) {
    const list = e.problem.errors as Array<string | { message?: string }> | undefined;
    const msgs = Array.isArray(list)
      ? list.map((x) => (typeof x === 'string' ? x : (x.message ?? ''))).filter(Boolean)
      : [];
    return {
      ok: false,
      error: msgs.length ? msgs.join('. ') : (e.problem.detail ?? e.problem.type),
      ...(e.problem.type === 'admissions.confirm_process'
        ? {
            confirm: {
              affected: Number(e.problem.affected ?? 0),
              sample: (e.problem.sample as string[] | undefined) ?? [],
            },
          }
        : {}),
    };
  }
  throw e;
}
async function call<T>(
  path: string,
  method: string,
  body: unknown,
  revalidate: string[],
): Promise<Out<T>> {
  try {
    const data = await apiFetch<T>(path, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    for (const p of revalidate) revalidatePath(p);
    return { ok: true, data };
  } catch (e) {
    return problem(e);
  }
}

export async function saveStages(stages: Array<Omit<Stage, 'used' | 'id'> & { id?: string }>) {
  return call<Stage[]>('/admissions/stages', 'PUT', { stages }, ['/admissions/setup']);
}
export async function saveProcess(
  id: string | null,
  body: { name: string; steps: ProcessStep[]; classIds: string[]; confirm: boolean },
) {
  if (id && !okId(id)) return { ok: false as const, error: 'Unknown process' };
  return call<{ id: string; affected: number; processes: Process[] }>(
    id ? `/admissions/processes/${id}` : '/admissions/processes',
    id ? 'PUT' : 'POST',
    body,
    ['/admissions/setup', '/admissions/list'],
  );
}
export async function archiveProcess(id: string) {
  if (!okId(id)) return { ok: false as const, error: 'Unknown process' };
  return call<{ processes: Process[] }>(`/admissions/processes/${id}`, 'DELETE', undefined, [
    '/admissions/setup',
  ]);
}

const regPaths = (id: string) => [`/admissions/registrations/${id}`, '/admissions/list'];
export async function decideRegistration(
  id: string,
  body: {
    decision: 'approve' | 'reject' | 'hold' | 'offer' | 'waitlist';
    remarks?: string;
    marks?: number | null;
    attendance?: 'present' | 'absent' | null;
    categoryId?: string;
    /** an offer: the email as changed on the preview (docs/design/56) */
    offerMessage?: { subject?: string; intro?: string; note?: string };
  },
) {
  if (!okId(id)) return { ok: false as const, error: 'Unknown registration' };
  return call(`/admissions/registrations/${id}/decide`, 'POST', body, regPaths(id));
}
export interface OfferPreview {
  amount: number;
  /** the words with {{name}}, {{class}}… for a batch of offers */
  templates: { subject: string; intro: string; note: string; fields: string[] };
  email: {
    to: string | null;
    on: boolean;
    subject: string;
    intro: string;
    note: string;
    rows: Array<[string, string]>;
    html: string;
  };
  sms: { to: string | null; on: boolean; text: string };
  whatsapp: { to: string | null; on: boolean; text: string };
}
/** The offer email (and the SMS / WhatsApp text) before it goes, with the person's changes. */
export async function previewOffer(
  id: string,
  edits: { subject?: string; intro?: string; note?: string },
): Promise<{ ok: true; data: OfferPreview } | { ok: false; error: string }> {
  if (!okId(id)) return { ok: false, error: 'Unknown registration' };
  try {
    const data = await apiFetch<OfferPreview>(`/admissions/registrations/${id}/offer-preview`, {
      method: 'POST',
      body: JSON.stringify(edits),
    });
    return { ok: true, data };
  } catch (e) {
    if (e instanceof ApiError)
      return { ok: false, error: String(e.problem.detail ?? e.problem.type) };
    throw e;
  }
}
export async function sendBackRegistration(
  id: string,
  body: { fields: string[]; remark: string; dueOn?: string },
) {
  if (!okId(id)) return { ok: false as const, error: 'Unknown registration' };
  return call(`/admissions/registrations/${id}/send-back`, 'POST', body, regPaths(id));
}
export async function undoRegistration(id: string, body: { reason: string; toStep?: number }) {
  if (!okId(id)) return { ok: false as const, error: 'Unknown registration' };
  return call(`/admissions/registrations/${id}/undo`, 'POST', body, regPaths(id));
}

export async function createSlot(
  cycleId: string,
  body: {
    stageId: string;
    classId: string | null;
    startsAt: string;
    minutes: number;
    venue: string;
    capacity: number;
    notes: string | null;
  },
) {
  if (!okId(cycleId)) return { ok: false as const, error: 'Unknown session' };
  return call<SlotDetail>(`/admissions/cycles/${cycleId}/slots`, 'POST', body, [
    '/admissions/schedule',
  ]);
}
export async function updateSlot(
  id: string,
  body: {
    stageId: string;
    classId: string | null;
    startsAt: string;
    minutes: number;
    venue: string;
    capacity: number;
    notes: string | null;
  },
) {
  if (!okId(id)) return { ok: false as const, error: 'Unknown slot' };
  return call<SlotDetail>(`/admissions/slots/${id}`, 'PUT', body, [
    '/admissions/schedule',
    `/admissions/schedule/${id}`,
  ]);
}
export async function deleteSlot(id: string) {
  if (!okId(id)) return { ok: false as const, error: 'Unknown slot' };
  return call(`/admissions/slots/${id}`, 'DELETE', undefined, ['/admissions/schedule']);
}
export async function allotSlot(id: string, body: { applicationIds?: string[]; notify: boolean }) {
  if (!okId(id)) return { ok: false as const, error: 'Unknown slot' };
  return call<SlotDetail>(`/admissions/slots/${id}/allot`, 'POST', body, [
    `/admissions/schedule/${id}`,
  ]);
}
export async function unallotSlot(id: string, applicationId: string) {
  if (!okId(id) || !okId(applicationId)) return { ok: false as const, error: 'Unknown slot' };
  return call<SlotDetail>(
    `/admissions/slots/${id}/candidates/${applicationId}`,
    'DELETE',
    undefined,
    [`/admissions/schedule/${id}`],
  );
}
export async function saveSlotResults(
  id: string,
  rows: Array<{
    applicationId: string;
    attendance: 'present' | 'absent' | null;
    marks: number | null;
    decision: 'approve' | 'reject' | 'hold';
    remarks?: string;
  }>,
) {
  if (!okId(id)) return { ok: false as const, error: 'Unknown slot' };
  return call<{
    saved: number;
    errors: Array<{ applicationId: string; error: string }>;
    slot: SlotDetail;
  }>(`/admissions/slots/${id}/results`, 'PUT', { rows }, [
    `/admissions/schedule/${id}`,
    '/admissions/list',
  ]);
}

/** A family at Selection, as the previews name them. */
export interface SelectionPick {
  id: string;
  number: string | null;
  candidate: string | null;
}
async function preview<T>(path: string, body: unknown): Promise<Out<T>> {
  return call<T>(path, 'POST', body, []);
}
/** A Selection offer's message before it goes (docs/design/56): the first family as the sample. */
export async function selectionOfferPreview(
  cycleId: string,
  applicationId: string,
  edits: { subject?: string; intro?: string; note?: string },
): Promise<{ ok: true; data: OfferPreview } | { ok: false; error: string }> {
  if (!okId(cycleId) || !okId(applicationId)) return { ok: false, error: 'Unknown registration' };
  return preview<OfferPreview>(`/admissions/cycles/${cycleId}/selection/offer-preview`, {
    applicationId,
    ...edits,
  });
}
/** The draw before it is made: the seed, who would be offered, who would wait (nothing changes). */
export async function selectionDrawPreview(
  cycleId: string,
  body: { classId: string; seats: number; categoryId?: string; seed?: string },
) {
  if (!okId(cycleId)) return { ok: false as const, error: 'Unknown session' };
  return preview<{ seed: string; offered: SelectionPick[]; waitlisted: SelectionPick[] }>(
    `/admissions/cycles/${cycleId}/selection/draw-preview`,
    body,
  );
}
/** Who "Offer the next" would offer. */
export async function selectionNextPreview(
  cycleId: string,
  body: { classId: string; categoryId?: string },
) {
  if (!okId(cycleId)) return { ok: false as const, error: 'Unknown session' };
  return preview<SelectionPick>(`/admissions/cycles/${cycleId}/selection/next-preview`, body);
}
export async function selectionAction(
  cycleId: string,
  kind: 'offer' | 'waitlist' | 'draw' | 'next',
  body: Record<string, unknown>,
) {
  if (!okId(cycleId)) return { ok: false as const, error: 'Unknown session' };
  return call<Record<string, unknown>>(
    `/admissions/cycles/${cycleId}/selection/${kind}`,
    'POST',
    body,
    ['/admissions/selection', '/admissions/list'],
  );
}
