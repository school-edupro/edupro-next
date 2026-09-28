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
  if (fd.has('formSchema')) {
    try {
      body.formSchema = JSON.parse(str(fd, 'formSchema')) as unknown;
    } catch {
      back(
        `/admissions/cycles/${id}`,
        'validation-failed',
        'The form schema must be a JSON array of fields',
      );
    }
  }
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
        instalmentsOverride: opt(fd, 'instalmentsOverride')
          ? Number(str(fd, 'instalmentsOverride'))
          : null,
        hosteller: fd.get('hosteller') !== null,
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

// ---- Sprint 9: workflow, admissions decisions, payments, attendance --------------------------------
export async function installWorkflowDefaults() {
  return run('/workflow/definitions', () =>
    apiFetch('/workflow/definitions/defaults', { method: 'POST' }),
  );
}

export async function actOnStep(fd: FormData) {
  const id = str(fd, 'id');
  const decision = str(fd, 'decision') === 'reject' ? 'reject' : 'approve';
  return run('/workflow/inbox', () =>
    apiFetch(`/workflow/steps/${id}/${decision}`, {
      method: 'POST',
      body: JSON.stringify({ note: opt(fd, 'note') }),
    }),
  );
}

export async function shortlistCycle(fd: FormData) {
  const id = str(fd, 'cycleId');
  const body: Record<string, unknown> = { classId: str(fd, 'classId') };
  if (opt(fd, 'minScore')) body.minScore = Number(str(fd, 'minScore'));
  if (opt(fd, 'count')) body.count = Number(str(fd, 'count'));
  return run(`/admissions/cycles/${id}`, () =>
    apiFetch(`/admissions/cycles/${id}/shortlist`, { method: 'POST', body: JSON.stringify(body) }),
  );
}

export async function drawCycle(fd: FormData) {
  const id = str(fd, 'cycleId');
  const body: Record<string, unknown> = { classId: str(fd, 'classId') };
  if (opt(fd, 'seats')) body.seats = Number(str(fd, 'seats'));
  if (opt(fd, 'seed')) body.seed = str(fd, 'seed');
  return run(`/admissions/cycles/${id}`, () =>
    apiFetch(`/admissions/cycles/${id}/draw`, { method: 'POST', body: JSON.stringify(body) }),
  );
}

export async function requestCycleApprovals(fd: FormData) {
  const id = str(fd, 'cycleId');
  return run(`/admissions/cycles/${id}`, () =>
    apiFetch(`/admissions/cycles/${id}/request-approvals`, {
      method: 'POST',
      body: JSON.stringify({ classId: opt(fd, 'classId') }),
    }),
  );
}

export async function requestApplicationApproval(fd: FormData) {
  const id = str(fd, 'id');
  return run(`/admissions/applications/${id}`, () =>
    apiFetch(`/admissions/applications/${id}/request-approval`, { method: 'POST' }),
  );
}

export async function admitApplication(fd: FormData) {
  const id = str(fd, 'id');
  return run(`/admissions/applications/${id}`, () =>
    apiFetch(`/admissions/applications/${id}/admit`, {
      method: 'POST',
      body: JSON.stringify({
        classSectionId: opt(fd, 'classSectionId'),
        rollNo: opt(fd, 'rollNo') ? Number(str(fd, 'rollNo')) : undefined,
        waiveFeeCheck: fd.get('waiveFeeCheck') === 'on',
      }),
    }),
  );
}

export async function recordOfflinePayment(fd: FormData) {
  return run('/fees/payments', () =>
    apiFetch('/payments/offline', {
      method: 'POST',
      body: JSON.stringify({
        studentId: str(fd, 'studentId'),
        amount: Number(str(fd, 'amount')),
        mode: str(fd, 'mode') || 'cash',
        reference: opt(fd, 'reference'),
        receivedOn: opt(fd, 'receivedOn'),
        remarks: opt(fd, 'remarks'),
      }),
    }),
  );
}

export async function markAttendance(fd: FormData) {
  const classSectionId = str(fd, 'classSectionId');
  const date = str(fd, 'date');
  const subjectId = opt(fd, 'subjectId');
  const marks: Array<{ studentId: string; code: string; remarks?: string }> = [];
  for (const [key, value] of fd.entries()) {
    if (!key.startsWith('code-') || typeof value !== 'string' || !value) continue;
    const studentId = key.slice(5);
    marks.push({ studentId, code: value, remarks: opt(fd, `remarks-${studentId}`) });
  }
  const back = `/attendance/register?classSectionId=${classSectionId}&date=${date}${subjectId ? `&subjectId=${subjectId}` : ''}`;
  return run(back, () =>
    apiFetch('/attendance/sessions', {
      method: 'POST',
      body: JSON.stringify({
        classSectionId,
        date,
        kind: subjectId ? 'subject' : 'day',
        subjectId,
        marks,
        notes: opt(fd, 'notes'),
      }),
    }),
  );
}

export async function lockAttendance(fd: FormData) {
  const id = str(fd, 'sessionId');
  const back = `/attendance/register?classSectionId=${str(fd, 'classSectionId')}&date=${str(fd, 'date')}`;
  return run(back, () =>
    apiFetch(`/attendance/sessions/${id}/lock`, {
      method: 'PUT',
      body: JSON.stringify({ locked: str(fd, 'locked') === 'true' }),
    }),
  );
}

