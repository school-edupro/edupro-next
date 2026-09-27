// Performance baseline (S5-09): /me, classes list and people search at 200 virtual users.
// k6 run -e BASE_URL=https://api.staging.example -e TOKEN=... -e SCHOOL_ID=1 perf/k6/baseline.js
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  scenarios: {
    steady: {
      executor: 'constant-vus',
      vus: Number(__ENV.VUS || 200),
      duration: __ENV.DURATION || '2m',
    },
  },
  thresholds: {
    'http_req_duration{name:me}': ['p(95)<200'],
    'http_req_duration{name:classes}': ['p(95)<300'],
    'http_req_duration{name:search}': ['p(95)<200'],
    http_req_failed: ['rate<0.01'],
  },
};

const base = __ENV.BASE_URL || 'http://localhost:4000';
const headers = {
  Authorization: `Bearer ${__ENV.TOKEN || 'dev:dev-admin'}`,
  'X-School-Id': __ENV.SCHOOL_ID || '1',
};
const terms = ['sharma', 'verma', 'r24', 'nair', 'iyer'];

export default function () {
  const me = http.get(`${base}/api/v1/me`, { headers, tags: { name: 'me' } });
  check(me, { 'me 200': (r) => r.status === 200 });
  const classes = http.get(`${base}/api/v1/academics/classes?size=50`, {
    headers,
    tags: { name: 'classes' },
  });
  check(classes, { 'classes 200': (r) => r.status === 200 });
  const q = terms[Math.floor(Math.random() * terms.length)];
  const search = http.get(`${base}/api/v1/people/search?q=${q}`, {
    headers,
    tags: { name: 'search' },
  });
  check(search, { 'search 200': (r) => r.status === 200 });
  sleep(0.5);
}
