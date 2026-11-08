#!/usr/bin/env node
/**
 * Sample signatures for a development school's employees (docs/design/83, "As built — store slips
 * signed like the GRN"): every active employee without a signature gets a handwriting-style image of
 * their own name, uploaded the normal way (the files API, then the employee's signature) as dev-admin.
 * Employees who already have one keep it. Development only: the API must be the local one.
 *
 *   node scripts/seed-sample-signatures.mjs          # lists who would get one
 *   node scripts/seed-sample-signatures.mjs --yes    # makes and uploads them
 *
 * SAMPLE_SCHOOL (default 1, Alpha). The images are drawn by the admin app's Playwright Chromium.
 */
import { createRequire } from 'node:module';

const API = process.env.API_URL ?? 'http://localhost:4000/api/v1';
const SCHOOL = process.env.SAMPLE_SCHOOL ?? '1';
const USER = 'dev-admin';
const WRITE = process.argv.includes('--yes');
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(API)) {
  console.error('Refused: API_URL is not the local API.');
  process.exit(1);
}

async function api(method, path, body) {
  for (let i = 0; ; i += 1) {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        authorization: `Bearer dev:${USER}`,
        'x-school-id': SCHOOL,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (res.status === 429 && i < 10) {
      const s = Number(res.headers.get('retry-after')) || 10;
      await res.text();
      await new Promise((r) => setTimeout(r, (s + 1) * 1000));
      continue;
    }
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${text.slice(0, 300)}`);
    return json;
  }
}

// the employees without a signature (active ones)
const all = [];
for (let page = 1; ; page += 1) {
  const r = await api('GET', `/people/employees?size=200&page=${page}`);
  all.push(...r.data);
  if (r.data.length < 200) break;
}
const todo = all.filter((e) => e.status === 'active' && !e.signatureFileId);
console.log(
  `${String(all.length)} employees in school ${SCHOOL}; ${String(todo.length)} without a signature:`,
);
for (const e of todo) console.log(`  ${e.employeeCode}  ${e.displayName}`);
if (!WRITE) {
  console.log('Nothing written: add --yes to make and upload them.');
  process.exit(0);
}

// the images: each name in a handwriting face, a little slanted, with a flourish under it
const require = createRequire(new URL('../apps/admin/package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<canvas id="c" width="420" height="120"></canvas>');
const draw = (name, seed) =>
  page.evaluate(
    ([n, s]) => {
      const c = document.getElementById('c');
      const g = c.getContext('2d');
      g.clearRect(0, 0, c.width, c.height);
      const rnd = (k) => {
        const x = Math.sin(s * 9301 + k * 49297) * 233280;
        return x - Math.floor(x);
      };
      g.save();
      g.translate(18, 78);
      g.rotate(-0.05 - rnd(1) * 0.06);
      g.fillStyle = '#1b2f6b';
      g.font = `${String(40 + Math.round(rnd(2) * 8))}px "Snell Roundhand", "Apple Chancery", "Brush Script MT", "Segoe Script", cursive`;
      g.fillText(n, 0, 0);
      const w = Math.min(g.measureText(n).width, 380);
      g.strokeStyle = '#1b2f6b';
      g.lineWidth = 1.6;
      g.beginPath();
      g.moveTo(w * 0.15, 14);
      g.bezierCurveTo(w * 0.45, 22 + rnd(3) * 8, w * 0.75, 4, w * (0.95 + rnd(4) * 0.1), 12);
      g.stroke();
      g.restore();
      return c.toDataURL('image/png');
    },
    [name, seed],
  );

let done = 0;
for (const [i, e] of todo.entries()) {
  // written as a person signs: Kamal Sharma, not KAMAL SHARMA
  const name = ([e.firstName, e.lastName].filter(Boolean).join(' ') || e.displayName)
    .toLowerCase()
    .replace(/(^|[\s.'-])\p{L}/gu, (m) => m.toUpperCase());
  const png = Buffer.from((await draw(name, i + 1)).split(',')[1], 'base64');
  const reg = await api('POST', '/platform/files', {
    fileName: `signature-${e.employeeCode}.png`,
    contentType: 'image/png',
    sizeBytes: png.length,
    classification: 'personal',
  });
  const url = reg.upload.url.startsWith('http')
    ? reg.upload.url
    : `${API.replace(/\/api\/v1$/, '')}${reg.upload.url}`;
  // one content type: the upload's own headers may name it again in other letters
  const headers = new Headers({ 'content-type': 'image/png' });
  for (const [k, v] of Object.entries(reg.upload.headers ?? {})) headers.set(k, v);
  const put = await fetch(url, { method: reg.upload.method || 'PUT', headers, body: png });
  if (!put.ok) throw new Error(`upload of ${e.employeeCode}: ${put.status} ${await put.text()}`);
  await api('POST', `/people/employees/${e.id}/signature`, { fileId: reg.file.id });
  done += 1;
  console.log(`  ✓ ${e.employeeCode}  ${name}`);
}
await browser.close();
console.log(`${String(done)} signatures uploaded.`);