/** Creates a reader; the key is shown once on the redirect target and never stored in clear. */
export async function createRfidDevice(fd: FormData) {
  let key = '';
  try {
    const r = await apiFetch<{ apiKey: string }>('/attendance/rfid/devices', {
      method: 'POST',
      body: JSON.stringify({
        code: str(fd, 'code').toUpperCase(),
        name: str(fd, 'name'),
        direction: opt(fd, 'direction'),
        kind: str(fd, 'kind') || 'gate',
        routeId: opt(fd, 'routeId'),
      }),
    });
    key = r.apiKey;
  } catch (error) {
    if (error instanceof ApiError)
      back('/attendance/rfid', error.problem.type, error.problem.detail);
    throw error;
  }
  revalidatePath('/attendance/rfid');
  redirect(`/attendance/rfid?ok=1&key=${encodeURIComponent(key)}`);
}

// ---- Sprint 10: communication, engagement, transport, devices ------------------------------------------
function requestBody(fd: FormData) {
  const audience = str(fd, 'audience') || 'class_section';
  const targetType =
    audience === 'class'
      ? 'class'
      : audience === 'class_section'
        ? 'class_section'
        : audience === 'route'
          ? 'route'
          : audience === 'group'
            ? 'group'
            : 'user';
  const targets = fd
    .getAll('targetId')
    .map(String)
    .filter(Boolean)
    .map((id) => ({ type: targetType, id }));
  return {
    title: str(fd, 'title'),
    category: str(fd, 'category') || 'general',
    templateId: str(fd, 'templateId'),
    body: str(fd, 'body'),
    audience,
    targets: ['everyone', 'students', 'employees'].includes(audience) ? [] : targets,
    scheduledAt: opt(fd, 'scheduledAt')
      ? new Date(str(fd, 'scheduledAt')).toISOString()
      : undefined,
  };
}

/** Compose → preview: re-renders the compose page with the draft in the query string and the recipient count. */
export async function previewRequest(fd: FormData) {
  const body = requestBody(fd);
  const params = new URLSearchParams();
  params.set('title', body.title);
  params.set('category', body.category);
  params.set('templateId', body.templateId);
  params.set('body', body.body);
  params.set('audience', body.audience);
  for (const t of body.targets) params.append('targetId', t.id);
  if (fd.get('scheduledAt')) params.set('scheduledAt', str(fd, 'scheduledAt'));
  params.set('preview', '1');
  redirect(`/comms/compose?${params.toString()}`);
}

export async function submitRequest(fd: FormData) {
  return run('/comms/requests', () =>
    apiFetch('/comms/requests', { method: 'POST', body: JSON.stringify(requestBody(fd)) }),
  );
}

export async function cancelRequest(fd: FormData) {
  const id = str(fd, 'id');
  return run(`/comms/requests/${id}`, () =>
    apiFetch(`/comms/requests/${id}/cancel`, { method: 'POST' }),
  );
}

export async function createGroup(fd: FormData) {
  return run('/comms/groups', () =>
    apiFetch('/comms/groups', {
      method: 'POST',
      body: JSON.stringify({
        code: str(fd, 'code').toLowerCase(),
        name: str(fd, 'name'),
        description: opt(fd, 'description'),
        userIds: fd.getAll('userIds').map(String).filter(Boolean),
      }),
    }),
  );
}

export async function updateGroupMembers(fd: FormData) {
  const id = str(fd, 'id');
  return run(`/comms/groups?group=${id}`, () =>
    apiFetch(`/comms/groups/${id}/members`, {
      method: 'PUT',
      body: JSON.stringify({
        add: fd.getAll('add').map(String).filter(Boolean),
        remove: fd.getAll('remove').map(String).filter(Boolean),
      }),
    }),
  );
}

export async function recordConsent(fd: FormData) {
  const userId = str(fd, 'userId');
  return run(`/comms/consents?userId=${userId}`, () =>
    apiFetch('/comms/consents', {
      method: 'POST',
      body: JSON.stringify({
        userId,
        purposeCode: str(fd, 'purposeCode'),
        status: str(fd, 'status'),
        note: opt(fd, 'note'),
      }),
    }),
  );
}

export async function respondToQuery(fd: FormData) {
  const id = str(fd, 'id');
  return run(`/engagement/queries/${id}`, () =>
    apiFetch(`/engagement/queries/${id}/responses`, {
      method: 'POST',
      body: JSON.stringify({ body: str(fd, 'body'), isInternal: fd.get('isInternal') === 'on' }),
    }),
  );
}

export async function closeQuery(fd: FormData) {
  const id = str(fd, 'id');
  return run(`/engagement/queries/${id}`, () =>
    apiFetch(`/engagement/queries/${id}/close`, {
      method: 'POST',
      body: JSON.stringify({ decision: opt(fd, 'decision'), note: opt(fd, 'note') }),
    }),
  );
}

export async function assignQuery(fd: FormData) {
  const id = str(fd, 'id');
  return run(`/engagement/queries/${id}`, () =>
    apiFetch(`/engagement/queries/${id}/assign`, {
      method: 'POST',
      body: JSON.stringify({ userId: opt(fd, 'userId') ?? null }),
    }),
  );
}

export async function decideChangeRequest(fd: FormData) {
  const id = str(fd, 'id');
  return run('/engagement/change-requests', () =>
    apiFetch(`/engagement/change-requests/${id}/decide`, {
      method: 'POST',
      body: JSON.stringify({ approve: str(fd, 'approve') === 'true', note: opt(fd, 'note') }),
    }),
  );
}

