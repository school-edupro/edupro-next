'use server';
/**
 * Server actions: the only place the admin app writes to the API. Each action calls the API with the
 * session token (ADR-007), then redirects back with a status so pages stay server-rendered forms.
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from './api';
import { readSession, writeSession } from './session';

function back(path: string, status: 'ok' | string, detail?: string): never {
  const params = new URLSearchParams();
  params.set(status === 'ok' ? 'ok' : 'error', status === 'ok' ? '1' : status);
  if (detail) params.set('detail', detail.slice(0, 200));
  revalidatePath(path);
  redirect(`${path}?${params.toString()}`);
}

async function run(path: string, fn: () => Promise<unknown>): Promise<never> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof ApiError && error.problem.type === 'mfa-required') {
      redirect(`/step-up?returnTo=${encodeURIComponent(path)}`); // S5-01: re-authenticate, then retry
    }
    if (error instanceof ApiError) back(path, error.problem.type, error.problem.detail);
    throw error;
  }
  back(path, 'ok');
}

const str = (fd: FormData, key: string): string => String(fd.get(key) ?? '').trim();
const opt = (fd: FormData, key: string): string | undefined => str(fd, key) || undefined;

// ---- roles ---------------------------------------------------------------------------------------
export async function createRole(fd: FormData) {
  return run('/access/roles', () =>
    apiFetch('/access/roles', {
      method: 'POST',
      body: JSON.stringify({
        code: str(fd, 'code'),
        name: str(fd, 'name'),
        kind: str(fd, 'kind') || 'module',
        description: str(fd, 'description'),
        copyFromRoleId: opt(fd, 'copyFromRoleId'),
        permissions: fd.getAll('permissions').map(String),
      }),
    }),
  );
}

export async function updateRole(fd: FormData) {
  const id = str(fd, 'id');
  return run(`/access/roles/${id}`, () =>
    apiFetch(`/access/roles/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        name: str(fd, 'name'),
        description: str(fd, 'description'),
        status: str(fd, 'status') || 'active',
        permissions: fd.getAll('permissions').map(String),
      }),
    }),
  );
}

export async function disableRole(fd: FormData) {
  const id = str(fd, 'id');
  return run('/access/roles', () => apiFetch(`/access/roles/${id}`, { method: 'DELETE' }));
}

// ---- assignments ---------------------------------------------------------------------------------
export async function grantRole(fd: FormData) {
  return run('/access/assignments', () =>
    apiFetch('/access/assignments', {
      method: 'POST',
      body: JSON.stringify({
        userId: str(fd, 'userId'),
        roleId: str(fd, 'roleId'),
        campusId: opt(fd, 'campusId'),
        validFrom: opt(fd, 'validFrom'),
        validTo: opt(fd, 'validTo'),
        reason: str(fd, 'reason'),
      }),
    }),
  );
}

export async function revokeAssignment(fd: FormData) {
  const id = str(fd, 'id');
  return run('/access/assignments', () =>
    apiFetch(`/access/assignments/${id}/revoke`, {
      method: 'POST',
      body: JSON.stringify({ reason: str(fd, 'reason') || 'revoked from admin' }),
    }),
  );
}

export async function setAssignmentScopes(fd: FormData) {
  const id = str(fd, 'id');
  const scopes = fd.getAll('sectionIds').map((v) => ({ type: 'class_section', id: String(v) }));
  return run(`/access/assignments/${id}`, () =>
    apiFetch(`/access/assignments/${id}/scopes`, {
      method: 'PUT',
      body: JSON.stringify({ scopes }),
    }),
  );
}

// ---- memberships ---------------------------------------------------------------------------------
export async function inviteMember(fd: FormData) {
  return run('/access/memberships', () =>
    apiFetch('/access/memberships', {
      method: 'POST',
      body: JSON.stringify({
        displayName: str(fd, 'displayName'),
        mobile: opt(fd, 'mobile'),
        email: opt(fd, 'email'),
        oneauthSub: opt(fd, 'oneauthSub'),
        personType: str(fd, 'personType') || 'employee',
        roleId: opt(fd, 'roleId'),
      }),
    }),
  );
}

export async function setMembershipStatus(fd: FormData) {
  const id = str(fd, 'id');
  return run('/access/memberships', () =>
    apiFetch(`/access/memberships/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: str(fd, 'status') }),
    }),
  );
}

// ---- delegations ---------------------------------------------------------------------------------
export async function createDelegation(fd: FormData) {
  const startsAt = new Date(str(fd, 'startsAt'));
  const endsAt = new Date(str(fd, 'endsAt'));
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()))
    back('/access/delegations', 'validation-failed', 'Both dates are required');
  return run('/access/delegations', () =>
    apiFetch('/access/delegations', {
      method: 'POST',
      body: JSON.stringify({
        toUserId: str(fd, 'toUserId'),
        roleId: str(fd, 'roleId'),
        fromUserId: opt(fd, 'fromUserId'),
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        reason: str(fd, 'reason'),
      }),
    }),
  );
}

export async function revokeDelegation(fd: FormData) {
  const id = str(fd, 'id');
  return run('/access/delegations', () =>
    apiFetch(`/access/delegations/${id}/revoke`, { method: 'POST', body: '{}' }),
  );
}

// ---- years ---------------------------------------------------------------------------------------
export async function createYear(fd: FormData) {
  return run('/system/years', () =>
    apiFetch('/platform/years', {
      method: 'POST',
      body: JSON.stringify({
        kind: str(fd, 'kind'),
        code: str(fd, 'code'),
        name: str(fd, 'name'),
        startDate: str(fd, 'startDate'),
        endDate: str(fd, 'endDate'),
      }),
    }),
  );
}

export async function yearAction(fd: FormData) {
  const kind = str(fd, 'kind');
  const id = str(fd, 'id');
  const action = str(fd, 'action'); // activate | lock | reopen | close
  const body =
    action === 'activate'
      ? undefined
      : action === 'close'
        ? { reason: str(fd, 'reason') || 'closed from admin' }
        : { stage: str(fd, 'stage'), reason: str(fd, 'reason') || `${action} from admin` };
  return run('/system/years', () =>
    apiFetch(`/platform/years/${kind}/${id}/${action}`, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    }),
  );
}

// ---- settings ------------------------------------------------------------------------------------
export async function setSetting(fd: FormData) {
  const key = str(fd, 'key');
  const kind = str(fd, 'valueKind');
  const raw = str(fd, 'value');
  let value: unknown = raw;
  if (kind === 'number') value = Number(raw);
  else if (kind === 'boolean') value = raw === 'true';
  else if (kind === 'json') {
    try {
      value = JSON.parse(raw);
    } catch {
      back('/system/settings', 'validation-failed', `${key}: value must be valid JSON`);
    }
  }
  return run('/system/settings', () =>
    apiFetch(`/platform/settings/${key}`, {
      method: 'PUT',
      body: JSON.stringify({ value, validFrom: opt(fd, 'validFrom') }),
    }),
  );
}

// ---- school --------------------------------------------------------------------------------------
export async function updateSchool(fd: FormData) {
  return run('/system/school', () =>
    apiFetch('/platform/school', {
      method: 'PATCH',
      body: JSON.stringify({
        name: str(fd, 'name'),
        shortName: opt(fd, 'shortName') ?? null,
        affiliationNo: opt(fd, 'affiliationNo') ?? null,
        board: str(fd, 'board'),
        timezone: str(fd, 'timezone'),
        locale: str(fd, 'locale'),
      }),
    }),
  );
}

export async function createCampus(fd: FormData) {
  return run('/system/school', () =>
    apiFetch('/platform/school/campuses', {
      method: 'POST',
      body: JSON.stringify({ code: str(fd, 'code').toUpperCase(), name: str(fd, 'name') }),
    }),
  );
}

// ---- comms (Sprint 3) ----------------------------------------------------------------------------
export async function createTemplate(fd: FormData) {
  return run('/comms/templates', () =>
    apiFetch('/comms/templates', {
      method: 'POST',
      body: JSON.stringify({
        code: str(fd, 'code'),
        channel: str(fd, 'channel'),
        name: str(fd, 'name'),
        subject: opt(fd, 'subject'),
        body: String(fd.get('body') ?? ''),
        dltTemplateId: opt(fd, 'dltTemplateId'),
        dltEntityId: opt(fd, 'dltEntityId'),
        senderId: opt(fd, 'senderId'),
      }),
    }),
  );
}

export async function updateTemplate(fd: FormData) {
  const id = str(fd, 'id');
  return run(`/comms/templates/${id}`, () =>
    apiFetch(`/comms/templates/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        name: str(fd, 'name'),
        subject: opt(fd, 'subject'),
        body: String(fd.get('body') ?? ''),
        dltTemplateId: opt(fd, 'dltTemplateId'),
        dltEntityId: opt(fd, 'dltEntityId'),
        senderId: opt(fd, 'senderId'),
        status: str(fd, 'status') || 'active',
      }),
    }),
  );
}

export async function sendMessage(fd: FormData) {
  let variables: Record<string, unknown> = {};
  const raw = str(fd, 'variables');
  if (raw) {
    try {
      variables = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      back(
        '/comms/messages',
        'validation-failed',
        'Variables must be a JSON object such as {"name":"Asha"}',
      );
    }
  }
  return run('/comms/messages', () =>
    apiFetch('/comms/messages', {
      method: 'POST',
      body: JSON.stringify({
        templateId: str(fd, 'templateId'),
        recipientUserId: opt(fd, 'recipientUserId'),
        recipientAddress: opt(fd, 'recipientAddress'),
        variables,
      }),
    }),
  );
}

export async function cancelMessage(fd: FormData) {
  const id = str(fd, 'id');
  return run('/comms/messages', () =>
    apiFetch(`/comms/messages/${id}/cancel`, { method: 'POST', body: '{}' }),
  );
}

// ---- reports and audit (Sprint 3) ----------------------------------------------------------------
export async function createExport(fd: FormData) {
  return run('/reports/exports', () =>
    apiFetch('/reports/exports', {
      method: 'POST',
      body: JSON.stringify({
        dataset: str(fd, 'dataset'),
        format: str(fd, 'format') || 'xlsx',
        title: opt(fd, 'title'),
      }),
    }),
  );
}

export async function exportAudit(fd: FormData) {
  const params: Record<string, string> = {};
  for (const key of ['from', 'to', 'entityType', 'entityId', 'actorUserId', 'action']) {
    const v = opt(fd, key);
    if (v) params[key] = key === 'from' || key === 'to' ? new Date(v).toISOString() : v;
  }
  return run('/reports/exports', () =>
    apiFetch('/platform/audit/export', {
      method: 'POST',
      body: JSON.stringify({ format: str(fd, 'format') || 'xlsx', params }),
    }),
  );
}

export async function retryJob(fd: FormData) {
  const id = str(fd, 'id');
  return run('/system/jobs', () =>
    apiFetch(`/platform/jobs/outbox/${id}/retry`, { method: 'POST', body: '{}' }),
  );
}

// ---- people (Sprint 4) ---------------------------------------------------------------------------
export async function createStudent(fd: FormData) {
  const guardianName = str(fd, 'guardianName');
  const [gFirst, ...gRest] = guardianName.split(/\s+/);
  const guardians = guardianName
    ? [
        {
          guardian: {
            firstName: gFirst,
            lastName: gRest.join(' ') || undefined,
            mobile: opt(fd, 'guardianMobile'),
            email: opt(fd, 'guardianEmail'),
          },
          relation: str(fd, 'relation') || 'father',
          isPrimary: true,
        },
      ]
    : [];
  const sectionId = opt(fd, 'classSectionId');
  let created: { id: string } | null = null;
  try {
    created = await apiFetch<{ id: string }>('/people/students', {
      method: 'POST',
      body: JSON.stringify({
        admissionNo: str(fd, 'admissionNo'),
        firstName: str(fd, 'firstName'),
        lastName: opt(fd, 'lastName'),
        dob: opt(fd, 'dob'),
        gender: str(fd, 'gender') || 'unspecified',
        category: opt(fd, 'category'),
        bloodGroup: opt(fd, 'bloodGroup'),
        house: opt(fd, 'house'),
        admittedOn: opt(fd, 'admittedOn'),
        guardians,
        enrolment: sectionId
          ? {
              classSectionId: sectionId,
              rollNo: opt(fd, 'rollNo') ? Number(str(fd, 'rollNo')) : undefined,
            }
          : undefined,
      }),
    });
  } catch (error) {
    if (error instanceof ApiError)
      back('/people/students/new', error.problem.type, error.problem.detail);
    throw error;
  }
  revalidatePath('/people/students');
  redirect(`/people/students/${created!.id}?ok=1`);
}

export async function updateStudent(fd: FormData) {
  const id = str(fd, 'id');
  return run(`/people/students/${id}`, () =>
    apiFetch(`/people/students/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        firstName: str(fd, 'firstName'),
        lastName: opt(fd, 'lastName') ?? null,
        dob: opt(fd, 'dob'),
        gender: str(fd, 'gender') || 'unspecified',
        category: opt(fd, 'category') ?? null,
        bloodGroup: opt(fd, 'bloodGroup') ?? null,
        house: opt(fd, 'house') ?? null,
        status: str(fd, 'status') || 'active',
      }),
    }),
  );
}

export async function linkGuardian(fd: FormData) {
  const id = str(fd, 'id');
  const [first, ...rest] = str(fd, 'guardianName').split(/\s+/);
  return run(`/people/students/${id}`, () =>
    apiFetch(`/people/students/${id}/guardians`, {
      method: 'POST',
      body: JSON.stringify({
        guardian: {
          firstName: first,
          lastName: rest.join(' ') || undefined,
          mobile: opt(fd, 'guardianMobile'),
          email: opt(fd, 'guardianEmail'),
        },
        relation: str(fd, 'relation') || 'guardian',
        isPrimary: fd.get('isPrimary') === 'on',
      }),
    }),
  );
}

export async function unlinkGuardian(fd: FormData) {
  const id = str(fd, 'id');
  const guardianId = str(fd, 'guardianId');
  return run(`/people/students/${id}`, () =>
    apiFetch(`/people/students/${id}/guardians/${guardianId}`, { method: 'DELETE' }),
  );
}

export async function enrolStudent(fd: FormData) {
  const id = str(fd, 'id');
  return run(`/people/students/${id}`, () =>
    apiFetch(`/people/students/${id}/enrolments`, {
      method: 'POST',
      body: JSON.stringify({
        classSectionId: str(fd, 'classSectionId'),
        rollNo: opt(fd, 'rollNo') ? Number(str(fd, 'rollNo')) : undefined,
        joinedOn: opt(fd, 'joinedOn'),
      }),
    }),
  );
}

export async function requestStudentIdCard(fd: FormData) {
  const id = str(fd, 'id');
  return run('/reports/exports', () =>
    apiFetch(`/people/students/${id}/id-card`, { method: 'POST', body: '{}' }),
  );
}

export async function createEmployee(fd: FormData) {
  let created: { id: string } | null = null;
  try {
    created = await apiFetch<{ id: string }>('/people/employees', {
      method: 'POST',
      body: JSON.stringify({
        employeeCode: str(fd, 'employeeCode'),
        firstName: str(fd, 'firstName'),
        lastName: opt(fd, 'lastName'),
        dob: opt(fd, 'dob'),
        gender: str(fd, 'gender') || 'unspecified',
        employeeType: str(fd, 'employeeType') || 'teaching',
        designation: opt(fd, 'designation'),
        department: opt(fd, 'department'),
        joinedOn: opt(fd, 'joinedOn'),
        mobile: opt(fd, 'mobile'),
        email: opt(fd, 'email'),
        posting: {
          reportsToEmployeeId: opt(fd, 'reportsToEmployeeId') ?? null,
          campusId: opt(fd, 'campusId') ?? null,
        },
      }),
    });
  } catch (error) {
    if (error instanceof ApiError)
      back('/people/employees', error.problem.type, error.problem.detail);
    throw error;
  }
  revalidatePath('/people/employees');
  redirect(`/people/employees/${created!.id}?ok=1`);
}

export async function updateEmployee(fd: FormData) {
  const id = str(fd, 'id');
  return run(`/people/employees/${id}`, () =>
    apiFetch(`/people/employees/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        firstName: str(fd, 'firstName'),
        lastName: opt(fd, 'lastName') ?? null,
        employeeType: str(fd, 'employeeType') || 'teaching',
        designation: opt(fd, 'designation') ?? null,
        department: opt(fd, 'department') ?? null,
        mobile: opt(fd, 'mobile'),
        email: opt(fd, 'email'),
        status: str(fd, 'status') || 'active',
      }),
    }),
  );
}

export async function upsertPosting(fd: FormData) {
  const id = str(fd, 'id');
  return run(`/people/employees/${id}`, () =>
    apiFetch(`/people/employees/${id}/postings`, {
      method: 'PUT',
      body: JSON.stringify({
        department: opt(fd, 'department'),
        designation: opt(fd, 'designation'),
        campusId: opt(fd, 'campusId') ?? null,
        reportsToEmployeeId: opt(fd, 'reportsToEmployeeId') ?? null,
        validFrom: opt(fd, 'validFrom'),
        validTo: opt(fd, 'validTo') ?? null,
      }),
    }),
  );
}

export async function requestEmployeeIdCard(fd: FormData) {
  const id = str(fd, 'id');
  return run('/reports/exports', () =>
    apiFetch(`/people/employees/${id}/id-card`, { method: 'POST', body: '{}' }),
  );
}

// ---- security (Sprint 5) -------------------------------------------------------------------------
export async function startImpersonation(fd: FormData) {
  const session = await readSession();
  if (!session) redirect('/login');
  let result: {
    token: string;
    session: { id: string; targetName: string; expiresAt: string };
  } | null = null;
  try {
    result = await apiFetch('/access/impersonation', {
      method: 'POST',
      body: JSON.stringify({
        userId: str(fd, 'userId'),
        reason: str(fd, 'reason'),
        minutes: Number(str(fd, 'minutes') || '30'),
      }),
    });
  } catch (error) {
    if (error instanceof ApiError && error.problem.type === 'mfa-required')
      redirect('/step-up?returnTo=%2Faccess%2Fmemberships');
    if (error instanceof ApiError)
      back('/access/memberships', error.problem.type, error.problem.detail);
    throw error;
  }
  await writeSession({
    ...session,
    accessToken: result!.token,
    impersonation: {
      sessionId: result!.session.id,
      targetName: result!.session.targetName,
      expiresAt: result!.session.expiresAt,
      originalAccessToken: session.accessToken,
    },
  });
  revalidatePath('/');
  redirect('/?ok=1');
}

export async function endImpersonation() {
  const session = await readSession();
  if (!session) redirect('/login');
  const imp = session.impersonation;
  if (imp) {
    await apiFetch(
      `/access/impersonation/${imp.sessionId}`,
      { method: 'DELETE' },
      { token: imp.originalAccessToken },
    ).catch(() => undefined);
    const { impersonation: _dropped, ...rest } = session;
    void _dropped;
    await writeSession({ ...rest, accessToken: imp.originalAccessToken });
  }
  revalidatePath('/');
  redirect('/access/memberships?ok=1');
}

export async function openBreakGlass(fd: FormData) {
  return run('/system/security', () =>
    apiFetch('/access/break-glass', {
      method: 'POST',
      body: JSON.stringify({
        reason: str(fd, 'reason'),
        roleCode: str(fd, 'roleCode') || 'school_admin',
        hours: Number(str(fd, 'hours') || '4'),
      }),
    }),
  );
}

// ---- Sprint 6: subjects ---------------------------------------------------------------------------
export async function createSubject(fd: FormData) {
  return run('/academics/subjects', () =>
    apiFetch('/academics/subjects', {
      method: 'POST',
      body: JSON.stringify({
        code: str(fd, 'code').toUpperCase(),
        name: str(fd, 'name'),
        kind: str(fd, 'kind') || 'scholastic',
        displayOrder: Number(str(fd, 'displayOrder') || '0'),
      }),
    }),
  );
}

export async function setSubjectStatus(fd: FormData) {
  const id = str(fd, 'id');
  return run('/academics/subjects', () =>
    apiFetch(`/academics/subjects/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: str(fd, 'status') }),
    }),
  );
}

export async function deleteSubject(fd: FormData) {
  const id = str(fd, 'id');
  return run('/academics/subjects', () =>
    apiFetch(`/academics/subjects/${id}`, { method: 'DELETE' }),
  );
}

export async function setClassSubjects(fd: FormData) {
  const classId = str(fd, 'classId');
  const electives = new Set(fd.getAll('elective').map(String));
  return run(`/academics/subjects?classId=${classId}`, () =>
    apiFetch(`/academics/classes/${classId}/subjects`, {
      method: 'PUT',
      body: JSON.stringify({
        subjects: fd.getAll('subjectIds').map((id) => ({
          subjectId: String(id),
          isElective: electives.has(String(id)),
        })),
      }),
    }),
  );
}

// ---- Sprint 6: teacher assignments ---------------------------------------------------------------
export async function createTeacherAssignment(fd: FormData) {
  return run('/academics/teacher-assignments', () =>
    apiFetch('/academics/teacher-assignments', {
      method: 'POST',
      body: JSON.stringify({
        employeeId: str(fd, 'employeeId'),
        classSectionId: str(fd, 'classSectionId'),
        kind: str(fd, 'kind'),
        subjectId: opt(fd, 'subjectId'),
        canMarkAttendance: fd.get('canMarkAttendance') !== null,
        canPostHomework: fd.get('canPostHomework') !== null,
        canAnswerQueries: fd.get('canAnswerQueries') !== null,
      }),
    }),
  );
}

export async function endTeacherAssignment(fd: FormData) {
  const id = str(fd, 'id');
  return run('/academics/teacher-assignments', () =>
    apiFetch(`/academics/teacher-assignments/${id}/end`, { method: 'POST' }),
  );
}

// ---- Sprint 6: timetable --------------------------------------------------------------------------
export async function createPeriod(fd: FormData) {
  return run('/academics/timetable', () =>
    apiFetch('/academics/timetable/periods', {
      method: 'POST',
      body: JSON.stringify({
        number: Number(str(fd, 'number')),
        name: str(fd, 'name'),
        startsAt: str(fd, 'startsAt'),
        endsAt: str(fd, 'endsAt'),
        kind: str(fd, 'kind') || 'teaching',
      }),
    }),
  );
}

export async function deletePeriod(fd: FormData) {
  const id = str(fd, 'id');
  return run('/academics/timetable', () =>
    apiFetch(`/academics/timetable/periods/${id}`, { method: 'DELETE' }),
  );
}

export async function setSlot(fd: FormData) {
  const classSectionId = str(fd, 'classSectionId');
  return run(`/academics/timetable?classSectionId=${classSectionId}`, () =>
    apiFetch('/academics/timetable/slots', {
      method: 'PUT',
      body: JSON.stringify({
        classSectionId,
        weekday: Number(str(fd, 'weekday')),
        periodId: str(fd, 'periodId'),
        subjectId: opt(fd, 'subjectId'),
        employeeId: opt(fd, 'employeeId'),
        room: opt(fd, 'room'),
      }),
    }),
  );
}

export async function clearSlot(fd: FormData) {
  const id = str(fd, 'id');
  const classSectionId = str(fd, 'classSectionId');
  return run(`/academics/timetable?classSectionId=${classSectionId}`, () =>
    apiFetch(`/academics/timetable/slots/${id}`, { method: 'DELETE' }),
  );
}

// ---- Sprint 6: imports ----------------------------------------------------------------------------
export async function validateImport(fd: FormData) {
  const file = fd.get('file');
  if (!(file instanceof File) || file.size === 0)
    back('/people/import', 'validation-failed', 'Choose a CSV file');
  let created: { id: string };
  try {
    created = await apiFetch<{ id: string }>('/people/imports/validate', {
      method: 'POST',
      body: JSON.stringify({
        kind: str(fd, 'kind') || 'students',
        fileName: (file as File).name.slice(0, 200),
        csv: await (file as File).text(),
      }),
    });
  } catch (error) {
    if (error instanceof ApiError) back('/people/import', error.problem.type, error.problem.detail);
    throw error;
  }
  redirect(`/people/import/${created.id}`);
}

export async function commitImport(fd: FormData) {
  const id = str(fd, 'id');
  return run(`/people/import/${id}`, () =>
    apiFetch(`/people/imports/${id}/commit`, { method: 'POST' }),
  );
}

export async function setStudentStatus(fd: FormData) {
  const id = str(fd, 'id');
  return run(`/people/students/${id}`, () =>
    apiFetch(`/people/students/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: str(fd, 'status'), statusReason: opt(fd, 'statusReason') }),
    }),
  );
}

// ---- Sprint 7: files (shared by daily work, notices and gallery) ---------------------------------
/** Uploads the files of a form field through the file service and returns the ready ids. */
async function uploadAll(
  fd: FormData,
  field: string,
  classification = 'internal',
): Promise<string[]> {
  const ids: string[] = [];
  for (const entry of fd.getAll(field)) {
    if (!(entry instanceof File) || entry.size === 0) continue;
    const reg = await apiFetch<{
      file: { id: string };
      upload: { url: string; method: string; headers?: Record<string, string> };
    }>('/platform/files', {
      method: 'POST',
      body: JSON.stringify({
        fileName: entry.name.slice(0, 200),
        contentType: entry.type,
        sizeBytes: entry.size,
        classification,
      }),
    });
    const target = reg.upload.url.startsWith('http')
      ? reg.upload.url
      : `${process.env.API_BASE_URL ?? 'http://localhost:4000'}${reg.upload.url}`;
    const headers: Record<string, string> = { 'content-type': entry.type };
    for (const [k, v] of Object.entries(reg.upload.headers ?? {})) headers[k] = v;
    const put = await fetch(target, {
      method: reg.upload.method || 'PUT',
      headers,
      body: Buffer.from(await entry.arrayBuffer()),
    });
    if (!put.ok) throw new ApiError(put.status, { type: 'file.upload_failed' });
    ids.push(reg.file.id);
  }
  return ids;
}

