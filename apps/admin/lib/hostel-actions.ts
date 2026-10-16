'use server';
/** Hostel module H1 server actions: set-up, wardens, allot / transfer / vacate and the go-live sheet. */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from './api';

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const num = (fd: FormData, k: string, d = 0) => {
  const v = Number(str(fd, k));
  return Number.isFinite(v) && str(fd, k) !== '' ? v : d;
};
const BASE = '/hostel';

function detailOf(error: ApiError): string {
  const errs = error.problem.errors as
    Array<{ path?: string; message?: string }> | Record<string, string> | undefined;
  return Array.isArray(errs)
    ? errs
        .map((e) => `${e.path ? `${e.path}: ` : ''}${e.message ?? ''}`)
        .filter(Boolean)
        .join('; ')
    : errs && typeof errs === 'object'
      ? Object.values(errs).join('; ')
      : (error.problem.detail ?? '');
}
const join = (path: string, q: string) => `${path}${path.includes('?') ? '&' : '?'}${q}`;
function back(path: string, error: unknown): never {
  if (error instanceof ApiError)
    redirect(
      join(
        path,
        `error=${encodeURIComponent(error.problem.type)}&detail=${encodeURIComponent((detailOf(error) || error.problem.type).slice(0, 300))}`,
      ),
    );
  throw error;
}
/** Where to go back: a hostel page named by the form, else the fallback. */
function here(fd: FormData, fallback: string): string {
  const v = str(fd, 'returnTo');
  return v.startsWith(BASE) && !v.includes('//') ? v : fallback;
}
const done = (path: string, detail: string): never => {
  revalidatePath(BASE);
  redirect(join(path, `ok=1&detail=${encodeURIComponent(detail.slice(0, 400))}`));
};

// ---- set-up -------------------------------------------------------------------------------------------
export async function saveHostel(fd: FormData) {
  const to = here(fd, `${BASE}/setup`);
  const id = str(fd, 'id');
  try {
    await apiFetch(id ? `/hostel/hostels/${id}` : '/hostel/hostels', {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify({
        name: str(fd, 'name'),
        code: str(fd, 'code'),
        gender: str(fd, 'gender') || 'mixed',
        address: str(fd, 'address'),
        phone: str(fd, 'phone'),
        status: str(fd, 'status') || 'active',
      }),
    });
  } catch (error) {
    back(to, error);
  }
  done(to, id ? 'Hostel saved.' : 'Hostel added.');
}

export async function saveWardens(fd: FormData) {
  const to = here(fd, `${BASE}/setup`);
  const head = str(fd, 'head');
  const ids = [
    ...new Set(
      fd
        .getAll('employeeId')
        .map(String)
        .filter((v) => /^\d{1,18}$/.test(v)),
    ),
  ];
  try {
    await apiFetch(`/hostel/hostels/${str(fd, 'hostelId')}/wardens`, {
      method: 'PUT',
      body: JSON.stringify({
        wardens: ids.map((employeeId) => ({ employeeId, isHead: employeeId === head })),
      }),
    });
  } catch (error) {
    back(to, error);
  }
  done(to, 'Wardens saved.');
}

export async function saveBlock(fd: FormData) {
  const to = here(fd, `${BASE}/setup`);
  const id = str(fd, 'id');
  try {
    await apiFetch(id ? `/hostel/blocks/${id}` : '/hostel/blocks', {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify({
        hostelId: str(fd, 'hostelId'),
        name: str(fd, 'name'),
        floors: num(fd, 'floors', 1),
      }),
    });
  } catch (error) {
    back(to, error);
  }
  done(to, 'Block saved.');
}

export async function deleteBlock(fd: FormData) {
  const to = here(fd, `${BASE}/setup`);
  try {
    await apiFetch(`/hostel/blocks/${str(fd, 'id')}`, { method: 'DELETE' });
  } catch (error) {
    back(to, error);
  }
  done(to, 'Block removed.');
}