export async function createRoute(fd: FormData) {
  return run('/transport/routes', () =>
    apiFetch('/transport/routes', {
      method: 'POST',
      body: JSON.stringify({
        code: str(fd, 'code'),
        name: str(fd, 'name'),
        vehicleNo: opt(fd, 'vehicleNo'),
        driverName: opt(fd, 'driverName'),
        driverMobile: opt(fd, 'driverMobile'),
      }),
    }),
  );
}

export async function assignRouteStudents(fd: FormData) {
  const id = str(fd, 'id');
  const assignments = fd
    .getAll('studentId')
    .map(String)
    .filter(Boolean)
    .map((studentId) => ({
      studentId,
      stopId: opt(fd, 'stopId'),
      stopName: opt(fd, 'stopName'),
      pickupTime: opt(fd, 'pickupTime'),
      dropTime: opt(fd, 'dropTime'),
    }));
  return run(`/transport/routes/${id}`, () =>
    apiFetch(`/transport/routes/${id}/students`, {
      method: 'PUT',
      body: JSON.stringify({ assignments }),
    }),
  );
}

export async function unassignRouteStudent(fd: FormData) {
  const id = str(fd, 'id');
  return run(`/transport/routes/${id}`, () =>
    apiFetch(`/transport/routes/${id}/students/${str(fd, 'studentId')}`, { method: 'DELETE' }),
  );
}

// ---- Sprint 11: substitutions, attendance rules, route rules, privacy notice, fee instalments ----------------
export async function createSubstitution(fd: FormData) {
  const date = str(fd, 'onDate');
  return run(`/academics/substitutions?date=${date}`, () =>
    apiFetch('/academics/substitutions', {
      method: 'POST',
      body: JSON.stringify({
        onDate: date,
        classSectionId: str(fd, 'classSectionId'),
        periodId: str(fd, 'periodId'),
        substituteEmployeeId: str(fd, 'substituteEmployeeId'),
        reason: opt(fd, 'reason'),
        note: opt(fd, 'note'),
      }),
    }),
  );
}

export async function removeSubstitution(fd: FormData) {
  const date = str(fd, 'onDate');
  return run(`/academics/substitutions?date=${date}`, () =>
    apiFetch(`/academics/substitutions/${str(fd, 'id')}`, { method: 'DELETE' }),
  );
}

export async function setAttendanceRule(fd: FormData) {
  const studentId = str(fd, 'studentId');
  const back = opt(fd, 'back') ?? '/attendance/rules';
  return run(back, () =>
    apiFetch(`/attendance/rules/${studentId}`, {
      method: 'PUT',
      body: JSON.stringify({
        lateAfter: opt(fd, 'lateAfter'),
        alertsMuted: fd.get('alertsMuted') === 'on',
        reason: opt(fd, 'reason'),
        validTo: opt(fd, 'validTo'),
      }),
    }),
  );
}

export async function clearAttendanceRule(fd: FormData) {
  const back = opt(fd, 'back') ?? '/attendance/rules';
  return run(back, () =>
    apiFetch(`/attendance/rules/${str(fd, 'studentId')}`, { method: 'DELETE' }),
  );
}