// ---- Sprint 7: daily work -----------------------------------------------------------------------
export async function postDailyWork(fd: FormData) {
  const back = str(fd, 'returnTo') || '/academics/daily-work';
  return run(back, async () => {
    const fileIds = await uploadAll(fd, 'files');
    await apiFetch('/academics/daily-work', {
      method: 'POST',
      body: JSON.stringify({
        classSectionId: str(fd, 'classSectionId'),
        subjectId: opt(fd, 'subjectId'),
        kind: str(fd, 'kind') || 'homework',
        title: str(fd, 'title'),
        body: str(fd, 'body'),
        assignedOn: opt(fd, 'assignedOn'),
        dueOn: opt(fd, 'dueOn'),
        fileIds,
      }),
    });
  });
}

export async function deleteDailyWork(fd: FormData) {
  const id = str(fd, 'id');
  return run(str(fd, 'returnTo') || '/academics/daily-work', () =>
    apiFetch(`/academics/daily-work/${id}`, { method: 'DELETE' }),
  );
}

// ---- Sprint 7: notices --------------------------------------------------------------------------
export async function createNotice(fd: FormData) {
  return run('/academics/notices', async () => {
    const fileIds = await uploadAll(fd, 'files');
    const targets = [
      ...fd.getAll('classIds').map((id) => ({ type: 'class', id: String(id) })),
      ...fd.getAll('classSectionIds').map((id) => ({ type: 'class_section', id: String(id) })),
    ];
    await apiFetch('/academics/notices', {
      method: 'POST',
      body: JSON.stringify({
        kind: str(fd, 'kind') || 'notice',
        title: str(fd, 'title'),
        body: str(fd, 'body'),
        audience: str(fd, 'audience') || 'everyone',
        publishFrom: opt(fd, 'publishFrom'),
        publishUntil: opt(fd, 'publishUntil'),
        isPinned: fd.get('isPinned') !== null,
        targets,
        fileIds,
        publish: fd.get('publish') !== null,
      }),
    });
  });
}

