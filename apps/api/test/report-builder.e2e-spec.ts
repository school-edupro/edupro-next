/**
 * Report builder (phase D, 2026-09-30): saved student reports with the user's own headers, filters and
 * sort; sharing with users and roles as view only or can edit; manager visibility; live preview with
 * section scope and masked ID numbers; export limits and the sensitive-export guard.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
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

describe('report builder (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let coord: SeededUser;
  let accountant: SeededUser;
  let viewerFull: SeededUser;
  let sectionA: string;
  let sectionB: string;
  let reportId: string;
  const h = (u: SeededUser) => headersFor(u.sub, school.id);

  beforeAll(async () => {
    const s = stamp('RB');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      coord = await seedUser(c, school, `${s}-coord`, 'academic_coordinator');
      accountant = await seedUser(c, school, `${s}-acct`, 'accountant');
      viewerFull = await seedUser(c, school, `${s}-full`, 'school_admin');
      await c.query(
        `INSERT INTO user_roles (school_id, user_id, role_id, reason)
         SELECT $1, $2, id, 'e2e' FROM roles WHERE school_id IS NULL AND code = 'sensitive_data_viewer'`,
        [school.id, viewerFull.id],
      );
    });
    app = await createApp();
    inject = injector(app);
    const cls = await inject({
      method: 'POST',
      url: '/academics/classes',
      headers: h(admin),
      json: { code: 'VII', name: 'Class VII' },
    });
    sectionA = (
      await inject({
        method: 'POST',
        url: `/academics/classes/${cls.json().id}/sections`,
        headers: h(admin),
        json: { name: 'A' },
      })
    ).json().id;
    sectionB = (
      await inject({
        method: 'POST',
        url: `/academics/classes/${cls.json().id}/sections`,
        headers: h(admin),
        json: { name: 'B' },
      })
    ).json().id;
    const kids: Array<[string, string, string, string, string]> = [
      ['RB01', 'zoya', 'Female', 'Muslim', sectionA],
      ['RB02', 'arjun', 'Male', 'Hindu', sectionA],
      ['RB03', 'meher', 'Female', 'Sikh', sectionB],
      ['RB04', 'bela', 'Female', 'Hindu', sectionB],
    ];
    for (const [adm, name, gender, religion, sec] of kids) {
      const r = await inject({
        method: 'POST',
        url: '/people/profile/quick-add',
        headers: h(admin),
        json: {
          classSectionId: sec,
          values: {
            admission_no: adm,
            first_name: name,
            dob: '10-10-2013',
            gender,
            father_name: `${name} father`,
            sms_mobile: '9812300000',
            category: 'General',
            ews: 'No',
            boarding: 'Day Scholar',
            transport_required: 'No',
          },
        },
      });
      expect(r.statusCode).toBe(201);
      await inject({
        method: 'PATCH',
        url: `/people/students/${r.json().id}/profile`,
        headers: h(admin),
        json: { values: { religion, aadhaar_no: `1111222233${adm.slice(-2)}` } },
      });
    }
  });
  afterAll(async () => {
    await app.close();
  });

  const spec = (extra: Record<string, unknown> = {}) => ({
    columns: [
      { key: 'admission_no', label: 'Adm No' },
      { key: 'full_name', label: 'Name of the student' },
      { key: 'class_section' },
      { key: 'religion' },
      { key: 'aadhaar_no', label: 'Aadhaar' },
    ],
    filters: [{ key: 'gender', op: 'eq', values: ['Female'] }],
    sort: [{ key: 'full_name', dir: 'asc' }],
    options: { paper: 'A4', orientation: 'auto' },
    ...extra,
  });

  it('offers the catalogue fields plus fees, transport and record columns', async () => {
    const r = await inject({ method: 'GET', url: '/reports/builder/fields', headers: h(admin) });
    expect(r.statusCode).toBe(200);
    const keys = r.json().fields.map((f: { key: string }) => f.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        'religion',
        'father_mobile',
        'fee_discount',
        'transport_route',
        'class_section',
      ]),
    );
    expect(r.json().fields.find((f: { key: string }) => f.key === 'class_section').options).toEqual(
      ['VII-A', 'VII-B'],
    );
    expect(r.json().pdfColumnLimit).toEqual({ A4: 15, A3: 25 });
  });

  it('previews with custom headers, filters in words, sort, and masked ID numbers', async () => {
    const r = await inject({
      method: 'POST',
      url: '/reports/builder/preview',
      headers: h(admin),
      json: { spec: spec() },
    });
    expect(r.statusCode).toBe(201);
    const d = r.json();
    expect(d.columns.map((c: { header: string }) => c.header)).toEqual([
      'Adm No',
      'Name of the student',
      'Class-Section',
      'Religion',
      'Aadhaar',
    ]);
    expect(d.total).toBe(3);
    expect(d.rows.map((x: { full_name: string }) => x.full_name)).toEqual([
      'BELA',
      'MEHER',
      'ZOYA',
    ]);
    expect(d.rows[0].aadhaar_no).toBe('XXXX-XXXX-3304');
    expect(d.filtersText).toEqual(['Gender is Female']);
    const full = await inject({
      method: 'POST',
      url: '/reports/builder/preview',
      headers: h(viewerFull),
      json: { spec: spec() },
    });
    expect(full.json().rows[0].aadhaar_no).toBe('111122223304');
    const inFilter = await inject({
      method: 'POST',
      url: '/reports/builder/preview',
      headers: h(admin),
      json: {
        spec: spec({
          filters: [
            { key: 'religion', op: 'in', values: ['hindu', 'Sikh'] },
            { key: 'class_section', op: 'eq', values: ['VII-B'] },
          ],
        }),
      },
    });
    expect(
      inFilter
        .json()
        .rows.map((x: { admission_no: string }) => x.admission_no)
        .sort(),
    ).toEqual(['RB03', 'RB04']);
    expect(inFilter.json().filtersText[0]).toBe('Religion is one of hindu, Sikh');
  });

  it('rejects unknown columns and too many columns for a PDF', async () => {
    const bad = await inject({
      method: 'POST',
      url: '/reports/builder/preview',
      headers: h(admin),
      json: { spec: spec({ columns: [{ key: 'no_such_field' }] }) },
    });
    expect(bad.statusCode).toBe(400);
    const wide = Array.from({ length: 16 }, (_, i) => ({
      key: [
        'admission_no',
        'first_name',
        'last_name',
        'dob',
        'gender',
        'religion',
        'category',
        'father_name',
        'father_mobile',
        'mother_name',
        'mother_mobile',
        'sms_mobile',
        'residential_city',
        'residential_state',
        'class_section',
        'roll_no',
      ][i]!,
    }));
    const saved = await inject({
      method: 'POST',
      url: '/reports/builder',
      headers: h(admin),
      json: { name: 'Wide list', spec: spec({ columns: wide }) },
    });
    expect(saved.statusCode).toBe(201);
    const pdf = await inject({
      method: 'POST',
      url: `/reports/builder/${saved.json().id}/export`,
      headers: h(admin),
      json: { format: 'pdf' },
    });
    expect(pdf.statusCode).toBe(400);
    expect(pdf.json().detail).toMatch(/at most 15 columns/);
    const xlsx = await inject({
      method: 'POST',
      url: `/reports/builder/${saved.json().id}/export`,
      headers: h(admin),
      json: { format: 'xlsx' },
    });
    expect(xlsx.statusCode).toBe(201);
  });

  it('saves, shares view-only with a user and can-edit with a role, and enforces it', async () => {
    const created = await inject({
      method: 'POST',
      url: '/reports/builder',
      headers: h(admin),
      json: { name: 'Girls with religion', description: 'for the census', spec: spec() },
    });
    expect(created.statusCode).toBe(201);
    reportId = created.json().id;
    expect(created.json()).toMatchObject({ isOwner: true, canEdit: true, canShare: true });
    const dup = await inject({
      method: 'POST',
      url: '/reports/builder',
      headers: h(admin),
      json: { name: 'girls WITH religion', spec: spec() },
    });
    expect(dup.statusCode).toBe(409);

    // not shared yet: invisible to the coordinator
    expect(
      (await inject({ method: 'GET', url: `/reports/builder/${reportId}`, headers: h(coord) }))
        .statusCode,
    ).toBe(404);

    const options = await inject({
      method: 'GET',
      url: '/reports/builder/share-options',
      headers: h(admin),
    });
    const accountantRole = options
      .json()
      .roles.find((r: { code: string }) => r.code === 'accountant');
    const share = await inject({
      method: 'PUT',
      url: `/reports/builder/${reportId}/shares`,
      headers: h(admin),
      json: {
        shares: [
          { userId: coord.id, canEdit: false },
          { roleId: accountantRole.id, canEdit: true },
        ],
      },
    });
    expect(share.statusCode).toBe(200);
    expect(share.json().shares).toHaveLength(2);

    const coordList = await inject({ method: 'GET', url: '/reports/builder', headers: h(coord) });
    expect(coordList.json().shared.map((x: { id: string }) => x.id)).toContain(reportId);
    const coordView = (
      await inject({ method: 'GET', url: `/reports/builder/${reportId}`, headers: h(coord) })
    ).json();
    expect(coordView).toMatchObject({
      canEdit: false,
      canShare: false,
      sharedWithMe: true,
      shares: [],
    });
    const coordEdit = await inject({
      method: 'PUT',
      url: `/reports/builder/${reportId}`,
      headers: h(coord),
      json: { name: 'Mine now', spec: spec() },
    });
    expect(coordEdit.statusCode).toBe(403);
    const coordShare = await inject({
      method: 'PUT',
      url: `/reports/builder/${reportId}/shares`,
      headers: h(coord),
      json: { shares: [] },
    });
    expect(coordShare.statusCode).toBe(403);
    // save as: the coordinator's own copy
    const copy = await inject({
      method: 'POST',
      url: `/reports/builder/${reportId}/copy`,
      headers: h(coord),
      json: {},
    });
    expect(copy.statusCode).toBe(201);
    expect(copy.json()).toMatchObject({ name: 'Girls with religion (copy)', isOwner: true });

    // the accountant role can edit, not re-share
    const acctEdit = await inject({
      method: 'PUT',
      url: `/reports/builder/${reportId}`,
      headers: h(accountant),
      json: {
        name: 'Girls with religion',
        description: 'edited by accounts',
        spec: spec({ sort: [{ key: 'admission_no', dir: 'desc' }] }),
      },
    });
    expect(acctEdit.statusCode).toBe(200);
    expect(acctEdit.json().spec.sort).toEqual([{ key: 'admission_no', dir: 'desc' }]);
    expect(
      (
        await inject({
          method: 'DELETE',
          url: `/reports/builder/${reportId}`,
          headers: h(accountant),
        })
      ).statusCode,
    ).toBe(403);
  });

  it('exports with full IDs open only for the requester or a sensitive-data viewer', async () => {
    const shared = await inject({
      method: 'PUT',
      url: `/reports/builder/${reportId}/shares`,
      headers: h(admin),
      json: {
        shares: [
          { userId: viewerFull.id, canEdit: false },
          { userId: coord.id, canEdit: false },
        ],
      },
    });
    expect(shared.statusCode).toBe(200);
    const exp = await inject({
      method: 'POST',
      url: `/reports/builder/${reportId}/export`,
      headers: h(viewerFull),
      json: { format: 'xlsx' },
    });
    expect(exp.statusCode).toBe(201);
    const row = await withMigrator((c) =>
      c.query<{ params: { showSensitive: boolean; name: string } }>(
        'SELECT params FROM exports WHERE id = $1',
        [exp.json().exportId],
      ),
    );
    expect(row.rows[0]!.params).toMatchObject({ showSensitive: true, name: 'Girls with religion' });
    const other = await inject({
      method: 'GET',
      url: `/reports/exports/${exp.json().exportId}`,
      headers: h(coord),
    });
    expect(other.statusCode).toBe(404);
    const own = await inject({
      method: 'GET',
      url: `/reports/exports/${exp.json().exportId}`,
      headers: h(viewerFull),
    });
    expect(own.statusCode).toBe(200);
  });

  describe('students list (grid)', () => {
    const grid = (body: Record<string, unknown>) =>
      inject({ method: 'POST', url: '/people/students/grid', headers: h(admin), json: body });

    it('offers every field with filter values, including sections and statuses', async () => {
      const r = await inject({
        method: 'GET',
        url: '/people/students/grid/fields',
        headers: h(coord),
      });
      expect(r.statusCode).toBe(200);
      const byKey = new Map(r.json().fields.map((f: { key: string }) => [f.key, f]));
      expect((byKey.get('class_section') as { options: string[] }).options).toEqual([
        'VII-A',
        'VII-B',
      ]);
      expect((byKey.get('enrolment_status') as { options: string[] }).options).toContain(
        'Withdrawn',
      );
    });

    it('returns counts, chosen columns, search, filters, sort and pages', async () => {
      const r = await grid({
        columns: [{ key: 'religion' }, { key: 'father_name', label: 'Father' }],
        filters: [{ key: 'class_section', op: 'eq', values: ['VII-B'] }],
        sort: [{ key: 'full_name', dir: 'desc' }],
        status: 'active',
        page: 1,
        size: 10,
      });
      expect(r.statusCode).toBe(201);
      const d = r.json();
      expect(d.stats).toEqual({ total: 4, active: 4, inactive: 0, withdrawn: 0 });
      expect(d.columns.map((c: { header: string }) => c.header)).toEqual(['Religion', 'Father']);
      expect(d.rows.map((x: { full_name: string }) => x.full_name)).toEqual(['MEHER', 'BELA']);
      expect(d.rows[0]).toMatchObject({ religion: 'Sikh', class_section: 'VII-B' });
      expect(d.rows[0].__id).toMatch(/^\d+$/);
      const search = await grid({ search: 'zoya', status: 'all', page: 1, size: 10 });
      expect(search.json().rows.map((x: { admission_no: string }) => x.admission_no)).toEqual([
        'RB01',
      ]);
      const paged = await grid({ status: 'active', page: 2, size: 10 });
      expect(paged.json()).toMatchObject({ total: 4, page: 1, pages: 1 });
      const bad = await grid({
        columns: [{ key: 'nope_field' }],
        status: 'active',
        page: 1,
        size: 10,
      });
      expect(bad.statusCode).toBe(400);
    });

    it('exports the current view with its status and search as a branded file', async () => {
      const r = await inject({
        method: 'POST',
        url: '/people/students/grid/export',
        headers: h(admin),
        json: {
          columns: [{ key: 'religion' }],
          filters: [],
          sort: [],
          search: 'meher',
          status: 'active',
          page: 1,
          size: 50,
          format: 'xlsx',
        },
      });
      expect(r.statusCode).toBe(201);
      expect(r.json().spec.options.search).toBe('meher');
      expect(r.json().spec.filters[0]).toEqual({
        key: 'student_status',
        op: 'eq',
        values: ['Active'],
      });
      expect(r.json().spec.columns.slice(0, 2)).toEqual([
        { key: 'admission_no' },
        { key: 'full_name', label: 'Student' },
      ]);
    });
  });

  it('the owner deletes; the report disappears for everyone it was shared with', async () => {
    expect(
      (await inject({ method: 'DELETE', url: `/reports/builder/${reportId}`, headers: h(admin) }))
        .statusCode,
    ).toBe(200);
    expect(
      (await inject({ method: 'GET', url: `/reports/builder/${reportId}`, headers: h(coord) }))
        .statusCode,
    ).toBe(404);
    const list = await inject({ method: 'GET', url: '/reports/builder', headers: h(admin) });
    expect(list.json().mine.map((x: { id: string }) => x.id)).not.toContain(reportId);
    void sectionB;
  });
});
