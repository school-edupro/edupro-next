#!/usr/bin/env node
/**
 * Sample item categories and items for the Purchase masters of the Alpha demo school (docs/design/83-84):
 * 11 categories with 27 sub-categories, and 81 items across them (49 consumables, 25 assets, 7 services) — consumables (some bought by the
 * box and counted by the piece, lab chemicals and first aid with batch and expiry), assets (IT and
 * audio-visual with serial numbers, furniture, lab, sports and electrical) and services (never stock).
 * The asset categories carry a depreciation rule: straight line over the useful life with 5% salvage
 * (furniture, lab, electrical 10 years; audio-visual, sports 5) and written-down value at 40% for IT.
 *
 * An item takes an HSN / SAC code only when the school's HSN master already has it (the module seeds
 * only codes whose GST rates are settled; the school adds the rest after its CA confirms the rates), so
 * most items have none until then. No GST rate is invented here.
 *
 * Everything goes through the API as dev-admin, so every rule applies as on screen and each row is in
 * the audit log. It only adds: a code that is there already is left as it is, so it can be run again.
 * Nothing is deleted, no purchase document is made and no message is sent.
 *
 * Needs the API on :4000. From the repository root:
 *   node scripts/seed-purchase-sample.mjs           (lists what it would add)
 *   node scripts/seed-purchase-sample.mjs --yes     (adds it)
 * SAMPLE_SCHOOL=2 for the Beta school.
 */

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
    // the API's rate limit refuses before doing anything: wait it out and send again
    if (res.status === 429 && i < 10) {
      const s = Number(res.headers.get('retry-after')) || 10;
      await res.text();
      await new Promise((r) => setTimeout(r, (s + 1) * 1000));
      continue;
    }
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (!res.ok)
      throw new Error(
        `${method} ${path} → ${String(res.status)} ${json?.type ?? ''}: ${json?.detail ?? text}`,
      );
    return json;
  }
}

/** every code of a master (all statuses) */
async function codes(master, column = 'code') {
  const out = new Set();
  for (let page = 1; ; page += 1) {
    const r = await api('GET', `/masters/${master}/rows?size=500&page=${String(page)}`);
    for (const row of r.data) out.add(String(row[column]));
    if (page * r.page.size >= r.page.total) break;
  }
  return out;
}

// ---- the categories ---------------------------------------------------------------------------------
const SLM10 = { dep_method: 'slm', useful_life_years: 10, salvage_pct: 5 };
const SLM5 = { dep_method: 'slm', useful_life_years: 5, salvage_pct: 5 };
/** [code, name, depreciation, [[sub code, sub name], ...]] */
const CATEGORIES = [
  [
    'STAT',
    'Stationery',
    null,
    [
      ['STAT-PAPER', 'Paper and notebooks'],
      ['STAT-WRITE', 'Writing instruments'],
      ['STAT-FILE', 'Files and office supplies'],
    ],
  ],
  [
    'TEACH',
    'Teaching aids',
    null,
    [
      ['TEACH-MAP', 'Maps, globes and charts'],
      ['TEACH-BOOK', 'Books and guides'],
    ],
  ],
  [
    'CLEAN',
    'Housekeeping and cleaning',
    null,
    [
      ['CLEAN-CHEM', 'Cleaning liquids'],
      ['CLEAN-TOOL', 'Cleaning tools'],
      ['CLEAN-HYG', 'Hygiene and toiletries'],
    ],
  ],
  [
    'IT',
    'IT equipment',
    { dep_method: 'wdv', wdv_rate_pct: 40 },
    [
      ['IT-COMP', 'Computers and UPS'],
      ['IT-PRINT', 'Printers and supplies'],
      ['IT-NET', 'Networking'],
    ],
  ],
  [
    'AV',
    'Audio-visual and smart class',
    SLM5,
    [
      ['AV-DISPLAY', 'Projectors and panels'],
      ['AV-SOUND', 'Sound systems'],
    ],
  ],
  [
    'FURN',
    'Furniture and fixtures',
    SLM10,
    [
      ['FURN-CLASS', 'Classroom furniture'],
      ['FURN-OFFICE', 'Office furniture'],
    ],
  ],
  [
    'LAB',
    'Laboratory',
    SLM10,
    [
      ['LAB-PHY', 'Physics lab'],
      ['LAB-CHEM', 'Chemistry lab'],
      ['LAB-BIO', 'Biology lab'],
    ],
  ],
  [
    'SPORT',
    'Sports',
    SLM5,
    [
      ['SPORT-BALL', 'Balls and kits'],
      ['SPORT-EQ', 'Sports equipment'],
    ],
  ],
  [
    'ELEC',
    'Electrical',
    SLM10,
    [
      ['ELEC-LIGHT', 'Lights and fans'],
      ['ELEC-APPL', 'Appliances'],
    ],
  ],
  [
    'MED',
    'Medical and first aid',
    null,
    [
      ['MED-DRUG', 'Medicines'],
      ['MED-AID', 'First-aid supplies'],
    ],
  ],
  [
    'SERV',
    'Services',
    null,
    [
      ['SERV-AMC', 'Repairs and maintenance'],
      ['SERV-STAFF', 'Housekeeping and security'],
      ['SERV-PRINT', 'Printing'],
    ],
  ],
];

