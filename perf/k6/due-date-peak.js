// Sprint 16: due-date peak at 5x against a running stack. Five "counters" post receipts for pupils of one
// section while parents read their ledgers. Needs a seeded school (pnpm --filter @edupro/db seed:demo),
// AUTH_DEV_BYPASS=1 and RATE_LIMIT_PER_MINUTE=1000000 on the API.
//   k6 run -e BASE_URL=http://localhost:4000 -e SCHOOL_ID=1 -e STUDENTS=12307,12308 perf/k6/due-date-peak.js
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = __ENV.BASE_URL || 'http://localhost:4000';
const SCHOOL = __ENV.SCHOOL_ID || '1';
const STUDENTS = (__ENV.STUDENTS || '').split(',').filter(Boolean);
const headers = (sub) => ({
  authorization: `Bearer dev:${sub}`,
  'x-school-id': SCHOOL,
  'content-type': 'application/json',
});

export const options = {
  scenarios: {
    counters: {
      executor: 'constant-vus',
      vus: Number(__ENV.COUNTERS || 5),
      duration: __ENV.DURATION || '2m',
      exec: 'counter',
    },
    parents: {
      executor: 'constant-vus',
      vus: Number(__ENV.PARENTS || 50),
      duration: __ENV.DURATION || '2m',
      exec: 'parent',
    },
  },
  thresholds: {
    'http_req_duration{name:receipt}': ['p(95)<600'],
    'http_req_duration{name:ledger}': ['p(95)<400'],
    'http_req_duration{name:daybook}': ['p(95)<800'],
    http_req_failed: ['rate<0.01'],
  },
};

export function counter() {
  if (STUDENTS.length === 0) return;
  const studentId = STUDENTS[Math.floor(Math.random() * STUDENTS.length)];
  const r = http.post(
    `${BASE}/api/v1/payments/receipts`,
    JSON.stringify({ studentId, amount: 100, mode: 'cash', collectLateFee: false }),
    { headers: headers('dev-accounts'), tags: { name: 'receipt' } },
  );
  check(r, { 'receipt posted': (x) => x.status === 201 || x.status === 409 });
  const d = http.get(
    `${BASE}/api/v1/reports/datasets/fee_day_book/rows?from=2026-04-01&to=2026-04-30`,
    { headers: headers('dev-accounts'), tags: { name: 'daybook' } },
  );
  check(d, { 'day book ok': (x) => x.status === 200 });
  sleep(0.2);
}

export function parent() {
  const r = http.get(`${BASE}/api/v1/fees/mine`, {
    headers: headers('dev-parent'),
    tags: { name: 'ledger' },
  });
  check(r, { 'ledger ok': (x) => x.status === 200 });
  sleep(0.5);
}
