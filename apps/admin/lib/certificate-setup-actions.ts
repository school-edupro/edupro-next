'use server';
/** Certificate set-up (docs/design/87, phase B): types, templates, who signs. */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from './api';
import {
  PAGE_SIZES,
  type CertificateSetupOverview,
  type CertificateTemplateDetail,
  type CertificateTypeDetail,
} from './certificates';

const okId = (id: string) => /^\d{1,18}$/.test(id);
const okCode = (v: string) => /^[A-Z][A-Z0-9_]{1,19}$/.test(v);
const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const detailOf = (e: ApiError) => {
  const errors = e.problem.errors as
    Record<string, string> | Array<{ message?: string; path?: unknown }> | undefined;
  const first = Array.isArray(errors)
    ? errors.map((x) => x.message).find(Boolean)
    : errors
      ? Object.values(errors)[0]
      : undefined;
  return e.problem.detail ?? first ?? e.problem.type;
};
const back = (path: string, error: ApiError): never =>
  redirect(
    `${path}${path.includes('?') ? '&' : '?'}error=${encodeURIComponent(error.problem.type)}&detail=${encodeURIComponent(detailOf(error).slice(0, 300))}`,
  );
async function call<T>(path: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ApiError) back(path, e);
    throw e;
  }
}

/** A type's settings from its form. */
export async function saveCertificateType(fd: FormData) {
  const code = str(fd, 'code');
  if (!okCode(code)) return;
  const here = `/certificates/setup/types/${code}`;
  let fields: unknown = [];
  try {
    fields = JSON.parse(str(fd, 'fieldsJson') || '[]');
  } catch {
    redirect(
      `${here}?error=validation-failed&detail=${encodeURIComponent('The fields could not be read')}`,
    );
  }
  const templateId = str(fd, 'templateId');
  // the layouts kept, and one added from the list
  const add = str(fd, 'addVariant');
  const variants = [...fd.getAll('variant').map(String), ...(okId(add) ? [add] : [])]
    .filter((id, i, all) => okId(id) && id !== templateId && all.indexOf(id) === i)
    .map((id) => ({
      templateId: id,
      label: str(fd, `variantLabel_${id}`) || str(fd, 'addVariantLabel') || 'Layout',
    }));
  // classes ticked, only when "only some classes" is chosen
  const classes =
    str(fd, 'classMode') === 'some'
      ? fd
          .getAll('class')
          .map((x) => String(x).trim().toUpperCase())
          .filter((x) => /^[A-Z0-9][A-Z0-9 _-]{0,19}$/.test(x))
      : [];
  const body = {
    name: str(fd, 'name'),
    description: str(fd, 'description') || undefined,
    prefix: str(fd, 'prefix').toUpperCase(),
    templateId: okId(templateId) ? templateId : null,
    variants,
    rules: {
      state: ['active', 'leaving', 'any'].includes(str(fd, 'state')) ? str(fd, 'state') : 'any',
      ...(fd.get('fees') ? { fees: true } : {}),
      ...(fd.get('library') ? { library: true } : {}),
      ...(fd.get('hostel') ? { hostel: true } : {}),
      ...(fd.get('transport') ? { transport: true } : {}),
      ...(classes.length ? { classes } : {}),
    },
    multiple: ['ONE', 'YEAR', 'ANY'].includes(str(fd, 'multiple')) ? str(fd, 'multiple') : 'ANY',
    active: fd.get('active') !== null,
    sortOrder: Math.min(9999, Math.max(0, Number(str(fd, 'sortOrder')) || 100)),
    issuers: str(fd, 'issuerMode') === 'some' ? fd.getAll('issuer').map(String).filter(okId) : [],
    fields,
  };
  await call(here, () =>
    apiFetch<CertificateTypeDetail>(`/certificates/setup/types/${code}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  );
  // the page saves its online-request part with the rest
  if (fd.has('levelsJson')) await putRequests(fd, code, here);
  revalidatePath('/certificates/setup');
  redirect(`${here}?ok=saved`);
}

/** A type of the school's own. */
/** A type's code made from its name (SPORTS_DAY), kept apart from the codes already used. */
function codeFrom(name: string, taken: Set<string>): string {
  let base = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 16);
  if (!/^[A-Z]/.test(base)) base = `C_${base}`.slice(0, 16);
  if (base.length < 2) base = 'OWN';
  let code = base.replace(/_+$/, '');
  for (let n = 2; taken.has(code); n += 1) code = `${base.slice(0, 16)}_${String(n)}`;
  return code;
}

export async function createCertificateType(fd: FormData) {
  const typed = str(fd, 'code').toUpperCase();
  const taken = new Set(
    (await apiFetch<CertificateSetupOverview>('/certificates/setup')).types.map((t) => t.code),
  );
  const code = okCode(typed) ? typed : codeFrom(str(fd, 'name'), taken);
  const copy = str(fd, 'copyTemplateId');
  const made = await call('/certificates/setup/types', () =>
    apiFetch<CertificateTypeDetail>('/certificates/setup/types', {
      method: 'POST',
      body: JSON.stringify({
        code,
        name: str(fd, 'name'),
        audience: str(fd, 'audience') === 'STAFF' ? 'STAFF' : 'STUDENT',
        prefix: str(fd, 'prefix').toUpperCase(),
        ...(okId(copy) ? { copyTemplateId: copy } : {}),
      }),
    }),
  );
  revalidatePath('/certificates/setup');
  redirect(`/certificates/setup/types/${made.code}?ok=created`);
}

/** A template saved from the editor: a new version. */
export async function saveCertificateTemplate(fd: FormData) {
  const id = str(fd, 'id');
  if (!okId(id)) return;
  const page = PAGE_SIZES.find((p) => p.value === str(fd, 'page')) ?? PAGE_SIZES[0]!;
  const type = str(fd, 'type');
  const here = `/certificates/setup/templates/${id}${okCode(type) ? `?type=${type}` : ''}`;
  const saved = await call(here, () =>
    apiFetch<CertificateTemplateDetail>(`/certificates/setup/templates/${id}`, {
      method: 'PUT',
      body: JSON.stringify({
        name: str(fd, 'name'),
        pageWidth: page.w,
        pageHeight: page.h,
        bodyHtml: String(fd.get('bodyHtml') ?? ''),
        stylesCss: String(fd.get('stylesCss') ?? ''),
      }),
    }),
  );
  revalidatePath('/certificates/setup/templates');
  redirect(`${here}${here.includes('?') ? '&' : '?'}ok=v${String(saved.version)}`);
}

export async function resetCertificateTemplate(fd: FormData) {
  const id = str(fd, 'id');
  if (!okId(id)) return;
  const t = await call(`/certificates/setup/templates/${id}`, () =>
    apiFetch<CertificateTemplateDetail>(`/certificates/setup/templates/${id}/reset`, {
      method: 'POST',
    }),
  );
  redirect(`/certificates/setup/templates/${id}?ok=v${String(t.version)}`);
}

export async function restoreCertificateTemplate(fd: FormData) {
  const id = str(fd, 'id');
  const version = str(fd, 'version');
  if (!okId(id) || !/^\d{1,5}$/.test(version)) return;
  const t = await call(`/certificates/setup/templates/${id}`, () =>
    apiFetch<CertificateTemplateDetail>(`/certificates/setup/templates/${id}/restore/${version}`, {
      method: 'POST',
    }),
  );
  redirect(`/certificates/setup/templates/${id}?ok=v${String(t.version)}`);
}

export async function copyCertificateTemplate(fd: FormData) {
  const copyOf = str(fd, 'copyOf');
  if (!okId(copyOf)) return;
  const t = await call('/certificates/setup/templates', () =>
    apiFetch<CertificateTemplateDetail>('/certificates/setup/templates', {
      method: 'POST',
      body: JSON.stringify({ copyOf, name: str(fd, 'name') }),
    }),
  );
  revalidatePath('/certificates/setup/templates');
  redirect(`/certificates/setup/templates/${t.id}?ok=copied`);
}

/** A layout given to a type from the templates list: the one it prints with, or one more at issue. */
export async function useCertificateTemplate(fd: FormData) {
  const id = str(fd, 'id');
  const typeCode = str(fd, 'typeCode');
  const as = str(fd, 'as') === 'main' ? 'main' : 'choice';
  const list = '/certificates/setup/templates';
  if (!okId(id)) return;
  if (!okCode(typeCode))
    redirect(
      `${list}?error=validation-failed&detail=${encodeURIComponent('Choose the certificate type')}`,
    );
  const r = await call(list, () =>
    apiFetch<{ typeName: string; templateName: string }>(
      `/certificates/setup/templates/${id}/use`,
      { method: 'POST', body: JSON.stringify({ typeCode, as }) },
    ),
  );
  revalidatePath(list);
  revalidatePath(`/certificates/setup/types/${typeCode}`);
  const said =
    as === 'main'
      ? `${r.typeName} now prints with ${r.templateName}.`
      : `${r.templateName} is now offered at issue for ${r.typeName} (Layout, after choosing the person).`;
  redirect(`${list}?ok=1&detail=${encodeURIComponent(said)}`);
}

/** Who signs and what prints. */
export async function saveCertificateSettings(fd: FormData) {
  const signatory = str(fd, 'signatoryEmployeeId');
  await call('/certificates/setup/settings', () =>
    apiFetch('/certificates/setup/settings', {
      method: 'PUT',
      body: JSON.stringify({
        signatoryEmployeeId: okId(signatory) ? signatory : null,
        signatoryTitle: str(fd, 'signatoryTitle') || 'Principal',
        printSignature: fd.get('printSignature') !== null,
        printPreparer: fd.get('printPreparer') !== null,
        footerNote: str(fd, 'footerNote') || undefined,
        correctionsKeepNumber: fd.get('correctionsKeepNumber') !== null,
      }),
    }),
  );
  revalidatePath('/certificates/setup');
  redirect('/certificates/setup/settings?ok=saved');
}

/** Who may ask for a type online and how it is decided. */
/** A type's online-request settings, as the type's page posts them. */
async function putRequests(fd: FormData, code: string, here: string) {
  let levels: unknown = [];
  try {
    levels = JSON.parse(str(fd, 'levelsJson') || '[]');
  } catch {
    redirect(
      `${here}?error=validation-failed&detail=${encodeURIComponent('The levels could not be read')}`,
    );
  }
  const fee = str(fd, 'fee');
  await call(here, () =>
    apiFetch(`/certificates/setup/types/${code}/requests`, {
      method: 'PUT',
      body: JSON.stringify({
        open: {
          parent: fd.get('openParent') !== null,
          student: fd.get('openStudent') !== null,
          staff: fd.get('openStaff') !== null,
        },
        purposes: str(fd, 'purposes')
          .split('\n')
          .map((x) => x.trim())
          .filter(Boolean),
        maxCopies: Math.min(10, Math.max(1, Number(str(fd, 'maxCopies')) || 1)),
        fee: fee && Number(fee) > 0 ? Number(fee) : null,
        levels,
      }),
    }),
  );
}

export async function saveCertificateRequests(fd: FormData) {
  const code = str(fd, 'code');
  if (!okCode(code)) return;
  const here = `/certificates/setup/types/${code}`;
  await putRequests(fd, code, here);
  revalidatePath('/certificates/setup');
  redirect(`${here}?ok=saved`);
}

// ---- from the old system (phase F) ----------------------------------------------------------------------------------
export async function legacyRead() {
  await call('/certificates/setup/legacy', () =>
    apiFetch('/certificates/setup/legacy/read', { method: 'POST' }),
  );
  redirect('/certificates/setup/legacy?ok=read');
}

export async function legacySaveMap(fd: FormData) {
  const map: Record<string, string | null> = {};
  for (const [k, v] of fd.entries())
    if (k.startsWith('map:') && typeof v === 'string') map[k.slice(4)] = okCode(v) ? v : null;
  await call('/certificates/setup/legacy', () =>
    apiFetch('/certificates/setup/legacy/map', { method: 'PUT', body: JSON.stringify({ map }) }),
  );
  redirect('/certificates/setup/legacy?ok=map');
}

export async function legacyBring(fd: FormData) {
  const dryRun = str(fd, 'dryRun') === '1';
  const r = await call('/certificates/setup/legacy', () =>
    apiFetch<{ counts: Record<string, number> }>('/certificates/setup/legacy/bring', {
      method: 'POST',
      body: JSON.stringify({ dryRun }),
    }),
  );
  const c = r.counts;
  const detail = `${dryRun ? 'Would bring' : 'Brought'} ${String(c.brought ?? 0)} of ${String(c.read ?? 0)}; already here ${String(c.already ?? 0)}; left out: ${String(c.noType ?? 0)} with no type, ${String(c.noPerson ?? 0)} with no student or employee found`;
  revalidatePath('/certificates');
  redirect(
    `/certificates/setup/legacy?ok=${dryRun ? 'dry' : 'brought'}&detail=${encodeURIComponent(detail)}`,
  );
}