// ---- the items --------------------------------------------------------------------------------------
const C = 'consumable';
const A = 'asset';
const S = 'service';
/**
 * [code, name, type, sub-category, unit, extra]; extra: hsn, brand, spec, store unit + per unit
 * (`per: ['PCS', 10]` a box of 10 pieces), batch (batch and expiry), serial
 */
const ITEMS = [
  // stationery
  [
    'STA-A4-REAM',
    'A4 copier paper, 75 GSM',
    C,
    'STAT-PAPER',
    'REAM',
    { spec: '500 sheets a ream' },
  ],
  ['STA-NB-172', 'Notebook, ruled, 172 pages', C, 'STAT-PAPER', 'NOS', { hsn: '48202000' }],
  ['STA-NB-GRAPH', 'Graph book, 64 pages', C, 'STAT-PAPER', 'NOS', { hsn: '48202000' }],
  ['STA-REG-200', 'Register, long book, 200 pages', C, 'STAT-PAPER', 'NOS', { hsn: '48202000' }],
  ['STA-PEN-BLUE', 'Ball pen, blue', C, 'STAT-WRITE', 'BOX', { per: ['PCS', 10] }],
  ['STA-PEN-RED', 'Ball pen, red', C, 'STAT-WRITE', 'BOX', { per: ['PCS', 10] }],
  ['STA-PENCIL-HB', 'Pencil, HB', C, 'STAT-WRITE', 'BOX', { hsn: '9609', per: ['PCS', 10] }],
  ['STA-ERASER', 'Eraser, non-dust', C, 'STAT-WRITE', 'BOX', { hsn: '40169200', per: ['PCS', 20] }],
  [
    'STA-SHARPENER',
    'Pencil sharpener',
    C,
    'STAT-WRITE',
    'BOX',
    { hsn: '82141010', per: ['PCS', 20] },
  ],
  ['STA-CHALK-W', 'White chalk, dustless (box of 100)', C, 'STAT-WRITE', 'BOX', { hsn: '9609' }],
  [
    'STA-MARKER-WB',
    'Whiteboard marker, assorted colours',
    C,
    'STAT-WRITE',
    'BOX',
    { per: ['PCS', 10] },
  ],
  ['STA-BOX-FILE', 'Box file, foolscap', C, 'STAT-FILE', 'NOS'],
  ['STA-STAPLER', 'Stapler, No. 10', C, 'STAT-FILE', 'NOS'],
  ['STA-STAPLE-PIN', 'Stapler pins, No. 10', C, 'STAT-FILE', 'BOX', { per: ['PKT', 20] }],
  ['STA-GLUE', 'Glue stick, 15 g', C, 'STAT-FILE', 'NOS'],
  // teaching aids
  ['TCH-GLOBE-12', 'Political globe, 12 inch', C, 'TEACH-MAP', 'NOS', { hsn: '4905' }],
  ['TCH-MAP-INDIA', 'Wall map of India, political', C, 'TEACH-MAP', 'NOS', { hsn: '4905' }],
  ['TCH-CHART-SCI', 'Science charts, set of 20', C, 'TEACH-MAP', 'SET', { hsn: '4905' }],
  ['TCH-DICT-EN', 'English dictionary', C, 'TEACH-BOOK', 'NOS', { hsn: '4901' }],
  ['TCH-ATLAS', 'School atlas', C, 'TEACH-BOOK', 'NOS', { hsn: '4905' }],
  // housekeeping
  ['CLN-FLOOR-5L', 'Floor cleaner, 5 litre can', C, 'CLEAN-CHEM', 'BTL'],
  ['CLN-PHENYL-5L', 'Phenyl, 5 litre can', C, 'CLEAN-CHEM', 'BTL'],
  ['CLN-GLASS', 'Glass cleaner, 500 ml', C, 'CLEAN-CHEM', 'BTL'],
  ['CLN-BROOM', 'Soft broom', C, 'CLEAN-TOOL', 'NOS'],
  ['CLN-MOP', 'Floor mop with handle', C, 'CLEAN-TOOL', 'NOS'],
  ['CLN-DUSTBIN-60', 'Dustbin with lid, 60 litre', C, 'CLEAN-TOOL', 'NOS'],
  ['CLN-HANDWASH-5L', 'Liquid hand wash, 5 litre', C, 'CLEAN-HYG', 'BTL'],
  ['CLN-TISSUE', 'Toilet roll', C, 'CLEAN-HYG', 'PKT', { per: ['ROLL', 10] }],
  ['CLN-GARBAGE-BAG', 'Garbage bags, large', C, 'CLEAN-HYG', 'PKT', { per: ['PCS', 30] }],
  // IT
  [
    'IT-LAPTOP',
    'Laptop, Core i5, 16 GB, 512 GB SSD',
    A,
    'IT-COMP',
    'NOS',
    { hsn: '8471', serial: true, spec: '14 inch, Windows 11 Pro, 3 years warranty' },
  ],
  [
    'IT-DESKTOP',
    'Desktop computer with 22 inch monitor',
    A,
    'IT-COMP',
    'NOS',
    { hsn: '8471', serial: true, spec: 'Core i3, 8 GB, 512 GB SSD, keyboard and mouse' },
  ],
  ['IT-UPS-1KVA', 'UPS, 1 kVA', A, 'IT-COMP', 'NOS', { serial: true }],
  ['IT-MOUSE', 'USB mouse', C, 'IT-COMP', 'NOS'],
  ['IT-KEYBOARD', 'USB keyboard', C, 'IT-COMP', 'NOS'],
  ['IT-PRINTER-LJ', 'Laser printer, mono, A4', A, 'IT-PRINT', 'NOS', { serial: true }],
  ['IT-TONER', 'Toner cartridge for the laser printer', C, 'IT-PRINT', 'NOS'],
  ['IT-SWITCH-24', 'Network switch, 24 port, gigabit', A, 'IT-NET', 'NOS', { serial: true }],
  ['IT-WIFI-AP', 'Wi-Fi access point', A, 'IT-NET', 'NOS', { serial: true }],
  [
    'IT-CABLE-CAT6',
    'CAT6 network cable (box of 305 metre)',
    C,
    'IT-NET',
    'BOX',
    { per: ['MTR', 305] },
  ],
  // audio-visual
  ['AV-PROJECTOR', 'Projector, 3500 lumens', A, 'AV-DISPLAY', 'NOS', { serial: true }],
  [
    'AV-IFP-75',
    'Interactive flat panel, 75 inch',
    A,
    'AV-DISPLAY',
    'NOS',
    { serial: true, spec: 'With wall mount and stylus' },
  ],
  ['AV-SCREEN', 'Projector screen, motorised, 8 x 6 ft', A, 'AV-DISPLAY', 'NOS'],
  [
    'AV-PA-SYSTEM',
    'PA system with two speakers and a microphone',
    A,
    'AV-SOUND',
    'SET',
    { serial: true },
  ],
  ['AV-MIC-CORDLESS', 'Cordless microphone', A, 'AV-SOUND', 'NOS', { serial: true }],
  // furniture
  [
    'FUR-DESK-DUAL',
    'Dual desk with bench (students)',
    A,
    'FURN-CLASS',
    'NOS',
    { spec: 'Steel frame, pre-laminated board top' },
  ],
  ['FUR-CHAIR-STU', 'Student chair', A, 'FURN-CLASS', 'NOS'],
  ['FUR-TEACHER-TBL', "Teacher's table with drawer", A, 'FURN-CLASS', 'NOS'],
  ['FUR-WHITEBOARD', 'Whiteboard, 8 x 4 ft', A, 'FURN-CLASS', 'NOS'],
  ['FUR-CHAIR-OFF', 'Office chair, revolving', A, 'FURN-OFFICE', 'NOS'],
  ['FUR-ALMIRAH', 'Steel almirah, 6.5 ft', A, 'FURN-OFFICE', 'NOS'],
  ['FUR-FILE-CAB', 'Filing cabinet, 4 drawer', A, 'FURN-OFFICE', 'NOS'],
  // laboratory
  ['LAB-MICROSCOPE', 'Compound microscope', A, 'LAB-BIO', 'NOS', { serial: true }],
  ['LAB-SLIDES', 'Prepared slides, set of 50', C, 'LAB-BIO', 'SET'],
  ['LAB-MULTIMETER', 'Digital multimeter', A, 'LAB-PHY', 'NOS'],
  ['LAB-VERNIER', 'Vernier calliper', C, 'LAB-PHY', 'NOS'],
  ['LAB-BEAKER-250', 'Glass beaker, 250 ml', C, 'LAB-CHEM', 'NOS'],
  ['LAB-TEST-TUBE', 'Test tube, 15 ml', C, 'LAB-CHEM', 'DOZ', { per: ['PCS', 12] }],
  ['LAB-HCL-500', 'Hydrochloric acid, 500 ml', C, 'LAB-CHEM', 'BTL', { batch: true }],
  ['LAB-LITMUS', 'Litmus paper, blue and red', C, 'LAB-CHEM', 'PKT', { batch: true }],
  // sports
  ['SPT-FOOTBALL', 'Football, size 5', C, 'SPORT-BALL', 'NOS'],
  ['SPT-BASKETBALL', 'Basketball, size 7', C, 'SPORT-BALL', 'NOS'],
  ['SPT-CRICKET-KIT', 'Cricket kit, junior', C, 'SPORT-BALL', 'SET'],
  ['SPT-SHUTTLE', 'Shuttlecocks, feather (tube of 10)', C, 'SPORT-BALL', 'BOX'],
  ['SPT-TT-TABLE', 'Table tennis table', A, 'SPORT-EQ', 'NOS'],
  ['SPT-BB-POLE', 'Basketball pole with board, pair', A, 'SPORT-EQ', 'PAIR'],
  // electrical
  ['ELE-LED-TUBE', 'LED tube light, 20 W', C, 'ELEC-LIGHT', 'NOS'],
  ['ELE-FAN-CEIL', 'Ceiling fan, 1200 mm', A, 'ELEC-LIGHT', 'NOS'],
  [
    'ELE-AC-1.5T',
    'Split air conditioner, 1.5 ton, 3 star',
    A,
    'ELEC-APPL',
    'NOS',
    { serial: true },
  ],
  [
    'ELE-COOLER-RO',
    'Water cooler with RO purifier, 80 litre',
    A,
    'ELEC-APPL',
    'NOS',
    { serial: true },
  ],
  // medical
  [
    'MED-PARA-500',
    'Paracetamol 500 mg tablets (strip of 10)',
    C,
    'MED-DRUG',
    'BOX',
    { batch: true, per: ['PCS', 10] },
  ],
  ['MED-ORS', 'ORS sachets', C, 'MED-DRUG', 'PKT', { batch: true, per: ['PCS', 25] }],
  ['MED-ANTISEPTIC', 'Antiseptic liquid, 500 ml', C, 'MED-AID', 'BTL', { batch: true }],
  ['MED-BANDAGE', 'Crepe bandage, 10 cm', C, 'MED-AID', 'NOS', { batch: true }],
  ['MED-FIRSTAID-KIT', 'First-aid box, filled', C, 'MED-AID', 'NOS', { batch: true }],
  // services
  ['SRV-AMC-AC', 'AC servicing (AMC), per quarter', S, 'SERV-AMC', 'JOB'],
  ['SRV-AMC-COMP', 'Computer lab AMC, per month', S, 'SERV-AMC', 'MON'],
  ['SRV-PLUMBING', 'Plumbing repairs', S, 'SERV-AMC', 'HRS'],
  ['SRV-PEST', 'Pest control, per visit', S, 'SERV-AMC', 'JOB'],
  ['SRV-HOUSEKEEP', 'Housekeeping staff, per month', S, 'SERV-STAFF', 'MON'],
  ['SRV-SECURITY', 'Security guards, per month', S, 'SERV-STAFF', 'MON'],
  ['SRV-PRINT-FORMS', 'Printing of circulars and forms', S, 'SERV-PRINT', 'JOB'],
];

