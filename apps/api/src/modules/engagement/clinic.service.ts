/* eslint-disable no-restricted-syntax -- the interpolations in this file are constant fragments (SELECTs, time zone, today, WHERE pieces with numbered placeholders); every value is bound */
import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { ViewerService } from '../academics/daily/viewer.service';
import {
  CHECKUP_FIELDS,
  CLINIC,
  FINDING_KEYS,
  type CampDto,
  type CheckupDto,
  type ClinicSettingsDto,
  type ExportVisitsDto,
  type ListVisitsDto,
  type MasterDto,
  type MedicineDto,
  type PeopleQueryDto,
  type StockInDto,
  type VisitDto,
  type WriteOffDto,
} from './clinic.dto';
import { healthCardPdf } from './health-card';
import { templateStatus } from './template-status';

type Row = Record<string, unknown>;
const TZ = `'Asia/Kolkata'`;
const TODAY = `(now() AT TIME ZONE ${TZ})::date`;
const DAY = (col: string) => `(${col} AT TIME ZONE ${TZ})::date`;
const iso = (d: unknown): string | null => (d instanceof Date ? d.toISOString() : null);
const text = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const n = (v: unknown) => Number(v ?? 0);
const EXPORT_MAX = 10000;
const ist = (v: string | null) =>
  v
    ? new Date(v).toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';
const OUTCOME_LABEL: Record<string, string> = {
  back_to_class: 'Back to class / work',
  rest: 'Rested in the clinic',
  sent_home: 'Sent home',
  referred: 'Referred',
};
const SECTION = (studentCol: string) =>
  `(SELECT k.code || '-' || cs.name FROM enrolments en JOIN class_sections cs ON cs.id = en.class_section_id JOIN classes k ON k.id = cs.class_id
     WHERE en.student_id = ${studentCol} AND en.status = 'active' ORDER BY en.academic_year_id DESC LIMIT 1)`;

const VISIT = `SELECT v.id::text, COALESCE(v.number, 'CV-' || v.id::text) AS number, v.audience, v.student_id::text, s.display_name AS student, s.admission_no,
       ${SECTION('s.id')} AS section, v.employee_id::text, e.display_name AS employee, e.employee_code, e.designation, e.department,
       v.in_at, v.out_at, v.complaint, v.disease_ids::text[] AS disease_ids,
       ARRAY(SELECT d.name FROM clinic_masters d WHERE d.id = ANY(v.disease_ids) ORDER BY d.name) AS diseases,
       v.temperature_c::float AS temperature_c, v.pulse, v.bp, v.spo2, v.weight_kg::float AS weight_kg, v.diagnosis, v.treatment, v.prescription,
       v.remark, v.outcome, v.referred_to, v.notified_at, v.clinic_id::text, cl.name AS clinic, v.doctor_id::text, doc.name AS doctor,
       v.nurse_id::text, nu.name AS nurse, COALESCE((SELECT ae.display_name FROM employees ae WHERE ae.user_id = v.attended_by LIMIT 1), au.display_name) AS recorded_by,
       COALESCE((SELECT jsonb_agg(jsonb_build_object('id', vm.id::text, 'medicineId', vm.medicine_id::text, 'name', m.name, 'strength', m.strength,
                         'unit', m.unit, 'qty', vm.qty, 'dosage', vm.dosage) ORDER BY vm.id)
                   FROM clinic_visit_medicines vm JOIN clinic_medicines m ON m.id = vm.medicine_id WHERE vm.visit_id = v.id), '[]'::jsonb) AS medicines
  FROM clinic_visits v
  LEFT JOIN students s ON s.id = v.student_id
  LEFT JOIN employees e ON e.id = v.employee_id
  LEFT JOIN clinic_masters cl ON cl.id = v.clinic_id
  LEFT JOIN clinic_masters doc ON doc.id = v.doctor_id
  LEFT JOIN clinic_masters nu ON nu.id = v.nurse_id
  LEFT JOIN users au ON au.id = v.attended_by`;
const VISIT_FROM = `FROM clinic_visits v LEFT JOIN students s ON s.id = v.student_id LEFT JOIN employees e ON e.id = v.employee_id`;

export interface VisitRow {
  id: string;
  number: string;
  audience: 'student' | 'staff';
  studentId: string | null;
  student: string | null;
  admissionNo: string | null;
  section: string | null;
  employeeId: string | null;
  employee: string | null;
  employeeCode: string | null;
  designation: string | null;
  department: string | null;
  who: string;
  inAt: string;
  outAt: string | null;
  complaint: string;
  diseaseIds: string[];
  diseases: string[];
  temperatureC: number | null;
  pulse: number | null;
  bp: string | null;
  spo2: number | null;
  weightKg: number | null;
  diagnosis: string | null;
  treatment: string | null;
  prescription: string | null;
  remark: string | null;
  outcome: string;
  outcomeLabel: string;
  referredTo: string | null;
  notifiedAt: string | null;
  clinicId: string | null;
  clinic: string | null;
  doctorId: string | null;
  doctor: string | null;
  nurseId: string | null;
  nurse: string | null;
  recordedBy: string | null;
  medicines: Array<{
    id: string;
    medicineId: string;
    name: string;
    strength: string | null;
    unit: string;
    qty: number;
    dosage: string | null;
  }>;
}
const toVisit = (x: Row): VisitRow => ({
  id: String(x.id),
  number: String(x.number),
  audience: x.audience as 'student' | 'staff',
  studentId: text(x.student_id),
  student: text(x.student),
  admissionNo: text(x.admission_no),
  section: text(x.section),
  employeeId: text(x.employee_id),
  employee: text(x.employee),
  employeeCode: text(x.employee_code),
  designation: text(x.designation),
  department: text(x.department),
  who:
    x.audience === 'student'
      ? `${String(x.student ?? '')}${x.section ? ` (${String(x.section)})` : ''}${x.admission_no ? ` · Adm. no. ${String(x.admission_no)}` : ''}`
      : `${String(x.employee ?? '')}${x.employee_code ? ` · ${String(x.employee_code)}` : ''}`,
  inAt: iso(x.in_at)!,
  outAt: iso(x.out_at),
  complaint: String(x.complaint),
  diseaseIds: (x.disease_ids as string[] | null) ?? [],
  diseases: (x.diseases as string[] | null) ?? [],
  temperatureC: num(x.temperature_c),
  pulse: num(x.pulse),
  bp: text(x.bp),
  spo2: num(x.spo2),
  weightKg: num(x.weight_kg),
  diagnosis: text(x.diagnosis),
  treatment: text(x.treatment),
  prescription: text(x.prescription),
  remark: text(x.remark),
  outcome: String(x.outcome),
  outcomeLabel: OUTCOME_LABEL[String(x.outcome)] ?? String(x.outcome),
  referredTo: text(x.referred_to),
  notifiedAt: iso(x.notified_at),
  clinicId: text(x.clinic_id),
  clinic: text(x.clinic),
  doctorId: text(x.doctor_id),
  doctor: text(x.doctor),
  nurseId: text(x.nurse_id),
  nurse: text(x.nurse),
  recordedBy: text(x.recorded_by),
  medicines: (x.medicines as VisitRow['medicines'] | null) ?? [],
});

const CHECKUP = `SELECT h.id::text, h.camp_id::text, c.name AS camp, h.student_id::text, s.display_name AS student, s.admission_no, s.dob::text AS dob,
       (SELECT k.code || '-' || cs.name FROM class_sections cs JOIN classes k ON k.id = cs.class_id WHERE cs.id = h.class_section_id) AS section,
       h.exam_date::text, h.doctor_id::text, d.name AS doctor, COALESCE(h.place, c.place) AS place, h.height_cm::float AS height_cm, h.weight_kg::float AS weight_kg,
       CASE WHEN h.height_cm > 0 AND h.weight_kg IS NOT NULL THEN round(h.weight_kg / ((h.height_cm / 100) * (h.height_cm / 100)), 1)::float END AS bmi,
       h.blood_group, h.findings, h.disease_id::text, dis.name AS disease, h.description, h.remarks, h.needs_attention, h.status, h.published_at
  FROM health_checkups h JOIN health_camps c ON c.id = h.camp_id JOIN students s ON s.id = h.student_id
  LEFT JOIN clinic_masters d ON d.id = COALESCE(h.doctor_id, c.doctor_id) LEFT JOIN clinic_masters dis ON dis.id = h.disease_id`;
