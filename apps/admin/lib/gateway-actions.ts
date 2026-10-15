'use server';
/** Fee setup -> Payment gateways (0142): save a gateway account, and which fees each takes. */
import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from './api';

const PATH = '/fees/gateways';
const back = (q: string) => redirect(`${PATH}?${q}`);
const fail = (error: unknown) => {
  if (error instanceof ApiError) {
    const errs = error.problem.errors as Array<{ message?: string }> | undefined;
    const detail =
      (Array.isArray(errs)
        ? errs
            .map((e) => e.message)
            .filter(Boolean)
            .join('; ')
        : '') ||
      (error.problem.type === 'mfa-required'
        ? 'Sign in again (One Auth with the second step, or the emailed code after One Auth) to change gateways'
        : String(error.problem.detail ?? error.problem.type));
    back(`error=1&detail=${encodeURIComponent(detail.slice(0, 300))}`);
  }
  throw error;
};

export async function saveGateway(fd: FormData) {
  const config: Record<string, string> = {};
  const secret: Record<string, string> = {};
  for (const [k, v] of fd.entries()) {
    if (typeof v !== 'string') continue;
    if (k.startsWith('config.')) config[k.slice(7)] = v;
    if (k.startsWith('secret.')) secret[k.slice(7)] = v;
  }
  const id = String(fd.get('id') ?? '');
  try {
    await apiFetch('/payments/gateways', {
      method: 'PUT',
      body: JSON.stringify({
        ...(/^\d{1,18}$/.test(id) ? { id } : {}),
        provider: String(fd.get('provider') ?? ''),
        label: String(fd.get('label') ?? ''),
        mode: fd.get('mode') === 'live' ? 'live' : 'test',
        config,
        secret,
        chargePercent: Number(fd.get('chargePercent') || 0),
        chargeFlat: Number(fd.get('chargeFlat') || 0),
        active: fd.get('active') === 'on',
      }),
    });
  } catch (error) {
    fail(error);
  }
  back('ok=1');
}

export async function saveGatewayRoutes(fd: FormData) {
  const routes: Record<string, string[]> = {};
  for (const l of ['school', 'hostel', 'misc', 'admission'])
    routes[l] = fd
      .getAll(`route.${l}`)
      .map(String)
      .filter((v) => /^\d{1,18}$/.test(v));
  try {
    await apiFetch('/payments/gateways/routes', { method: 'PUT', body: JSON.stringify(routes) });
  } catch (error) {
    fail(error);
  }
  back('ok=1');
}
