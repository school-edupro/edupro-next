#!/usr/bin/env node
/**
 * Synthetic check for the on-call monitor (Sprint 22, docs/runbooks/on-call.md). Calls the health and
 * metrics endpoints, the public app_version route of the compat API and, when a developer or service
 * token is given, one authenticated read; prints one line per check with the latency and exits 1 when
 * any check fails or exceeds its budget.
 *
 *   node scripts/synthetic-check.mjs --base http://localhost:4000 --school 1 [--token dev:dev-admin] [--budget-ms 1500]
 */
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1] ?? 'true'] : null))
    .filter(Boolean),
);
const base = (args.base ?? process.env.API_BASE_URL ?? 'http://localhost:4000').replace(/\/$/, '');
const school = args.school ?? process.env.SCHOOL_ID ?? '1';
const token = args.token ?? process.env.SYNTHETIC_TOKEN ?? '';
const budget = Number(args['budget-ms'] ?? 1500);

const checks = [
  { name: 'health', path: '/api/v1/health', expect: (b) => /ok|up/i.test(JSON.stringify(b)) },
  {
    name: 'metrics',
    path: '/metrics',
    text: true,
    expect: (b) => /edupro_http_requests_total/.test(b),
  },
  {
    name: 'compat.app_version',
    path: `/api/v1/compat/v1/app_version?platform=android&school_id=${school}`,
    expect: (b) => typeof b?.version === 'string',
  },
];
if (token)
  checks.push(
    {
      name: 'me',
      path: '/api/v1/me',
      headers: { authorization: `Bearer ${token}`, 'x-school-id': school },
      expect: (b) => Array.isArray(b?.permissions),
    },
    {
      name: 'classes',
      path: '/api/v1/academics/classes?size=5',
      headers: { authorization: `Bearer ${token}`, 'x-school-id': school },
      expect: (b) => Array.isArray(b?.data),
    },
  );

let failed = 0;
for (const c of checks) {
  const started = Date.now();
  let status = 0;
  let ok = false;
  let note = '';
  try {
    const res = await fetch(base + c.path, {
      headers: c.headers ?? {},
      signal: AbortSignal.timeout(10_000),
    });
    status = res.status;
    const body = c.text ? await res.text() : await res.json().catch(() => null);
    ok = res.ok && c.expect(body);
  } catch (error) {
    note = error instanceof Error ? error.message : String(error);
  }
  const ms = Date.now() - started;
  const slow = ms > budget;
  if (!ok || slow) failed += 1;
  console.log(
    `${(!ok ? 'FAIL' : slow ? 'SLOW' : 'ok  ').padEnd(5)} ${c.name.padEnd(20)} ${String(status).padEnd(4)} ${String(ms).padStart(5)} ms${note ? `  ${note}` : ''}`,
  );
}
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