export async function updateRouteRules(fd: FormData) {
  const id = str(fd, 'id');
  return run(`/transport/routes/${id}`, () =>
    apiFetch(`/transport/routes/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        alertBoarding: fd.get('alertBoarding') === 'on',
        alertAlighting: fd.get('alertAlighting') === 'on',
        lateAfter: opt(fd, 'lateAfter') ?? null,
      }),
    }),
  );
}

export async function publishPrivacyNotice(fd: FormData) {
  return run('/system/privacy', () =>
    apiFetch('/engagement/privacy-notices', {
      method: 'POST',
      body: JSON.stringify({
        title: str(fd, 'title'),
        body: str(fd, 'body'),
        bodyHi: opt(fd, 'bodyHi'),
      }),
    }),
  );
}

// ---- Sprint 12: fee ledger, receipts, fleet, insights ------------------------------------------------
export async function regenerateStudentDemand(fd: FormData) {
  const studentId = str(fd, 'studentId');
  return run(`/fees/ledger/${studentId}`, () =>
    apiFetch(`/fees/students/${studentId}/demands/regenerate`, { method: 'POST' }),
  );
}

export async function setLateFeeOverride(fd: FormData) {
  const studentId = str(fd, 'studentId');
  return run(`/fees/ledger/${studentId}`, () =>
    apiFetch(`/fees/students/${studentId}/late-fee`, {
      method: 'PUT',
      body: JSON.stringify({
        periodId: str(fd, 'periodId'),
        amount: Number(str(fd, 'amount') || '0'),
        reason: str(fd, 'reason'),
      }),
    }),
  );
}

export async function revokeLateFeeOverride(fd: FormData) {
  const studentId = str(fd, 'studentId');
  const id = str(fd, 'overrideId');
  return run(`/fees/ledger/${studentId}`, () =>
    apiFetch(`/fees/students/${studentId}/late-fee/${id}`, { method: 'DELETE' }),
  );
}

export async function queueReceiptPdf(fd: FormData) {
  const studentId = str(fd, 'studentId');
  const id = str(fd, 'paymentId');
  return run(`/fees/ledger/${studentId}`, () =>
    apiFetch(`/fees/payments/${id}/receipt`, { method: 'POST' }),
  );
}

export async function recordLedgerPayment(fd: FormData) {
  const studentId = str(fd, 'studentId');
  return run(`/fees/ledger/${studentId}`, () =>
    apiFetch('/payments/offline', {
      method: 'POST',
      body: JSON.stringify({
        studentId,
        amount: Number(str(fd, 'amount')),
        mode: str(fd, 'mode') || 'cash',
        reference: opt(fd, 'reference'),
        receivedOn: opt(fd, 'receivedOn'),
        remarks: opt(fd, 'remarks'),
      }),
    }),
  );
}

export async function setPeriodLateFee(fd: FormData) {
  const id = str(fd, 'periodId');
  const slabs: Array<{ on: string; amount: number }> = [];
  for (const n of [1, 2, 3]) {
    const on = opt(fd, `slab${n}On`);
    if (on) slabs.push({ on, amount: Number(str(fd, `slab${n}Amount`) || '0') });
  }
  return run('/fees/masters', () =>
    apiFetch(`/fees/periods/${id}/late-fee`, {
      method: 'PUT',
      body: JSON.stringify({
        lateFeeAmount: Number(str(fd, 'lateFeeAmount') || '0'),
        slabs,
        visibleFrom: opt(fd, 'visibleFrom') ?? null,
      }),
    }),
  );
}

export async function setReceiptSequence(fd: FormData) {
  return run('/fees/masters', () =>
    apiFetch('/fees/receipt-sequences', {
      method: 'PUT',
      body: JSON.stringify({
        ledger: str(fd, 'ledger'),
        financialYearId: str(fd, 'financialYearId'),
        prefix: str(fd, 'prefix'),
        width: Number(str(fd, 'width') || '6'),
        startAt: Number(str(fd, 'startAt') || '1'),
      }),
    }),
  );
}

export async function createVehicle(fd: FormData) {
  return run('/transport/vehicles', () =>
    apiFetch('/transport/vehicles', {
      method: 'POST',
      body: JSON.stringify({
        regNo: str(fd, 'regNo'),
        make: opt(fd, 'make'),
        capacity: opt(fd, 'capacity') ? Number(str(fd, 'capacity')) : undefined,
        insuranceExpiry: opt(fd, 'insuranceExpiry'),
        fitnessExpiry: opt(fd, 'fitnessExpiry'),
        permitExpiry: opt(fd, 'permitExpiry'),
        gpsDeviceId: opt(fd, 'gpsDeviceId'),
      }),
    }),
  );
}

export async function setVehicleStatus(fd: FormData) {
  const id = str(fd, 'id');
  return run('/transport/vehicles', () =>
    apiFetch(`/transport/vehicles/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: str(fd, 'status') }),
    }),
  );
}

export async function createDriver(fd: FormData) {
  return run('/transport/drivers', () =>
    apiFetch('/transport/drivers', {
      method: 'POST',
      body: JSON.stringify({
        name: str(fd, 'name'),
        mobile: opt(fd, 'mobile'),
        licenceNo: opt(fd, 'licenceNo'),
        licenceExpiry: opt(fd, 'licenceExpiry'),
      }),
    }),
  );
}

export async function setDriverStatus(fd: FormData) {
  const id = str(fd, 'id');
  return run('/transport/drivers', () =>
    apiFetch(`/transport/drivers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: str(fd, 'status') }),
    }),
  );
}

export async function setRouteFleet(fd: FormData) {
  const id = str(fd, 'id');
  return run(`/transport/routes/${id}`, () =>
    apiFetch(`/transport/routes/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        vehicleId: opt(fd, 'vehicleId') ?? null,
        driverId: opt(fd, 'driverId') ?? null,
        conductorName: opt(fd, 'conductorName') ?? null,
        conductorMobile: opt(fd, 'conductorMobile') ?? null,
      }),
    }),
  );
}

/** Stops arrive as parallel field lists (stopId[], stopName[], ...); blank names are dropped. */
export async function setRouteStops(fd: FormData) {
  const id = str(fd, 'id');
  const ids = fd.getAll('stopId').map(String);
  const names = fd.getAll('stopName').map(String);
  const lats = fd.getAll('lat').map(String);
  const lngs = fd.getAll('lng').map(String);
  const pickups = fd.getAll('pickupTime').map(String);
  const drops = fd.getAll('dropTime').map(String);
  const slabs = fd.getAll('slabId').map(String);
  const stops = names
    .map((name, i) => ({
      id: ids[i] || undefined,
      name: name.trim(),
      lat: lats[i]?.trim() ? Number(lats[i]) : undefined,
      lng: lngs[i]?.trim() ? Number(lngs[i]) : undefined,
      pickupTime: pickups[i]?.trim() || undefined,
      dropTime: drops[i]?.trim() || undefined,
      slabId: slabs[i]?.trim() || undefined,
    }))
    .filter((s) => s.name);
  return run(`/transport/routes/${id}`, () =>
    apiFetch(`/transport/routes/${id}/stops`, { method: 'PUT', body: JSON.stringify({ stops }) }),
  );
}

export async function refreshMarts() {
  return run('/insights/principal', () => apiFetch('/insights/marts/refresh', { method: 'POST' }));
}

