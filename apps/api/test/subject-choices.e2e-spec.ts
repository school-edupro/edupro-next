/**
 * Subject choices and the class's subject order (docs/design/67): a class's subjects put in order, each
 * compulsory, one of a choice group or a free elective, and its streams; a student's list is the
 * compulsory subjects, the stream's and those picked (a group takes at most its number); the office or
 * the section's class teacher sets them, another teacher not; a subject with marks is not taken off;
 * the set-up changes the students' kinds; the register and the card print the class's order, leave out
 * what a student does not take and print additional subjects last; counts, Excel and last year's choices.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { loadReportCardData } from '@edupro/db';
import ExcelJS from 'exceljs';
import {
  createApp,
  headersFor,
  injector,
  seedSchool,
  seedUser,
  stamp,
  withMigrator,
  type SeededSchool,
  type SeededUser,
} from './helpers';

interface Setup {
  placed: boolean;
  fromExams: boolean;
  subjects: Array<{ id: string; code: string; take: string; groupId: string | null }>;
  groups: Array<{ id: string; name: string; kind: string; min: number; max: number }>;
  streams: Array<{ name: string; subjectIds: string[] }>;
}
interface Choices extends Setup {
  canEdit: boolean;
  rows: Array<{
    studentId: string;
    name: string;
    stream: string | null;
    subjects: Array<{ subjectId: string; kind: string }>;
    marked: string[];
    changes: Array<{ id: string; fromExam: string; reason: string }>;
  }>;
}

describe('subject choices and order (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  /** the ready-made exam office: sets choices anywhere, enters marks */
  let office: SeededUser;
  /** the class teacher of XI-A */
  let teacher: SeededUser;
  /** a class teacher of no section here */
  let other: SeededUser;
  let classId: string;
  let section: string;
  let examId: string;
  const s = stamp('SC');
  const subject: Record<string, string> = {};
  const student: Record<string, string> = {};
  const call = (u: SeededUser, method: 'GET' | 'POST' | 'PUT', url: string, json?: unknown) =>
    inject({
      method,
      url,
      headers: headersFor(u.sub, school.id),
      ...(json === undefined ? {} : { json }),
    });
  const choices = async () =>
    (
      await call(admin, 'GET', `/exams/subject-choices?classSectionId=${section}`)
    ).json() as Choices;
  const codes = (ids: string[]) =>
    ids.map((id) => Object.keys(subject).find((k) => subject[k] === id)).sort();
  const of = (c: Choices, name: string) => {
    const r = c.rows.find((x) => x.name.startsWith(name))!;
    return {
      ...r,
      codes: codes(r.subjects.map((x) => x.subjectId)),
      kind: (code: string) => r.subjects.find((x) => x.subjectId === subject[code])?.kind,
    };
  };
  const put = (u: SeededUser, rows: unknown[]) =>
    call(u, 'PUT', '/exams/subject-choices', { classSectionId: section, rows });
  const pick = (...list: string[]) => list.map((k) => ({ subjectId: subject[k]! }));
  /** ENG; Second language (HIN, SKT, FRE); MAT; PHY; CHE; BIO; PE; Additional (MUS) */
  const setup = (over: { pe?: string; musKind?: string } = {}) => ({
    classId,
    groups: [
      { key: 'L2', name: 'Second language', kind: 'optional', min: 1, max: 1 },
      { key: 'ADD', name: 'Additional', kind: over.musKind ?? 'additional', min: 0, max: 1 },
    ],
    subjects: [
      { subjectId: subject.ENG, take: 'all' },
      ...['HIN', 'SKT', 'FRE'].map((k) => ({ subjectId: subject[k], take: 'group', group: 'L2' })),
      ...['MAT', 'PHY', 'CHE', 'BIO'].map((k) => ({ subjectId: subject[k], take: 'free' })),
      { subjectId: subject.PE, take: over.pe ?? 'free' },
      { subjectId: subject.MUS, take: 'group', group: 'ADD' },
    ],
    streams: [
      { name: 'Science-PCM', subjectIds: [subject.PHY, subject.CHE, subject.MAT] },
      { name: 'Science-PCB', subjectIds: [subject.PHY, subject.CHE, subject.BIO] },
    ],
  });

  beforeAll(async () => {
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      office = await seedUser(c, school, `${s}-exams`, 'exam_office');
      teacher = await seedUser(c, school, `${s}-ct`, 'class_teacher');
      other = await seedUser(c, school, `${s}-ot`, 'class_teacher');
    });
    app = await createApp();
    inject = injector(app);
    classId = (
      await call(admin, 'POST', '/academics/classes', {
        code: 'XI',
        name: 'Class XI',
        displayOrder: 11,
      })
    ).json().id;
    section = (
      await call(admin, 'POST', `/academics/classes/${classId}/sections`, { name: 'A' })
    ).json().id;
    // the subject master's order: MAT first, so the class's order shows
    for (const [i, [code, name]] of [
      ['MAT', 'Mathematics'],
      ['ENG', 'English'],
      ['HIN', 'Hindi'],
      ['SKT', 'Sanskrit'],
      ['FRE', 'French'],
      ['PHY', 'Physics'],
      ['CHE', 'Chemistry'],
      ['BIO', 'Biology'],
      ['PE', 'Physical Education'],
      ['MUS', 'Music'],
    ].entries()) {
      const r = await call(admin, 'POST', '/academics/subjects', {
        code,
        name,
        kind: 'scholastic',
        displayOrder: i + 1,
      });
      expect(r.statusCode).toBe(201);
      subject[code!] = r.json().id;
    }
    const cs = await call(admin, 'PUT', `/academics/classes/${classId}/subjects`, {
      subjects: Object.values(subject).map((id) => ({ subjectId: id, isElective: false })),
    });
    expect(cs.statusCode).toBe(200);
    for (const [i, first] of ['Anu', 'Bela', 'Chirag', 'Devi'].entries()) {
      const r = await call(admin, 'POST', '/people/students', {
        admissionNo: `${s}-${String(i + 1)}`,
        firstName: first,
        lastName: 'Choice',
        guardians: [],
        enrolment: { classSectionId: section, rollNo: i + 1 },
      });
      expect(r.statusCode).toBe(201);
      student[first] = r.json().id;
    }
    await withMigrator(async (c) => {
      for (const [u, code, mine] of [
        [teacher, 'T1', true],
        [other, 'T2', false],
      ] as const) {
        const e = await c.query<{ id: string }>(
          `INSERT INTO employees (school_id, employee_code, first_name, last_name, user_id) VALUES ($1, $2, 'Tara', $2, $3) RETURNING id::text`,
          [school.id, code, u.id],
        );
        if (mine)
          await c.query(
            `INSERT INTO teacher_assignments (school_id, academic_year_id, employee_id, class_section_id, kind)
             VALUES ($1, $2, $3, $4, 'class_teacher')`,
            [school.id, school.yearId, e.rows[0]!.id, section],
          );
      }
    });
  });
  afterAll(async () => {
    await app?.close();
  });

  it("starts in the subject master's order; the set-up puts the class's subjects in order with groups and streams", async () => {
    const before = (
      await call(admin, 'GET', `/exams/subject-choices/setup?classId=${classId}`)
    ).json() as Setup;
    expect(before).toMatchObject({ placed: false, fromExams: false, groups: [], streams: [] });
    expect(before.subjects.map((x) => x.code).slice(0, 3)).toEqual(['MAT', 'ENG', 'HIN']);
    const url = '/exams/subject-choices/setup';
    // every subject placed; a group no bigger than its subjects; a group subject needs its group
    const short = setup();
    short.subjects = short.subjects.slice(1);
    expect((await call(admin, 'PUT', url, short)).statusCode).toBe(400);
    const big = setup();
    big.groups[0]!.max = 4;
    expect((await call(admin, 'PUT', url, big)).json()).toMatchObject({ type: 'exams.group_pick' });
    const lone = setup();
    lone.subjects[1] = { subjectId: subject.HIN, take: 'group', group: 'NONE' };
    expect((await call(admin, 'PUT', url, lone)).statusCode).toBe(400);
    // the office sets choices but not the set-up
    expect((await call(office, 'PUT', url, setup())).statusCode).toBe(403);
    const ok = await call(admin, 'PUT', url, setup());
    expect(ok.statusCode).toBe(200);
    const after = ok.json() as Setup;
    expect(after.placed).toBe(true);
    expect(after.subjects.map((x) => x.code)).toEqual([
      'ENG',
      'HIN',
      'SKT',
      'FRE',
      'MAT',
      'PHY',
      'CHE',
      'BIO',
      'PE',
      'MUS',
    ]);
    expect(after.groups.map((g) => [g.name, g.kind, g.min, g.max])).toEqual([
      ['Second language', 'optional', 1, 1],
      ['Additional', 'additional', 0, 1],
    ]);
    expect(after.streams.map((x) => [x.name, codes(x.subjectIds)])).toEqual([
      ['Science-PCM', ['CHE', 'MAT', 'PHY']],
      ['Science-PCB', ['BIO', 'CHE', 'PHY']],
    ]);
  });

  it('a pick brings the compulsory subjects and the stream’s; a group takes at most its number; the class teacher sets their section, another teacher not', async () => {
    const anu = await put(office, [
      { studentId: student.Anu, stream: 'science-pcm', subjects: pick('HIN', 'MUS') },
    ]);
    expect(anu.statusCode).toBe(200);
    let c = await choices();
    expect(of(c, 'Anu').codes).toEqual(['CHE', 'ENG', 'HIN', 'MAT', 'MUS', 'PHY']);
    expect(of(c, 'Anu').stream).toBe('Science-PCM');
    expect(of(c, 'Anu').kind('ENG')).toBe('compulsory');
    expect(of(c, 'Anu').kind('HIN')).toBe('optional');
    expect(of(c, 'Anu').kind('MUS')).toBe('additional');
    // two second languages; a stream the class does not have
    const two = await put(office, [{ studentId: student.Bela, subjects: pick('HIN', 'SKT') }]);
    expect(two.json()).toMatchObject({ type: 'exams.choice_refused' });
    expect(two.json().detail).toContain('Second language: pick at most 1');
    const arts = await put(office, [{ studentId: student.Bela, stream: 'Arts', subjects: [] }]);
    expect(arts.json().detail).toContain('Arts is not a stream of the class');
    // the class teacher of XI-A sets Bela's; another class teacher may not
    const bela = await put(teacher, [
      { studentId: student.Bela, stream: 'Science-PCB', subjects: pick('FRE') },
    ]);
    expect(bela.statusCode).toBe(200);
    expect((await put(other, [{ studentId: student.Bela, subjects: [] }])).statusCode).toBe(403);
    const mine = (await call(teacher, 'GET', '/exams/subject-choices/sections')).json().data;
    expect(mine.find((x: { id: string }) => x.id === section)).toMatchObject({ canEdit: true });
    expect(
      (await call(other, 'GET', `/exams/subject-choices?classSectionId=${section}`)).json(),
    ).toMatchObject({ canEdit: false });
    c = await choices();
    expect(of(c, 'Bela').codes).toEqual(['BIO', 'CHE', 'ENG', 'FRE', 'PHY']);
    expect(c.rows.filter((r) => r.subjects.length)).toHaveLength(2);
  });

  it("the register and the card print the class's order, leave out what a student does not take, additional last; marks keep a subject", async () => {
    const type = await call(admin, 'POST', '/exams/types', { code: 'UT1', name: 'Unit Test 1' });
    const exam = await call(admin, 'POST', '/exams', {
      examTypeId: type.json().id,
      code: 'UT1-SC',
      name: 'Unit Test 1',
      classes: [{ classId }],
    });
    expect(exam.statusCode).toBe(201);
    examId = exam.json().id;
    const subs = await call(admin, 'PUT', `/exams/${examId}/subjects`, {
      classId,
      subjects: Object.values(subject).map((id) => ({
        subjectId: id,
        maxMarks: 50,
        passMarks: 17,
      })),
    });
    expect(subs.statusCode).toBe(200);
    for (const k of ['ENG', 'HIN', 'MAT', 'MUS'])
      expect(
        (
          await call(office, 'PUT', `/exams/${examId}/marks`, {
            classSectionId: section,
            subjectId: subject[k],
            rows: [{ studentId: student.Anu, marks: 40 }],
          })
        ).statusCode,
      ).toBe(200);
    const sheet = (
      await call(admin, 'GET', `/exams/${examId}/register-sheet?classSectionId=${section}`)
    ).json();
    expect(sheet.subjects.map((x: { code: string }) => x.code)).toEqual([
      'ENG',
      'HIN',
      'SKT',
      'FRE',
      'MAT',
      'PHY',
      'CHE',
      'BIO',
      'PE',
      'MUS',
    ]);
    const byCode = (code: string) =>
      sheet.subjects.find((x: { code: string; id: string }) => x.code === code).id as string;
    const anuRow = sheet.rows.find((r: { studentId: string }) => r.studentId === student.Anu);
    expect(anuRow.notTaken.sort()).toEqual(['BIO', 'FRE', 'PE', 'SKT'].map(byCode).sort());
    expect(anuRow.additional).toEqual([byCode('MUS')]);
    const pdf = await call(
      admin,
      'GET',
      `/exams/${examId}/register-sheet?classSectionId=${section}&format=pdf`,
    );
    expect(pdf.json().contentType).toBe('application/pdf');
    // Anu's card: her subjects only, Music (additional) last
    const card = await withMigrator(async (c) => {
      await c.query(
        `SELECT set_config('app.school_id', $1, false), set_config('app.academic_year_id', $2, false)`,
        [school.id, school.yearId],
      );
      return loadReportCardData(c as never, {
        studentId: student.Anu!,
        examIds: [examId],
        termCode: 'T1',
        termName: 'Term 1',
        defaulterMin: 75,
      });
    });
    expect(card.subjects.map((x) => x.code)).toEqual(['ENG', 'HIN', 'MAT', 'PHY', 'CHE', 'MUS']);
    expect(card.subjects.at(-1)).toMatchObject({ code: 'MUS', kind: 'additional' });
    // Hindi has marks: it is not taken off Anu (Sanskrit in its place is refused)
    const swap = await put(office, [
      { studentId: student.Anu, stream: 'Science-PCM', subjects: pick('SKT', 'MUS') },
    ]);
    expect(swap.statusCode).toBe(409);
    expect(swap.json().detail).toContain('Has marks in HIN');
    expect(of(await choices(), 'Anu').marked.length).toBe(4);
    // marked NA (not applicable), Music may go; then it comes back
    const na = await call(office, 'PUT', `/exams/${examId}/marks`, {
      classSectionId: section,
      subjectId: subject.MUS,
      rows: [{ studentId: student.Anu, marks: null, code: 'NA' }],
    });
    expect(na.statusCode).toBe(200);
    for (const list of [pick('HIN'), pick('HIN', 'MUS')])
      expect(
        (await put(office, [{ studentId: student.Anu, stream: 'Science-PCM', subjects: list }]))
          .statusCode,
      ).toBe(200);
  });

  it('changing the set-up gives students the new compulsory subject and sets the kinds again', async () => {
    const r = await call(
      admin,
      'PUT',
      '/exams/subject-choices/setup',
      setup({ pe: 'all', musKind: 'optional' }),
    );
    expect(r.statusCode).toBe(200);
    // Anu and Bela have choices: Physical Education added; Music now counts in the total
    expect(r.json()).toMatchObject({ added: 2, rekinded: 1 });
    const c = await choices();
    expect(of(c, 'Anu').kind('PE')).toBe('compulsory');
    expect(of(c, 'Bela').kind('PE')).toBe('compulsory');
    expect(of(c, 'Anu').kind('MUS')).toBe('optional');
    expect(of(c, 'Chirag').subjects).toHaveLength(0);
    await call(admin, 'PUT', '/exams/subject-choices/setup', setup({ pe: 'all' }));
  });

  it("counts each subject by section; the Excel sheet by group round-trips; last year's choices come over", async () => {
    // Chirag and Devi have no choices: they take every subject
    const n = (await call(admin, 'GET', `/exams/subject-choices/counts?classId=${classId}`)).json();
    expect(n.sections[0]).toMatchObject({ students: 4, notSet: 2 });
    expect(n.total.counts[subject.ENG!]).toBe(4);
    expect(n.total.counts[subject.HIN!]).toBe(3);
    expect(n.total.counts[subject.BIO!]).toBe(3);
    const file = await call(
      admin,
      'GET',
      `/exams/subject-choices/counts/file?classId=${classId}&format=xlsx`,
    );
    expect(file.statusCode).toBe(200);
    // the legacy "Student Subject Mapping Report": letterhead, then each section's S.No / Subject / count
    const rep = new ExcelJS.Workbook();
    await rep.xlsx.load(
      Buffer.from(file.json().base64 as string, 'base64') as unknown as ArrayBuffer,
    );
    const rs = rep.worksheets[0]!;
    expect(String(rs.getRow(2).getCell(2).value)).toBe('Student Subject Mapping Report | Class-XI');
    expect(String(rs.getRow(5).getCell(1).value)).toBe('Section: XI-A');
    expect(Array.from(rs.getRow(6).values as unknown[]).slice(1)).toEqual([
      'S.No',
      'Subject',
      'Student Count',
    ]);
    // Anu and Bela have saved subjects: English 2; Chirag and Devi are not set yet
    expect(Array.from(rs.getRow(7).values as unknown[]).slice(1)).toEqual([1, 'ENGLISH', 2]);

    const dl = (
      await call(admin, 'GET', `/exams/subject-choices/excel?classSectionId=${section}`)
    ).json();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(dl.base64 as string, 'base64') as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]!;
    const heads = Array.from(ws.getRow(1).values as unknown[], (v) =>
      String(v ?? '').replace(/\s*\*$/, ''),
    );
    expect(heads.filter(Boolean)).toEqual([
      'Admission no',
      'Name',
      'Stream',
      'Second language',
      'Additional',
      'Other subjects',
      'Additional (out of total)',
    ]);
    const col = (h: string) => heads.indexOf(h);
    // Anu's row as saved
    expect(String(ws.getRow(2).getCell(col('Second language')).value)).toBe('HIN');
    expect(String(ws.getRow(2).getCell(col('Stream')).value)).toBe('Science-PCM');
    // Chirag: PCB with Sanskrit; Devi left out of the sheet (keeps no choices)
    const ch = ws.getRow(4);
    ch.getCell(col('Stream')).value = 'Science-PCB';
    ch.getCell(col('Second language')).value = 'skt';
    ws.spliceRows(5, 1);
    const bad = new ExcelJS.Workbook();
    await bad.xlsx.load((await wb.xlsx.writeBuffer()) as ArrayBuffer);
    bad.worksheets[0]!.getRow(4).getCell(col('Second language')).value = 'XYZ';
    const upload = async (book: ExcelJS.Workbook, apply: boolean) =>
      (
        await call(admin, 'POST', '/exams/subject-choices/upload', {
          classSectionId: section,
          file: Buffer.from(await book.xlsx.writeBuffer()).toString('base64'),
          apply,
        })
      ).json();
    const wrong = await upload(bad, true);
    expect(wrong).toMatchObject({ errors: 1, applied: false });
    expect(wrong.rows[2].error).toContain('XYZ is not one of HIN, SKT, FRE');
    expect(await upload(wb, true)).toMatchObject({ errors: 0, applied: true });
    let c = await choices();
    expect(of(c, 'Chirag').codes).toEqual(['BIO', 'CHE', 'ENG', 'PE', 'PHY', 'SKT']);
    expect(of(c, 'Anu').codes).toEqual(['CHE', 'ENG', 'HIN', 'MAT', 'MUS', 'PE', 'PHY']);
    expect(of(c, 'Devi').subjects).toHaveLength(0);

    // last year Devi took Hindi with Science-PCM
    await withMigrator(async (m) => {
      const y = await m.query<{ id: string }>(
        `INSERT INTO academic_years (school_id, code, name, start_date, end_date, status)
         VALUES ($1, '2025-26', 'Session 2025-26', '2025-04-01', '2026-03-31', 'closed') RETURNING id::text`,
        [school.id],
      );
      for (const k of ['HIN', 'PHY', 'CHE', 'MAT'])
        await m.query(
          `INSERT INTO student_subjects (school_id, academic_year_id, student_id, subject_id, kind, stream)
           VALUES ($1, $2, $3, $4, 'optional', 'Science-PCM')`,
          [school.id, y.rows[0]!.id, student.Devi, subject[k]],
        );
    });
    const last = await call(teacher, 'POST', '/exams/subject-choices/last-year', {
      classSectionId: section,
    });
    expect(last.json()).toMatchObject({ copied: 1, skipped: 0 });
    c = await choices();
    expect(of(c, 'Devi').codes).toEqual(['CHE', 'ENG', 'HIN', 'MAT', 'PE', 'PHY']);
    expect(of(c, 'Devi').stream).toBe('Science-PCM');
  });

  it('a student’s own additional subject (the old “Opt”) stays through the set-up and the sheet', async () => {
    // Biology (from the stream) kept out of Chirag’s total
    const r = await put(office, [
      {
        studentId: student.Chirag,
        stream: 'Science-PCB',
        subjects: [...pick('SKT'), { subjectId: subject.BIO!, additional: true }],
      },
    ]);
    expect(r.statusCode).toBe(200);
    expect(of(await choices(), 'Chirag').kind('BIO')).toBe('additional');
    // the set-up sets kinds again: the student's tick stays
    expect(
      (await call(admin, 'PUT', '/exams/subject-choices/setup', setup({ pe: 'all' }))).statusCode,
    ).toBe(200);
    const after = of(await choices(), 'Chirag');
    expect(after.kind('BIO')).toBe('additional');
    expect(after.subjects.find((x) => x.subjectId === subject.BIO)).toMatchObject({
      additional: true,
    });
    // the sheet: its column, and a compulsory subject refused there
    const dl = (
      await call(admin, 'GET', `/exams/subject-choices/excel?classSectionId=${section}`)
    ).json();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(dl.base64 as string, 'base64') as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]!;
    const heads = Array.from(ws.getRow(1).values as unknown[], (v) =>
      String(v ?? '').replace(/\s*\*$/, ''),
    );
    const col = heads.indexOf('Additional (out of total)');
    expect(col).toBeGreaterThan(0);
    expect(String(ws.getRow(4).getCell(col).value)).toBe('BIO');
    ws.getRow(3).getCell(col).value = 'ENG';
    const bad = (
      await call(admin, 'POST', '/exams/subject-choices/upload', {
        classSectionId: section,
        file: Buffer.from(await wb.xlsx.writeBuffer()).toString('base64'),
        apply: false,
      })
    ).json();
    expect(bad.rows[1].error).toContain('ENG is not one of the student’s own');
    ws.getRow(3).getCell(col).value = 'PHY';
    const ok = (
      await call(admin, 'POST', '/exams/subject-choices/upload', {
        classSectionId: section,
        file: Buffer.from(await wb.xlsx.writeBuffer()).toString('base64'),
        apply: true,
      })
    ).json();
    expect(ok).toMatchObject({ errors: 0, applied: true });
    const c = await choices();
    expect(of(c, 'Bela').kind('PHY')).toBe('additional');
    expect(of(c, 'Chirag').kind('BIO')).toBe('additional');
  });

  it('the whole class at once: every section set, a student with marks left out; lists, find and history; subject teachers see', async () => {
    const b = (
      await call(admin, 'POST', `/academics/classes/${classId}/sections`, { name: 'B' })
    ).json().id as string;
    const esha = await call(admin, 'POST', '/people/students', {
      admissionNo: `${s}-9`,
      firstName: 'Esha',
      lastName: 'Choice',
      guardians: [],
      enrolment: { classSectionId: b, rollNo: 1 },
    });
    expect(esha.statusCode).toBe(201);
    const groups = (await choices()).groups;
    const l2 = groups.find((g) => g.name === 'Second language')!.id;
    // a class teacher sets only their section: the whole class is the office's
    expect(
      (
        await call(other, 'POST', '/exams/subject-choices/bulk', {
          classId,
          set: `group:${l2}:${subject.FRE}`,
          scope: 'all',
        })
      ).statusCode,
    ).toBe(403);
    const bulk = await call(office, 'POST', '/exams/subject-choices/bulk', {
      classId,
      set: `group:${l2}:${subject.FRE}`,
      scope: 'all',
    });
    expect(bulk.statusCode).toBe(201);
    // Anu has marks in Hindi: left as she is; Bela has French already; Chirag, Devi and Esha changed
    expect(bulk.json().changed).toBe(3);
    expect(bulk.json().skipped).toEqual([
      expect.objectContaining({ name: 'Anu Choice', section: 'XI-A' }),
    ]);
    const c = await choices();
    expect(of(c, 'Chirag').codes).toContain('FRE');
    expect(of(c, 'Chirag').codes).not.toContain('SKT');
    expect(of(c, 'Anu').codes).toContain('HIN');
    const eshaRow = (await call(admin, 'GET', `/exams/subject-choices?classSectionId=${b}`)).json()
      .rows[0];
    expect(codes(eshaRow.subjects.map((x: { subjectId: string }) => x.subjectId))).toEqual([
      'ENG',
      'FRE',
      'PE',
    ]);
    // the summary: two sections, nobody short of the second language
    const n = (await call(admin, 'GET', `/exams/subject-choices/counts?classId=${classId}`)).json();
    expect(n.sections.map((x: { code: string }) => x.code)).toEqual(['XI-A', 'XI-B']);
    expect(n.total).toMatchObject({ students: 5, missing: 0 });
    expect(n.total.counts[subject.FRE!]).toBe(4);
    // every student of the class, and one section upright
    for (const q of [
      `classId=${classId}&format=xlsx`,
      `classSectionId=${section}&format=pdf&portrait=true`,
    ]) {
      const f = await call(admin, 'GET', `/exams/subject-choices/list-file?${q}`);
      expect(f.statusCode).toBe(200);
    }
    // the legacy "Define Student Subject Mapping" layout: letterhead, then Subject-1 / Option(Y/N)
    const listed = (
      await call(
        admin,
        'GET',
        `/exams/subject-choices/list-file?classSectionId=${section}&format=xlsx`,
      )
    ).json();
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(Buffer.from(listed.base64 as string, 'base64') as unknown as ArrayBuffer);
    const sheet = book.worksheets[0]!;
    expect(String(sheet.getRow(2).getCell(1).value)).toBe('Define Student Subject Mapping');
    expect(String(sheet.getRow(3).getCell(1).value)).toBe('Classes: XI-A');
    const heading = Array.from(sheet.getRow(7).values as unknown[], (v) => String(v ?? '')).filter(
      Boolean,
    );
    expect(heading.slice(0, 6)).toEqual([
      'ADMISSION_NUMBER',
      'CLASS_NAME',
      'STUDENT_NAME',
      'STREAM',
      'SUBJECT-1',
      'OPTION(Y/N)',
    ]);
    expect(String(sheet.getRow(8).getCell(5).value)).toBe('ENGLISH');
    // a student by admission no; the history of Chirag's subjects
    const found = (
      await call(admin, 'GET', `/exams/subject-choices/find?q=${encodeURIComponent(`${s}-3`)}`)
    ).json().data;
    expect(found[0]).toMatchObject({ name: 'Chirag Choice', sectionId: section });
    const h = (
      await call(admin, 'GET', `/exams/subject-choices/history?studentId=${student.Chirag}`)
    ).json();
    const lines = h.data as Array<{ subject: string; what: string; by: string | null }>;
    expect(
      lines.find((x) => x.subject === 'Sanskrit (SKT)' && x.what === 'Taken off'),
    ).toBeTruthy();
    expect(
      lines.find((x) => x.subject === 'French (FRE)' && x.what.startsWith('Added')),
    ).toBeTruthy();
    // the teacher app: the class teacher's section is theirs; a teacher of none has none
    const mine = (await call(teacher, 'GET', '/exams/subject-choices/sections')).json().data;
    expect(mine.find((x: { id: string }) => x.id === section)).toMatchObject({
      mine: true,
      canEdit: true,
    });
    const none = (await call(other, 'GET', '/exams/subject-choices/sections')).json().data;
    expect(none.some((x: { mine: boolean }) => x.mine)).toBe(false);
  });

  it('Social Science entered in parts once for the class: an exam splits it; the register shows each student’s own subjects as Subject-1, Subject-2, … with the parts', async () => {
    const sst = (
      await call(admin, 'POST', '/academics/subjects', {
        code: 'SST',
        name: 'Social Science',
        kind: 'scholastic',
        displayOrder: 20,
      })
    ).json().id as string;
    subject.SST = sst;
    for (const [code, name] of [
      ['GEO', 'Geography'],
      ['HIS', 'History'],
      ['POL', 'Political Science'],
    ]) {
      const r = await call(admin, 'POST', '/academics/subjects', {
        code,
        name,
        kind: 'scholastic',
        parentId: sst,
      });
      expect(r.statusCode).toBe(201);
      subject[code!] = r.json().id;
    }
    await withMigrator((c) =>
      c.query(
        `INSERT INTO class_subjects (school_id, academic_year_id, class_id, subject_id) VALUES ($1, $2, $3, $4)`,
        [school.id, school.yearId, classId, sst],
      ),
    );
    // Social Science fourth, for everyone, in three parts (a part must be a sub-subject)
    const plan = setup({ pe: 'all' }) as ReturnType<typeof setup> & {
      subjects: Array<Record<string, unknown>>;
    };
    plan.subjects.splice(5, 0, {
      subjectId: sst,
      take: 'all',
      parts: [
        { subjectId: subject.GEO, share: 1 },
        { subjectId: subject.HIS, share: 1 },
        { subjectId: subject.POL, share: 1 },
      ],
    });
    const wrong = structuredClone(plan);
    (wrong.subjects[5] as unknown as { parts: unknown[] }).parts = [
      { subjectId: subject.ENG, share: 1 },
    ];
    expect((await call(admin, 'PUT', '/exams/subject-choices/setup', wrong)).statusCode).toBe(400);
    const saved = await call(admin, 'PUT', '/exams/subject-choices/setup', plan);
    expect(saved.statusCode).toBe(200);
    expect(
      (saved.json().subjects as Array<{ code: string; parts: Array<{ code: string }> }>)
        .find((x) => x.code === 'SST')!
        .parts.map((p) => p.code),
    ).toEqual(['GEO', 'HIS', 'POL']);
    // a new exam: Social Science out of 80 comes in parts 26 + 26 + 28
    const type = (await call(admin, 'GET', '/exams/types')).json().data[0].id as string;
    const exam = await call(admin, 'POST', '/exams', {
      examTypeId: type,
      code: 'HY-SC',
      name: 'Half yearly',
      classes: [{ classId }],
    });
    const hy = exam.json().id as string;
    const subs = await call(admin, 'PUT', `/exams/${hy}/subjects`, {
      classId,
      subjects: Object.entries(subject)
        .filter(([k]) => !['GEO', 'HIS', 'POL'].includes(k))
        .map(([k, id]) => ({ subjectId: id, maxMarks: k === 'SST' ? 80 : 50, passMarks: 17 })),
    });
    expect(subs.statusCode).toBe(200);
    const es = (
      subs.json().subjects as Array<{
        id: string;
        subjectCode: string;
        maxMarks: string;
        parts?: Array<{ id: string; name: string; maxMarks: string }>;
      }>
    ).find((x) => x.subjectCode === 'SST')!;
    expect(es.maxMarks).toBe('80.00');
    expect(es.parts!.map((p) => [p.name, Number(p.maxMarks)])).toEqual([
      ['Geography', 26],
      ['History', 26],
      ['Political Science', 28],
    ]);
    for (const [i, p] of es.parts!.entries())
      expect(
        (
          await call(office, 'PUT', `/exams/${hy}/part-marks`, {
            classSectionId: section,
            partId: p.id,
            rows: [{ studentId: student.Anu, marks: 20 + i }],
          })
        ).statusCode,
      ).toBe(200);
    expect(
      (
        await call(office, 'PUT', `/exams/${hy}/marks`, {
          classSectionId: section,
          subjectId: subject.ENG,
          rows: [{ studentId: student.Anu, marks: 44 }],
        })
      ).statusCode,
    ).toBe(200);
    const sheet = (
      await call(admin, 'GET', `/exams/${hy}/register-sheet?classSectionId=${section}`)
    ).json();
    const code = (id: string) =>
      sheet.subjects.find((x: { id: string; code: string }) => x.id === id).code as string;
    const anu = sheet.rows.find((r: { studentId: string }) => r.studentId === student.Anu);
    // her own subjects only, in the class's order, Music (additional) last; no Sanskrit, French or Biology
    expect(anu.slots.map(code)).toEqual(['ENG', 'HIN', 'MAT', 'SST', 'PHY', 'CHE', 'PE', 'MUS']);
    const sstRow = sheet.subjects.find((x: { code: string }) => x.code === 'SST');
    expect(sstRow.parts.map((p: { code: string }) => p.code)).toEqual(['GEO', 'HIS', 'POL']);
    expect(Object.values(anu.parts).map((v) => Number((v as { marks: string }).marks))).toEqual(
      expect.arrayContaining([20, 21, 22]),
    );
    // the files: Subject-1 … with the subject, its marks and its parts
    const file = await call(
      admin,
      'GET',
      `/exams/${hy}/register-sheet?classSectionId=${section}&format=xlsx`,
    );
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(
      Buffer.from(file.json().base64 as string, 'base64') as unknown as ArrayBuffer,
    );
    const ws = wb.worksheets[0]!;
    const groups = Array.from(ws.getRow(3).values as unknown[], (v) => String(v ?? ''));
    const heads = Array.from(ws.getRow(4).values as unknown[], (v) => String(v ?? ''));
    expect(groups).toContain('Subject-1');
    expect(heads.slice(4, 6)).toEqual(['Subject', 'Marks']);
    const line = Array.from(ws.getRow(5).values as unknown[], (v) => String(v ?? ''));
    expect(line).toContain('GEO 20, HIS 21, POL 22');
    expect(
      (await call(admin, 'GET', `/exams/${hy}/register-sheet?classSectionId=${section}&format=pdf`))
        .statusCode,
    ).toBe(200);
  });

  it('a slot template: two slots with the same languages take exactly two; fewer is missing, more refused', async () => {
    const k = (
      await call(admin, 'POST', '/academics/classes', {
        code: 'VIII',
        name: 'Class VIII',
        displayOrder: 8,
      })
    ).json().id as string;
    const sec = (
      await call(admin, 'POST', `/academics/classes/${k}/sections`, { name: 'A' })
    ).json().id as string;
    const kid = await call(admin, 'POST', '/people/students', {
      admissionNo: `${s}-81`,
      firstName: 'Ira',
      lastName: 'Slot',
      guardians: [],
      enrolment: { classSectionId: sec, rollNo: 1 },
    });
    const ira = kid.json().id as string;
    await call(admin, 'PUT', `/academics/classes/${k}/subjects`, {
      subjects: ['ENG', 'HIN', 'SKT', 'FRE', 'MAT'].map((c) => ({ subjectId: subject[c] })),
    });
    // Subject-1 English, Subject-2 and -3 two of Hindi / Sanskrit / French, Subject-4 Maths
    const langs = [subject.HIN, subject.SKT, subject.FRE].sort().join(',');
    const ok = await call(admin, 'PUT', '/exams/subject-choices/setup', {
      classId: k,
      groups: [{ key: langs, name: 'Languages', kind: 'optional', min: 2, max: 2 }],
      subjects: [
        { subjectId: subject.ENG, take: 'all', group: null, parts: [] },
        ...['HIN', 'SKT', 'FRE'].map((c) => ({
          subjectId: subject[c],
          take: 'group',
          group: langs,
          parts: [],
        })),
        { subjectId: subject.MAT, take: 'all', group: null, parts: [] },
      ],
      streams: [],
    });
    expect(ok.statusCode).toBe(200);
    const set = (ids: string[]) =>
      call(admin, 'PUT', '/exams/subject-choices', {
        classSectionId: sec,
        rows: [{ studentId: ira, subjects: ids.map((c) => ({ subjectId: subject[c]! })) }],
      });
    const missing = async () =>
      (await call(admin, 'GET', `/exams/subject-choices/counts?classId=${k}`)).json().total.missing;
    expect((await set(['HIN'])).statusCode).toBe(200);
    expect(await missing()).toBe(1);
    expect((await set(['HIN', 'FRE'])).statusCode).toBe(200);
    expect(await missing()).toBe(0);
    const three = await set(['HIN', 'FRE', 'SKT']);
    expect(three.statusCode).toBe(409);
    expect(three.json().detail).toContain('Languages: pick at most 2');

    // marks in Hindi and French while not set; then the slot takes one: the grid's save keeps the
    // others and says why this one is left
    const jai = (
      await call(admin, 'POST', '/people/students', {
        admissionNo: `${s}-82`,
        firstName: 'Jai',
        lastName: 'Slot',
        guardians: [],
        enrolment: { classSectionId: sec, rollNo: 2 },
      })
    ).json().id as string;
    expect((await set([])).statusCode).toBe(200);
    const type = (await call(admin, 'GET', '/exams/types')).json().data[0].id as string;
    const ex = (
      await call(admin, 'POST', '/exams', {
        examTypeId: type,
        code: 'PT-VIII',
        name: 'Periodic test',
        classes: [{ classId: k }],
      })
    ).json().id as string;
    await call(admin, 'PUT', `/exams/${ex}/subjects`, {
      classId: k,
      subjects: ['ENG', 'HIN', 'SKT', 'FRE', 'MAT'].map((c) => ({
        subjectId: subject[c],
        maxMarks: 20,
      })),
    });
    for (const c of ['HIN', 'FRE'])
      expect(
        (
          await call(office, 'PUT', `/exams/${ex}/marks`, {
            classSectionId: sec,
            subjectId: subject[c],
            rows: [{ studentId: ira, marks: 15 }],
          })
        ).statusCode,
      ).toBe(200);
    const one = await call(admin, 'PUT', '/exams/subject-choices/setup', {
      classId: k,
      groups: [{ key: langs, name: 'Languages', kind: 'optional', min: 1, max: 1 }],
      subjects: [
        { subjectId: subject.ENG, take: 'all', group: null, parts: [] },
        ...['HIN', 'SKT', 'FRE'].map((c) => ({
          subjectId: subject[c],
          take: 'group',
          group: langs,
          parts: [],
        })),
        { subjectId: subject.MAT, take: 'all', group: null, parts: [] },
      ],
      streams: [],
    });
    expect(one.statusCode).toBe(200);
    const grid = await call(admin, 'PUT', '/exams/subject-choices', {
      classSectionId: sec,
      partial: true,
      // as the grid sends it: a subject with marks stays in the list
      rows: [
        { studentId: ira, subjects: [{ subjectId: subject.HIN! }, { subjectId: subject.FRE! }] },
        { studentId: jai, subjects: [{ subjectId: subject.SKT! }] },
      ],
    });
    expect(grid.statusCode).toBe(200);
    expect(grid.json()).toMatchObject({ saved: 1 });
    expect(grid.json().refused).toEqual([
      expect.objectContaining({
        studentId: ira,
        error: expect.stringContaining('has marks this year in HIN and FRE, but Languages takes 1'),
      }),
    ]);
    // without `partial` (an upload, another caller) the whole lot is refused as before
    const strict = await call(admin, 'PUT', '/exams/subject-choices', {
      classSectionId: sec,
      rows: [{ studentId: ira, subjects: [{ subjectId: subject.HIN! }] }],
    });
    expect(strict.statusCode).toBe(409);
  });

  it('a subject changed mid-year: French until UT1, Sanskrit from the half-yearly; registers, entry and the term line follow', async () => {
    const exams = (await call(admin, 'GET', '/exams')).json().data as Array<{
      id: string;
      code: string;
    }>;
    const ut = exams.find((x) => x.code === 'UT1-SC')!.id;
    const hy = exams.find((x) => x.code === 'HY-SC')!.id;
    const mark = (exam: string, code: string, row: Record<string, unknown>) =>
      call(office, 'PUT', `/exams/${exam}/marks`, {
        classSectionId: section,
        subjectId: subject[code],
        rows: [{ studentId: student.Bela, ...row }],
      });
    expect((await mark(ut, 'FRE', { marks: 30 })).statusCode).toBe(200);
    expect((await mark(hy, 'FRE', { marks: 45 })).statusCode).toBe(200);
    const change = (u: SeededUser, body: Record<string, unknown>) =>
      call(u, 'POST', '/exams/subject-choices/change', {
        classSectionId: section,
        studentId: student.Bela,
        fromSubjectId: subject.FRE,
        toSubjectId: subject.SKT,
        fromExamId: hy,
        reason: 'Moved to Sanskrit',
        ...body,
      });
    // the office only; a subject everyone takes, or one of another slot, is not changed
    expect((await change(teacher, {})).statusCode).toBe(403);
    expect((await change(admin, { fromSubjectId: subject.ENG })).json().detail).toContain(
      'everyone takes ENG',
    );
    expect((await change(admin, { toSubjectId: subject.MAT })).json().detail).toContain(
      'not choices of the same slot',
    );
    // French has marks in the half-yearly: not from there, until they are NA
    const busy = await change(admin, {});
    expect(busy.statusCode).toBe(409);
    expect(busy.json().detail).toContain('FRE has marks in HY-SC');
    expect((await mark(hy, 'FRE', { marks: null, code: 'NA' })).statusCode).toBe(200);
    const done = await change(admin, {});
    expect(done.statusCode).toBe(201);
    const bela = of(await choices(), 'Bela');
    expect(bela.codes).toContain('SKT');
    expect(bela.codes).not.toContain('FRE');
    expect(bela.changes).toEqual([
      expect.objectContaining({ fromExam: 'HY-SC', reason: 'Moved to Sanskrit' }),
    ]);
    // the unit test keeps French; the half-yearly has Sanskrit
    const slots = async (exam: string) => {
      const sheet = (
        await call(admin, 'GET', `/exams/${exam}/register-sheet?classSectionId=${section}`)
      ).json();
      const row = sheet.rows.find((r: { studentId: string }) => r.studentId === student.Bela);
      return row.slots.map(
        (id: string) => sheet.subjects.find((x: { id: string }) => x.id === id).code as string,
      ) as string[];
    };
    expect(await slots(ut)).toContain('FRE');
    expect(await slots(ut)).not.toContain('SKT');
    expect(await slots(hy)).toContain('SKT');
    expect(await slots(hy)).not.toContain('FRE');
    // the half-yearly's French sheet no longer takes her; Sanskrit does
    expect((await mark(hy, 'FRE', { marks: 40 })).statusCode).not.toBe(200);
    expect((await mark(hy, 'SKT', { marks: 44 })).statusCode).toBe(200);
    // a term line: Sanskrit carries the unit test's French marks
    const scheme = await call(admin, 'POST', '/exams/schemes', {
      name: 'Language carry',
      purpose: 'register',
      classIds: [classId],
      def: {
        exams: [
          { key: 'UT', examId: ut },
          { key: 'HY', examId: hy },
        ],
        columns: [
          { key: 'ut', label: 'UT', kind: 'raw', exam: 'UT' },
          { key: 'hy', label: 'HY', kind: 'raw', exam: 'HY' },
          { key: 'tot', label: 'Total', kind: 'sum', of: ['ut', 'hy'], total: true },
        ],
        result: { passPct: 33, compartmentUpTo: 2, rankBy: 'total' },
      },
    });
    expect(scheme.statusCode).toBe(201);
    const reg = (
      await call(
        admin,
        'GET',
        `/exams/schemes/${scheme.json().id as string}/register?classSectionId=${section}`,
      )
    ).json();
    const line = reg.rows
      .find((r: { studentId: string }) => r.studentId === student.Bela)
      .subjects.find((x: { code: string }) => x.code === 'SKT');
    expect(line.note).toBe('UT in French');
    expect(line.values.UT.v).toBe(30);
    expect(line.values.HY.v).toBe(44);
    expect(line.values.TOT.v).toBe(74);
    expect(
      reg.rows
        .find((r: { studentId: string }) => r.studentId === student.Bela)
        .subjects.some((x: { code: string }) => x.code === 'FRE'),
    ).toBe(false);
    // the grid saves her as she is; Sanskrit has marks, so the change is not undone
    expect(
      (
        await call(admin, 'PUT', '/exams/subject-choices', {
          classSectionId: section,
          partial: true,
          rows: [
            {
              studentId: student.Bela,
              stream: bela.stream,
              subjects: bela.subjects.map((x) => ({ subjectId: x.subjectId })),
            },
          ],
        })
      ).json(),
    ).toMatchObject({ saved: 1, refused: [] });
    const undo = await call(admin, 'POST', '/exams/subject-choices/change/undo', {
      classSectionId: section,
      changeId: bela.changes[0]!.id,
    });
    expect(undo.statusCode).toBe(409);
    expect(undo.json().detail).toContain('SKT has marks');
  });
});
