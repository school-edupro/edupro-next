#!/usr/bin/env node
/**
 * Sample exam data for two classes of the Alpha demo school (docs/design/67): Periodic Test 1 and 2,
 * Activity Test 1 and 2, and Term I; VI and VII unless --classes says otherwise (e.g. --classes VI,VIII).
 * Everything goes through the API as the demo users, so every rule applies as on screen (who takes a
 * subject, codes, parts, locks, results); only the clearing of an earlier run (and of the classes'
 * hand-entered marks) is done in the database, as the API never deletes marks. Nothing is published or
 * released and no message is sent.
 *
 *   1. Only with --setup (the first VI-VII run): Class VII gets a subject template (VI keeps its own);
 *      every VI-VII student gets their subjects (VI-A a language each, VII the compulsory ones); Term I
 *      gets its subjects (out of 80, Art and PE graded A-C in VII), Social Science in its class parts.
 *      Without it the classes' subjects, choices and exam subjects stay as set up.
 *   2. Marks for every student who takes a subject: a steady level per student with some spread; AB
 *      (absent) twice and ML (medical leave) three times, each in a fixed place.
 *   3. What each exam takes (its areas): attendance and remarks (the general remark and the remark
 *      categories the class takes; Term I also what the student took part in); Term I co-scholastic
 *      indicators and height / weight / blood group.
 *   4. The stage of mid-October: PT1, PT2 and both activity tests submitted, verified and worked out;
 *      Term I submitted for verification, the second class's B section Science and Social Science still
 *      in progress, the first class's A section Computer Science entered but not submitted.
 *   5. "Term I result (sample)": the DPS VI-VIII scheme (periodic tests 15 + activities 5 + term 80)
 *      for these classes and those it had before, locked and worked out.
 *
 * Needs the local database (DATABASE_MIGRATOR_URL on localhost) and the API on :4000 (about 900 calls:
 * raise its rate limit for the run). From the repository root:
 *   set -a; source .env; set +a; node scripts/seed-exam-sample.mjs --classes VI,VIII --yes
 * It can be run again: it clears what it made first (only in the classes named).
 */
import { createRequire } from 'node:module';

const require = createRequire(new URL('../packages/db/package.json', import.meta.url));
const pg = require('pg');

const API = process.env.API_URL ?? 'http://localhost:4000/api/v1';
const SCHOOL = process.env.SAMPLE_SCHOOL ?? '1';
const ADMIN = 'dev-admin'; // sets up, verifies, writes remarks, attendance, indicators, health
const OFFICE = 'dev-clerk'; // the exam office: choices and marks, submits
const EXAMS = {
  PT1: 'PT1-2026',
  PT2: 'PT2',
  ACT1: 'ACT1',
  ACT2: 'ACT2',
  TERM: 'TERM1-I-2026',
};
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const CLASSES = (arg('--classes') ?? 'VI,VII')
  .split(',')
  .map((x) => x.trim().toUpperCase())
  .filter(Boolean);
/** the first VI-VII run's subject set-up (step 2) */
const SETUP = process.argv.includes('--setup');
const SCHEME = 'Term I result (sample)';
/** where the fixed codes and stages fall: the first class and the second (or the first again) */
const [C1, C2 = C1] = CLASSES;
if (!CLASSES.length || CLASSES.length > 3) {
  console.error('Refused: name one to three classes, e.g. --classes VI,VIII');
  process.exit(1);
}
if (SETUP && CLASSES.join(',') !== 'VI,VII') {
  console.error('Refused: --setup is the subject set-up of the VI-VII sample only');
  process.exit(1);
}

if (!/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(process.env.DATABASE_MIGRATOR_URL ?? '')) {
  console.error('Refused: DATABASE_MIGRATOR_URL is not the local database.');
  process.exit(1);
}
if (!process.argv.includes('--yes')) {
  console.error(
    `This replaces the marks, results and entries of classes ${CLASSES.join(', ')} in ${Object.values(EXAMS).join(', ')}. Run with --yes.`,
  );
  process.exit(1);
}