// ---- Sprint 13: cashier, refunds, settlements, transport requests, vehicle logs --------------------
export async function postCashierReceipt(fd: FormData) {
  const studentId = str(fd, 'studentId');
  const back = `/fees/cashier?studentId=${studentId}`;
  let out: { paymentId: string; receiptNo: string | null } | null = null;
  try {
    out = await apiFetch<{ paymentId: string; receiptNo: string | null }>('/payments/receipts', {
      method: 'POST',
      body: JSON.stringify({
        studentId,
        amount: Number(str(fd, 'amount')),
        mode: str(fd, 'mode') || 'cash',
        reference: opt(fd, 'reference'),
        receivedOn: opt(fd, 'receivedOn'),
        remarks: opt(fd, 'remarks'),
        instrumentNo: opt(fd, 'instrumentNo'),
        instrumentDate: opt(fd, 'instrumentDate'),
        bankName: opt(fd, 'bankName'),
        ledger: str(fd, 'ledger') || 'school',
        collectLateFee: str(fd, 'collectLateFee') !== 'no',
      }),
    });
  } catch (error) {
    if (error instanceof ApiError && error.problem.type === 'mfa-required')
      redirect(`/step-up?returnTo=${encodeURIComponent(back)}`);
    if (error instanceof ApiError) back_(back, error.problem.type, error.problem.detail);
    throw error;
  }
  redirect(
    `${back}&ok=1&paymentId=${out!.paymentId}&receiptNo=${encodeURIComponent(out!.receiptNo ?? '')}`,
  );
}

function back_(path: string, type: string, detail?: string): never {
  const sep = path.includes('?') ? '&' : '?';
  redirect(
    `${path}${sep}error=${encodeURIComponent(type)}${detail ? `&detail=${encodeURIComponent(String(detail).slice(0, 200))}` : ''}`,
  );
}

export async function queueCashierReceiptPdf(fd: FormData) {
  const studentId = str(fd, 'studentId');
  const id = str(fd, 'paymentId');
  const back = `/fees/cashier?studentId=${studentId}`;
  try {
    await apiFetch(`/fees/payments/${id}/receipt`, { method: 'POST' });
  } catch (error) {
    if (error instanceof ApiError && error.problem.type === 'mfa-required')
      redirect(`/step-up?returnTo=${encodeURIComponent(back)}`);
    if (error instanceof ApiError) back_(back, error.problem.type, error.problem.detail);
    throw error;
  }
  redirect(`${back}&ok=1`);
}

export async function requestRefund(fd: FormData) {
  const studentId = str(fd, 'studentId');
  const paymentId = str(fd, 'paymentId');
  return run(`/fees/ledger/${studentId}`, () =>
    apiFetch(`/payments/receipts/${paymentId}/refunds`, {
      method: 'POST',
      body: JSON.stringify({
        amount: Number(str(fd, 'amount')),
        reason: str(fd, 'reason'),
        mode: str(fd, 'mode') || 'bank',
        reference: opt(fd, 'reference'),
      }),
    }),
  );
}

export async function decideRefund(fd: FormData) {
  const id = str(fd, 'id');
  const back = str(fd, 'back') || '/fees/refunds';
  return run(back, () =>
    apiFetch(`/payments/refunds/${id}/decide`, {
      method: 'POST',
      body: JSON.stringify({
        outcome: str(fd, 'outcome') === 'rejected' ? 'rejected' : 'approved',
        note: opt(fd, 'note'),
        reference: opt(fd, 'reference'),
      }),
    }),
  );
}

export async function uploadSettlement(fd: FormData) {
  const file = fd.get('file');
  let csv = str(fd, 'csv');
  let fileName: string | undefined;
  if (file && typeof file === 'object' && 'text' in file && (file as File).size > 0) {
    csv = await (file as File).text();
    fileName = (file as File).name;
  }
  return run('/fees/settlements', () =>
    apiFetch('/payments/settlements', {
      method: 'POST',
      body: JSON.stringify({
        provider: str(fd, 'provider') || 'razorpay',
        settlementRef: str(fd, 'settlementRef'),
        settledOn: str(fd, 'settledOn'),
        utr: opt(fd, 'utr'),
        fileName,
        csv,
      }),
    }),
  );
}

export async function decideTransportRequest(fd: FormData) {
  const id = str(fd, 'id');
  return run('/transport/requests', () =>
    apiFetch(`/transport/requests/${id}/decide`, {
      method: 'POST',
      body: JSON.stringify({
        outcome: str(fd, 'outcome') === 'rejected' ? 'rejected' : 'approved',
        note: opt(fd, 'note'),
      }),
    }),
  );
}

export async function addVehicleLog(fd: FormData) {
  const vehicleId = str(fd, 'vehicleId');
  const num = (k: string) => (opt(fd, k) ? Number(str(fd, k)) : undefined);
  return run(`/transport/vehicles/${vehicleId}`, () =>
    apiFetch(`/transport/vehicles/${vehicleId}/logs`, {
      method: 'PUT',
      body: JSON.stringify({
        logDate: str(fd, 'logDate'),
        routeId: opt(fd, 'routeId'),
        driverId: opt(fd, 'driverId'),
        odometerStart: num('odometerStart'),
        odometerEnd: num('odometerEnd'),
        fuelLitres: num('fuelLitres'),
        fuelCost: num('fuelCost'),
        trips: num('trips'),
        incident: opt(fd, 'incident'),
        remarks: opt(fd, 'remarks'),
      }),
    }),
  );
}