export async function publishNotice(fd: FormData) {
  const id = str(fd, 'id');
  const action = str(fd, 'action') === 'unpublish' ? 'unpublish' : 'publish';
  return run('/academics/notices', () =>
    apiFetch(`/academics/notices/${id}/${action}`, { method: 'POST' }),
  );
}

export async function deleteNotice(fd: FormData) {
  const id = str(fd, 'id');
  return run('/academics/notices', () =>
    apiFetch(`/academics/notices/${id}`, { method: 'DELETE' }),
  );
}

// ---- Sprint 7: calendar -------------------------------------------------------------------------
export async function createHoliday(fd: FormData) {
  return run('/academics/calendar', () =>
    apiFetch('/academics/calendar/holidays', {
      method: 'POST',
      body: JSON.stringify({
        name: str(fd, 'name'),
        kind: str(fd, 'kind') || 'holiday',
        startsOn: str(fd, 'startsOn'),
        endsOn: opt(fd, 'endsOn'),
        appliesTo: str(fd, 'appliesTo') || 'everyone',
      }),
    }),
  );
}

export async function deleteHoliday(fd: FormData) {
  const id = str(fd, 'id');
  return run('/academics/calendar', () =>
    apiFetch(`/academics/calendar/holidays/${id}`, { method: 'DELETE' }),
  );
}