// ---- small helpers ---------------------------------------------------------------------------------
let calls = 0;
async function api(user, method, path, body) {
  calls += 1;
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      authorization: `Bearer dev:${user}`,
      'x-school-id': SCHOOL,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok)
    throw new Error(
      `${method} ${path} → ${String(res.status)} ${json?.type ?? ''}: ${json?.detail ?? text}`,
    );
  return json;
}
/** a repeatable random number from a key (the same sample on every run) */
function rand(key) {
  let h = 2166136261;
  for (const ch of String(key)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  h += 0x6d2b79f5;
  let t = h;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
/** a student's steady level: most between 0.55 and 0.9, a few weaker, a few toppers */
const level = (studentId) => {
  const r = rand(`lvl:${studentId}`);
  return r < 0.1 ? 0.32 + r : r > 0.9 ? 0.86 + (r - 0.9) : 0.5 + r * 0.42;
};
const half = (v) => Math.round(v * 2) / 2;
const log = (...a) => console.log(...a);

// ---- 0. what is there ------------------------------------------------------------------------------
const exams = (await api(ADMIN, 'GET', '/exams')).data;
const exam = Object.fromEntries(
  Object.entries(EXAMS).map(([k, code]) => {
    const e = exams.find((x) => x.code === code);
    if (!e) throw new Error(`No exam with the code ${code} in the working year`);
    return [k, e];
  }),
);
const classes = exam.PT1.classes
  .filter((k) => CLASSES.includes(k.classCode))
  .map((k) => ({ id: k.classId, code: k.classCode }));
if (classes.length !== CLASSES.length)
  throw new Error(`${EXAMS.PT1} does not have classes ${CLASSES.join(', ')}`);
const classIds = classes.map((k) => k.id);
const sections = (await api(ADMIN, 'GET', '/exams/subject-choices/sections')).data.filter((s) =>
  classIds.includes(s.classId),
);
const scales = (await api(ADMIN, 'GET', '/exams/grade-scales')).data;
const coScholastic = scales.find((g) => g.code === 'CO_SCHOLASTIC_3');
log(
  `Exams ${Object.values(exam)
    .map((e) => e.code)
    .join(', ')}; sections ${sections.map((s) => s.code).join(', ')}`,
);

// ---- 1. clear an earlier run (and PT1's hand-entered VI-VII marks) ---------------------------------
const db = new pg.Client({ connectionString: process.env.DATABASE_MIGRATOR_URL });
await db.connect();
const examIds = Object.values(exam).map((e) => e.id);
const schemeClassIds = new Set(classIds);
const before = Number(
  (
    await db.query(`SELECT coalesce(max(id), 0) AS n FROM comms_messages WHERE school_id = $1`, [
      SCHOOL,
    ])
  ).rows[0].n,
);
await db.query('BEGIN');
try {
  const es = (
    await db.query(
      `SELECT id FROM exam_subjects WHERE exam_id = ANY($1::bigint[]) AND class_id = ANY($2::bigint[])`,
      [examIds, classIds],
    )
  ).rows.map((x) => x.id);
  const students = (
    await db.query(
      `SELECT en.student_id FROM enrolments en JOIN class_sections cs ON cs.id = en.class_section_id
        WHERE cs.class_id = ANY($1::bigint[]) AND en.status = 'active'
          AND en.academic_year_id = (SELECT academic_year_id FROM exams WHERE id = $2)`,
      [classIds, examIds[0]],
    )
  ).rows.map((x) => x.student_id);
  await db.query(
    `DELETE FROM mark_part_entries WHERE part_id IN (SELECT id FROM exam_subject_parts WHERE exam_subject_id = ANY($1::bigint[]))`,
    [es],
  );
  await db.query(`DELETE FROM mark_entries WHERE exam_subject_id = ANY($1::bigint[])`, [es]);
  await db.query(`DELETE FROM exam_entry_status_log WHERE exam_subject_id = ANY($1::bigint[])`, [
    es,
  ]);
  await db.query(`DELETE FROM exam_entry_status WHERE exam_subject_id = ANY($1::bigint[])`, [es]);
  await db.query(
    `UPDATE exam_subjects SET entry_locked = false, locked_by = NULL, locked_at = NULL WHERE id = ANY($1::bigint[])`,
    [es],
  );
  for (const t of [
    'exam_results',
    'exam_remarks',
    'exam_remark_items',
    'exam_attendance',
    'indicator_entries',
    'health_records',
  ])
    await db.query(
      `DELETE FROM ${t} WHERE exam_id = ANY($1::bigint[]) AND student_id = ANY($2::bigint[])`,
      [examIds, students],
    );
  await db.query(
    `UPDATE exam_classes SET indicators_locked = false, remarks_locked = false, attendance_locked = false, health_locked = false
      WHERE exam_id = ANY($1::bigint[]) AND class_id = ANY($2::bigint[])`,
    [examIds, classIds],
  );
  const oldRows = (
    await db.query(
      `SELECT id, class_ids::text[] AS class_ids FROM mark_schemes WHERE school_id = $1 AND name = $2`,
      [SCHOOL, SCHEME],
    )
  ).rows;
  const old = oldRows.map((x) => x.id);
  // the register keeps the classes it had (another class's sample stays in it)
  for (const r of oldRows) for (const id of r.class_ids) schemeClassIds.add(id);
  await db.query(`DELETE FROM term_results WHERE scheme_id = ANY($1::bigint[])`, [old]);
  await db.query(`DELETE FROM mark_schemes WHERE id = ANY($1::bigint[])`, [old]);
  // the set-up's subject choices are made again; otherwise the students' subject changes stay
  if (SETUP)
    await db.query(`DELETE FROM student_subject_changes WHERE student_id = ANY($1::bigint[])`, [
      students,
    ]);
  await db.query('COMMIT');
  log(
    `Cleared ${String(es.length)} exam subjects of ${CLASSES.join(', ')} and ${String(students.length)} students' entries`,
  );
} catch (e) {
  await db.query('ROLLBACK');
  throw e;
}

// ---- 2. subjects (--setup only): VII's template, everyone's choices, Term I's subjects ---------------
const classOf = (code) => classes.find((k) => k.code === code);
if (SETUP) {
  const vi = classOf('VI');
  const vii = classOf('VII');
  const viSetup = await api(ADMIN, 'GET', `/exams/subject-choices/setup?classId=${vi.id}`);
  const sstParts =
    viSetup.subjects
      .find((x) => x.code === 'SST')
      ?.parts?.map((p) => ({ subjectId: p.subjectId, share: p.share })) ?? [];
  const viiOrder = ['ENG', 'HIN', 'MAT', 'SCI', 'SST', 'CS', 'ART', 'PE'];
  const viiSetup = await api(ADMIN, 'GET', `/exams/subject-choices/setup?classId=${vii.id}`);
  await api(ADMIN, 'PUT', '/exams/subject-choices/setup', {
    classId: vii.id,
    groups: [],
    subjects: [
      ...viiOrder
        .map((c) => viiSetup.subjects.find((x) => x.code === c))
        .filter(Boolean)
        .map((x) => ({
          subjectId: x.id,
          take: 'all',
          group: null,
          parts: x.code === 'SST' ? sstParts : [],
        })),
      ...viiSetup.subjects
        .filter((x) => !viiOrder.includes(x.code))
        .map((x) => ({ subjectId: x.id, take: 'free', group: null, parts: [] })),
    ],
    streams: [],
  });
  log('Class VII: subject template set');

  const langGroup = viSetup.groups.find((g) => g.max === 1);
  const viLangs = ['HIN', 'HIN', 'HIN', 'SAN', 'HIN', 'FREN', 'GERM', 'SAN', 'SPA'];
  for (const s of sections) {
    const list = await api(ADMIN, 'GET', `/exams/subject-choices?classSectionId=${s.id}`);
    if (s.classId === vii.id) {
      await api(OFFICE, 'POST', '/exams/subject-choices/defaults', { classSectionId: s.id });
    } else if (langGroup) {
      // VI: a language from Subject-2 for each student without one
      const rows = list.rows
        .filter(
          (r) => !langGroup.subjectIds.some((id) => r.subjects.some((x) => x.subjectId === id)),
        )
        .map((r, i) => {
          const want = viSetup.subjects.find((x) => x.code === viLangs[i % viLangs.length]);
          const lang = langGroup.subjectIds.includes(want?.id) ? want.id : langGroup.subjectIds[0];
          return { studentId: r.studentId, subjects: [{ subjectId: lang }] };
        });
      if (rows.length) {
        const out = await api(OFFICE, 'PUT', '/exams/subject-choices', {
          classSectionId: s.id,
          partial: true,
          rows,
        });
        if (out.refused?.length)
          log(
            `  ${s.code}: not set`,
            out.refused.map((x) => `${x.name}: ${x.error}`),
          );
      }
    }
  }
  log('Subject choices set for VI-VII');

  // Term I: every subject a student takes, out of 80 (pass 27), a paper a day from the exam's first day
  // (the languages of a group on one day); VII's Art and PE graded A-C
  const dayOf = (n) => {
    const d = new Date(`${exam.TERM.startsOn ?? '2026-10-01'}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const termSubjects = async (k, order) => {
    const setup = await api(ADMIN, 'GET', `/exams/subject-choices/setup?classId=${k.id}`);
    const taken = setup.subjects.filter((x) => x.take !== 'free').map((x) => x.code);
    const codes = order ?? taken;
    const groupDay = new Map();
    let day = 0;
    return codes
      .map((c) => setup.subjects.find((x) => x.code === c))
      .filter(Boolean)
      .map((x) => {
        const graded = k.code === 'VII' && ['ART', 'PE'].includes(x.code) && coScholastic;
        if (graded) return { subjectId: x.id, maxMarks: 0, gradeScaleId: coScholastic.id };
        let n = x.groupId ? groupDay.get(x.groupId) : undefined;
        if (n === undefined) {
          n = day;
          day += 1;
          if (x.groupId) groupDay.set(x.groupId, n);
        }
        return { subjectId: x.id, maxMarks: 80, passMarks: 27, examOn: dayOf(n) };
      });
  };
  for (const k of [vi, vii])
    await api(ADMIN, 'PUT', `/exams/${exam.TERM.id}/subjects`, {
      classId: k.id,
      subjects: await termSubjects(k, k.code === 'VII' ? viiOrder : null),
    });
  log('Term I: subjects set for VI-VII');
} else log(`Subjects of ${CLASSES.join(', ')}: as set up`);

// ---- 3. marks ------------------------------------------------------------------------------------
const shift = { PT1: 0, PT2: 0.02, ACT1: 0.06, ACT2: 0.05, TERM: -0.03 };
/** Term I left in progress: the second class's B section, Science and Social Science (the last three not entered) */
const inProgress = (key, sec, code) =>
  key === 'TERM' && sec.code === `${C2}-B` && ['SCI', 'SST'].includes(code);
/** Term I entered and not submitted: the first class's A section, Computer Science */
const notSubmitted = (key, sec, code) => key === 'TERM' && sec.code === `${C1}-A` && code === 'CS';
/**
 * A few codes, each in its place (exam, section, subject, the nth student who takes it): AB twice (as
 * the school's codes say, it counts 0 and holds the term result as Absent), ML three times (left out).
 * A subject in parts takes AB only.
 */
const CODES = [
  ['PT1', `${C1}-A`, 'MAT', 3, 'AB'],
  ['PT2', `${C2}-A`, 'MAT', 5, 'ML'],
  ['ACT2', `${C1}-B`, 'ENG', 2, 'ML'],
  ['TERM', `${C2}-A`, 'HIN', 4, 'ML'],
  ['TERM', `${C1}-B`, 'SST', 6, 'AB'],
];
const sheetsOf = async (key) => {
  const e = await api(ADMIN, 'GET', `/exams/${exam[key].id}`);
  return e.subjects.filter((x) => classIds.includes(x.classId));
};
const entered = []; // [key, section, subjectId, code, complete]
for (const key of Object.keys(EXAMS)) {
  const ess = await sheetsOf(key);
  for (const s of sections) {
    for (const es of ess.filter((x) => x.classId === s.classId)) {
      const sheet = await api(
        ADMIN,
        'GET',
        `/exams/${exam[key].id}/marks?classSectionId=${s.id}&subjectId=${es.subjectId}`,
      );
      const takers = sheet.rows.filter((r) => r.taken);
      if (!takers.length) continue;
      const max = Number(sheet.examSubject.maxMarks);
      const cut = inProgress(key, s, es.subjectCode) ? takers.length - 3 : takers.length;
      const mine = takers.slice(0, cut);
      const at = (r) =>
        clamp(
          level(r.studentId) +
            shift[key] +
            (rand(`${key}:${es.subjectCode}:${r.studentId}`) - 0.5) * 0.22,
          0.12,
          1,
        );
      const code = (r) =>
        CODES.find(
          ([k, sec, subj, nth]) =>
            k === key && sec === s.code && subj === es.subjectCode && takers[nth - 1] === r,
        )?.[4] ?? null;
      if (sheet.examSubject.gradeOnly) {
        const grades = sheet.grades?.length ? sheet.grades : ['A', 'B', 'C'];
        await api(OFFICE, 'PUT', `/exams/${exam[key].id}/marks`, {
          classSectionId: s.id,
          subjectId: es.subjectId,
          rows: mine.map((r) => {
            const v = at(r);
            return {
              studentId: r.studentId,
              marks: null,
              grade: grades[v > 0.78 ? 0 : v > 0.55 ? 1 : 2],
            };
          }),
        });
      } else if (sheet.examSubject.parts?.length) {
        for (const p of sheet.examSubject.parts) {
          const pmax = Number(p.maxMarks);
          await api(OFFICE, 'PUT', `/exams/${exam[key].id}/part-marks`, {
            classSectionId: s.id,
            partId: p.id,
            rows: mine.map((r) =>
              code(r) === 'AB'
                ? { studentId: r.studentId, marks: null, absent: true }
                : {
                    studentId: r.studentId,
                    marks: half(
                      pmax * clamp(at(r) + (rand(`${p.id}:${r.studentId}`) - 0.5) * 0.1, 0.1, 1),
                    ),
                    absent: false,
                  },
            ),
          });
        }
      } else {
        await api(OFFICE, 'PUT', `/exams/${exam[key].id}/marks`, {
          classSectionId: s.id,
          subjectId: es.subjectId,
          rows: mine.map((r) =>
            code(r)
              ? { studentId: r.studentId, marks: null, code: code(r) }
              : { studentId: r.studentId, marks: half(max * at(r)) },
          ),
        });
      }
      entered.push({
        key,
        s,
        subjectId: es.subjectId,
        code: es.subjectCode,
        complete: cut === takers.length,
      });
    }
  }
  log(`${exam[key].code}: marks entered`);
}

// ---- 4. what each exam takes besides marks ----------------------------------------------------------
const REMARKS = {
  top: [
    'Excellent work throughout; keeps up the high standard.',
    'Outstanding grasp of concepts and neat, careful work.',
    'A sincere and bright learner; well done.',
  ],
  good: [
    'Good progress; more practice in written answers will help.',
    'Attentive in class and regular with homework.',
    'Steady effort; can aim higher with revision.',
  ],
  low: [
    'Needs regular revision and more practice at home.',
    'Should ask doubts in class and complete work on time.',
    'Capable of better results with consistent effort.',
  ],
};
const remarkOf = (studentId, key) => {
  const l = level(studentId);
  const pool = l > 0.8 ? REMARKS.top : l > 0.55 ? REMARKS.good : REMARKS.low;
  return pool[Math.floor(rand(`rem:${key}:${studentId}`) * pool.length)];
};
const band = (studentId) => {
  const l = level(studentId);
  return l > 0.8 ? 'top' : l > 0.55 ? 'good' : 'low';
};
/** how a listed remark reads, to give it to a student of that level */
const tone = (text) =>
  /\b(needs?|support|should|less)\b/i.test(text)
    ? 'low'
    : /excellent|outstanding|quickly|confiden|courteous|respectful|aiming high/i.test(text)
      ? 'top'
      : 'good';
/** a free-text category without a subject ("Any other"): a third of the students, in Term I */
const OTHER = [
  'Represented the school in an inter-school competition.',
  'Took an active part in the inter-house quiz.',
  'Helped look after the class library this term.',
  'Won a prize at the science exhibition.',
];
const TOOK_PART = [
  'Inter-house quiz',
  'Annual sports day (relay)',
  'Science exhibition',
  'English debate',
  'Art and craft fair',
  'Yoga day',
  'School choir',
];
const tookPart = (id) => {
  const a = TOOK_PART[Math.floor(rand(`tp1:${id}`) * TOOK_PART.length)];
  const b = TOOK_PART[Math.floor(rand(`tp2:${id}`) * TOOK_PART.length)];
  return rand(`tp:${id}`) < 0.3 ? null : a === b ? a : `${a}; ${b}`;
};
const NOTES = [
  'Takes part with interest.',
  'Works neatly and with care.',
  'Shows good effort and new ideas.',
];
const HEIGHT = { VI: 138, VII: 143, VIII: 149 };
const DAYS = { PT1: 46, PT2: 22, TERM: 112 };
for (const key of ['PT1', 'PT2', 'TERM']) {
  const areas = exam[key].areas ?? [];
  for (const s of sections) {
    const list = await api(ADMIN, 'GET', `/exams/subject-choices?classSectionId=${s.id}`);
    const ids = list.rows.map((r) => r.studentId);
    if (areas.includes('remarks')) {
      await api(ADMIN, 'PUT', `/exams/${exam[key].id}/remarks`, {
        classSectionId: s.id,
        rows: ids.map((id) => ({
          studentId: id,
          remark: remarkOf(id, key),
          ...(key === 'TERM' ? { participation: tookPart(id) } : {}),
        })),
      });
      // the remark categories the class takes: a listed one for everyone (a remark of their level),
      // a subject's for everyone, "Any other" for a third in Term I
      const sheet = await api(
        ADMIN,
        'GET',
        `/exams/${exam[key].id}/remark-items?classSectionId=${s.id}`,
      );
      const rows = [];
      for (const k of sheet.categories.filter((x) => x.may)) {
        const bank = k.bank.filter((b) => b.text.trim().split(/\s+/).length >= 3);
        for (const id of ids) {
          if (!k.freeText) {
            if (!bank.length) break;
            const fits = bank.filter((b) => tone(b.text) === band(id));
            const pool = fits.length ? fits : bank;
            const b = pool[Math.floor(rand(`cat:${key}:${k.id}:${id}`) * pool.length)];
            rows.push({ studentId: id, categoryId: k.id, text: null, bankCode: b.code });
          } else if (k.subjectId) {
            rows.push({ studentId: id, categoryId: k.id, text: remarkOf(id, `${key}:${k.code}`) });
          } else if (key === 'TERM' && rand(`oth:${k.id}:${id}`) < 0.34) {
            const t = OTHER[Math.floor(rand(`otht:${id}`) * OTHER.length)];
            rows.push({ studentId: id, categoryId: k.id, text: t });
          }
        }
      }
      if (rows.length)
        await api(ADMIN, 'PUT', `/exams/${exam[key].id}/remark-items`, {
          classSectionId: s.id,
          rows,
        });
    }
    if (areas.includes('attendance'))
      await api(ADMIN, 'PUT', `/exams/${exam[key].id}/attendance`, {
        classSectionId: s.id,
        rows: ids.map((id) => ({
          studentId: id,
          daysTotal: DAYS[key],
          daysPresent: Math.round(
            DAYS[key] *
              clamp(0.8 + level(id) * 0.18 + (rand(`att:${key}:${id}`) - 0.5) * 0.08, 0.6, 1),
          ),
        })),
      });
    if (key === 'TERM' && areas.includes('indicators')) {
      const sheet = await api(
        ADMIN,
        'GET',
        `/exams/${exam[key].id}/indicators?classSectionId=${s.id}`,
      );
      const levels = sheet.set?.grades ?? [];
      const items = (sheet.indicators ?? []).filter(
        (i) =>
          !i.heading &&
          (i.kind === 'text' || (i.kind === 'level' && (i.levels?.length || levels.length))),
      );
      if (items.length)
        await api(ADMIN, 'PUT', `/exams/${exam[key].id}/indicators`, {
          classSectionId: s.id,
          rows: ids.flatMap((id) =>
            items.map((i) => {
              if (i.kind === 'text')
                return {
                  studentId: id,
                  indicatorId: i.id,
                  note: NOTES[Math.floor(rand(`note:${i.id}:${id}`) * NOTES.length)],
                };
              const v = clamp(level(id) + (rand(`ind:${i.id}:${id}`) - 0.5) * 0.3, 0, 1);
              const own = i.levels?.length ? i.levels : levels;
              return {
                studentId: id,
                indicatorId: i.id,
                grade: own[Math.min(own.length - 1, Math.floor((1 - v) * own.length))],
              };
            }),
          ),
        });
    }
    if (key === 'TERM' && areas.includes('health')) {
      const base = HEIGHT[classes.find((k) => k.id === s.classId)?.code] ?? 145;
      const groups = ['A+', 'B+', 'O+', 'AB+', 'O+', 'B+', 'A-', 'O-'];
      await api(ADMIN, 'PUT', `/exams/${exam[key].id}/health`, {
        classSectionId: s.id,
        recordedOn: '2026-09-25',
        rows: ids.map((id) => {
          const h = Math.round((base + (rand(`h:${id}`) - 0.5) * 18) * 10) / 10;
          return {
            studentId: id,
            heightCm: h,
            weightKg: Math.round((h - 100) * (0.75 + rand(`w:${id}`) * 0.3) * 10) / 10,
            bloodGroup: groups[Math.floor(rand(`bg:${id}`) * groups.length)],
          };
        }),
      });
    }
  }
  const besides = areas.filter((a) => a !== 'marks');
  log(`${exam[key].code}: ${besides.length ? `${besides.join(', ')} filled` : 'marks only'}`);
}

// ---- 5. the stage of mid-October -----------------------------------------------------------------
for (const x of entered) {
  if (!x.complete) continue;
  if (notSubmitted(x.key, x.s, x.code)) continue; // entered, not submitted
  const body = { classSectionId: x.s.id, subjectId: x.subjectId };
  await api(OFFICE, 'POST', `/exams/${exam[x.key].id}/entry-status/submit`, body);
  if (x.key !== 'TERM')
    await api(ADMIN, 'POST', `/exams/${exam[x.key].id}/entry-status/verify`, body);
}
for (const key of ['PT1', 'PT2', 'ACT1', 'ACT2'])
  await api(ADMIN, 'POST', `/exams/${exam[key].id}/results/compute`);
log(
  `PT1, PT2, ACT1, ACT2 verified and worked out; Term I submitted (${C2}-B SCI and SST in progress, ${C1}-A CS not submitted)`,
);

// ---- 6. the Term I result ------------------------------------------------------------------------
const scheme = await api(ADMIN, 'POST', '/exams/schemes', {
  name: SCHEME,
  purpose: 'result',
  termCode: 'T1',
  // in the exam's class order
  classIds: exam.PT1.classes.map((k) => k.classId).filter((id) => schemeClassIds.has(id)),
  preset: 'DPS_VI_VIII',
  examMap: {
    MT1: exam.PT1.id,
    MT2: exam.PT2.id,
    SE1: exam.ACT1.id,
    SE2: exam.ACT2.id,
    TERM: exam.TERM.id,
  },
});
await api(ADMIN, 'POST', `/exams/schemes/${scheme.id}/lock`);
const done = await api(ADMIN, 'POST', `/exams/schemes/${scheme.id}/compute`);
log(`${SCHEME}: locked and worked out`, JSON.stringify(done).slice(0, 160));

// ---- nothing sent ---------------------------------------------------------------------------------
const queued = (
  await db.query(
    `SELECT count(*)::int AS n FROM comms_messages WHERE school_id = $1 AND id > $2 AND status = 'queued'`,
    [SCHOOL, before],
  )
).rows[0].n;
log(
  queued
    ? `WARNING: ${String(queued)} messages were queued; cancel them before starting the workers`
    : 'No message queued.',
);
await db.end();
log(`Done in ${String(calls)} calls.`);