export async function saveRoomType(fd: FormData) {
  const to = here(fd, `${BASE}/setup?tab=types`);
  const id = str(fd, 'id');
  let out: { repriced?: number } = {};
  try {
    out = await apiFetch(id ? `/hostel/room-types/${id}` : '/hostel/room-types', {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify({
        name: str(fd, 'name'),
        seater: num(fd, 'seater', 1),
        ac: fd.get('ac') === 'on',
        feeGroup: str(fd, 'feeGroup'),
        status: str(fd, 'status') || 'active',
      }),
    });
  } catch (error) {
    back(to, error);
  }
  done(
    to,
    out.repriced
      ? `Room type saved. The hostel fee of ${String(out.repriced)} pupil(s) in these rooms was raised again by the new fee group.`
      : 'Room type saved.',
  );
}

export async function createRoom(fd: FormData) {
  const to = here(fd, `${BASE}/setup?tab=rooms`);
  let out: { beds?: number } = {};
  try {
    out = await apiFetch('/hostel/rooms', {
      method: 'POST',
      body: JSON.stringify({
        hostelId: str(fd, 'hostelId'),
        blockId: str(fd, 'blockId') || null,
        floor: num(fd, 'floor', 0),
        roomNo: str(fd, 'roomNo'),
        roomTypeId: str(fd, 'roomTypeId'),
        remarks: str(fd, 'remarks'),
        ...(str(fd, 'beds') ? { beds: num(fd, 'beds', 0) } : {}),
      }),
    });
  } catch (error) {
    back(to, error);
  }
  done(to, `Room added with ${String(out.beds ?? 0)} bed(s).`);
}

export async function updateRoom(fd: FormData) {
  const to = here(fd, `${BASE}/setup?tab=rooms`);
  let out: { repriced?: number } = {};
  try {
    out = await apiFetch(`/hostel/rooms/${str(fd, 'id')}`, {
      method: 'PATCH',
      body: JSON.stringify({
        roomNo: str(fd, 'roomNo') || undefined,
        roomTypeId: str(fd, 'roomTypeId') || undefined,
        status: str(fd, 'status') || undefined,
        remarks: str(fd, 'remarks'),
      }),
    });
  } catch (error) {
    back(to, error);
  }
  done(
    to,
    out.repriced
      ? `Room saved. The hostel fee of ${String(out.repriced)} pupil(s) in it was raised again by the new room type.`
      : 'Room saved.',
  );
}

export async function addBed(fd: FormData) {
  const to = here(fd, `${BASE}/setup?tab=rooms`);
  try {
    await apiFetch(`/hostel/rooms/${str(fd, 'roomId')}/beds`, {
      method: 'POST',
      body: JSON.stringify({ label: str(fd, 'label').toUpperCase(), status: 'active' }),
    });
  } catch (error) {
    back(to, error);
  }
  done(to, 'Bed added.');
}