export async function createEvent(fd: FormData) {
  return run('/academics/calendar', () =>
    apiFetch('/academics/calendar/events', {
      method: 'POST',
      body: JSON.stringify({
        title: str(fd, 'title'),
        kind: str(fd, 'kind') || 'event',
        startsOn: str(fd, 'startsOn'),
        endsOn: opt(fd, 'endsOn'),
        startsAt: opt(fd, 'startsAt'),
        description: opt(fd, 'description'),
        audience: str(fd, 'audience') || 'everyone',
      }),
    }),
  );
}

export async function deleteEvent(fd: FormData) {
  const id = str(fd, 'id');
  return run('/academics/calendar', () =>
    apiFetch(`/academics/calendar/events/${id}`, { method: 'DELETE' }),
  );
}

// ---- Sprint 7: gallery --------------------------------------------------------------------------
export async function createAlbum(fd: FormData) {
  return run('/academics/gallery', async () => {
    const fileIds = await uploadAll(fd, 'files', 'public');
    await apiFetch('/academics/gallery/albums', {
      method: 'POST',
      body: JSON.stringify({
        title: str(fd, 'title'),
        description: opt(fd, 'description'),
        eventOn: opt(fd, 'eventOn'),
        audience: str(fd, 'audience') || 'everyone',
        fileIds,
      }),
    });
  });
}