export async function requestDepartmentExport(fd: FormData) {
  const dept = str(fd, 'department');
  const params: Record<string, unknown> = {};
  for (const k of ['from', 'to', 'status'] as const) if (opt(fd, k)) params[k] = str(fd, k);
  if (opt(fd, 'academicYearId')) params.academicYearId = str(fd, 'academicYearId');
  if (str(fd, 'onlyOpen') === 'yes') params.onlyOpen = true;
  return run(`/insights/departments/${dept}`, () =>
    apiFetch('/reports/exports', {
      method: 'POST',
      body: JSON.stringify({
        dataset: str(fd, 'dataset'),
        format: str(fd, 'format') === 'xlsx' ? 'xlsx' : 'csv',
        params,
      }),
    }),
  );
}

// ---- Sprint 14: adjustments, profile changes, misc receipts, reconciliation, exams, assistant ------
export async function requestAdjustment(fd: FormData) {
  const studentId = str(fd, 'studentId');
  const back = studentId ? `/fees/ledger/${studentId}` : '/fees/adjustments';
  const kind = str(fd, 'kind') || 'waiver';
  return run(back, () =>
    apiFetch('/fees/adjustments', {
      method: 'POST',
      body: JSON.stringify({
        kind,
        demandId: kind === 'waiver' ? opt(fd, 'demandId') : undefined,
        paymentId: kind === 'waiver' ? undefined : opt(fd, 'paymentId'),
        amount: kind === 'waiver' ? Number(str(fd, 'amount')) : undefined,
        charge: opt(fd, 'charge') ? Number(str(fd, 'charge')) : undefined,
        reason: str(fd, 'reason'),
      }),
    }),
  );
}

export async function decideAdjustment(fd: FormData) {
  const id = str(fd, 'id');
  return run('/fees/adjustments', () =>
    apiFetch(`/fees/adjustments/${id}/decide`, {
      method: 'POST',
      body: JSON.stringify({
        outcome: str(fd, 'outcome') === 'rejected' ? 'rejected' : 'approved',
        note: opt(fd, 'note'),
      }),
    }),
  );
}