export async function setBed(fd: FormData) {
  const to = here(fd, `${BASE}/setup?tab=rooms`);
  const id = str(fd, 'id');
  try {
    if (str(fd, 'do') === 'delete') await apiFetch(`/hostel/beds/${id}`, { method: 'DELETE' });
    else
      await apiFetch(`/hostel/beds/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ label: str(fd, 'label'), status: str(fd, 'status') }),
      });
  } catch (error) {
    back(to, error);
  }
  done(to, str(fd, 'do') === 'delete' ? 'Bed removed.' : 'Bed saved.');
}

// ---- allotment -----------------------------------------------------------------------------------------
type FeeOut = { fee?: { synced: boolean; note?: string }; paidMonths?: string[]; place?: string };
const feeWords = (o: FeeOut) =>
  [
    o.fee?.synced
      ? 'The hostel fee has been raised again.'
      : `The hostel fee was not changed (${o.fee?.note ?? 'fee set-up missing'}).`,
    o.paidMonths?.length
      ? `Already paid and left as they are: ${o.paidMonths.join(', ')}. Settle any difference at the fee desk.`
      : '',
  ]
    .filter(Boolean)
    .join(' ');

export async function allotBed(fd: FormData) {
  const to = here(fd, `${BASE}/allot`);
  let out: FeeOut = {};
  try {
    out = await apiFetch('/hostel/allotments', {
      method: 'POST',
      body: JSON.stringify({
        studentId: str(fd, 'studentId'),
        bedId: str(fd, 'bedId'),
        fromDate: str(fd, 'fromDate'),
        remarks: str(fd, 'remarks'),
      }),
    });
  } catch (error) {
    back(to, error);
  }
  done(to, `Allotted: ${out.place ?? ''}. ${feeWords(out)}`);
}

export async function transferBed(fd: FormData) {
  const to = here(fd, `${BASE}/allot`);
  let out: FeeOut = {};
  try {
    out = await apiFetch(`/hostel/students/${str(fd, 'studentId')}/transfer`, {
      method: 'POST',
      body: JSON.stringify({
        bedId: str(fd, 'bedId'),
        onDate: str(fd, 'onDate'),
        remarks: str(fd, 'remarks'),
      }),
    });
  } catch (error) {
    back(to, error);
  }
  done(to, `Moved to ${out.place ?? ''}. ${feeWords(out)}`);
}

export async function vacateBed(fd: FormData) {
  const to = here(fd, `${BASE}/allot`);
  let out: FeeOut = {};
  try {
    out = await apiFetch(`/hostel/students/${str(fd, 'studentId')}/vacate`, {
      method: 'POST',
      body: JSON.stringify({
        onDate: str(fd, 'onDate'),
        reason: str(fd, 'reason') === 'withdrawn' ? 'withdrawn' : 'vacate',
        remarks: str(fd, 'remarks'),
      }),
    });
  } catch (error) {
    back(to, error);
  }
  done(to, `The stay ends on ${str(fd, 'onDate')}. ${feeWords(out)}`);
}

// ---- go-live sheet ---------------------------------------------------------------------------------------
export async function uploadBeds(fd: FormData) {
  const to = `${BASE}/upload`;
  const file = fd.get('file');
  if (!(file instanceof File) || !file.size)
    redirect(`${to}?error=validation-failed&detail=${encodeURIComponent('Choose the Excel file')}`);
  const f = file as File;
  if (f.size > 700_000)
    redirect(
      `${to}?error=validation-failed&detail=${encodeURIComponent('The file is larger than 700 KB')}`,
    );
  const apply = str(fd, 'mode') === 'apply';
  let out: {
    rows: number;
    rooms: number;
    beds: number;
    allotted: number;
    feeNotSynced: number;
    errors: Array<{ row: number; message: string }>;
  } = { rows: 0, rooms: 0, beds: 0, allotted: 0, feeNotSynced: 0, errors: [] };
  try {
    out = await apiFetch('/hostel/import', {
      method: 'POST',
      body: JSON.stringify({
        fileName: f.name,
        fileBase64: Buffer.from(await f.arrayBuffer()).toString('base64'),
        apply,
      }),
    });
  } catch (error) {
    back(to, error);
  }
  revalidatePath(BASE);
  const q = new URLSearchParams({
    mode: apply ? 'apply' : 'check',
    rows: String(out.rows),
    rooms: String(out.rooms),
    beds: String(out.beds),
    allotted: String(out.allotted),
    nosync: String(out.feeNotSynced),
    problems: out.errors
      .slice(0, 30)
      .map((e) => `Row ${String(e.row)}: ${e.message}`)
      .join('\n')
      .slice(0, 1800),
    bad: String(out.errors.length),
  });
  redirect(`${to}?${q.toString()}`);
}

// ---- H2: rules and roll-call sessions -------------------------------------------------------------------
export async function saveHostelRules(fd: FormData) {
  const to = `${BASE}/setup?tab=rules`;
  try {
    await apiFetch('/hostel/settings', {
      method: 'PUT',
      body: JSON.stringify({
        lateGraceMinutes: num(fd, 'lateGraceMinutes', 30),
        escalateAfterHours: num(fd, 'escalateAfterHours', 6),
        outingReturnBy: str(fd, 'outingReturnBy') || '19:00',
        alertParentAbsent: fd.get('alertParentAbsent') === 'on',
      }),
    });
  } catch (error) {
    back(to, error);
  }
  done(to, 'Hostel rules saved.');
}

export async function saveSession(fd: FormData) {
  const to = `${BASE}/setup?tab=rules`;
  const id = str(fd, 'id');
  try {
    await apiFetch(id ? `/hostel/sessions/${id}` : '/hostel/sessions', {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify({
        hostelId: str(fd, 'hostelId'),
        name: str(fd, 'name'),
        atTime: str(fd, 'atTime'),
        active: id ? fd.get('active') === 'on' : true,
      }),
    });
  } catch (error) {
    back(to, error);
  }
  done(to, id ? 'Session saved.' : 'Session added.');
}

// ---- H3: visitors, visiting hours, the mess --------------------------------------------------------------
/** Visiting hours of a hostel: one slot per weekday (empty day = no visits; all empty = any time). */
export async function saveVisitHours(fd: FormData) {
  const to = `${BASE}/setup?tab=rules`;
  const hours = [0, 1, 2, 3, 4, 5, 6]
    .map((weekday) => ({
      weekday,
      from: str(fd, `from-${String(weekday)}`),
      to: str(fd, `to-${String(weekday)}`),
    }))
    .filter((h) => h.from && h.to);
  try {
    await apiFetch(`/hostel/hostels/${str(fd, 'hostelId')}/visit-hours`, {
      method: 'PUT',
      body: JSON.stringify({ hours }),
    });
  } catch (error) {
    back(to, error);
  }
  done(to, hours.length ? 'Visiting hours saved.' : 'Visiting hours cleared: visits any time.');
}

export async function saveMenuChange(fd: FormData) {
  const to = here(fd, `${BASE}/mess`);
  try {
    await apiFetch('/hostel/menu/change', {
      method: 'PUT',
      body: JSON.stringify({
        mealId: str(fd, 'mealId'),
        onDate: str(fd, 'onDate'),
        items: str(fd, 'items'),
        note: str(fd, 'note'),
      }),
    });
  } catch (error) {
    back(to, error);
  }
  done(
    to,
    str(fd, 'items') ? 'Change for the day saved.' : 'Back to the weekly menu for that day.',
  );
}

export async function decideHostelVisit(fd: FormData) {
  const to = here(fd, `${BASE}/visitors`);
  const outcome = str(fd, 'outcome') === 'refused' ? 'refused' : 'allowed';
  try {
    await apiFetch(`/hostel/visits/${str(fd, 'id')}/decide`, {
      method: 'POST',
      body: JSON.stringify({ outcome, note: str(fd, 'note') }),
    });
  } catch (error) {
    back(to, error);
  }
  done(
    to,
    outcome === 'allowed'
      ? 'Visitor allowed in. The parent has been told.'
      : 'Visit refused. The parent has been told.',
  );
}

export async function decideHostelVisitor(fd: FormData) {
  const to = here(fd, `${BASE}/visitors?tab=approve`);
  const outcome = str(fd, 'outcome') === 'rejected' ? 'rejected' : 'approved';
  try {
    await apiFetch(`/hostel/visitors/${str(fd, 'id')}/decide`, {
      method: 'POST',
      body: JSON.stringify({ outcome, note: str(fd, 'note') }),
    });
  } catch (error) {
    back(to, error);
  }
  done(to, outcome === 'approved' ? 'Visitor approved.' : 'Visitor not approved.');
}

export async function addHostelVisitor(fd: FormData) {
  const to = here(fd, `${BASE}/visitors?tab=lists`);
  try {
    await apiFetch('/hostel/visitors', {
      method: 'POST',
      body: JSON.stringify({
        studentId: str(fd, 'studentId'),
        name: str(fd, 'name'),
        relation: str(fd, 'relation'),
        mobile: str(fd, 'mobile'),
      }),
    });
  } catch (error) {
    back(to, error);
  }
  done(to, 'Visitor added to the list (approved).');
}

/** The gate registers a hostel visitor (live photo optional). */
export async function registerHostelVisit(fd: FormData) {
  const asked = str(fd, 'returnTo');
  const to =
    asked.startsWith('/engagement/visitors/new?kind=hostel') && !asked.includes('//')
      ? asked
      : '/engagement/visitors/new?kind=hostel';
  let out: { number?: string; state?: string; why?: string | null } = {};
  try {
    out = await apiFetch('/hostel/visits', {
      method: 'POST',
      body: JSON.stringify({
        studentId: str(fd, 'studentId'),
        visitorName: str(fd, 'visitorName'),
        mobile: str(fd, 'mobile'),
        relation: str(fd, 'relation'),
        partySize: num(fd, 'partySize', 1),
        idProofKind: str(fd, 'idProofKind'),
        gate: str(fd, 'gate'),
        photo: str(fd, 'photo') || undefined,
      }),
    });
  } catch (error) {
    back(to, error);
  }
  done(
    '/engagement/visitors/new?kind=hostel',
    out.state === 'inside'
      ? `${out.number ?? ''}: let the visitor in. The parent has been told.`
      : `${out.number ?? ''}: ask the visitor to wait — ${out.why ?? ''}. The warden has been asked to allow or refuse.`,
  );
}

// ---- H4: complaints and incidents -------------------------------------------------------------------------
/** A complaint about a room, raised by the office on the helpdesk's hostel desk. */
export async function raiseHostelComplaint(fd: FormData) {
  const to = `${BASE}/complaints`;
  let out: { id?: string; number?: string } = {};
  try {
    out = await apiFetch('/helpdesk/tickets', {
      method: 'POST',
      body: JSON.stringify({
        desk: 'hostel',
        categoryCode: str(fd, 'categoryCode'),
        subject: str(fd, 'subject'),
        body: str(fd, 'body'),
        priority: str(fd, 'priority') || 'normal',
        hostelRoomId: str(fd, 'roomId'),
        fileIds: [],
      }),
    });
  } catch (error) {
    back(to, error);
  }
  done(to, `Complaint ${out.number ?? ''} raised. It is with the head warden of the hostel.`);
}

export async function recordIncident(fd: FormData) {
  const to = here(fd, `${BASE}/incidents`);
  let out: { parentTold?: boolean; principalTold?: boolean } = {};
  try {
    out = await apiFetch('/hostel/incidents', {
      method: 'POST',
      body: JSON.stringify({
        studentId: str(fd, 'studentId'),
        occurredAt: str(fd, 'occurredAt').replace('T', ' ') || undefined,
        category: str(fd, 'category'),
        severity: str(fd, 'severity') === 'serious' ? 'serious' : 'minor',
        what: str(fd, 'what'),
        action: str(fd, 'action'),
        tellParent: fd.get('tellParent') === 'on',
      }),
    });
  } catch (error) {
    back(to, error);
  }
  done(
    `${BASE}/incidents`,
    `Incident recorded.${out.parentTold ? ' The parent has been told.' : ''}${out.principalTold ? ' The principal and school admins have been told.' : ''}`,
  );
}

// ---- roll-call (also taken from the admin app) ------------------------------------------------------------
/** Saves the roll of a session: everyone present unless marked; away on leave is kept by the system. */
export async function saveHostelRollcall(fd: FormData) {
  const sessionId = str(fd, 'sessionId');
  const on = str(fd, 'on');
  const to = `${BASE}/rollcall/take?sessionId=${encodeURIComponent(sessionId)}&on=${encodeURIComponent(on)}`;
  const marks = fd
    .getAll('studentId')
    .map(String)
    .map((id) => ({
      studentId: id,
      status: ['present', 'absent', 'sick', 'on_leave'].includes(str(fd, `s-${id}`))
        ? str(fd, `s-${id}`)
        : 'present',
      note: str(fd, `n-${id}`) || undefined,
    }));
  let out: { counts: Record<string, number>; alerted: number } = { counts: {}, alerted: 0 };
  try {
    out = await apiFetch('/hostel/rollcall', {
      method: 'POST',
      body: JSON.stringify({ sessionId, on, marks }),
    });
  } catch (error) {
    back(to, error);
  }
  const c = out.counts;
  done(
    to,
    `Saved: ${String(c.present ?? 0)} present, ${String(c.absent ?? 0)} absent, ${String(c.on_leave ?? 0)} on leave, ${String(c.sick ?? 0)} sick.${out.alerted ? ` ${String(out.alerted)} absence(s) reported to the head warden and the parents.` : ''}`,
  );
}