export interface CheckupRow {
  id: string;
  campId: string;
  camp: string;
  studentId: string;
  student: string;
  admissionNo: string | null;
  dob: string | null;
  section: string | null;
  examDate: string;
  doctorId: string | null;
  doctor: string | null;
  place: string | null;
  heightCm: number | null;
  weightKg: number | null;
  bmi: number | null;
  bloodGroup: string | null;
  findings: Record<string, string>;
  diseaseId: string | null;
  disease: string | null;
  description: string | null;
  remarks: string | null;
  needsAttention: boolean;
  status: 'draft' | 'published';
  publishedAt: string | null;
}
const toCheckup = (x: Row): CheckupRow => ({
  id: String(x.id),
  campId: String(x.camp_id),
  camp: String(x.camp),
  studentId: String(x.student_id),
  student: String(x.student),
  admissionNo: text(x.admission_no),
  dob: text(x.dob),
  section: text(x.section),
  examDate: String(x.exam_date),
  doctorId: text(x.doctor_id),
  doctor: text(x.doctor),
  place: text(x.place),
  heightCm: num(x.height_cm),
  weightKg: num(x.weight_kg),
  bmi: num(x.bmi),
  bloodGroup: text(x.blood_group),
  findings: (x.findings as Record<string, string> | null) ?? {},
  diseaseId: text(x.disease_id),
  disease: text(x.disease),
  description: text(x.description),
  remarks: text(x.remarks),
  needsAttention: Boolean(x.needs_attention),
  status: x.status as 'draft' | 'published',
  publishedAt: iso(x.published_at),
});

/**
 * Clinic management (0075): the set-up (clinics, doctors, nurses, diseases, medicines), medicine stock by
 * batch, clinic visits of pupils and staff with what was found and given, health check-up camps with a
 * card per pupil that the doctor publishes class by class, the family's view, and the figures for the
 * reports and the dashboard.
 */