export async function addAlbumPhotos(fd: FormData) {
  const id = str(fd, 'id');
  return run(`/academics/gallery/${id}`, async () => {
    const fileIds = await uploadAll(fd, 'files', 'public');
    if (fileIds.length === 0)
      throw new ApiError(400, { type: 'validation-failed', detail: 'Choose at least one image' });
    await apiFetch(`/academics/gallery/albums/${id}/items`, {
      method: 'POST',
      body: JSON.stringify({ items: fileIds.map((fileId) => ({ fileId })) }),
    });
  });
}

export async function deleteAlbum(fd: FormData) {
  const id = str(fd, 'id');
  return run('/academics/gallery', () =>
    apiFetch(`/academics/gallery/albums/${id}`, { method: 'DELETE' }),
  );
}

// ---- Sprint 7: templates ------------------------------------------------------------------------
export async function installTemplateDefaults() {
  return run('/system/templates', () =>
    apiFetch('/platform/templates/defaults', { method: 'POST' }),
  );
}

export async function createDocumentTemplate(fd: FormData) {
  return run('/system/templates', () =>
    apiFetch('/platform/templates', {
      method: 'POST',
      body: JSON.stringify({
        code: str(fd, 'code'),
        name: str(fd, 'name'),
        kind: str(fd, 'kind'),
        pageWidth: str(fd, 'pageWidth') || '210mm',
        pageHeight: str(fd, 'pageHeight') || '297mm',
        bodyHtml: str(fd, 'bodyHtml'),
        stylesCss: str(fd, 'stylesCss'),
      }),
    }),
  );
}

