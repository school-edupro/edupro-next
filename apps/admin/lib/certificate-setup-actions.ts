'use server';
/** Certificate set-up (docs/design/87, phase B): types, templates, who signs. */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from './api';
import {
  PAGE_SIZES,
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
  const variants = fd
    .getAll('variant')
    .map(String)
    .filter((id) => okId(id) && id !== templateId)
    .map((id) => ({ templateId: id, label: str(fd, `variantLabel_${id}`) || 'Layout' }));
  const classes = str(fd, 'classes')
    .split(/[,\s]+/)
    .map((x) => x.trim().toUpperCase())
    .filter(Boolean);
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
    issuers: fd.getAll('issuer').map(String).filter(okId),
    fields,
  };
  await call(here, () =>
    apiFetch<CertificateTypeDetail>(`/certificates/setup/types/${code}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  );
  revalidatePath('/certificates/setup');
  redirect(`${here}?ok=saved`);
}

/** A type of the school's own. */
export async function createCertificateType(fd: FormData) {
  const code = str(fd, 'code').toUpperCase();
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
      }),
    }),
  );
  revalidatePath('/certificates/setup');
  redirect('/certificates/setup/settings?ok=saved');
}
