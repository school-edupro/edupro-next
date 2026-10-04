import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { ViewerService } from '../academics/daily/viewer.service';
import type { CreateQueryDto, ListQueriesDto } from '../engagement/engagement.dto';
import type {
  EmployeeQueryDto,
  GatePassDecideDto,
  GatePassDto,
  ListQueryDto,
  VisitorInDto,
} from '../engagement/plus.dto';
import { EngagementPlusService } from '../engagement/plus.service';
import { QueriesService } from '../engagement/queries.service';
import type { EntryQueryDto, PutMarksDto } from '../exams/exams.dto';
import { ExamEntryService } from '../exams/exam-entry.service';
import { ReportCardsService } from '../exams/report-cards.service';
import { FeeLedgerService } from '../fees/fee-ledger.service';
import { FilesService } from '../files/files.service';
import { LibraryService } from '../library/library.service';
import { SettingsService } from '../platform/settings.service';
import type {
  AlbumImagesDto,
  AppVersionDto,
  AssignmentQueryDto,
  GatePassQueryDto,
  MarkEntryQueryDto,
  SadmissionDto,
  SendQueryDto,
  StudentLeaveDto,
  SubmitGatePassDto,
  SubmitMarkEntryDto,
  SubmitVisitorDto,
  UpdateGatePassStatusDto,
  VisitorQueryDto,
} from './compat.dto';
import { legacyDate as toIso } from './compat-writes.service';

type Row = Record<string, unknown>;
/** yyyy-mm-dd → dd-mm-yyyy (what the apps render); anything else passes through. */
const dmy = (v: unknown): string => {
  const s = v == null ? '' : String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.split('-').reverse().join('-') : s;
};
const ts = (v: unknown): string => (v ? new Date(v as string).toISOString() : '');
const money = (v: unknown): string => Number(v ?? 0).toFixed(2);
const items = <T>(list: T[]) => ({ items: list });
const fail = (info: string) => ({ status: false as const, info });

/**
 * Sprint 20: the remaining legacy endpoints of the student, parent and teacher apps (design note 17
 * section 1). Everything runs through the new services or read-only SQL under the caller's tenant.
 */
@Injectable()
export class CompatParityService {
  constructor(
    private readonly db: DbService,
    private readonly viewer: ViewerService,
    private readonly fees: FeeLedgerService,
    private readonly libraryService: LibraryService,
    private readonly reportCards: ReportCardsService,
    private readonly examEntry: ExamEntryService,
    private readonly queries: QueriesService,
    private readonly plus: EngagementPlusService,
    private readonly files: FilesService,
    private readonly settings: SettingsService,
  ) {}

  // ---- helpers ------------------------------------------------------------------------------------
  /** The child the request is about: by `sadmission` among the family's children, else the first child. */
  private async child(ctx: RequestContext, q: { sadmission?: string }) {
    const v = await this.viewer.resolve(ctx, 'engagement.family.view');
    if (v.kind !== 'family' || v.students.length === 0) return null;
    if (!q.sadmission) return v.students[0]!;
    const match = await this.db.tenant(requireTenant(ctx), (c) =>
      c.query<{ id: string }>(
        `SELECT id::text FROM students WHERE admission_no = $1 AND id = ANY($2::bigint[])`,
        [q.sadmission, v.students.map((s) => s.id)],
      ),
    );
    const id = match.rows[0]?.id;
    return id ? (v.students.find((s) => s.id === id) ?? null) : null;
  }