export async function requestProfileChange(fd: FormData) {
  const studentId = str(fd, 'studentId');
  const body: Record<string, unknown> = { reason: str(fd, 'reason') };
  if (opt(fd, 'feeGroup')) body.feeGroup = str(fd, 'feeGroup');
  if (opt(fd, 'studentType')) body.studentType = str(fd, 'studentType');
  const discount = str(fd, 'discountId');
  if (discount === 'none') body.discountId = null;
  else if (discount) body.discountId = discount;
  const hosteller = str(fd, 'hosteller');
  if (hosteller === 'yes') body.hosteller = true;
  if (hosteller === 'no') body.hosteller = false;
  return run(`/people/students/${studentId}`, () =>
    apiFetch(`/fees/students/${studentId}/profile-changes`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  );
}

export async function decideProfileChange(fd: FormData) {
  const id = str(fd, 'id');
  return run('/fees/adjustments', () =>
    apiFetch(`/fees/profile-changes/${id}/decide`, {
      method: 'POST',
      body: JSON.stringify({
        outcome: str(fd, 'outcome') === 'rejected' ? 'rejected' : 'approved',
        note: opt(fd, 'note'),
      }),
    }),
  );
}

export async function postMiscReceipt(fd: FormData) {
  const payerKind = str(fd, 'payerKind') || 'other';
  return run('/fees/misc', () =>
    apiFetch('/fees/misc/receipts', {
      method: 'POST',
      body: JSON.stringify({
        payerKind,
        studentId: payerKind === 'student' ? opt(fd, 'studentId') : undefined,
        employeeId: payerKind === 'employee' ? opt(fd, 'employeeId') : undefined,
        payerName: opt(fd, 'payerName'),
        payerMobile: opt(fd, 'payerMobile'),
        headId: str(fd, 'headId'),
        amount: Number(str(fd, 'amount')),
        receivedOn: opt(fd, 'receivedOn'),
        mode: str(fd, 'mode') || 'cash',
        reference: opt(fd, 'reference'),
        instrumentNo: opt(fd, 'instrumentNo'),
        bankName: opt(fd, 'bankName'),
        remarks: opt(fd, 'remarks'),
      }),
    }),
  );
}

export async function reconcileNow() {
  return run('/fees/misc', () => apiFetch('/fees/reconciliations/run', { method: 'POST' }));
}

export async function createExamType(fd: FormData) {
  return run('/exams/masters', () =>
    apiFetch('/exams/types', {
      method: 'POST',
      body: JSON.stringify({
        code: str(fd, 'code').toUpperCase(),
        name: str(fd, 'name'),
        weightage: opt(fd, 'weightage') ? Number(str(fd, 'weightage')) : null,
        sortOrder: opt(fd, 'sortOrder') ? Number(str(fd, 'sortOrder')) : 0,
      }),
    }),
  );
}

export async function saveGradeScale(fd: FormData) {
  const grades = fd.getAll('grade').map(String);
  const mins = fd.getAll('minPct').map(String);
  const maxs = fd.getAll('maxPct').map(String);
  const points = fd.getAll('points').map(String);
  const remarks = fd.getAll('remark').map(String);
  const bands = grades
    .map((grade, i) => ({
      grade: grade.trim(),
      minPct: Number(mins[i]),
      maxPct: Number(maxs[i]),
      points: points[i]?.trim() ? Number(points[i]) : null,
      remark: remarks[i]?.trim() || undefined,
    }))
    .filter((b) => b.grade && Number.isFinite(b.minPct) && Number.isFinite(b.maxPct));
  return run('/exams/masters', () =>
    apiFetch('/exams/grade-scales', {
      method: 'PUT',
      body: JSON.stringify({
        code: str(fd, 'code').toUpperCase(),
        name: str(fd, 'name'),
        description: opt(fd, 'description'),
        bands,
      }),
    }),
  );
}

export async function createExam(fd: FormData) {
  const classes = fd.getAll('classId').map(String).filter(Boolean);
  const scaleId = opt(fd, 'gradeScaleId') ?? null;
  return run('/exams', () =>
    apiFetch('/exams', {
      method: 'POST',
      body: JSON.stringify({
        examTypeId: str(fd, 'examTypeId'),
        code: str(fd, 'code').toUpperCase(),
        name: str(fd, 'name'),
        startsOn: opt(fd, 'startsOn'),
        endsOn: opt(fd, 'endsOn'),
        showOnPortal: str(fd, 'showOnPortal') === 'on',
        classes: classes.map((classId) => ({ classId, gradeScaleId: scaleId })),
      }),
    }),
  );
}

export async function updateExam(fd: FormData) {
  const id = str(fd, 'id');
  const body: Record<string, unknown> = {};
  if (opt(fd, 'marksLocked')) body.marksLocked = str(fd, 'marksLocked') === 'yes';
  if (opt(fd, 'status')) body.status = str(fd, 'status');
  if (opt(fd, 'showOnPortal')) body.showOnPortal = str(fd, 'showOnPortal') === 'yes';
  return run(`/exams/${id}`, () =>
    apiFetch(`/exams/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  );
}

export async function setExamSubjects(fd: FormData) {
  const id = str(fd, 'id');
  const classId = str(fd, 'classId');
  const subjectIds = fd.getAll('subjectId').map(String);
  const maxs = fd.getAll('maxMarks').map(String);
  const passes = fd.getAll('passMarks').map(String);
  const dates = fd.getAll('examOn').map(String);
  const electives = new Set(fd.getAll('elective').map(String));
  const subjects = subjectIds
    .map((subjectId, i) => ({
      subjectId,
      maxMarks: Number(maxs[i]),
      passMarks: passes[i]?.trim() ? Number(passes[i]) : null,
      examOn: dates[i]?.trim() || null,
      isElective: electives.has(subjectId),
    }))
    .filter((s) => Number.isFinite(s.maxMarks) && s.maxMarks > 0);
  return run(`/exams/${id}?classId=${classId}`, () =>
    apiFetch(`/exams/${id}/subjects`, {
      method: 'PUT',
      body: JSON.stringify({ classId, subjects }),
    }),
  );
}

export async function lockExamSubjects(fd: FormData) {
  const id = str(fd, 'id');
  const classId = str(fd, 'classId');
  return run(`/exams/${id}?classId=${classId}`, () =>
    apiFetch(`/exams/${id}/subjects/lock`, {
      method: 'POST',
      body: JSON.stringify({ classId, locked: str(fd, 'locked') === 'yes' }),
    }),
  );
}

export async function askAssistant(fd: FormData) {
  const question = str(fd, 'question');
  const conversationId = opt(fd, 'conversationId');
  const language = opt(fd, 'language');
  let out: { conversationId: string } | null = null;
  try {
    out = await apiFetch<{ conversationId: string }>('/insights/assistant', {
      method: 'POST',
      body: JSON.stringify({
        question,
        conversationId,
        language: language && language !== 'auto' ? language : undefined,
      }),
    });
  } catch (error) {
    if (error instanceof ApiError)
      back_(
        conversationId ? `/insights/assistant?c=${conversationId}` : '/insights/assistant',
        error.problem.type,
        error.problem.detail,
      );
    throw error;
  }
  redirect(`/insights/assistant?c=${out!.conversationId}`);
}

// ---- Sprint 15: fee reports centre, bank statements, anomaly alerts ---------------------------------
function reportBack(fd: FormData): string {
  const q = new URLSearchParams();
  for (const k of [
    'report',
    'from',
    'to',
    'ledger',
    'mode',
    'month',
    'classId',
    'minBalance',
    'asOf',
  ])
    if (opt(fd, k)) q.set(k, str(fd, k));
  return `/fees/reports?${q.toString()}`;
}

export async function requestFeeReportExport(fd: FormData) {
  const params: Record<string, unknown> = {};
  for (const k of ['from', 'to', 'ledger', 'mode', 'classId', 'minBalance', 'asOf'] as const)
    if (opt(fd, k)) params[k] = str(fd, k);
  const format = str(fd, 'format');
  return run(reportBack(fd), () =>
    apiFetch('/reports/exports', {
      method: 'POST',
      body: JSON.stringify({
        dataset: str(fd, 'dataset'),
        format: ['csv', 'xlsx', 'pdf', 'xml'].includes(format) ? format : 'xlsx',
        params,
      }),
    }),
  );
}

export async function notifyDefaulters(fd: FormData) {
  const studentIds = fd.getAll('studentId').map(String).filter(Boolean);
  const back = reportBack(fd);
  if (studentIds.length === 0) back_(back, 'validation-failed', 'Pick at least one student');
  let out: { sent: number; skippedToday: number; noMobile: number; failed: number } | undefined;
  try {
    out = await apiFetch('/fees/reports/defaulters/notify', {
      method: 'POST',
      body: JSON.stringify({
        studentIds,
        channel: str(fd, 'channel') === 'sms' ? 'sms' : 'whatsapp',
        asOf: opt(fd, 'asOf'),
      }),
    });
  } catch (error) {
    if (error instanceof ApiError && error.problem.type === 'mfa-required')
      redirect(`/step-up?returnTo=${encodeURIComponent(back)}`);
    if (error instanceof ApiError) back_(back, error.problem.type, error.problem.detail);
    throw error;
  }
  redirect(
    `${back}&ok=1&sent=${out!.sent}&skipped=${out!.skippedToday}&noMobile=${out!.noMobile}&failed=${out!.failed}`,
  );
}

export async function uploadBankStatement(fd: FormData) {
  const file = fd.get('file');
  let csv = str(fd, 'csv');
  let fileName: string | undefined;
  if (file && typeof file === 'object' && 'text' in file && (file as File).size > 0) {
    csv = await (file as File).text();
    fileName = (file as File).name;
  }
  let out: { id: string } | undefined;
  try {
    out = await apiFetch('/payments/bank-statements', {
      method: 'POST',
      body: JSON.stringify({
        bankName: str(fd, 'bankName'),
        accountRef: opt(fd, 'accountRef'),
        fileName,
        csv,
      }),
    });
  } catch (error) {
    if (error instanceof ApiError) back_('/fees/bank', error.problem.type, error.problem.detail);
    throw error;
  }
  redirect(`/fees/bank?id=${out!.id}&ok=1`);
}

export async function ackAlert(fd: FormData) {
  return run('/insights/alerts', () =>
    apiFetch(`/insights/alerts/${str(fd, 'id')}/ack`, { method: 'POST' }),
  );
}

// ---- Sprint 16: shadow run, service keys, exam results, AI reports -------------------------------
export async function shadowFeed(fd: FormData) {
  const file = fd.get('file');
  let csv = str(fd, 'csv');
  let fileName: string | undefined;
  if (file && typeof file === 'object' && 'text' in file && (file as File).size > 0) {
    csv = await (file as File).text();
    fileName = (file as File).name;
  }
  const kind = str(fd, 'kind') === 'balances' ? 'balances' : 'receipts';
  let rows: unknown[] | undefined;
  if (csv.trim().startsWith('[') || csv.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(csv) as unknown;
      rows = Array.isArray(parsed) ? parsed : (parsed as { rows?: unknown[] }).rows;
      csv = '';
    } catch {
      back_('/fees/shadow', 'validation-failed', 'The file is neither CSV nor JSON');
    }
  }
  return run('/fees/shadow', () =>
    apiFetch('/shadow/feeds', {
      method: 'POST',
      body: JSON.stringify({
        kind,
        source: `upload:${fileName ?? 'paste'}`,
        fileName,
        rows,
        csv: csv || undefined,
      }),
    }),
  );
}

export async function shadowReconcile(fd: FormData) {
  return run('/fees/shadow', () =>
    apiFetch('/shadow/reconcile', {
      method: 'POST',
      body: JSON.stringify({ from: opt(fd, 'from'), to: opt(fd, 'to') }),
    }),
  );
}

export async function decideVariance(fd: FormData) {
  const runId = str(fd, 'runId');
  return run(`/fees/shadow${runId ? `?runId=${runId}` : ''}`, () =>
    apiFetch(`/shadow/variances/${str(fd, 'id')}`, {
      method: 'POST',
      body: JSON.stringify({
        status: str(fd, 'status') || 'explained',
        explanation: opt(fd, 'explanation'),
      }),
    }),
  );
}

export async function createServiceKey(fd: FormData) {
  const { cookies } = await import('next/headers');
  let out: { key: string; name: string } | undefined;
  try {
    out = await apiFetch('/platform/service-keys', {
      method: 'POST',
      body: JSON.stringify({
        name: str(fd, 'name'),
        scopes: fd.getAll('scopes').map(String).filter(Boolean),
      }),
    });
  } catch (error) {
    if (error instanceof ApiError && error.problem.type === 'mfa-required')
      redirect(`/step-up?returnTo=${encodeURIComponent('/system/service-keys')}`);
    if (error instanceof ApiError)
      back_('/system/service-keys', error.problem.type, error.problem.detail);
    throw error;
  }
  // the key is shown once: it travels in a short-lived httpOnly cookie, never in a URL
  (await cookies()).set('edupro_new_service_key', `${out!.name}|${out!.key}`, {
    httpOnly: true,
    sameSite: 'strict',
    maxAge: 120,
    path: '/system/service-keys',
  });
  redirect('/system/service-keys?ok=1');
}

export async function revokeServiceKey(fd: FormData) {
  return run('/system/service-keys', () =>
    apiFetch(`/platform/service-keys/${str(fd, 'id')}/revoke`, { method: 'POST' }),
  );
}

export async function computeExamResults(fd: FormData) {
  const id = str(fd, 'examId');
  const back = str(fd, 'back') || `/exams/${id}/analysis`;
  return run(back, () => apiFetch(`/exams/${id}/results/compute`, { method: 'POST' }));
}

export async function runAiReport(fd: FormData) {
  return run('/insights/reports', () =>
    apiFetch('/insights/reports/run', {
      method: 'POST',
      body: JSON.stringify({
        kind: str(fd, 'kind') === 'department_weekly' ? 'department_weekly' : 'principal_brief',
        department: opt(fd, 'department'),
        periodTo: opt(fd, 'periodTo'),
        language: str(fd, 'language') === 'hi' ? 'hi' : 'en',
      }),
    }),
  );
}