export async function updateDocumentTemplate(fd: FormData) {
  const id = str(fd, 'id');
  return run(`/system/templates/${id}`, () =>
    apiFetch(`/platform/templates/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        name: str(fd, 'name'),
        pageWidth: str(fd, 'pageWidth') || '210mm',
        pageHeight: str(fd, 'pageHeight') || '297mm',
        bodyHtml: str(fd, 'bodyHtml'),
        stylesCss: str(fd, 'stylesCss'),
        status: str(fd, 'status') || 'active',
      }),
    }),
  );
}

export async function renderTemplateFor(fd: FormData) {
  const id = str(fd, 'templateId');
  const entityId = str(fd, 'entityId');
  return run(str(fd, 'returnTo') || '/reports/exports', () =>
    apiFetch(`/platform/templates/${id}/render`, {
      method: 'POST',
      body: JSON.stringify({
        entity: str(fd, 'entity') || 'student',
        entityId,
        title: opt(fd, 'title'),
      }),
    }),
  );
}

// ---- Sprint 7: transfer certificate, withdrawal, promotion ----------------------------------------
export async function issueTc(fd: FormData) {
  const studentId = str(fd, 'studentId');
  return run(`/people/students/${studentId}`, () =>
    apiFetch(`/people/students/${studentId}/tc`, {
      method: 'POST',
      body: JSON.stringify({
        reason: str(fd, 'reason'),
        issuedOn: opt(fd, 'issuedOn'),
        conduct: str(fd, 'conduct') || 'Good',
        promotionStatus: opt(fd, 'promotionStatus'),
        duesCleared: fd.get('duesCleared') !== null,
        remarks: opt(fd, 'remarks'),
      }),
    }),
  );
}

export async function renderTc(fd: FormData) {
  const id = str(fd, 'id');
  return run(str(fd, 'returnTo') || '/people/tc', () =>
    apiFetch(`/people/tc/${id}/render`, { method: 'POST' }),
  );
}

export async function cancelTc(fd: FormData) {
  const id = str(fd, 'id');
  return run(str(fd, 'returnTo') || '/people/tc', () =>
    apiFetch(`/people/tc/${id}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason: str(fd, 'reason') }),
    }),
  );
}