  private async employee(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{ id: string; code: string; name: string }>(
        `SELECT id::text, employee_code AS code, display_name AS name FROM employees WHERE user_id = app.current_user_id() AND deleted_at IS NULL LIMIT 1`,
      );
      return r.rows[0] ?? null;
    });
  }

  /** "VI-A" → section of the working year. */
  private async section(c: PoolClient, yearId: string, sclass: string) {
    const m = /^([A-Za-z0-9]+)\s*[-/ ]\s*([A-Za-z0-9]+)$/.exec(sclass.trim());
    if (!m) return null;
    const r = await c.query<{ id: string; class_id: string; code: string }>(
      `SELECT cs.id::text, cs.class_id::text, k.code || '-' || cs.name AS code FROM class_sections cs JOIN classes k ON k.id = cs.class_id
        WHERE upper(k.code) = upper($1) AND upper(cs.name) = upper($2) AND cs.academic_year_id = $3 AND cs.deleted_at IS NULL`,
      [m[1], m[2], yearId],
    );
    return r.rows[0] ?? null;
  }

  private year(ctx: RequestContext): string {
    const y = requireTenant(ctx).academicYearId;
    if (!y)
      throw new DomainError('year.not_selected', 'No academic year is active or selected', {
        status: 409,
      });
    return y;
  }

  // ---- student / parent: fees, transport, library, health ------------------------------------------
  async fee(ctx: RequestContext, q: SadmissionDto) {
    const child = await this.child(ctx, q);
    if (!child) return items([]);
    const mine = await this.fees.mine(ctx);
    const ledger = mine.children.find((c) => c.student.id === child.id);
    return items(
      (ledger?.instalments ?? []).map((i) => ({
        fees_amount: money(i.net),
        month: i.label,
        status: i.status === 'paid' ? 'Paid' : i.status === 'overdue' ? 'Overdue' : 'Due',
        due_date: dmy(i.dueOn),
        balance: money(Number(i.balance) + Number(i.lateFee.outstanding)),
        ledger: i.ledger,
        datetime: `${i.dueOn}T00:00:00.000Z`,
      })),
    );
  }

  async transport(ctx: RequestContext, q: SadmissionDto) {
    const child = await this.child(ctx, q);
    if (!child) return items([]);
    const yearId = this.year(ctx);
    const r = await this.db.tenant(requireTenant(ctx), (c) =>
      c.query<Row>(
        `SELECT r.code AS routeno, r.name AS route_details, COALESCE(v.reg_no, r.vehicle_no, '') AS bus_no,
                COALESCE(d.name, r.driver_name, '') AS driver_name, COALESCE(d.mobile, r.driver_mobile, '') AS driver_mobile,
                COALESCE(r.conductor_name, '') AS attendant_name, COALESCE(r.conductor_mobile, '') AS attendant_mobile,
                COALESCE(st.name, a.stop_name, '') AS pick_up, to_char(COALESCE(st.pickup_time, a.pickup_time), 'HH24:MI') AS in_time,
                to_char(COALESCE(st.drop_time, a.drop_time), 'HH24:MI') AS out_time, sl.name AS route_slab, sl.monthly_amount::text AS routecharges,
                y.code AS financialyear, v.gps_device_id, a.created_at
           FROM student_route_assignments a JOIN transport_routes r ON r.id = a.route_id
           JOIN academic_years y ON y.id = a.academic_year_id
           LEFT JOIN transport_stops st ON st.id = a.stop_id
           LEFT JOIN transport_slabs sl ON sl.id = st.slab_id
           LEFT JOIN transport_vehicles v ON v.id = r.vehicle_id AND v.deleted_at IS NULL
           LEFT JOIN transport_drivers d ON d.id = r.driver_id AND d.deleted_at IS NULL
          WHERE a.student_id = $1 AND a.academic_year_id = $2 LIMIT 1`,
        [child.id, yearId],
      ),
    );
    const x = r.rows[0];
    if (!x) return items([]);
    return items([
      {
        routeno: String(x.routeno),
        bus_no: String(x.bus_no),
        timing: `${x.in_time ?? ''}${x.out_time ? ` / ${x.out_time}` : ''}`,
        driver_name: String(x.driver_name),
        driver_mobile: String(x.driver_mobile),
        GPSUserId: '',
        GPSPassword: '',
        GPSURL: x.gps_device_id ? '/transport' : '',
        in_time: String(x.in_time ?? ''),
        out_time: String(x.out_time ?? ''),
        routecharges: x.routecharges ? money(x.routecharges) : '',
        route_details: String(x.route_details),
        financialyear: String(x.financialyear),
        route_slab: String(x.route_slab ?? ''),
        attendant_name: String(x.attendant_name),
        attendant_mobile: String(x.attendant_mobile),
        teacher_name: '',
        teacher_mobile: '',
        pick_up: String(x.pick_up),
        drop_out: String(x.pick_up),
        datetime: ts(x.created_at),
      },
    ]);
  }

  async library(ctx: RequestContext, q: SadmissionDto) {
    const child = await this.child(ctx, q);
    if (!child) return items([]);
    const mine = await this.libraryService.mine(ctx);
    const loans = mine.children.find((c) => c.student.id === child.id)?.loans ?? [];
    const adm = await this.admission(ctx, child.id);
    return items(
      loans.map((l) => ({
        sadmission: adm,
        sname: child.name,
        sclass: child.section ?? '',
        srollno: '',
        bookid: l.accessionNo,
        bookname: l.title,
        bookauthor: l.author ?? '',
        booksubject: '',
        tilldate: dmy(l.dueOn),
        returndate: l.returnedOn ? dmy(l.returnedOn) : '',
        status: l.returnedOn ? 'Returned' : l.daysOverdue > 0 ? 'Overdue' : 'Issued',
        issue_date: dmy(l.issuedOn),
        IssuerType: 'Student',
      })),
    );
  }

  private async admission(ctx: RequestContext, studentId: string): Promise<string> {
    const r = await this.db.tenant(requireTenant(ctx), (c) =>
      c.query<{ a: string }>(`SELECT admission_no AS a FROM students WHERE id = $1`, [studentId]),
    );
    return r.rows[0]?.a ?? '';
  }

  private async healthRows(ctx: RequestContext, q: SadmissionDto) {
    const child = await this.child(ctx, q);
    if (!child) return { child: null, records: [] as Row[], visits: [] as Row[], adm: '' };
    const h = await this.plus.myHealth(ctx);
    const mine = h.children.find((c) => c.student.id === child.id);
    return {
      child,
      records: (mine?.records ?? []) as Row[],
      visits: (mine?.visits ?? []) as unknown as Row[],
      adm: await this.admission(ctx, child.id),
    };
  }

  async health(ctx: RequestContext, q: SadmissionDto) {
    const { child, records, adm } = await this.healthRows(ctx, q);
    if (!child) return items([]);
    return items(
      records.map((r) => ({
        sadmission: adm,
        sname: child.name,
        height: String(r.height_cm ?? ''),
        weight: String(r.weight_kg ?? ''),
        bmi: String(r.bmi ?? ''),
        blood_group: String(r.blood_group ?? ''),
        left_vision: String(r.vision_left ?? ''),
        right_vision: String(r.vision_right ?? ''),
        dental: String(r.dental ?? ''),
        DateOfExamination: dmy(r.recorded_on),
      })),
    );
  }

  async clinic(ctx: RequestContext, q: SadmissionDto) {
    const { child, records, visits, adm } = await this.healthRows(ctx, q);
    if (!child) return items([]);
    const checks = records.map((r, i) => ({
      SrNo: String(i + 1),
      sadmission: adm,
      sname: child.name,
      sclass: child.section ?? '',
      height: String(r.height_cm ?? ''),
      weight: String(r.weight_kg ?? ''),
      blood_group: String(r.blood_group ?? ''),
      bmi: String(r.bmi ?? ''),
      right_vision: String(r.vision_right ?? ''),
      left_vision: String(r.vision_left ?? ''),
      Tooth_cavity: String(r.dental ?? ''),
      DateOfExamination: dmy(r.recorded_on),
      PlaceOfExamination: 'School',
      Remarks: 'Annual health check',
      channels: 'health',
    }));
    const clinicRows = visits.map((v, i) => ({
      SrNo: String(checks.length + i + 1),
      sadmission: adm,
      sname: child.name,
      sclass: child.section ?? '',
      height: '',
      weight: '',
      blood_group: '',
      bmi: '',
      right_vision: '',
      left_vision: '',
      Tooth_cavity: '',
      DateOfExamination: dmy(String(v.inAt ?? '').slice(0, 10)),
      PlaceOfExamination: 'Clinic',
      Remarks: `${String(v.complaint ?? '')}${v.treatment ? ` · ${String(v.treatment)}` : ''}${v.temperatureC ? ` · ${String(v.temperatureC)} °C` : ''}`,
      channels: 'clinic',
    }));
    return items([...checks, ...clinicRows]);
  }

  // ---- exams: datesheet and report cards -----------------------------------------------------------
  private async classIdOf(ctx: RequestContext, q: SadmissionDto): Promise<string | null> {
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      if (q.sclass) {
        const sec = await this.section(c, yearId, q.sclass);
        if (sec) return sec.class_id;
        const k = await c.query<{ id: string }>(
          `SELECT id::text FROM classes WHERE upper(code) = upper($1) AND deleted_at IS NULL LIMIT 1`,
          [q.sclass.trim()],
        );
        if (k.rows[0]) return k.rows[0].id;
      }
      const child = await this.child(ctx, q);
      if (!child?.classSectionId) return null;
      const r = await c.query<{ class_id: string }>(
        `SELECT class_id::text FROM class_sections WHERE id = $1`,
        [child.classSectionId],
      );
      return r.rows[0]?.class_id ?? null;
    });
  }

  private async datesheetRows(ctx: RequestContext, classId: string) {
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), (c) =>
      c.query<{
        exam_id: string;
        exam: string;
        exam_code: string;
        starts_on: string | null;
        subject: string;
        exam_on: string | null;
        class_code: string;
      }>(
        `SELECT e.id::text AS exam_id, e.name AS exam, e.code AS exam_code, e.starts_on::text, s.name AS subject, es.exam_on::text, k.code AS class_code
           FROM exam_subjects es JOIN exams e ON e.id = es.exam_id JOIN subjects s ON s.id = es.subject_id JOIN classes k ON k.id = es.class_id
          WHERE es.class_id = $1 AND e.academic_year_id = $2 AND e.deleted_at IS NULL AND e.status = 'active' AND e.show_on_portal
          ORDER BY e.starts_on NULLS LAST, es.exam_on NULLS LAST, s.display_order`,
        [classId, yearId],
      ),
    );
  }

  async datesheet(ctx: RequestContext, q: SadmissionDto) {
    const classId = await this.classIdOf(ctx, q);
    if (!classId) return items([]);
    const r = await this.datesheetRows(ctx, classId);
    return items(
      r.rows
        .filter((x) => x.exam_on)
        .map((x) => ({
          subject: x.subject,
          testdate: dmy(x.exam_on),
          testtype: x.exam,
          datetime: `${x.exam_on}T00:00:00.000Z`,
        })),
    );
  }

  async studentDatesheet(ctx: RequestContext, q: SadmissionDto) {
    const classId = await this.classIdOf(ctx, q);
    if (!classId) return items([]);
    const r = await this.datesheetRows(ctx, classId);
    const byExam = new Map<string, (typeof r.rows)[number][]>();
    for (const x of r.rows) byExam.set(x.exam_id, [...(byExam.get(x.exam_id) ?? []), x]);
    return items(
      [...byExam.entries()].map(([id, rows]) => ({
        srno: id,
        sclass: rows[0]!.class_code,
        NoticeDate: dmy(rows[0]!.starts_on ?? rows[0]!.exam_on ?? ''),
        examtype: rows[0]!.exam,
        notice: rows
          .filter((x) => x.exam_on)
          .map((x) => `${x.subject}: ${dmy(x.exam_on)}`)
          .join(', '),
      })),
    );
  }

  async reportCard(ctx: RequestContext, q: SadmissionDto) {
    const child = await this.child(ctx, q);
    if (!child) return items([]);
    const mine = await this.reportCards.mine(ctx);
    const me = mine.children.find((c) => c.student.id === child.id);
    const adm = await this.admission(ctx, child.id);
    const out: Row[] = [];
    for (const term of me?.terms ?? []) {
      const exams = term.exams as Array<{
        code: string;
        name: string;
        pct: string | null;
        grade: string | null;
        result: string | null;
        rank: number | null;
      }>;
      for (const e of exams)
        out.push({
          sadmission: adm,
          sname: child.name,
          sclass: child.section ?? '',
          term: term.name,
          exam: e.name,
          percentage: e.pct ?? '',
          grade: e.grade ?? '',
          result: e.result ?? '',
          rank: e.rank == null ? '' : String(e.rank),
          released_on: dmy(term.releasedAt ?? ''),
          pdf_available: term.withheld ? '0' : '1',
          release_id: term.releaseId,
        });
    }
    return items(out);
  }

  // ---- calendar, news, gallery ---------------------------------------------------------------------
  async calendar(ctx: RequestContext) {
    const yearId = this.year(ctx);
    const r = await this.db.tenant(requireTenant(ctx), (c) =>
      c.query<{ on: string; title: string; kind: string }>(
        `SELECT starts_on::text AS "on", name AS title, kind::text FROM holidays WHERE academic_year_id = $1 AND kind <> 'working_day'
         UNION ALL
         SELECT starts_on::text, title, kind::text FROM almanac_events WHERE academic_year_id = $1 AND deleted_at IS NULL
         ORDER BY 1`,
        [yearId],
      ),
    );
    return items(
      r.rows.map((x) => ({
        class: 'All',
        AcademicCalenderdate: dmy(x.on),
        remark: `${x.title} (${x.kind})`,
        CalenderURL: '',
        status: '1',
        datetime: `${x.on}T00:00:00.000Z`,
        Month: new Date(`${x.on}T00:00:00Z`).toLocaleString('en-IN', {
          month: 'long',
          timeZone: 'UTC',
        }),
        channels: 'calendar',
      })),
    );
  }

  private async schoolWideNotices(ctx: RequestContext, pinnedOnly: boolean) {
    return this.db.tenant(requireTenant(ctx), (c) =>
      c.query<{ id: string; title: string; body: string; published_at: Date; is_pinned: boolean }>(
        `SELECT n.id::text, n.title, n.body, n.published_at, n.is_pinned FROM notices n
          WHERE n.deleted_at IS NULL AND n.published_at IS NOT NULL AND (n.publish_until IS NULL OR n.publish_until >= CURRENT_DATE)
            AND NOT EXISTS (SELECT 1 FROM notice_targets t WHERE t.notice_id = n.id)
            AND ($1::boolean = false OR n.is_pinned)
          ORDER BY n.is_pinned DESC, n.publish_from DESC LIMIT 20`,
        [pinnedOnly],
      ),
    );
  }

  async news(ctx: RequestContext) {
    const r = await this.schoolWideNotices(ctx, false);
    return items(
      r.rows.map((n) => ({
        srno: n.id,
        newstitle: n.title,
        news: n.body,
        imageurl: '',
        datetime: n.published_at.toISOString(),
      })),
    );
  }

  async banner(ctx: RequestContext) {
    const r = await this.schoolWideNotices(ctx, true);
    return {
      error: '',
      items: r.rows.map((n, i) => ({
        type: 'news',
        messeage: n.title,
        url: '',
        order_priority: String(i + 1),
        status: '1',
      })),
    };
  }

  async albums(ctx: RequestContext) {
    const v = await this.viewer.resolve(ctx, 'academics.gallery.view');
    const yearId = this.year(ctx);
    const audiences =
      v.kind === 'family' ? ['everyone', 'students'] : ['everyone', 'students', 'employees'];
    const r = await this.db.tenant(requireTenant(ctx), (c) =>
      c.query<{
        id: string;
        title: string;
        cover_file_id: string | null;
        first_file_id: string | null;
      }>(
        `SELECT a.id::text, a.title, a.cover_file_id::text,
                (SELECT i.file_id::text FROM gallery_items i WHERE i.album_id = a.id ORDER BY i.sort_order, i.id LIMIT 1) AS first_file_id
           FROM gallery_albums a WHERE a.academic_year_id = $1 AND a.deleted_at IS NULL AND a.status = 'active' AND a.audience = ANY($2::audience_kind[])
          ORDER BY a.event_on DESC NULLS LAST, a.id DESC LIMIT 50`,
        [yearId, audiences],
      ),
    );
    const out = [];
    for (const a of r.rows) {
      const fileId = a.cover_file_id ?? a.first_file_id;
      let thumb = '';
      if (fileId)
        thumb = await this.files
          .downloadUrl(ctx, fileId)
          .then((d) => d.download.url)
          .catch(() => '');
      out.push({ album_id: a.id, album_title: a.title, ThumbNailImg: thumb, channels: 'gallery' });
    }
    return items(out);
  }

  async albumImages(ctx: RequestContext, q: AlbumImagesDto) {
    const id = q.id ?? q.album_cover_item_id;
    if (!id) return items([]);
    const v = await this.viewer.resolve(ctx, 'academics.gallery.view');
    const audiences =
      v.kind === 'family' ? ['everyone', 'students'] : ['everyone', 'students', 'employees'];
    const r = await this.db.tenant(requireTenant(ctx), (c) =>
      c.query<{ file_id: string; caption: string | null }>(
        `SELECT i.file_id::text, i.caption FROM gallery_items i JOIN gallery_albums a ON a.id = i.album_id
          WHERE a.id = $1 AND a.deleted_at IS NULL AND a.audience = ANY($2::audience_kind[]) ORDER BY i.sort_order, i.id LIMIT 200`,
        [id, audiences],
      ),
    );
    const out = [];
    for (const x of r.rows) {
      const url = await this.files
        .downloadUrl(ctx, x.file_id)
        .then((d) => d.download.url)
        .catch(() => '');
      if (url) out.push({ photo_name: url, caption: x.caption ?? '', channels: 'gallery' });
    }
    return items(out);
  }

  // ---- gate passes and visitors (Sprint 19 modules) ------------------------------------------------
  private passRow(p: {
    id: string;
    admissionNo: string;
    student: string;
    kind: string;
    reason: string;
    escortName: string | null;
    escortMobile: string | null;
    status: string;
    onDate: string;
    passNo: string | null;
  }) {
    return {
      slip_no: p.id,
      gt_admission_id: p.admissionNo,
      gt_student_name: p.student,
      gt_type: p.kind === 'late_arrival' ? 'Late Arrival' : 'Early Leave',
      gt_reason: p.reason,
      gt_accompanied: p.escortName ?? '',
      gt_accompanied_mobile: p.escortMobile ?? '',
      status:
        p.status === 'approved' ? 'Approved' : p.status === 'rejected' ? 'Rejected' : 'Pending',
      issue_date: dmy(p.onDate),
      pass_no: p.passNo ?? '',
    };
  }

  async gatePasses(ctx: RequestContext, q: GatePassQueryDto) {
    const v = await this.viewer.resolve(ctx, 'engagement.family.view').catch(() => null);
    if (v?.kind === 'family') {
      const mine = await this.plus.myGatePasses(ctx);
      return { gatepass_data: mine.data.map((p) => this.passRow(p)), image: '' };
    }
    const status = (q.status ?? '').toLowerCase();
    const list = await this.plus.gatePasses(ctx, {
      status: status === 'approved' ? 'approved' : status === 'rejected' ? 'rejected' : 'pending',
      page: 1,
      size: q.limit_value,
    } as ListQueryDto);
    return { gatepass_data: list.data.map((p) => this.passRow(p)), image: '' };
  }

  async submitGatePass(ctx: RequestContext, body: SubmitGatePassDto) {
    const v = await this.viewer.resolve(ctx, 'engagement.family.view').catch(() => null);
    const student = await this.db.tenant(requireTenant(ctx), (c) =>
      c.query<{ id: string }>(
        `SELECT id::text FROM students WHERE (admission_no = $1 OR id::text = $1) AND deleted_at IS NULL LIMIT 1`,
        [body.gt_admission_id],
      ),
    );
    const studentId = student.rows[0]?.id;
    if (!studentId) return fail('No record');
    const mobile = (body.gt_accompanied_mobile ?? '').replace(/\D/g, '').slice(-10);
    const dto = {
      studentId,
      kind: /late/i.test(body.gt_type) ? 'late_arrival' : 'early_leave',
      reason: body.gt_reason + (body.gt_other_remark ? ` · ${body.gt_other_remark}` : ''),
      escortName: body.gt_accompanied_other || body.gt_accompanied || undefined,
      escortMobile: /^\d{10}$/.test(mobile) ? mobile : undefined,
    } as GatePassDto;
    try {
      const p = await this.plus.requestGatePass(ctx, dto, v?.kind === 'family');
      return { status: true, info: 'Gate pass request submitted', slip_no: p.id };
    } catch (error) {
      if (error instanceof DomainError) return fail(error.message);
      throw error;
    }
  }

  private may(ctx: RequestContext, permission: string): boolean {
    return Boolean(ctx.permissions?.has(permission));
  }

  async updateGatePass(ctx: RequestContext, body: UpdateGatePassStatusDto) {
    // gate pass v2: whoever the pass waits on (class teacher, coordinator...) decides, not the office
    const outcome = /approv|issue|allow|yes/i.test(body.gate_pass_status) ? 'approved' : 'rejected';
    try {
      const p = await this.plus.decideGatePass(ctx, body.slip_no, { outcome } as GatePassDecideDto);
      return {
        status: true,
        info: outcome === 'approved' ? `Gate pass ${p.passNo ?? ''} issued` : 'Gate pass rejected',
      };
    } catch (error) {
      if (error instanceof DomainError) return fail(error.message);
      throw error;
    }
  }

  async visitors(ctx: RequestContext, q: VisitorQueryDto) {
    if (!this.may(ctx, 'engagement.visitor.manage'))
      return { status: false, info: [] as unknown[], image: '' };
    try {
      const onDate = q.date ? toIso(q.date) : null;
      const rows = await this.plus.visitors(ctx, onDate);
      const list = (Array.isArray(rows) ? rows : (rows as { data: unknown[] }).data) as Array<{
        id: string;
        visitorName: string;
        mobile: string | null;
        purpose: string;
        toMeet: string | null;
        inAt: string;
        outAt: string | null;
        badgeNo: string | null;
      }>;
      return {
        status: true,
        info: list.slice(0, q.limit_value).map((v) => ({
          srno: v.id,
          name: v.visitorName,
          mobile: v.mobile ?? '',
          reason: v.purpose,
          whom_to_meet: v.toMeet ?? '',
          in_time: ts(v.inAt),
          out_time: v.outAt ? ts(v.outAt) : '',
          badge_no: v.badgeNo ?? '',
          status: v.outAt ? 'Out' : 'In',
        })),
        image: '',
      };
    } catch (error) {
      if (error instanceof DomainError) return { ...fail(error.message), info: [] as unknown[] };
      throw error;
    }
  }

  async submitVisitor(ctx: RequestContext, body: SubmitVisitorDto) {
    if (!this.may(ctx, 'engagement.visitor.manage'))
      return { ...fail('Not permitted'), name: body.name };
    const mobile = (body.mobile ?? '').replace(/\D/g, '').slice(-10);
    // id_no is deliberately dropped: the platform stores the kind of id proof, never the number
    const dto = {
      visitorName: body.name,
      mobile: /^\d{10}$/.test(mobile) ? mobile : undefined,
      purpose: body.reason,
      toMeet: body.whom_to_meet || undefined,
      idProofKind: body.select_id || undefined,
      badgeNo: body.en_gate_no || undefined,
    } as VisitorInDto;
    try {
      const v = await this.plus.visitorIn(ctx, dto);
      return { status: true, info: 'Visitor entry submitted', name: body.name, srno: v.id };
    } catch (error) {
      if (error instanceof DomainError) return { ...fail(error.message), name: body.name };
      throw error;
    }
  }

  // ---- leave and queries ---------------------------------------------------------------------------
  private leaveRow(r: {
    id: string;
    studentId: string;
    categoryCode: string;
    leaveFrom: string | null;
    leaveTo: string | null;
    body: string;
    openedAt: string;
    status: string;
    decision: string | null;
  }) {
    const days =
      r.leaveFrom && r.leaveTo
        ? Math.round((Date.parse(r.leaveTo) - Date.parse(r.leaveFrom)) / 864e5) + 1
        : 0;
    return {
      srno: r.id,
      student_id: r.studentId,
      leave_type: r.categoryCode,
      from_date: dmy(r.leaveFrom ?? ''),
      to_date: dmy(r.leaveTo ?? ''),
      no_of_days: String(days),
      reason: r.body,
      attachment: '',
      applied_on: dmy(r.openedAt.slice(0, 10)),
      approval_status:
        r.status === 'closed' || r.status === 'answered'
          ? r.decision === 'rejected'
            ? 'Rejected'
            : 'Approved'
          : 'Pending',
    };
  }

  async applyLeave(ctx: RequestContext, body: StudentLeaveDto) {
    const student = await this.db.tenant(requireTenant(ctx), (c) =>
      c.query<{ id: string }>(
        `SELECT id::text FROM students WHERE (admission_no = $1 OR id::text = $1) AND deleted_at IS NULL LIMIT 1`,
        [body.student_id],
      ),
    );
    if (!student.rows[0]) return { status: false, message: 'No record', data: null };
    try {
      const from = toIso(body.from_date);
      const to = toIso(body.to_date);
      const q = await this.queries.create(ctx, {
        studentId: student.rows[0].id,
        kind: 'leave',
        categoryCode: 'attendance',
        subject: `Leave (${body.leave_type}) ${dmy(from)} to ${dmy(to)}`,
        body: body.leave_reason,
        fileIds: [],
        leaveFrom: from,
        leaveTo: to,
      } as CreateQueryDto);
      return {
        status: true,
        message: 'Leave applied',
        data: this.leaveRow({ ...q, categoryCode: body.leave_type }),
      };
    } catch (error) {
      if (error instanceof DomainError)
        return { status: false, message: error.message, data: null };
      throw error;
    }
  }

  async leaveList(ctx: RequestContext) {
    const r = await this.queries.list(ctx, { kind: 'leave', page: 1, size: 50 } as ListQueriesDto);
    return { status: true, data: r.data.map((x) => this.leaveRow(x)) };
  }

  async parentQueries(ctx: RequestContext) {
    const r = await this.queries.list(ctx, { page: 1, size: 100 } as ListQueriesDto);
    const adm = new Map<string, string>();
    await this.db.tenant(requireTenant(ctx), async (c) => {
      const ids = [...new Set(r.data.map((x) => x.studentId))];
      if (!ids.length) return;
      const a = await c.query<{ id: string; admission_no: string }>(
        `SELECT id::text, admission_no FROM students WHERE id = ANY($1::bigint[])`,
        [ids],
      );
      for (const s of a.rows) adm.set(s.id, s.admission_no);
    });
    return {
      status: true,
      info: r.data.map((x) => ({
        srno: x.id,
        sadmission: adm.get(x.studentId) ?? '',
        sname: x.studentName,
        sclass: x.section ?? '',
        query_type: x.kind,
        subject: x.subject,
        query: x.body,
        status: x.status,
        datetime: x.openedAt,
      })),
    };
  }

  async sendQuery(ctx: RequestContext, body: SendQueryDto) {
    try {
      const q = await this.plus.raiseEmployeeQuery(ctx, {
        category: (body.depart ?? 'other').toLowerCase().includes('leave') ? 'leave' : 'other',
        subject: body.cboSubject || body.txtQuery.slice(0, 60),
        detail: body.txtQuery,
      } as EmployeeQueryDto);
      return { status: true, info: 'Query submitted', srno: q.id };
    } catch (error) {
      if (error instanceof DomainError) return fail(error.message);
      throw error;
    }
  }

  async queryResponses(ctx: RequestContext) {
    const emp = await this.employee(ctx);
    if (!emp) return items([]);
    const r = await this.plus.employeeQueries(ctx, { page: 1, size: 100 } as ListQueryDto, true);
    return items(
      r.data.map((x) => ({
        EmpId: emp.code,
        Employeequery: `${x.subject}: ${x.detail}`,
        queryresponse: x.answer ?? '',
        query_type: x.category,
        datetime: x.createdAt,
      })),
    );
  }

  // ---- teacher: profile, classes, marks, assignments -----------------------------------------------
  async userDetail(ctx: RequestContext) {
    const r = await this.db.tenant(requireTenant(ctx), (c) =>
      c.query<Row>(
        `SELECT e.employee_code, e.display_name, e.dob::text, e.gender::text, e.joined_on::text, e.address, e.mobile, e.email::text,
                COALESCE(p.designation, e.designation, '') AS designation, COALESCE(p.department, e.department, '') AS department
           FROM employees e LEFT JOIN postings p ON p.employee_id = e.id AND p.academic_year_id = app.current_academic_year_id() AND p.valid_to IS NULL
          WHERE e.user_id = app.current_user_id() AND e.deleted_at IS NULL LIMIT 1`,
      ),
    );
    const e = r.rows[0];
    if (!e) return items([]);
    const addr = (e.address as Record<string, string> | null) ?? {};
    return items([
      {
        EmpId: String(e.employee_code),
        Name: String(e.display_name),
        DOB: dmy(e.dob),
        Gender: String(e.gender ?? ''),
        DOJ: dmy(e.joined_on),
        FatherName: '',
        Address: [addr.line1, addr.city, addr.pin].filter(Boolean).join(', '),
        MobileNo: String(e.mobile ?? ''),
        email: String(e.email ?? ''),
        Password: '',
        Designation: String(e.designation),
        Department: String(e.department),
        'Profile Photo': '',
        channels: 'profile',
      },
    ]);
  }

  async classSubject(ctx: RequestContext) {
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const ta = await c.query<{
        code: string;
        kind: string;
        subject: string | null;
        subject_code: string | null;
      }>(
        `SELECT k.code || '-' || cs.name AS code, ta.kind::text, s.name AS subject, s.code AS subject_code
           FROM teacher_assignments ta JOIN employees e ON e.id = ta.employee_id
           JOIN class_sections cs ON cs.id = ta.class_section_id JOIN classes k ON k.id = cs.class_id
           LEFT JOIN subjects s ON s.id = ta.subject_id
          WHERE e.user_id = app.current_user_id() AND ta.academic_year_id = $1 AND ta.valid_to IS NULL
          ORDER BY k.display_order, cs.name, s.display_order`,
        [yearId],
      );
      const exams = await c.query<{ code: string; name: string }>(
        `SELECT e.code, e.name FROM exams e WHERE e.academic_year_id = $1 AND e.deleted_at IS NULL AND e.status = 'active' AND NOT e.marks_locked ORDER BY e.starts_on NULLS LAST, e.code`,
        [yearId],
      );
      const classTeacher = [
        ...new Set(
          ta.rows
            .filter((x) => x.kind === 'class_teacher' || x.kind === 'coordinator')
            .map((x) => x.code),
        ),
      ];
      return {
        status: true,
        msg: '',
        info_class_tecaher: classTeacher.map((code) => ({ class: code })),
        info_class: [...new Set(ta.rows.map((x) => x.code))].map((code) => ({ class: code })),
        info_subject_class: ta.rows
          .filter((x) => x.subject)
          .map((x) => ({ class: x.code, subject: x.subject, subject_code: x.subject_code ?? '' })),
        info_exam_type: exams.rows.map((e) => ({ exam_type: e.name, exam_code: e.code })),
        info_mark_type: [{ mark_type: 'marks' }],
        info_leave_type: [],
      };
    });
  }

  private async examAndSubject(
    ctx: RequestContext,
    sclass: string,
    examCode: string,
    subjectCode: string,
  ) {
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const sec = await this.section(c, yearId, sclass);
      if (!sec) throw new DomainError('not-found', `Section ${sclass} not found`, { status: 404 });
      const exam = await c.query<{ id: string }>(
        `SELECT id::text FROM exams WHERE academic_year_id = $1 AND (upper(code) = upper($2) OR lower(name) = lower($2)) AND deleted_at IS NULL LIMIT 1`,
        [yearId, examCode.trim()],
      );
      if (!exam.rows[0])
        throw new DomainError('not-found', `Exam ${examCode} not found`, { status: 404 });
      const sub = await c.query<{ id: string }>(
        `SELECT id::text FROM subjects WHERE (upper(code) = upper($1) OR lower(name) = lower($1)) AND deleted_at IS NULL LIMIT 1`,
        [subjectCode.trim()],
      );
      if (!sub.rows[0])
        throw new DomainError('not-found', `Subject ${subjectCode} not found`, { status: 404 });
      return { sectionId: sec.id, examId: exam.rows[0].id, subjectId: sub.rows[0].id };
    });
  }

  async markSheet(ctx: RequestContext, q: MarkEntryQueryDto) {
    try {
      const ids = await this.examAndSubject(ctx, q.class, q.exam_type, q.subject_code);
      const sheet = await this.examEntry.marks(ctx, ids.examId, {
        classSectionId: ids.sectionId,
        subjectId: ids.subjectId,
      } as EntryQueryDto);
      return {
        status: true,
        EntryLockStatus: sheet.examSubject.entryLocked || sheet.exam.marksLocked ? '1' : '0',
        max_marks: sheet.examSubject.maxMarks,
        info_student: sheet.rows.map((r) => ({
          student_id: r.studentId,
          sadmission: r.admissionNo,
          sname: r.name,
          srollno: r.rollNo == null ? '' : String(r.rollNo),
          marks: r.marks ?? '',
          absent: r.absent ? '1' : '0',
        })),
      };
    } catch (error) {
      if (error instanceof DomainError)
        return { ...fail(error.message), info_student: [], EntryLockStatus: '1' };
      throw error;
    }
  }

  async submitMarks(ctx: RequestContext, body: SubmitMarkEntryDto) {
    const subject = body.subject_code ?? body.subject_name ?? '';
    try {
      const ids = await this.examAndSubject(ctx, body.class, body.exam_type, subject);
      // legacy rows carry admission numbers or ids; resolve both
      const map = await this.db.tenant(requireTenant(ctx), (c) =>
        c.query<{ id: string; admission_no: string }>(
          `SELECT id::text, admission_no FROM students WHERE (id::text = ANY($1::text[]) OR admission_no = ANY($1::text[])) AND deleted_at IS NULL`,
          [body.data.map((d) => d.student_id)],
        ),
      );
      const byKey = new Map<string, string>();
      for (const s of map.rows) {
        byKey.set(s.id, s.id);
        byKey.set(s.admission_no, s.id);
      }
      const rows = body.data
        .map((d) => {
          const studentId = byKey.get(d.student_id);
          if (!studentId) return null;
          const absent =
            d.absent === true ||
            d.absent === '1' ||
            d.absent === 'true' ||
            d.absent === 'AB' ||
            d.marks === 'AB';
          const n = d.marks === undefined || d.marks === '' || absent ? null : Number(d.marks);
          return {
            studentId,
            marks: n === null || Number.isNaN(n) ? null : n,
            absent,
            exempt: false,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);
      if (!rows.length) return { status: false, msg: 'No matching students' };
      const r = await this.examEntry.putMarks(ctx, ids.examId, {
        classSectionId: ids.sectionId,
        subjectId: ids.subjectId,
        rows,
      } as PutMarksDto);
      return { status: true, msg: `Saved ${r.inserted + r.updated} marks` };
    } catch (error) {
      if (error instanceof DomainError) return { status: false, msg: error.message };
      throw error;
    }
  }

  async assignments(ctx: RequestContext, q: AssignmentQueryDto) {
    const yearId = this.year(ctx);
    const v = await this.viewer.resolve(ctx, 'academics.daily_work.view');
    const ids =
      v.kind === 'family'
        ? v.students.map((s) => s.classSectionId).filter((x): x is string => !!x)
        : v.sectionIds;
    const from = q.date_from ? toIso(q.date_from) : null;
    const to = q.date_to ? toIso(q.date_to) : null;
    const r = await this.db.tenant(requireTenant(ctx), async (c) => {
      let sectionIds = ids;
      if (q.class) {
        const sec = await this.section(c, yearId, q.class);
        sectionIds = sec ? [sec.id] : [];
      }
      return c.query<Row>(
        `SELECT d.assigned_on::text, d.due_on::text, d.title, d.body, s.name AS subject, k.code || '-' || cs.name AS section
           FROM daily_work d LEFT JOIN subjects s ON s.id = d.subject_id JOIN class_sections cs ON cs.id = d.class_section_id JOIN classes k ON k.id = cs.class_id
          WHERE d.deleted_at IS NULL AND d.kind = 'assignment' AND d.academic_year_id = $1
            AND ($2::bigint[] IS NULL OR d.class_section_id = ANY($2::bigint[]))
            AND ($3::date IS NULL OR d.assigned_on >= $3::date) AND ($4::date IS NULL OR d.assigned_on <= $4::date)
          ORDER BY d.assigned_on DESC LIMIT 100`,
        [yearId, sectionIds, from, to],
      );
    });
    return {
      status: true,
      info_student: r.rows.map((x) => ({
        assignmentdate: dmy(x.assigned_on),
        assignmentcompletiondate: dmy(x.due_on ?? ''),
        remark: `${String(x.title)}${x.body ? `: ${String(x.body)}` : ''}`,
        assignmentURL: '',
        image_status: '0',
        subject: String(x.subject ?? ''),
        class: String(x.section),
      })),
    };
  }

  staffLeaveStub() {
    return {
      status: false,
      info: 'Staff leave is handled on the staff portal until the HR module (Release 2)',
    };
  }

  // ---- before sign-in ------------------------------------------------------------------------------
  async appVersion(q: AppVersionDto) {
    const platform = (q.platform ?? 'android').toLowerCase().includes('ios') ? 'ios' : 'android';
    let current = '1.0.0';
    let floor = '0.0.0';
    if (q.school_id) {
      const rows = await this.settings.current({
        schoolId: q.school_id,
        userId: null,
        allowedSchoolIds: [q.school_id],
      });
      current = String(
        rows.find((s) => s.key === `compat.app_version_${platform}`)?.value ?? current,
      );
      floor = String(rows.find((s) => s.key === 'compat.app_force_below')?.value ?? floor);
    }
    const cmp = (a: string, b: string) => {
      const x = a.split('.').map(Number);
      const y = b.split('.').map(Number);
      for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
        const d = (x[i] ?? 0) - (y[i] ?? 0);
        if (d !== 0) return d;
      }
      return 0;
    };
    const installed = q.versioncode ?? '';
    const force = installed !== '' && cmp(installed, floor) < 0;
    const update = installed !== '' && cmp(installed, current) < 0;
    return {
      isview: '1',
      version: current,
      message: force
        ? 'Please update the app to continue'
        : update
          ? 'A new version of the app is available'
          : '',
      forceupdate: force ? '1' : '0',
      versionupdate: update ? '1' : '0',
      error: '',
    };
  }
}
