#!/usr/bin/env node
/**
 * Sample periodicals for a dev school (docs/design/36-library.md, part 6): two news agents, seven
 * periodicals (two dailies, a weekly, a fortnightly, two monthlies, a quarterly), a subscription for the
 * session in the school's libraries, the issues received so far (on their expected day or the next),
 * a few marked missing, the last few left unreceived (so some show as late) and a special issue.
 * Made through the API as the dev admin, the way Library → Periodicals does it. A periodical that
 * already has a subscription is left alone, so the script can run again. Dev only.
 *
 *   node scripts/fixtures/library-periodicals-sample.mjs --school 1 [--api http://localhost:4000/api/v1] [--as dev-admin]
 */
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1] ?? ''] : null))
    .filter(Boolean),
);
const API = args.api ?? process.env.API_URL ?? 'http://localhost:4000/api/v1';
const SCHOOL = args.school ?? '1';
const AS = args.as ?? 'dev-admin';
const headers = {
  'content-type': 'application/json',
  authorization: `Bearer dev:${AS}`,
  'x-school-id': SCHOOL,
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function call(method, path, body) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const res = await fetch(`${API}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 429) {
      await sleep(Number(res.headers.get('retry-after') ?? '2') * 1000 || 2000);
      continue;
    }
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
  }
  throw new Error(`${method} ${path}: too many requests`);
}

const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const year = Number(today.slice(0, 4));
const session = Number(today.slice(5, 7)) >= 4 ? year : year - 1;
const STARTS = `${String(session)}-04-01`;
const ENDS = `${String(session + 1)}-03-31`;
const addDays = (d, n) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

const VENDORS = [
  {
    code: 'NEWSAGT',
    name: 'Sharma News Agency',
    contact_person: 'Rakesh Sharma',
    phone: '0120-4000101',
  },
  {
    code: 'MAGDIST',
    name: 'Ace Magazine Distributors',
    contact_person: 'Neha Verma',
    phone: '0120-4000202',
  },
];
// library: the code in Library setup (the first library if that code is not there)
const PERIODICALS = [
  {
    name: 'The Times of India',
    kind: 'Newspaper',
    frequency: 'Daily',
    language: 'English',
    vendor: 'NEWSAGT',
    library: 'MAIN',
    copies: 2,
    cost: 4380,
    grace: 1,
    missing: 2,
  },
  {
    name: 'Dainik Jagran',
    kind: 'Newspaper',
    frequency: 'Daily',
    language: 'Hindi',
    vendor: 'NEWSAGT',
    library: 'MAIN',
    copies: 1,
    cost: 1825,
    grace: 1,
    missing: 1,
  },
  {
    name: 'India Today',
    kind: 'Magazine',
    frequency: 'Weekly',
    language: 'English',
    vendor: 'MAGDIST',
    library: 'SLIB',
    copies: 1,
    cost: 2600,
    grace: 7,
    missing: 1,
    special: 'Diwali special',
  },
  {
    name: 'Champak',
    kind: 'Magazine',
    frequency: 'Fortnightly',
    language: 'Hindi',
    vendor: 'MAGDIST',
    library: 'JLIB',
    copies: 2,
    cost: 960,
    grace: 7,
    missing: 0,
  },
  {
    name: 'National Geographic Kids',
    kind: 'Magazine',
    frequency: 'Monthly',
    language: 'English',
    vendor: 'MAGDIST',
    library: 'JLIB',
    copies: 1,
    cost: 1800,
    grace: 10,
    missing: 0,
  },
  {
    name: 'Science Reporter',
    kind: 'Journal',
    frequency: 'Monthly',
    language: 'English',
    vendor: 'MAGDIST',
    library: 'SLIB',
    copies: 1,
    cost: 300,
    grace: 15,
    missing: 1,
    issn: '0036-8512',
  },
  {
    name: 'School Science',
    kind: 'Journal',
    frequency: 'Quarterly',
    language: 'English',
    vendor: 'MAGDIST',
    library: 'SLIB',
    copies: 1,
    cost: 220,
    grace: 20,
    missing: 0,
  },
];

const masterRows = async (master) => {
  const r = await call('GET', `/masters/${master}/rows?size=500`);
  return r.data ?? r.rows ?? [];
};

async function main() {
  for (const v of VENDORS) {
    const rows = await masterRows('library_vendors');
    if (!rows.some((x) => String(x.code ?? x.values?.code) === v.code))
      await call('POST', '/masters/library_vendors/rows', { values: v });
  }
  for (const p of PERIODICALS) {
    const rows = await masterRows('library_periodicals');
    if (!rows.some((x) => String(x.name ?? x.values?.name).toLowerCase() === p.name.toLowerCase()))
      await call('POST', '/masters/library_periodicals/rows', {
        values: {
          name: p.name,
          kind_id: p.kind,
          frequency: p.frequency,
          language_id: p.language,
          vendor_id: p.vendor,
          ...(p.issn ? { issn: p.issn } : {}),
        },
      });
  }
  const setup = await call('GET', '/library/subscriptions/setup');
  const existing = await call('GET', '/library/subscriptions?status=all');
  const libs = setup.libraries ?? [];
  const libId = (code) => (libs.find((l) => l.code === code) ?? libs[0])?.id;
  const summary = [];
  for (const p of PERIODICALS) {
    const per = (setup.periodicals ?? []).find(
      (x) => x.name.toLowerCase() === p.name.toLowerCase(),
    );
    if (!per) throw new Error(`periodical not found after saving: ${p.name}`);
    if (
      (existing.data ?? []).some(
        (s) => String(s.periodical ?? s.periodicalName).toLowerCase() === p.name.toLowerCase(),
      )
    ) {
      summary.push(`${p.name}: already subscribed, left alone`);
      continue;
    }
    const made = await call('POST', '/library/subscriptions', {
      periodicalId: per.id,
      libraryId: libId(p.library),
      ...(per.vendorId ? { vendorId: per.vendorId } : {}),
      startsOn: STARTS,
      endsOn: ENDS,
      copies: p.copies,
      cost: p.cost,
      orderNo: `PO/${String(session)}/${p.vendor}`,
      billNo: `${p.vendor}-${String(session)}-01`,
      billDate: STARTS,
      graceDays: p.grace,
      notes: 'Sample subscription (seeded for testing)',
    });
    if (p.special)
      await call('POST', `/library/subscriptions/${made.id}/issues`, {
        expectedOn: `${String(session)}-10-20`,
        label: p.special,
      });
    const detail = await call('GET', `/library/subscriptions/${made.id}`);
    // received up to a little before today: the last few stay expected (some of them late)
    const holdBack = p.frequency === 'Daily' ? 3 : 1;
    const past = detail.issues.filter((i) => i.expectedOn <= today);
    const toReceive = past.slice(0, Math.max(0, past.length - holdBack));
    const missingIdx = new Set(
      Array.from({ length: p.missing }, (_, k) =>
        Math.floor(((k + 1) * toReceive.length) / (p.missing + 1)),
      ),
    );
    let got = 0;
    let lost = 0;
    for (const [n, i] of toReceive.entries()) {
      if (missingIdx.has(n)) {
        await call('POST', `/library/issues/${i.id}/missing`, {
          remarks: 'Not delivered by the vendor (sample)',
        });
        lost += 1;
        continue;
      }
      await call('POST', `/library/issues/${i.id}/receive`, {
        on: n % 5 === 4 ? addDays(i.expectedOn, 1) : i.expectedOn,
        copies: p.copies,
      });
      got += 1;
    }
    summary.push(
      `${p.name}: ${String(detail.issues.length)} issues expected in the session, ${String(got)} received, ${String(lost)} missing, ${String(past.length - toReceive.length)} still to receive`,
    );
  }
  console.log(summary.join('\n'));
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