export async function requestWithdrawal(fd: FormData) {
  const studentId = str(fd, 'studentId');
  return run(`/people/students/${studentId}`, () =>
    apiFetch(`/people/students/${studentId}/withdrawal`, {
      method: 'POST',
      body: JSON.stringify({ leavingOn: str(fd, 'leavingOn'), reason: str(fd, 'reason') }),
    }),
  );
}

export async function recordClearance(fd: FormData) {
  const id = str(fd, 'id');
  return run(str(fd, 'returnTo') || `/people/withdrawals/${id}`, () =>
    apiFetch(`/people/withdrawals/${id}/clearances/${encodeURIComponent(str(fd, 'department'))}`, {
      method: 'PUT',
      body: JSON.stringify({
        status: str(fd, 'status') || 'cleared',
        dues: Number(str(fd, 'dues') || '0'),
        remarks: opt(fd, 'remarks'),
      }),
    }),
  );
}

export async function completeWithdrawal(fd: FormData) {
  const id = str(fd, 'id');
  return run(str(fd, 'returnTo') || `/people/withdrawals/${id}`, () =>
    apiFetch(`/people/withdrawals/${id}/complete`, { method: 'POST' }),
  );
}

export async function cancelWithdrawal(fd: FormData) {
  const id = str(fd, 'id');
  return run(str(fd, 'returnTo') || `/people/withdrawals/${id}`, () =>
    apiFetch(`/people/withdrawals/${id}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason: str(fd, 'reason') }),
    }),
  );
}

export async function savePromotions(fd: FormData) {
  const classId = str(fd, 'classId');
  const toYearId = str(fd, 'toYearId');
  const decisions: Array<{ studentId: string; decision: string; toClassSectionId?: string }> = [];
  for (const studentId of fd.getAll('studentIds').map(String)) {
    const decision = str(fd, `decision:${studentId}`);
    if (!decision) continue;
    const section = opt(fd, `section:${studentId}`);
    const entry: { studentId: string; decision: string; toClassSectionId?: string } = {
      studentId,
      decision,
    };
    if (section) entry.toClassSectionId = section;
    decisions.push(entry);
  }
  const back = `/people/promotions?classId=${classId}&toYearId=${toYearId}`;
  if (decisions.length === 0)
    redirect(`${back}&error=validation-failed&detail=No+decisions+chosen`);
  return run(back, () =>
    apiFetch('/people/promotions', {
      method: 'PUT',
      body: JSON.stringify({ toYearId, decisions }),
    }),
  );
}

export async function applyPromotions(fd: FormData) {
  const classId = str(fd, 'classId');
  const toYearId = str(fd, 'toYearId');
  return run(`/people/promotions?classId=${classId}&toYearId=${toYearId}`, () =>
    apiFetch('/people/promotions/apply', {
      method: 'POST',
      body: JSON.stringify({ toYearId, classId }),
    }),
  );
}

// ---- Sprint 8: admissions -----------------------------------------------------------------------
function criteriaFrom(fd: FormData) {
  const classIds = fd.getAll('criteriaClassId').map(String);
  return classIds
    .map((classId, i) => ({
      classId,
      seats: Number(fd.getAll('criteriaSeats')[i] ?? 0),
      dobFrom: String(fd.getAll('criteriaDobFrom')[i] ?? '') || undefined,
      dobTo: String(fd.getAll('criteriaDobTo')[i] ?? '') || undefined,
      passcode: String(fd.getAll('criteriaPasscode')[i] ?? '') || undefined,
    }))
    .filter((k) => k.classId);
}

function scoringFrom(fd: FormData) {
  const codes = fd.getAll('scoreCode').map(String);
  return codes
    .map((code, i) => ({
      code,
      name: String(fd.getAll('scoreName')[i] ?? ''),
      points: Number(fd.getAll('scorePoints')[i] ?? 0),
      autoRule: String(fd.getAll('scoreRule')[i] ?? '') || undefined,
    }))
    .filter((s) => s.code && s.name);
}

export async function createAdmissionCycle(fd: FormData) {
  return run('/admissions/cycles', () =>
    apiFetch('/admissions/cycles', {
      method: 'POST',
      body: JSON.stringify({
        academicYearId: str(fd, 'academicYearId'),
        code: str(fd, 'code').toUpperCase(),
        name: str(fd, 'name'),
        nameHi: opt(fd, 'nameHi'),
        instructions: opt(fd, 'instructions'),
        instructionsHi: opt(fd, 'instructionsHi'),
        opensAt: new Date(str(fd, 'opensAt')).toISOString(),
        closesAt: new Date(str(fd, 'closesAt')).toISOString(),
        applicationFee: Number(str(fd, 'applicationFee') || '0'),
        criteria: criteriaFrom(fd),
        scoreCriteria: scoringFrom(fd),
      }),
    }),
  );
}

export async function updateAdmissionCycle(fd: FormData) {
  const id = str(fd, 'id');
  const body: Record<string, unknown> = {};
  if (fd.has('name')) {
    body.name = str(fd, 'name');
    body.nameHi = opt(fd, 'nameHi') ?? null;
    body.instructions = opt(fd, 'instructions') ?? null;
    body.instructionsHi = opt(fd, 'instructionsHi') ?? null;
    body.opensAt = new Date(str(fd, 'opensAt')).toISOString();
    body.closesAt = new Date(str(fd, 'closesAt')).toISOString();
    body.applicationFee = Number(str(fd, 'applicationFee') || '0');
    body.criteria = criteriaFrom(fd);
    body.scoreCriteria = scoringFrom(fd);
  }
  if (fd.has('status')) body.status = str(fd, 'status');
  return run(`/admissions/cycles/${id}`, () =>
    apiFetch(`/admissions/cycles/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  );
}

export async function setApplicationStatus(fd: FormData) {
  const id = str(fd, 'id');
  return run(`/admissions/applications/${id}`, () =>
    apiFetch(`/admissions/applications/${id}/status`, {
      method: 'POST',
      body: JSON.stringify({ status: str(fd, 'status'), note: opt(fd, 'note') }),
    }),
  );
}

export async function scoreApplication(fd: FormData) {
  const id = str(fd, 'id');
  return run(`/admissions/applications/${id}`, () =>
    apiFetch(`/admissions/applications/${id}/score`, {
      method: 'POST',
      body: JSON.stringify({ award: fd.getAll('award').map(String), remarks: opt(fd, 'remarks') }),
    }),
  );
}

// ---- Sprint 8: fees -----------------------------------------------------------------------------
export async function createFeeHead(fd: FormData) {
  return run('/fees/masters', () =>
    apiFetch('/fees/heads', {
      method: 'POST',
      body: JSON.stringify({
        code: str(fd, 'code').toUpperCase(),
        name: str(fd, 'name'),
        kind: str(fd, 'kind') || 'regular',
        ledger: str(fd, 'ledger') || 'school',
        isOptional: fd.get('isOptional') !== null,
        refundable: fd.get('refundable') !== null,
        sortOrder: Number(str(fd, 'sortOrder') || '0'),
      }),
    }),
  );
}

export async function setFeeHeadStatus(fd: FormData) {
  const id = str(fd, 'id');
  return run('/fees/masters', () =>
    apiFetch(`/fees/heads/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: str(fd, 'status') }),
    }),
  );
}

export async function generateFeePeriods(fd: FormData) {
  return run('/fees/masters', () =>
    apiFetch('/fees/periods/generate', {
      method: 'POST',
      body: JSON.stringify({
        dueDay: Number(str(fd, 'dueDay') || '10'),
        monthsPerInstalment: Number(str(fd, 'monthsPerInstalment') || '3'),
      }),
    }),
  );
}

export async function createTransportSlab(fd: FormData) {
  return run('/fees/masters', () =>
    apiFetch('/fees/slabs', {
      method: 'POST',
      body: JSON.stringify({
        code: str(fd, 'code').toUpperCase(),
        name: str(fd, 'name'),
        distanceFromKm: opt(fd, 'distanceFromKm') ? Number(str(fd, 'distanceFromKm')) : undefined,
        distanceToKm: opt(fd, 'distanceToKm') ? Number(str(fd, 'distanceToKm')) : undefined,
        monthlyAmount: Number(str(fd, 'monthlyAmount') || '0'),
      }),
    }),
  );
}

export async function createFeeDiscount(fd: FormData) {
  const mode = str(fd, 'mode') || 'percent';
  return run('/fees/masters', () =>
    apiFetch('/fees/discounts', {
      method: 'POST',
      body: JSON.stringify({
        code: str(fd, 'code').toUpperCase(),
        name: str(fd, 'name'),
        headId: opt(fd, 'headId'),
        percent: mode === 'percent' ? Number(str(fd, 'value') || '0') : undefined,
        amount: mode === 'amount' ? Number(str(fd, 'value') || '0') : undefined,
        appliesToTransport: fd.get('appliesToTransport') !== null,
      }),
    }),
  );
}

export async function setFeeStructure(fd: FormData) {
  const classId = str(fd, 'classId');
  const feeGroup = str(fd, 'feeGroup') || 'general';
  const entries: Array<{ headId: string; amount: number; frequency: string; studentType: string }> =
    [];
  for (const headId of fd.getAll('headIds').map(String)) {
    const amount = Number(str(fd, `amount:${headId}`) || '0');
    if (amount <= 0) continue;
    entries.push({
      headId,
      amount,
      frequency: str(fd, `frequency:${headId}`) || 'monthly',
      studentType: str(fd, `studentType:${headId}`) || 'all',
    });
  }
  return run(`/fees/structures?classId=${classId}`, () =>
    apiFetch(`/fees/structures/${classId}`, {
      method: 'PUT',
      body: JSON.stringify({ feeGroup, entries }),
    }),
  );
}

export async function setFeeProfile(fd: FormData) {
  const studentId = str(fd, 'studentId');
  return run(`/people/students/${studentId}`, () =>
    apiFetch(`/fees/students/${studentId}/profile`, {
      method: 'PUT',
      body: JSON.stringify({
        feeGroup: str(fd, 'feeGroup') || 'general',
        studentType: str(fd, 'studentType') || 'old',
        transportSlabId: opt(fd, 'transportSlabId') ?? null,
        transportDisabled: fd.get('transportDisabled') !== null,
        discountId: opt(fd, 'discountId') ?? null,
        openingBalance: Number(str(fd, 'openingBalance') || '0'),
        notes: opt(fd, 'notes'),
      }),
    }),
  );
}

export async function generateStudentDemand(fd: FormData) {
  const studentId = str(fd, 'studentId');
  return run(str(fd, 'returnTo') || `/people/students/${studentId}`, () =>
    apiFetch(`/fees/students/${studentId}/demands/generate`, { method: 'POST' }),
  );
}

export async function generateClassDemand(fd: FormData) {
  const classId = str(fd, 'classId');
  return run(`/fees/demands?classId=${classId}`, () =>
    apiFetch('/fees/demands/generate', { method: 'POST', body: JSON.stringify({ classId }) }),
  );
}