@Injectable()
export class ClinicService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly viewer: ViewerService,
  ) {}

  // ---- set-up ---------------------------------------------------------------------------------------
  private async settings(c: PoolClient) {
    await c.query(
      `INSERT INTO clinic_settings (school_id) VALUES (app.current_school_id()) ON CONFLICT (school_id) DO NOTHING`,
    );
    const r = await c.query<Row>(
      `SELECT checkup_hidden, expiry_alert_days, card_note FROM clinic_settings WHERE school_id = app.current_school_id()`,
    );
    const x = r.rows[0]!;
    return {
      checkupHidden: (x.checkup_hidden as string[]) ?? [],
      expiryAlertDays: Number(x.expiry_alert_days),
      cardNote: text(x.card_note),
    };
  }

  private async masters(c: PoolClient, onlyActive = false) {
    const r = await c.query<Row>(
      `SELECT m.id::text, m.kind, m.name, m.qualification, m.reg_no, m.mobile, m.employee_id::text, e.display_name AS employee, m.note, m.status::text,
              m.sort_order,
              CASE m.kind WHEN 'disease' THEN (SELECT count(*) FROM clinic_visits v WHERE m.id = ANY(v.disease_ids))
                          WHEN 'doctor' THEN (SELECT count(*) FROM clinic_visits v WHERE v.doctor_id = m.id)
                          WHEN 'nurse' THEN (SELECT count(*) FROM clinic_visits v WHERE v.nurse_id = m.id)
                          ELSE (SELECT count(*) FROM clinic_visits v WHERE v.clinic_id = m.id) END::int AS used
         FROM clinic_masters m LEFT JOIN employees e ON e.id = m.employee_id
        WHERE ($1::boolean IS FALSE OR m.status = 'active') ORDER BY m.kind, m.sort_order, m.name`,
      [onlyActive],
    );
    return r.rows.map((x) => ({
      id: String(x.id),
      kind: String(x.kind),
      name: String(x.name),
      qualification: text(x.qualification),
      regNo: text(x.reg_no),
      mobile: text(x.mobile),
      employeeId: text(x.employee_id),
      employee: text(x.employee),
      note: text(x.note),
      active: x.status === 'active',
      sortOrder: Number(x.sort_order),
      used: n(x.used),
    }));
  }

  /** Medicines with what is in stock now (expired batches apart) and the nearest expiry. */
  private async medicines(c: PoolClient, onlyActive = false) {
    const r = await c.query<Row>(
      `SELECT m.id::text, m.name, m.form, m.strength, m.unit, m.low_stock_at, m.status::text,
              COALESCE((SELECT sum(k.qty_left) FROM clinic_stock k WHERE k.medicine_id = m.id AND (k.expiry_on IS NULL OR k.expiry_on >= ${TODAY})), 0)::int AS stock,
              COALESCE((SELECT sum(k.qty_left) FROM clinic_stock k WHERE k.medicine_id = m.id AND k.expiry_on < ${TODAY}), 0)::int AS expired,
              (SELECT min(k.expiry_on)::text FROM clinic_stock k WHERE k.medicine_id = m.id AND k.qty_left > 0 AND k.expiry_on >= ${TODAY}) AS next_expiry
         FROM clinic_medicines m WHERE ($1::boolean IS FALSE OR m.status = 'active') ORDER BY m.name, m.strength`,
      [onlyActive],
    );
    return r.rows.map((x) => ({
      id: String(x.id),
      name: String(x.name),
      form: String(x.form),
      strength: text(x.strength),
      unit: String(x.unit),
      lowStockAt: Number(x.low_stock_at),
      active: x.status === 'active',
      stock: n(x.stock),
      expired: n(x.expired),
      nextExpiry: text(x.next_expiry),
      low: n(x.stock) <= Number(x.low_stock_at),
    }));
  }

  async setup(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const staff = await c.query<{ id: string; name: string }>(
        `SELECT id::text, display_name || COALESCE(' · ' || designation, '') || COALESCE(' · ' || employee_code, '') AS name FROM employees
          WHERE status = 'active' AND deleted_at IS NULL ORDER BY display_name LIMIT 3000`,
      );
      return {
        settings: await this.settings(c),
        masters: await this.masters(c),
        medicines: await this.medicines(c),
        fields: CHECKUP_FIELDS,
        staff: staff.rows,
        templates: await templateStatus(c, 'clinic'),
      };
    });
  }

  /** What the visit and check-up forms pick from. */
  async options(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => ({
      settings: await this.settings(c),
      masters: await this.masters(c, true),
      medicines: await this.medicines(c, true),
      fields: CHECKUP_FIELDS,
    }));
  }

  async saveSettings(ctx: RequestContext, dto: ClinicSettingsDto) {
    await this.db.tenant(requireTenant(ctx), async (c) => {
      await this.settings(c);
      await c.query(
        `UPDATE clinic_settings SET checkup_hidden = $1, expiry_alert_days = $2, card_note = $3, updated_at = now(), updated_by = app.current_user_id()
          WHERE school_id = app.current_school_id()`,
        [[...new Set(dto.checkupHidden)], dto.expiryAlertDays, dto.cardNote ?? null],
      );
    });
    return this.setup(ctx);
  }

  async saveMaster(ctx: RequestContext, id: string | null, dto: MasterDto) {
    await this.db.tenant(requireTenant(ctx), async (c) => {
      const values = [
        dto.kind,
        dto.name,
        dto.qualification ?? null,
        dto.regNo ?? null,
        dto.mobile ?? null,
        ['doctor', 'nurse'].includes(dto.kind) ? (dto.employeeId ?? null) : null,
        dto.note ?? null,
        dto.active ? 'active' : 'inactive',
        dto.sortOrder,
      ];
      const r = await (
        id
          ? c.query<{ id: string }>(
              `UPDATE clinic_masters SET name = $2, qualification = $3, reg_no = $4, mobile = $5, employee_id = $6, note = $7, status = $8::row_status,
                    sort_order = $9, updated_at = now() WHERE id = $10 AND kind = $1 RETURNING id::text`,
              [...values, id],
            )
          : c.query<{ id: string }>(
              `INSERT INTO clinic_masters (school_id, kind, name, qualification, reg_no, mobile, employee_id, note, status, sort_order, created_by)
             VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, $8::row_status, $9, app.current_user_id()) RETURNING id::text`,
              values,
            )
      ).catch((e: { code?: string }) => {
        if (e.code === '23505')
          throw new DomainError('conflict', `"${dto.name}" is already on the list`, {
            status: 409,
          });
        throw e;
      });
      if (!r.rows[0]) throw new DomainError('not-found', 'Entry not found', { status: 404 });
      await this.audit.stage(ctx, c, {
        action: `engagement.clinic_setup.${id ? 'update' : 'create'}`,
        entityType: 'clinic_masters',
        entityId: r.rows[0].id,
        after: dto,
      });
    });
    return this.setup(ctx);
  }

  async saveMedicine(ctx: RequestContext, id: string | null, dto: MedicineDto) {
    await this.db.tenant(requireTenant(ctx), async (c) => {
      const values = [
        dto.name,
        dto.form,
        dto.strength ?? null,
        dto.unit,
        dto.lowStockAt,
        dto.active ? 'active' : 'inactive',
      ];
      const r = await (
        id
          ? c.query<{ id: string }>(
              `UPDATE clinic_medicines SET name = $1, form = $2, strength = $3, unit = $4, low_stock_at = $5, status = $6::row_status, updated_at = now()
              WHERE id = $7 RETURNING id::text`,
              [...values, id],
            )
          : c.query<{ id: string }>(
              `INSERT INTO clinic_medicines (school_id, name, form, strength, unit, low_stock_at, status, created_by)
             VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6::row_status, app.current_user_id()) RETURNING id::text`,
              values,
            )
      ).catch((e: { code?: string }) => {
        if (e.code === '23505')
          throw new DomainError('conflict', `"${dto.name}" is already on the list`, {
            status: 409,
          });
        throw e;
      });
      if (!r.rows[0]) throw new DomainError('not-found', 'Medicine not found', { status: 404 });
    });
    return this.setup(ctx);
  }

  // ---- medicine stock -------------------------------------------------------------------------------
  /** Every medicine with its batches, the alerts, and the last movements. */
  async stock(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const s = await this.settings(c);
      const batches = await c.query<Row>(
        `SELECT k.id::text, k.medicine_id::text, k.batch_no, k.expiry_on::text, k.qty_in, k.qty_left, k.received_on::text, k.supplier, k.note,
                (k.expiry_on < ${TODAY}) AS expired, (k.expiry_on >= ${TODAY} AND k.expiry_on <= ${TODAY} + $1::int) AS expiring
           FROM clinic_stock k WHERE k.qty_left > 0 ORDER BY k.expiry_on NULLS LAST, k.id`,
        [s.expiryAlertDays],
      );
      const moves = await c.query<Row>(
        `SELECT mv.id::text, m.name, m.strength, m.unit, mv.kind, mv.qty, mv.note, mv.at, mv.visit_id::text,
                COALESCE((SELECT e.display_name FROM employees e WHERE e.user_id = mv.by_user LIMIT 1), u.display_name) AS by_name
           FROM clinic_stock_moves mv JOIN clinic_medicines m ON m.id = mv.medicine_id LEFT JOIN users u ON u.id = mv.by_user
          ORDER BY mv.id DESC LIMIT 60`,
      );
      return {
        expiryAlertDays: s.expiryAlertDays,
        medicines: await this.medicines(c),
        batches: batches.rows.map((x) => ({
          id: String(x.id),
          medicineId: String(x.medicine_id),
          batchNo: text(x.batch_no),
          expiryOn: text(x.expiry_on),
          qtyIn: n(x.qty_in),
          qtyLeft: n(x.qty_left),
          receivedOn: String(x.received_on),
          supplier: text(x.supplier),
          note: text(x.note),
          expired: Boolean(x.expired),
          expiring: Boolean(x.expiring),
        })),
        moves: moves.rows.map((x) => ({
          id: String(x.id),
          medicine: `${String(x.name)}${x.strength ? ` ${String(x.strength)}` : ''}`,
          unit: String(x.unit),
          kind: String(x.kind),
          qty: n(x.qty),
          note: text(x.note),
          at: iso(x.at)!,
          visitId: text(x.visit_id),
          by: text(x.by_name),
        })),
      };
    });
  }

  async receiveStock(ctx: RequestContext, dto: StockInDto) {
    await this.db.tenant(requireTenant(ctx), async (c) => {
      const m = await c.query(`SELECT 1 FROM clinic_medicines WHERE id = $1`, [dto.medicineId]);
      if (!m.rowCount) throw new DomainError('not-found', 'Medicine not found', { status: 404 });
      const r = await c.query<{ id: string }>(
        `INSERT INTO clinic_stock (school_id, medicine_id, batch_no, expiry_on, qty_in, qty_left, received_on, supplier, note, created_by)
         VALUES (app.current_school_id(), $1, $2, $3::date, $4, $4, COALESCE($5::date, ${TODAY}), $6, $7, app.current_user_id()) RETURNING id::text`,
        [
          dto.medicineId,
          dto.batchNo ?? null,
          dto.expiryOn ?? null,
          dto.qty,
          dto.receivedOn ?? null,
          dto.supplier ?? null,
          dto.note ?? null,
        ],
      );
      await c.query(
        `INSERT INTO clinic_stock_moves (school_id, medicine_id, stock_id, kind, qty, note, by_user)
         VALUES (app.current_school_id(), $1, $2, 'received', $3, $4, app.current_user_id())`,
        [dto.medicineId, r.rows[0]!.id, dto.qty, dto.supplier ?? dto.note ?? null],
      );
      await this.audit.stage(ctx, c, {
        action: 'engagement.clinic.stock_in',
        entityType: 'clinic_stock',
        entityId: r.rows[0]!.id,
        after: dto,
      });
    });
    return this.stock(ctx);
  }

  /** Expired, damaged or lost stock is written off with the reason. */
  async writeOff(ctx: RequestContext, dto: WriteOffDto) {
    await this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{ medicine_id: string }>(
        `UPDATE clinic_stock SET qty_left = qty_left - $2 WHERE id = $1 AND qty_left >= $2 RETURNING medicine_id::text`,
        [dto.stockId, dto.qty],
      );
      if (!r.rows[0])
        throw new DomainError('conflict', 'This batch does not hold that many', { status: 409 });
      await c.query(
        `INSERT INTO clinic_stock_moves (school_id, medicine_id, stock_id, kind, qty, note, by_user)
         VALUES (app.current_school_id(), $1, $2, 'written_off', $3, $4, app.current_user_id())`,
        [r.rows[0].medicine_id, dto.stockId, dto.qty, dto.note],
      );
      await this.audit.stage(ctx, c, {
        action: 'engagement.clinic.stock_write_off',
        entityType: 'clinic_stock',
        entityId: dto.stockId,
        after: dto,
      });
    });
    return this.stock(ctx);
  }

  /** Takes a medicine from the batches that expire first; refuses when the shelf is short. */
  private async give(c: PoolClient, visitId: string, medicineId: string, qty: number) {
    const m = await c.query<{ name: string }>(
      `SELECT name FROM clinic_medicines WHERE id = $1 AND status = 'active'`,
      [medicineId],
    );
    if (!m.rows[0]) throw new DomainError('not-found', 'Medicine not found', { status: 404 });
    const batches = await c.query<{ id: string; qty_left: number }>(
      `SELECT id::text, qty_left FROM clinic_stock WHERE medicine_id = $1 AND qty_left > 0 AND (expiry_on IS NULL OR expiry_on >= ${TODAY})
        ORDER BY expiry_on NULLS LAST, id FOR UPDATE`,
      [medicineId],
    );
    const have = batches.rows.reduce((a, b) => a + Number(b.qty_left), 0);
    if (have < qty)
      throw new DomainError(
        'clinic.no_stock',
        `Only ${String(have)} of ${m.rows[0].name} in stock (not expired); receive stock first or give less`,
        { status: 409 },
      );
    let left = qty;
    for (const b of batches.rows) {
      if (left <= 0) break;
      const take = Math.min(left, Number(b.qty_left));
      await c.query(`UPDATE clinic_stock SET qty_left = qty_left - $2 WHERE id = $1`, [b.id, take]);
      await c.query(
        `INSERT INTO clinic_stock_moves (school_id, medicine_id, stock_id, kind, qty, visit_id, by_user)
         VALUES (app.current_school_id(), $1, $2, 'given', $3, $4, app.current_user_id())`,
        [medicineId, b.id, take, visitId],
      );
      left -= take;
    }
  }

  // ---- visits ---------------------------------------------------------------------------------------
  /** Pupils by name or admission number, staff by name or code, with what the clinic should know. */
  async people(ctx: RequestContext, q: PeopleQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r =
        q.audience === 'student'
          ? await c.query<Row>(
              `SELECT s.id::text, s.display_name AS name, s.admission_no AS code, ${SECTION('s.id')} AS detail,
                      (SELECT h.blood_group FROM health_checkups h WHERE h.student_id = s.id AND h.blood_group IS NOT NULL ORDER BY h.exam_date DESC LIMIT 1) AS blood_group,
                      (SELECT count(*) FROM clinic_visits v WHERE v.student_id = s.id AND v.in_at > now() - interval '90 days')::int AS visits_90
                 FROM students s WHERE s.deleted_at IS NULL AND (s.admission_no ILIKE $1 || '%' OR s.display_name ILIKE '%' || $1 || '%')
                ORDER BY (lower(s.admission_no) = lower($1)) DESC, s.display_name LIMIT 12`,
              [q.q],
            )
          : await c.query<Row>(
              `SELECT e.id::text, e.display_name AS name, e.employee_code AS code, concat_ws(' · ', e.designation, e.department) AS detail,
                      NULL::text AS blood_group,
                      (SELECT count(*) FROM clinic_visits v WHERE v.employee_id = e.id AND v.in_at > now() - interval '90 days')::int AS visits_90
                 FROM employees e WHERE e.deleted_at IS NULL AND e.status = 'active'
                  AND (e.employee_code ILIKE $1 || '%' OR e.display_name ILIKE '%' || $1 || '%')
                ORDER BY (lower(e.employee_code) = lower($1)) DESC, e.display_name LIMIT 12`,
              [q.q],
            );
      return {
        data: r.rows.map((x) => ({
          id: String(x.id),
          name: String(x.name),
          code: text(x.code),
          detail: text(x.detail),
          bloodGroup: text(x.blood_group),
          visits90: n(x.visits_90),
        })),
      };
    });
  }

  /** The clinic history of one person: visits, and for a pupil the check-ups too. */
  async history(ctx: RequestContext, audience: 'student' | 'staff', id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const v = await c.query<Row>(
        `${VISIT} WHERE ${audience === 'student' ? 'v.student_id' : 'v.employee_id'} = $1 ORDER BY v.in_at DESC LIMIT 30`,
        [id],
      );
      const h =
        audience === 'student'
          ? await c.query<Row>(
              `${CHECKUP} WHERE h.student_id = $1 ORDER BY h.exam_date DESC LIMIT 10`,
              [id],
            )
          : { rows: [] as Row[] };
      return { visits: v.rows.map(toVisit), checkups: h.rows.map(toCheckup) };
    });
  }

  private async findVisit(c: PoolClient, id: string): Promise<VisitRow> {
    const r = await c.query<Row>(`${VISIT} WHERE v.id = $1`, [id]);
    if (!r.rows[0]) throw new DomainError('not-found', 'Clinic visit not found', { status: 404 });
    return toVisit(r.rows[0]);
  }

  async visit(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => this.findVisit(c, id));
  }

  async createVisit(ctx: RequestContext, dto: VisitDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const who =
        dto.audience === 'student'
          ? await c.query(`SELECT 1 FROM students WHERE id = $1 AND deleted_at IS NULL`, [
              dto.studentId,
            ])
          : await c.query(`SELECT 1 FROM employees WHERE id = $1 AND deleted_at IS NULL`, [
              dto.employeeId,
            ]);
      if (!who.rowCount)
        throw new DomainError(
          'not-found',
          `${dto.audience === 'student' ? 'Student' : 'Employee'} not found`,
          {
            status: 404,
          },
        );
      const stamp = (t?: string) =>
        t
          ? `(COALESCE($17::date, ${TODAY})::text || ' ' || '${t}' || ':00+05:30')::timestamptz`
          : null;
      // the times are validated HH:MM by the request schema, so they are safe to place in the SQL
      const r = await c.query<{ id: string }>(
        `INSERT INTO clinic_visits (school_id, audience, student_id, employee_id, clinic_id, doctor_id, nurse_id, complaint, disease_ids, temperature_c,
                                    pulse, bp, spo2, weight_kg, diagnosis, treatment, prescription, remark, outcome, referred_to, sent_home,
                                    in_at, out_at, attended_by, request_id)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, $8::bigint[], $9, $10, $11, $12, $13, $14, $15, $16, $18, $19, $20, $19::text = 'sent_home',
                 ${stamp(dto.timeIn) ?? `CASE WHEN $17::date IS NULL OR $17::date = ${TODAY} THEN now() ELSE ($17::date::text || ' 09:00:00+05:30')::timestamptz END`},
                 ${stamp(dto.timeOut) ?? 'NULL'}, app.current_user_id(), app.current_request_id())
         RETURNING id::text`,
        [
          dto.audience,
          dto.audience === 'student' ? dto.studentId : null,
          dto.audience === 'staff' ? dto.employeeId : null,
          dto.clinicId ?? null,
          dto.doctorId ?? null,
          dto.nurseId ?? null,
          dto.complaint,
          dto.diseaseIds,
          dto.temperatureC ?? null,
          dto.pulse ?? null,
          dto.bp ?? null,
          dto.spo2 ?? null,
          dto.weightKg ?? null,
          dto.diagnosis ?? null,
          dto.treatment ?? null,
          dto.prescription ?? null,
          dto.onDate ?? null,
          dto.remark ?? null,
          dto.outcome,
          dto.outcome === 'referred' ? (dto.referredTo ?? null) : null,
        ],
      );
      const id = r.rows[0]!.id;
      await c.query(
        `UPDATE clinic_visits SET number = 'CV-' || to_char(in_at AT TIME ZONE ${TZ}, 'YYMM') || '-' || lpad(id::text, 4, '0') WHERE id = $1`,
        [id],
      );
      for (const m of dto.medicines) {
        await this.give(c, id, m.medicineId, m.qty);
        await c.query(
          `INSERT INTO clinic_visit_medicines (school_id, visit_id, medicine_id, qty, dosage) VALUES (app.current_school_id(), $1, $2, $3, $4)`,
          [id, m.medicineId, m.qty, m.dosage ?? null],
        );
      }
      const v = await this.findVisit(c, id);
      const notified = await this.tellFamily(c, v);
      await this.audit.stage(ctx, c, {
        action: 'engagement.clinic.visit',
        entityType: 'clinic_visits',
        entityId: id,
        after: {
          audience: dto.audience,
          outcome: dto.outcome,
          medicines: dto.medicines.length,
          notified,
        },
      });
      return { ...v, notified };
    });
  }

  /**
   * The parents hear when it matters: a medicine was given, the child is sent home, or referred. SMS and
   * WhatsApp go by the clinic templates (when ready), and an email with the details.
   */
  private async tellFamily(c: PoolClient, v: VisitRow): Promise<number> {
    if (v.audience !== 'student' || !v.studentId) return 0;
    if (!v.medicines.length && !['sent_home', 'referred'].includes(v.outcome)) return 0;
    const school = await c.query<{ name: string }>(
      `SELECT name FROM schools WHERE id = app.current_school_id()`,
    );
    const g = await c.query<{ mobile: string | null; email: string | null }>(
      `SELECT g.mobile, g.email::text FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
        WHERE sg.student_id = $1 AND sg.receives_notifications`,
      [v.studentId],
    );
    const given = v.medicines
      .map((m) => `${m.name}${m.strength ? ` ${m.strength}` : ''}`)
      .join(', ');
    const action =
      v.outcome === 'rest'
        ? `${given ? `Medicine given: ${given}. ` : ''}Resting in the clinic.`
        : given
          ? `Medicine given: ${given}.`
          : '';
    const code =
      v.outcome === 'referred'
        ? 'clinic_referred'
        : v.outcome === 'sent_home'
          ? 'clinic_sent_home'
          : 'clinic_visit';
    const sent = await c.query<{ n: number }>(
      `SELECT app.template_to_mobiles($1, $2::text[], $3::jsonb) AS n`,
      [
        code,
        g.rows.map((x) => x.mobile).filter(Boolean),
        JSON.stringify({
          who: v.student ?? '',
          time: new Date(v.inAt).toLocaleTimeString('en-IN', {
            timeZone: 'Asia/Kolkata',
            hour: '2-digit',
            minute: '2-digit',
          }),
          complaint: v.complaint,
          action,
          referred: v.referredTo ?? '',
          school: school.rows[0]?.name ?? '',
        }),
      ],
    );
    let count = n(sent.rows[0]?.n);
    const title =
      v.outcome === 'referred'
        ? 'Your child is referred to a doctor or hospital'
        : v.outcome === 'sent_home'
          ? 'Please collect your child from the school clinic'
          : 'Your child visited the school clinic';
    for (const email of [
      ...new Set(g.rows.map((x) => x.email).filter((e): e is string => Boolean(e))),
    ]) {
      const q = await c.query<{ id: string | null }>(
        `SELECT app.queue_mail($1, $2, app.mail_card_html($3, $4, $5, $6, $7::jsonb, NULL, NULL, NULL), '[]'::jsonb,
                               jsonb_build_object('clinicVisit', $8::text))::text AS id`,
        [
          email,
          `${title}: ${v.student ?? ''}`,
          school.rows[0]?.name ?? '',
          title,
          v.outcome === 'back_to_class' || v.outcome === 'rest' ? '#00265D' : '#B26A00',
          'This is what the school clinic recorded. The same shows under Health in the parent portal.',
          JSON.stringify([
            ['Student', v.who],
            ['Time', ist(v.inAt)],
            ['Complaint', v.complaint],
            ['Treatment', v.treatment],
            ['Medicine given', given || null],
            ['Advice', v.remark],
            ['Outcome', v.outcomeLabel],
            ['Referred to', v.referredTo],
            ['Seen by', [v.doctor, v.nurse].filter(Boolean).join(', ') || null],
          ]),
          v.id,
        ],
      );
      if (q.rows[0]?.id) count += 1;
    }
    if (count) await c.query(`UPDATE clinic_visits SET notified_at = now() WHERE id = $1`, [v.id]);
    return count;
  }

  /** The person leaves the clinic. */
  async closeVisit(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query(
        `UPDATE clinic_visits SET out_at = now() WHERE id = $1 AND out_at IS NULL`,
        [id],
      );
      if (!r.rowCount)
        throw new DomainError('conflict', 'This visit is already closed', { status: 409 });
      return this.findVisit(c, id);
    });
  }

  private visitWhere(q: ExportVisitsDto, params: unknown[]): string {
    const where: string[] = [];
    const dated = Boolean(q.from || q.to);
    if (q.tab === 'today' && !dated) where.push(`${DAY('v.in_at')} = ${TODAY}`);
    if (q.tab === 'in_clinic') where.push(`v.out_at IS NULL AND ${DAY('v.in_at')} = ${TODAY}`);
    const add = (sql: string, v: unknown) => {
      params.push(v);
      where.push(sql.replace('?', `$${String(params.length)}`));
    };
    if (q.audience) add(`v.audience = ?`, q.audience);
    if (q.outcome) add(`v.outcome = ?`, q.outcome);
    if (q.doctorId) add(`v.doctor_id = ?`, q.doctorId);
    if (q.diseaseId) add(`?::bigint = ANY(v.disease_ids)`, q.diseaseId);
    if (q.from) add(`${DAY('v.in_at')} >= ?::date`, q.from);
    if (q.to) add(`${DAY('v.in_at')} <= ?::date`, q.to);
    if (q.q)
      add(
        `concat_ws(' ', v.number, s.display_name, s.admission_no, e.display_name, e.employee_code, v.complaint, v.diagnosis) ILIKE '%' || ? || '%'`,
        q.q,
      );
    return where.length ? where.join(' AND ') : 'true';
  }

  async visits(ctx: RequestContext, q: ListVisitsDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const params: unknown[] = [];
      const w = this.visitWhere(q, params);
      const total = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n ${VISIT_FROM} WHERE ${w}`,
        params,
      );
      params.push(q.size, (q.page - 1) * q.size);
      const r = await c.query<Row>(
        `${VISIT} WHERE ${w} ORDER BY v.in_at DESC, v.id DESC LIMIT $${String(params.length - 1)} OFFSET $${String(params.length)}`,
        params,
      );
      const counts = await c.query<Row>(
        `SELECT count(*) FILTER (WHERE ${DAY('in_at')} = ${TODAY})::int AS today,
                count(*) FILTER (WHERE ${DAY('in_at')} = ${TODAY} AND out_at IS NULL)::int AS in_clinic FROM clinic_visits`,
      );
      return {
        data: r.rows.map(toVisit),
        page: { number: q.page, size: q.size, total: total.rows[0]?.n ?? 0 },
        counts: { today: n(counts.rows[0]?.today), inClinic: n(counts.rows[0]?.in_clinic) },
      };
    });
  }

  async visitsExcel(ctx: RequestContext, q: ExportVisitsDto) {
    const rows = await this.db.tenant(requireTenant(ctx), async (c) => {
      const params: unknown[] = [];
      const w = this.visitWhere(q, params);
      const r = await c.query<Row>(
        `${VISIT} WHERE ${w} ORDER BY v.in_at DESC, v.id DESC LIMIT ${String(EXPORT_MAX)}`,
        params,
      );
      return r.rows.map(toVisit);
    });
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Clinic visits');
    ws.addRow([`Clinic visits · ${String(rows.length)} row(s)`]).font = { bold: true };
    ws.addRow([
      'Visit no.',
      'For',
      'Name',
      'Admission no. / Emp. code',
      'Class / Department',
      'Time in',
      'Time out',
      'Complaint',
      'Disease',
      'Temp (°C)',
      'Pulse',
      'BP',
      'SpO2',
      'Diagnosis',
      'Treatment',
      'Medicines given',
      'Prescription',
      'Remark',
      'Outcome',
      'Referred to',
      'Doctor',
      'Nurse',
      'Clinic',
      'Parents told',
      'Recorded by',
    ]).font = { bold: true };
    for (const v of rows)
      ws.addRow([
        v.number,
        v.audience === 'student' ? 'Student' : 'Staff',
        v.student ?? v.employee ?? '',
        v.admissionNo ?? v.employeeCode ?? '',
        v.section ?? v.department ?? '',
        ist(v.inAt),
        ist(v.outAt),
        v.complaint,
        v.diseases.join(', '),
        v.temperatureC ?? '',
        v.pulse ?? '',
        v.bp ?? '',
        v.spo2 ?? '',
        v.diagnosis ?? '',
        v.treatment ?? '',
        v.medicines.map((m) => `${m.name} × ${String(m.qty)}`).join(', '),
        v.prescription ?? '',
        v.remark ?? '',
        v.outcomeLabel,
        v.referredTo ?? '',
        v.doctor ?? '',
        v.nurse ?? '',
        v.clinic ?? '',
        v.notifiedAt ? 'Yes' : '',
        v.recordedBy ?? '',
      ]);
    [
      14, 9, 24, 18, 16, 18, 18, 28, 22, 9, 7, 9, 7, 28, 28, 30, 30, 26, 20, 20, 18, 18, 14, 11, 18,
    ].forEach((w, i) => {
      ws.getColumn(i + 1).width = w;
    });
    ws.views = [{ state: 'frozen', ySplit: 2 }];
    const out = await wb.xlsx.writeBuffer();
    return {
      bytes: Buffer.from(out as ArrayBuffer),
      filename: `clinic-visits-${new Date().toISOString().slice(0, 10)}.xlsx`,
    };
  }

  // ---- health check-up camps ------------------------------------------------------------------------
  async camps(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<Row>(
        `SELECT c.id::text, c.name, c.starts_on::text, c.ends_on::text, c.doctor_id::text, d.name AS doctor, c.place, c.status,
                (SELECT count(*) FROM health_checkups h WHERE h.camp_id = c.id)::int AS examined,
                (SELECT count(*) FROM health_checkups h WHERE h.camp_id = c.id AND h.status = 'published')::int AS published,
                (SELECT count(*) FROM health_checkups h WHERE h.camp_id = c.id AND h.needs_attention)::int AS attention,
                (SELECT count(DISTINCT en.student_id) FROM enrolments en WHERE en.status = 'active'
                    AND en.academic_year_id = COALESCE(c.academic_year_id, app.current_academic_year_id()))::int AS pupils
           FROM health_camps c LEFT JOIN clinic_masters d ON d.id = c.doctor_id ORDER BY c.starts_on DESC, c.id DESC`,
      );
      return {
        data: r.rows.map((x) => ({
          id: String(x.id),
          name: String(x.name),
          startsOn: String(x.starts_on),
          endsOn: text(x.ends_on),
          doctorId: text(x.doctor_id),
          doctor: text(x.doctor),
          place: text(x.place),
          status: String(x.status),
          examined: n(x.examined),
          published: n(x.published),
          attention: n(x.attention),
          pupils: n(x.pupils),
        })),
      };
    });
  }

  async saveCamp(ctx: RequestContext, id: string | null, dto: CampDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const values = [
        dto.name,
        dto.startsOn,
        dto.endsOn ?? null,
        dto.doctorId ?? null,
        dto.place ?? null,
        dto.status,
      ];
      const r = id
        ? await c.query<{ id: string }>(
            `UPDATE health_camps SET name = $1, starts_on = $2::date, ends_on = $3::date, doctor_id = $4, place = $5, status = $6, updated_at = now()
              WHERE id = $7 RETURNING id::text`,
            [...values, id],
          )
        : await c.query<{ id: string }>(
            `INSERT INTO health_camps (school_id, academic_year_id, name, starts_on, ends_on, doctor_id, place, status, created_by)
             VALUES (app.current_school_id(), app.current_academic_year_id(), $1, $2::date, $3::date, $4, $5, $6, app.current_user_id()) RETURNING id::text`,
            values,
          );
      if (!r.rows[0]) throw new DomainError('not-found', 'Check-up not found', { status: 404 });
      await this.audit.stage(ctx, c, {
        action: `engagement.clinic.camp_${id ? 'update' : 'create'}`,
        entityType: 'health_camps',
        entityId: r.rows[0].id,
        after: dto,
      });
      return { id: r.rows[0].id };
    });
  }

  private async camp(c: PoolClient, id: string) {
    const r = await c.query<Row>(
      `SELECT c.id::text, c.name, c.starts_on::text, c.ends_on::text, c.doctor_id::text, d.name AS doctor, c.place, c.status,
              COALESCE(c.academic_year_id, app.current_academic_year_id())::text AS year_id
         FROM health_camps c LEFT JOIN clinic_masters d ON d.id = c.doctor_id WHERE c.id = $1`,
      [id],
    );
    if (!r.rows[0]) throw new DomainError('not-found', 'Check-up not found', { status: 404 });
    const x = r.rows[0];
    return {
      id: String(x.id),
      name: String(x.name),
      startsOn: String(x.starts_on),
      endsOn: text(x.ends_on),
      doctorId: text(x.doctor_id),
      doctor: text(x.doctor),
      place: text(x.place),
      status: String(x.status),
      yearId: String(x.year_id),
    };
  }

  /** One camp with every class and how far it is: enrolled, examined, published, needing attention. */
  async campDetail(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const camp = await this.camp(c, id);
      const r = await c.query<Row>(
        `SELECT cs.id::text, k.code || '-' || cs.name AS section, k.display_order,
                count(DISTINCT en.student_id)::int AS pupils,
                count(DISTINCT h.student_id)::int AS examined,
                count(DISTINCT h.student_id) FILTER (WHERE h.status = 'published')::int AS published,
                count(DISTINCT h.student_id) FILTER (WHERE h.needs_attention)::int AS attention
           FROM class_sections cs JOIN classes k ON k.id = cs.class_id
           JOIN enrolments en ON en.class_section_id = cs.id AND en.status = 'active' AND en.academic_year_id = $2
           LEFT JOIN health_checkups h ON h.camp_id = $1 AND h.student_id = en.student_id
          GROUP BY cs.id, k.code, cs.name, k.display_order ORDER BY k.display_order, cs.name`,
        [id, camp.yearId],
      );
      return {
        camp,
        sections: r.rows.map((x) => ({
          id: String(x.id),
          section: String(x.section),
          pupils: n(x.pupils),
          examined: n(x.examined),
          published: n(x.published),
          attention: n(x.attention),
        })),
      };
    });
  }

  /** The pupils of one class for one camp, each with the check-up as far as it is filled. */
  async campSection(ctx: RequestContext, id: string, sectionId: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const camp = await this.camp(c, id);
      const sec = await c.query<{ section: string }>(
        `SELECT k.code || '-' || cs.name AS section FROM class_sections cs JOIN classes k ON k.id = cs.class_id WHERE cs.id = $1`,
        [sectionId],
      );
      if (!sec.rows[0]) throw new DomainError('not-found', 'Class not found', { status: 404 });
      const pupils = await c.query<Row>(
        `SELECT s.id::text, s.display_name AS name, s.admission_no, en.roll_no, h.id::text AS checkup_id
           FROM enrolments en JOIN students s ON s.id = en.student_id AND s.deleted_at IS NULL
           LEFT JOIN health_checkups h ON h.camp_id = $1 AND h.student_id = s.id
          WHERE en.class_section_id = $2 AND en.status = 'active' AND en.academic_year_id = $3
          ORDER BY en.roll_no NULLS LAST, s.display_name`,
        [id, sectionId, camp.yearId],
      );
      const done = await c.query<Row>(
        `${CHECKUP} WHERE h.camp_id = $1 AND h.student_id = ANY($2::bigint[])`,
        [id, pupils.rows.map((x) => x.id)],
      );
      const by = new Map(done.rows.map(toCheckup).map((h) => [h.studentId, h]));
      return {
        camp,
        section: { id: sectionId, name: sec.rows[0].section },
        settings: await this.settings(c),
        pupils: pupils.rows.map((x) => ({
          id: String(x.id),
          name: String(x.name),
          admissionNo: text(x.admission_no),
          rollNo: text(x.roll_no),
          checkup: by.get(String(x.id)) ?? null,
        })),
      };
    });
  }

  async saveCheckup(ctx: RequestContext, campId: string, studentId: string, dto: CheckupDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const camp = await this.camp(c, campId);
      if (camp.status !== 'open')
        throw new DomainError('conflict', 'This check-up is closed; reopen it to change a card', {
          status: 409,
        });
      const en = await c.query<{ id: string }>(
        `SELECT en.class_section_id::text AS id FROM enrolments en WHERE en.student_id = $1 AND en.status = 'active' ORDER BY en.academic_year_id DESC LIMIT 1`,
        [studentId],
      );
      if (!en.rows[0]) throw new DomainError('not-found', 'Student not found', { status: 404 });
      const findings = Object.fromEntries(
        Object.entries(dto.findings).filter(([k, v]) => FINDING_KEYS.includes(k as never) && v),
      );
      const r = await c.query<{ id: string }>(
        `INSERT INTO health_checkups (school_id, camp_id, student_id, class_section_id, exam_date, doctor_id, place, height_cm, weight_kg, blood_group,
                                      findings, disease_id, description, remarks, needs_attention, created_by, updated_by)
         VALUES (app.current_school_id(), $1, $2, $3, COALESCE($4::date, ${TODAY}), $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, $14,
                 app.current_user_id(), app.current_user_id())
         ON CONFLICT (camp_id, student_id) DO UPDATE SET exam_date = EXCLUDED.exam_date, doctor_id = EXCLUDED.doctor_id, place = EXCLUDED.place,
              height_cm = EXCLUDED.height_cm, weight_kg = EXCLUDED.weight_kg, blood_group = EXCLUDED.blood_group, findings = EXCLUDED.findings,
              disease_id = EXCLUDED.disease_id, description = EXCLUDED.description, remarks = EXCLUDED.remarks,
              needs_attention = EXCLUDED.needs_attention, updated_at = now(), updated_by = app.current_user_id()
         RETURNING id::text`,
        [
          campId,
          studentId,
          en.rows[0].id,
          dto.examDate ?? null,
          dto.doctorId ?? null,
          dto.place ?? null,
          dto.heightCm ?? null,
          dto.weightKg ?? null,
          dto.bloodGroup ?? null,
          JSON.stringify(findings),
          dto.diseaseId ?? null,
          dto.description ?? null,
          dto.remarks ?? null,
          dto.needsAttention,
        ],
      );
      await this.audit.stage(ctx, c, {
        action: 'engagement.clinic.checkup_save',
        entityType: 'health_checkups',
        entityId: r.rows[0]!.id,
        after: { campId, studentId },
      });
      return toCheckup(
        (await c.query<Row>(`${CHECKUP} WHERE h.id = $1`, [r.rows[0]!.id])).rows[0]!,
      );
    });
  }

  /** The doctor publishes a class: the parents now see the cards, and are told. */
  async publishSection(ctx: RequestContext, campId: string, sectionId: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const camp = await this.camp(c, campId);
      const r = await c.query<{ id: string; student_id: string }>(
        `UPDATE health_checkups SET status = 'published', published_at = now(), published_by = app.current_user_id()
          WHERE camp_id = $1 AND class_section_id = $2 AND status = 'draft' RETURNING id::text, student_id::text`,
        [campId, sectionId],
      );
      const school = await c.query<{ name: string }>(
        `SELECT name FROM schools WHERE id = app.current_school_id()`,
      );
      for (const h of r.rows) {
        // the yearly record older screens and the mobile app read (0026) follows the published card
        await c.query(
          `INSERT INTO health_records (school_id, student_id, recorded_on, height_cm, weight_kg, blood_group, vision_left, vision_right, dental, notes, recorded_by)
           SELECT x.school_id, x.student_id, x.exam_date, x.height_cm, x.weight_kg, x.blood_group, x.findings ->> 'vision_left', x.findings ->> 'vision_right',
                  x.findings ->> 'tooth_cavity', x.remarks, app.current_user_id()
             FROM health_checkups x WHERE x.id = $1`,
          [h.id],
        );
        const g = await c.query<{ mobile: string | null; name: string }>(
          `SELECT g.mobile, s.display_name AS name FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id JOIN students s ON s.id = sg.student_id
            WHERE sg.student_id = $1 AND sg.receives_notifications`,
          [h.student_id],
        );
        if (g.rows.length)
          await c.query(
            `SELECT app.template_to_mobiles('clinic_health_card', $1::text[], $2::jsonb)`,
            [
              g.rows.map((x) => x.mobile).filter(Boolean),
              JSON.stringify({
                who: g.rows[0]!.name,
                camp: camp.name,
                school: school.rows[0]?.name ?? '',
              }),
            ],
          );
      }
      await this.audit.stage(ctx, c, {
        action: 'engagement.clinic.checkup_publish',
        entityType: 'health_camps',
        entityId: campId,
        after: { sectionId, published: r.rowCount },
      });
      return { published: r.rowCount ?? 0 };
    });
  }

  private async cardOf(c: PoolClient, h: CheckupRow) {
    const s = await this.settings(c);
    const school = await c.query<{ name: string }>(
      `SELECT name FROM schools WHERE id = app.current_school_id()`,
    );
    const shown = CHECKUP_FIELDS.filter((f) => !s.checkupHidden.includes(f.key));
    const value = (key: string): string | null =>
      key === 'height_cm'
        ? h.heightCm !== null
          ? `${String(h.heightCm)} cm`
          : null
        : key === 'weight_kg'
          ? h.weightKg !== null
            ? `${String(h.weightKg)} kg`
            : null
          : key === 'blood_group'
            ? h.bloodGroup
            : (h.findings[key] ?? null);
    const groups: Array<{ title: string; rows: Array<[string, string | null]> }> = [
      ...new Set<string>(shown.map((f) => f.group)),
    ].map((title) => ({
      title,
      rows: [
        ...shown
          .filter((f) => f.group === title)
          .map((f): [string, string | null] => [f.label, value(f.key)]),
        ...(title === 'General' && h.bmi !== null
          ? ([['BMI', String(h.bmi)]] as Array<[string, string]>)
          : []),
      ],
    }));
    if (h.disease || h.description)
      groups.push({
        title: 'Specific condition',
        rows: [
          ['Condition', h.disease],
          ['Details', h.description],
        ],
      });
    return {
      bytes: await healthCardPdf({
        school: school.rows[0]?.name ?? '',
        camp: h.camp,
        student: h.student,
        admissionNo: h.admissionNo,
        section: h.section,
        dob: h.dob,
        examDate: h.examDate,
        place: h.place,
        doctor: h.doctor,
        groups,
        remarks: h.remarks,
        needsAttention: h.needsAttention,
        note: s.cardNote,
      }),
      filename: `health-card-${(h.admissionNo ?? h.studentId).replace(/[^\w-]+/g, '-')}.pdf`,
    };
  }

  private async findCheckup(c: PoolClient, id: string): Promise<CheckupRow> {
    const r = await c.query<Row>(`${CHECKUP} WHERE h.id = $1`, [id]);
    if (!r.rows[0]) throw new DomainError('not-found', 'Health card not found', { status: 404 });
    return toCheckup(r.rows[0]);
  }

  async card(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) =>
      this.cardOf(c, await this.findCheckup(c, id)),
    );
  }

  /** Everything examined in one camp, a row per pupil. */
  async campExcel(ctx: RequestContext, id: string) {
    const { camp, rows, hidden } = await this.db.tenant(requireTenant(ctx), async (c) => ({
      camp: await this.camp(c, id),
      hidden: (await this.settings(c)).checkupHidden,
      rows: (
        await c.query<Row>(
          `${CHECKUP} WHERE h.camp_id = $1 ORDER BY section, s.display_name LIMIT ${String(EXPORT_MAX)}`,
          [id],
        )
      ).rows.map(toCheckup),
    }));
    const fields = CHECKUP_FIELDS.filter(
      (f) => !hidden.includes(f.key) && !['height_cm', 'weight_kg', 'blood_group'].includes(f.key),
    );
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Health check-up');
    ws.addRow([`${camp.name} · ${String(rows.length)} pupil(s) examined`]).font = { bold: true };
    ws.addRow([
      'Class',
      'Student',
      'Admission no.',
      'Examined on',
      'Height (cm)',
      'Weight (kg)',
      'BMI',
      'Blood group',
      ...fields.map((f) => f.label),
      'Specific condition',
      'Details',
      'Remarks for parents',
      'Needs attention',
      'Doctor',
      'Published',
    ]).font = { bold: true };
    for (const h of rows)
      ws.addRow([
        h.section ?? '',
        h.student,
        h.admissionNo ?? '',
        h.examDate,
        h.heightCm ?? '',
        h.weightKg ?? '',
        h.bmi ?? '',
        h.bloodGroup ?? '',
        ...fields.map((f) => h.findings[f.key] ?? ''),
        h.disease ?? '',
        h.description ?? '',
        h.remarks ?? '',
        h.needsAttention ? 'Yes' : '',
        h.doctor ?? '',
        h.status === 'published' ? 'Yes' : '',
      ]);
    ws.columns.forEach((col, i) => {
      col.width = i === 1 ? 24 : 14;
    });
    ws.views = [{ state: 'frozen', ySplit: 2 }];
    const out = await wb.xlsx.writeBuffer();
    return {
      bytes: Buffer.from(out as ArrayBuffer),
      filename: `health-check-up-${camp.name.replace(/[^\w-]+/g, '-').toLowerCase()}.xlsx`,
    };
  }

  // ---- dashboard ------------------------------------------------------------------------------------
  async dashboard(ctx: RequestContext, q: { from?: string; to?: string }) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const s = await this.settings(c);
      const range = await c.query<{ from: string; to: string; days: number }>(
        `SELECT f::text AS "from", t::text AS "to", (t - f + 1) AS days FROM (
           SELECT COALESCE($1::date, ${TODAY} - 29) AS f, COALESCE($2::date, ${TODAY}) AS t) x`,
        [q.from ?? null, q.to ?? null],
      );
      const r = range.rows[0]!;
      if (r.days < 1 || r.days > 366)
        throw new DomainError('validation-failed', 'Pick up to 366 days', { status: 400 });
      const p = [r.from, r.to];
      const inRange = `${DAY('v.in_at')} BETWEEN $1::date AND $2::date`;
      const today = await c.query<Row>(
        `SELECT count(*) FILTER (WHERE ${DAY('in_at')} = ${TODAY})::int AS today,
                count(*) FILTER (WHERE ${DAY('in_at')} = ${TODAY} AND out_at IS NULL)::int AS in_clinic,
                count(*) FILTER (WHERE ${DAY('in_at')} = ${TODAY} AND outcome = 'sent_home')::int AS sent_home,
                count(*) FILTER (WHERE ${DAY('in_at')} = ${TODAY} AND outcome = 'referred')::int AS referred,
                count(*) FILTER (WHERE ${DAY('in_at')} >= date_trunc('month', ${TODAY})::date)::int AS this_month
           FROM clinic_visits`,
      );
      const months = await c.query<Row>(
        `SELECT to_char(m, 'YYYY-MM') AS k,
                (SELECT count(*) FROM clinic_visits v WHERE v.audience = 'student' AND to_char(${DAY('v.in_at')}, 'YYYY-MM') = to_char(m, 'YYYY-MM'))::int AS student,
                (SELECT count(*) FROM clinic_visits v WHERE v.audience = 'staff' AND to_char(${DAY('v.in_at')}, 'YYYY-MM') = to_char(m, 'YYYY-MM'))::int AS staff
           FROM generate_series(date_trunc('month', ${TODAY}) - interval '5 months', date_trunc('month', ${TODAY}), interval '1 month') m ORDER BY 1`,
      );
      const days = await c.query<Row>(
        `SELECT to_char(d, 'YYYY-MM-DD') AS k,
                count(v.id) FILTER (WHERE v.audience = 'student')::int AS student, count(v.id) FILTER (WHERE v.audience = 'staff')::int AS staff
           FROM generate_series($1::date, $2::date, interval '1 day') d LEFT JOIN clinic_visits v ON ${DAY('v.in_at')} = d::date GROUP BY 1 ORDER BY 1`,
        p,
      );
      const diseases = await c.query<Row>(
        `SELECT d.name, count(*)::int AS n FROM clinic_visits v CROSS JOIN LATERAL unnest(v.disease_ids) AS x(id) JOIN clinic_masters d ON d.id = x.id
          WHERE ${inRange} GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 10`,
        p,
      );
      const classes = await c.query<Row>(
        `SELECT COALESCE(${SECTION('v.student_id')}, 'No class') AS name, count(*)::int AS n, count(DISTINCT v.student_id)::int AS people
           FROM clinic_visits v WHERE v.audience = 'student' AND ${inRange} GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 12`,
        p,
      );
      const departments = await c.query<Row>(
        `SELECT COALESCE(NULLIF(btrim(e.department), ''), 'No department') AS name, count(*)::int AS n, count(DISTINCT v.employee_id)::int AS people
           FROM clinic_visits v JOIN employees e ON e.id = v.employee_id WHERE v.audience = 'staff' AND ${inRange} GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 12`,
        p,
      );
      const outcomes = await c.query<Row>(
        `SELECT v.outcome, count(*)::int AS n FROM clinic_visits v WHERE ${inRange} GROUP BY 1 ORDER BY 2 DESC`,
        p,
      );
      const frequent = await c.query<Row>(
        `SELECT v.audience, COALESCE(s.display_name, e.display_name) AS name, COALESCE(s.admission_no, e.employee_code) AS code,
                COALESCE(${SECTION('v.student_id')}, e.department) AS detail, count(*)::int AS n, max(v.in_at) AS last_at,
                COALESCE(v.student_id, v.employee_id)::text AS id
           FROM clinic_visits v LEFT JOIN students s ON s.id = v.student_id LEFT JOIN employees e ON e.id = v.employee_id
          WHERE ${inRange} GROUP BY v.audience, s.display_name, e.display_name, s.admission_no, e.employee_code, v.student_id, v.employee_id, e.department
         HAVING count(*) >= 3 ORDER BY 5 DESC LIMIT 12`,
        p,
      );
      const meds = await this.medicines(c, true);
      const expiring = await c.query<Row>(
        `SELECT m.name, m.strength, k.batch_no, k.expiry_on::text, k.qty_left, m.unit, (k.expiry_on < ${TODAY}) AS expired
           FROM clinic_stock k JOIN clinic_medicines m ON m.id = k.medicine_id
          WHERE k.qty_left > 0 AND k.expiry_on IS NOT NULL AND k.expiry_on <= ${TODAY} + $1::int ORDER BY k.expiry_on LIMIT 30`,
        [s.expiryAlertDays],
      );
      const given = await c.query<Row>(
        `SELECT m.name, m.strength, m.unit, sum(vm.qty)::int AS qty, count(DISTINCT vm.visit_id)::int AS visits
           FROM clinic_visit_medicines vm JOIN clinic_visits v ON v.id = vm.visit_id JOIN clinic_medicines m ON m.id = vm.medicine_id
          WHERE ${inRange} GROUP BY 1, 2, 3 ORDER BY 4 DESC LIMIT 10`,
        p,
      );
      const camps = (await this.campsWith(c)).slice(0, 4);
      return {
        range: { from: r.from, to: r.to },
        today: {
          visits: n(today.rows[0]?.today),
          inClinic: n(today.rows[0]?.in_clinic),
          sentHome: n(today.rows[0]?.sent_home),
          referred: n(today.rows[0]?.referred),
          thisMonth: n(today.rows[0]?.this_month),
        },
        months: months.rows.map((x) => ({
          key: String(x.k),
          student: n(x.student),
          staff: n(x.staff),
        })),
        days: days.rows.map((x) => ({
          key: String(x.k),
          student: n(x.student),
          staff: n(x.staff),
        })),
        diseases: diseases.rows.map((x) => ({ name: String(x.name), count: n(x.n) })),
        classes: classes.rows.map((x) => ({
          name: String(x.name),
          count: n(x.n),
          people: n(x.people),
        })),
        departments: departments.rows.map((x) => ({
          name: String(x.name),
          count: n(x.n),
          people: n(x.people),
        })),
        outcomes: outcomes.rows.map((x) => ({
          outcome: String(x.outcome),
          label: OUTCOME_LABEL[String(x.outcome)] ?? String(x.outcome),
          count: n(x.n),
        })),
        frequent: frequent.rows.map((x) => ({
          audience: String(x.audience),
          id: String(x.id),
          name: String(x.name),
          code: text(x.code),
          detail: text(x.detail),
          count: n(x.n),
          lastAt: iso(x.last_at),
        })),
        lowStock: meds.filter((m) => m.low),
        expiring: expiring.rows.map((x) => ({
          medicine: `${String(x.name)}${x.strength ? ` ${String(x.strength)}` : ''}`,
          batchNo: text(x.batch_no),
          expiryOn: String(x.expiry_on),
          qtyLeft: n(x.qty_left),
          unit: String(x.unit),
          expired: Boolean(x.expired),
        })),
        given: given.rows.map((x) => ({
          medicine: `${String(x.name)}${x.strength ? ` ${String(x.strength)}` : ''}`,
          unit: String(x.unit),
          qty: n(x.qty),
          visits: n(x.visits),
        })),
        camps,
      };
    });
  }

  private async campsWith(c: PoolClient) {
    const r = await c.query<Row>(
      `SELECT c.id::text, c.name, c.starts_on::text, c.status,
              (SELECT count(*) FROM health_checkups h WHERE h.camp_id = c.id)::int AS examined,
              (SELECT count(*) FROM health_checkups h WHERE h.camp_id = c.id AND h.status = 'published')::int AS published,
              (SELECT count(*) FROM health_checkups h WHERE h.camp_id = c.id AND h.needs_attention)::int AS attention,
              (SELECT count(DISTINCT en.student_id) FROM enrolments en WHERE en.status = 'active'
                  AND en.academic_year_id = COALESCE(c.academic_year_id, app.current_academic_year_id()))::int AS pupils
         FROM health_camps c ORDER BY c.starts_on DESC, c.id DESC LIMIT 6`,
    );
    return r.rows.map((x) => ({
      id: String(x.id),
      name: String(x.name),
      startsOn: String(x.starts_on),
      status: String(x.status),
      examined: n(x.examined),
      published: n(x.published),
      attention: n(x.attention),
      pupils: n(x.pupils),
    }));
  }

  // ---- the family -----------------------------------------------------------------------------------
  private async family(ctx: RequestContext) {
    const v = await this.viewer.resolve(ctx, CLINIC.family);
    if (v.kind !== 'family')
      throw new DomainError('forbidden', 'Only a parent or student can do this here', {
        status: 403,
      });
    return v;
  }

  /** Each child's clinic visits (what a parent needs, not the clinical notes) and published cards. */
  async mine(ctx: RequestContext) {
    const v = await this.family(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const data = [];
      for (const s of v.students) {
        const visits = await c.query<Row>(
          `${VISIT} WHERE v.student_id = $1 ORDER BY v.in_at DESC LIMIT 25`,
          [s.id],
        );
        const cards = await c.query<Row>(
          `${CHECKUP} WHERE h.student_id = $1 AND h.status = 'published' ORDER BY h.exam_date DESC LIMIT 10`,
          [s.id],
        );
        data.push({
          id: s.id,
          name: s.name,
          visits: visits.rows.map(toVisit).map((x) => ({
            id: x.id,
            number: x.number,
            inAt: x.inAt,
            outAt: x.outAt,
            complaint: x.complaint,
            treatment: x.treatment,
            medicines: x.medicines.map((m) => `${m.name}${m.strength ? ` ${m.strength}` : ''}`),
            remark: x.remark,
            outcome: x.outcome,
            outcomeLabel: x.outcomeLabel,
            referredTo: x.referredTo,
          })),
          cards: cards.rows.map(toCheckup).map((h) => ({
            id: h.id,
            camp: h.camp,
            examDate: h.examDate,
            heightCm: h.heightCm,
            weightKg: h.weightKg,
            bmi: h.bmi,
            bloodGroup: h.bloodGroup,
            remarks: h.remarks,
            needsAttention: h.needsAttention,
            doctor: h.doctor,
          })),
        });
      }
      return { data };
    });
  }

  async mineCard(ctx: RequestContext, id: string) {
    const v = await this.family(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const h = await this.findCheckup(c, id);
      if (h.status !== 'published' || !v.students.some((s) => s.id === h.studentId))
        throw new DomainError('not-found', 'Health card not found', { status: 404 });
      return this.cardOf(c, h);
    });
  }
}
