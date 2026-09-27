// Local baseline with autocannon (no k6 binary on developer laptops).
import autocannon from 'autocannon';

const base = process.env.BASE_URL ?? 'http://localhost:4000';
const headers = {
  authorization: `Bearer ${process.env.TOKEN ?? 'dev:dev-admin'}`,
  'x-school-id': process.env.SCHOOL_ID ?? '1',
};
const targets = [
  ['me', `${base}/api/v1/me`],
  ['classes', `${base}/api/v1/academics/classes?size=50`],
  ['search', `${base}/api/v1/people/search?q=sharma`],
];
for (const [name, url] of targets) {
  const r = await autocannon({
    url,
    headers,
    connections: Number(process.env.CONNECTIONS ?? 50),
    duration: Number(process.env.DURATION ?? 10),
  });
  const errors = r.errors + r.non2xx;
  console.log(
    `${name.padEnd(8)} req/s ${Math.round(r.requests.average).toString().padStart(6)}  p50 ${r.latency.p50} ms  p95 ${r.latency.p97_5 ?? r.latency.p95} ms  p99 ${r.latency.p99} ms  2xx ${r['2xx']}  non-2xx ${r.non2xx}  errors ${r.errors}`,
  );
  if (r.non2xx > 0)
    console.log(
      '  (non-2xx responses usually mean the rate limit: start the API with RATE_LIMIT_PER_MINUTE=1000000 for load tests)',
    );
}