// ---- add what is missing ----------------------------------------------------------------------------
const parentOf = Object.fromEntries(
  CATEGORIES.flatMap(([code, , , subs]) => subs.map(([sub]) => [sub, code])),
);
const haveCats = await codes('purchase_item_categories');
const haveItems = await codes('purchase_items');
const haveHsn = await codes('purchase_hsn');
const haveUoms = await codes('purchase_uoms');

const newCats = [];
for (const [code, name, dep, subs] of CATEGORIES) {
  if (!haveCats.has(code)) newCats.push({ code, name, ...(dep ?? {}) });
  for (const [sub, subName] of subs)
    if (!haveCats.has(sub)) newCats.push({ code: sub, name: subName, parent_id: code });
}
const newItems = [];
const noHsn = [];
for (const [code, name, type, sub, uom, x = {}] of ITEMS) {
  if (haveItems.has(code)) continue;
  for (const u of [uom, x.per?.[0]].filter(Boolean))
    if (!haveUoms.has(u)) throw new Error(`Unit ${u} (item ${code}) is not in the school's units`);
  const hsn = x.hsn && haveHsn.has(x.hsn) ? x.hsn : null;
  if (x.hsn && !hsn) noHsn.push(`${code} (${x.hsn})`);
  newItems.push({
    code,
    name,
    item_type: type,
    category_id: parentOf[sub],
    sub_category_id: sub,
    uom_id: uom,
    hsn_id: hsn,
    brand: x.brand ?? null,
    specification: x.spec ?? null,
    stock_tracked: type !== S,
    stock_uom_id: x.per?.[0] ?? null,
    stock_per_unit: x.per?.[1] ?? 1,
    tracks_batch: Boolean(x.batch),
    tracks_serial: Boolean(x.serial),
  });
}

console.log(
  `School ${SCHOOL}: ${String(haveCats.size)} categories and ${String(haveItems.size)} items there now.`,
);
console.log(
  `To add: ${String(newCats.length)} categories / sub-categories, ${String(newItems.length)} items.`,
);
if (noHsn.length) console.log(`HSN not in the school's list, left empty: ${noHsn.join(', ')}`);
if (!WRITE) {
  for (const c of newCats) console.log(`  category ${c.code.padEnd(12)} ${c.name}`);
  for (const i of newItems)
    console.log(`  item     ${i.code.padEnd(16)} ${i.item_type.padEnd(10)} ${i.name}`);
  console.log('Nothing written. Run with --yes to add them.');
  process.exit(0);
}
// categories first (a sub-category needs its category), then the items
for (const c of newCats.filter((x) => !x.parent_id))
  await api('POST', '/masters/purchase_item_categories/rows', { values: c });
for (const c of newCats.filter((x) => x.parent_id))
  await api('POST', '/masters/purchase_item_categories/rows', { values: c });
for (const i of newItems) await api('POST', '/masters/purchase_items/rows', { values: i });
console.log(`Added ${String(newCats.length)} categories and ${String(newItems.length)} items.`);
