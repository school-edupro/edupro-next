import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import {
  HOSTEL,
  type AllotDto,
  type BedDto,
  type BlockDto,
  type BoardQueryDto,
  type HostelDto,
  type RegisterQueryDto,
  type RoomDto,
  type RoomTypeDto,
  type RoomUpdateDto,
  type TransferDto,
  type VacateDto,
  type WardensDto,
} from './hostel.dto';

const SECTION = `(SELECT k.code || '-' || cs.name FROM enrolments e JOIN class_sections cs ON cs.id = e.class_section_id
                   JOIN classes k ON k.id = cs.class_id
                  WHERE e.student_id = s.id AND e.academic_year_id = $YEAR
                  ORDER BY (e.status = 'active') DESC, e.id DESC LIMIT 1)`;
const section = (yearParam: string) => SECTION.replace('$YEAR', yearParam);

/** Where a bed is, in words: "Boys Hostel · Block A · Room 101 · Bed B". */
const PLACE = `h.name || ' · ' || COALESCE(bl.name || ' · ', '') || 'Room ' || r.room_no || ' · Bed ' || b.label`;
const PLACE_JOINS = `JOIN hostel_beds b ON b.id = a.bed_id JOIN hostel_rooms r ON r.id = b.room_id
  JOIN hostels h ON h.id = r.hostel_id LEFT JOIN hostel_blocks bl ON bl.id = r.block_id
  JOIN hostel_room_types t ON t.id = r.room_type_id`;

const day = (iso: string) => iso.slice(0, 10);
const before = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

/**
 * Hostel module H1 (docs/design/25-hostel-module.md): hostels, blocks, room types, rooms and beds; wardens;
 * bed allotment with history (allot, transfer, vacate); the occupancy board. An allotment keeps the fee
 * profile in step (hosteller, stay months, hostel fee group) and raises the session's demand again, so the
 * hostel fee of each month follows the bed held that month.
 */
@Injectable()
export class HostelService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  private year(ctx: RequestContext): string {
    const t = requireTenant(ctx);
    if (!t.academicYearId)
      throw new DomainError('year.not_selected', 'No academic year is active or selected', {
        status: 409,
      });
    return t.academicYearId;
  }

  /**
   * The hostels the user may see: all for the office (set-up or allotment rights), else those the user is
   * a warden of. null = no limit.
   */
  private async scope(ctx: RequestContext, c: PoolClient): Promise<string[] | null> {
    const p = ctx.permissions;
    if (!p || p.has(HOSTEL.setup) || p.has(HOSTEL.allot)) return null;
    const r = await c.query<{ id: string }>(
      `SELECT w.hostel_id::text AS id FROM hostel_wardens w JOIN employees e ON e.id = w.employee_id
        WHERE e.user_id = $1`,
      [ctx.user.id],
    );
    return r.rows.map((x) => x.id);
  }

  // ---- hostels ------------------------------------------------------------------------------------------
  async hostels(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const only = await this.scope(ctx, c);
      const r = await c.query(
        `SELECT h.id::text, h.name, h.code, h.gender, h.address, h.phone, h.status,
                (SELECT count(*)::int FROM hostel_rooms r WHERE r.hostel_id = h.id AND r.status <> 'closed') AS rooms,
                (SELECT count(*)::int FROM hostel_beds b JOIN hostel_rooms r ON r.id = b.room_id
                  WHERE r.hostel_id = h.id AND r.status = 'active' AND b.status = 'active') AS beds,
                (SELECT count(*)::int FROM hostel_allotments a JOIN hostel_beds b ON b.id = a.bed_id JOIN hostel_rooms r ON r.id = b.room_id
                  WHERE r.hostel_id = h.id AND a.to_date IS NULL) AS taken,
                COALESCE((SELECT json_agg(json_build_object('employeeId', e.id::text, 'name', e.display_name, 'mobile', e.mobile, 'isHead', w.is_head)
                                          ORDER BY w.is_head DESC, e.display_name)
                            FROM hostel_wardens w JOIN employees e ON e.id = w.employee_id WHERE w.hostel_id = h.id), '[]') AS wardens,
                COALESCE((SELECT json_agg(json_build_object('id', bl.id::text, 'name', bl.name, 'floors', bl.floors) ORDER BY bl.name)
                            FROM hostel_blocks bl WHERE bl.hostel_id = h.id), '[]') AS blocks
           FROM hostels h
          WHERE ($1::bigint[] IS NULL OR h.id = ANY ($1::bigint[]))
          ORDER BY h.status, h.name`,
        [only],
      );
      return r.rows;
    });
  }

  async saveHostel(ctx: RequestContext, dto: HostelDto, id?: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const dup = await c.query(
        `SELECT 1 FROM hostels WHERE code = $1 AND ($2::bigint IS NULL OR id <> $2)`,
        [dto.code, id ?? null],
      );
      if (dup.rowCount)
        throw new DomainError('hostel.code_taken', `Hostel code ${dto.code} is already used`, {
          status: 409,
        });
      const r = id
        ? await c.query<{ id: string }>(
            `UPDATE hostels SET name = $2, code = $3, gender = $4, address = $5, phone = $6, status = $7,
                    updated_at = now(), updated_by = app.current_user_id()
              WHERE id = $1 RETURNING id::text`,
            [
              id,
              dto.name,
              dto.code,
              dto.gender,
              dto.address ?? null,
              dto.phone ?? null,
              dto.status,
            ],
          )
        : await c.query<{ id: string }>(
            `INSERT INTO hostels (school_id, name, code, gender, address, phone, status, created_by, updated_by)
             VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, app.current_user_id(), app.current_user_id())
             RETURNING id::text`,
            [dto.name, dto.code, dto.gender, dto.address ?? null, dto.phone ?? null, dto.status],
          );
      if (!r.rows[0]) throw new DomainError('not-found', 'Hostel not found', { status: 404 });
      if (id && dto.status === 'closed') {
        const open = await c.query(
          `SELECT 1 FROM hostel_allotments a JOIN hostel_beds b ON b.id = a.bed_id JOIN hostel_rooms r ON r.id = b.room_id
            WHERE r.hostel_id = $1 AND a.to_date IS NULL LIMIT 1`,
          [id],
        );
        if (open.rowCount)
          throw new DomainError(
            'hostel.occupied',
            'Pupils still hold beds in this hostel: vacate or transfer them before closing it',
            { status: 409 },
          );
      }
      await this.audit.stage(ctx, c, {
        action: id ? 'hostel.update' : 'hostel.create',
        entityType: 'hostel',
        entityId: r.rows[0].id,
        after: dto,
      });
      return { id: r.rows[0].id };
    });
  }

  // ---- blocks ------------------------------------------------------------------------------------------
  async saveBlock(ctx: RequestContext, dto: BlockDto, id?: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = id
        ? await c.query<{ id: string }>(
            `UPDATE hostel_blocks SET name = $2, floors = $3 WHERE id = $1 RETURNING id::text`,
            [id, dto.name, dto.floors],
          )
        : await c.query<{ id: string }>(
            `INSERT INTO hostel_blocks (school_id, hostel_id, name, floors)
             VALUES (app.current_school_id(), $1, $2, $3)
             ON CONFLICT (hostel_id, name) DO NOTHING RETURNING id::text`,
            [dto.hostelId, dto.name, dto.floors],
          );
      if (!r.rows[0])
        throw new DomainError(
          'hostel.block_taken',
          `Block ${dto.name} already exists in this hostel`,
          {
            status: 409,
          },
        );
      await this.audit.stage(ctx, c, {
        action: id ? 'hostel.block.update' : 'hostel.block.create',
        entityType: 'hostel_block',
        entityId: r.rows[0].id,
        after: dto,
      });
      return { id: r.rows[0].id };
    });
  }

  async deleteBlock(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const used = await c.query(`SELECT 1 FROM hostel_rooms WHERE block_id = $1 LIMIT 1`, [id]);
      if (used.rowCount)
        throw new DomainError(
          'hostel.block_in_use',
          'The block has rooms: move or remove them first',
          {
            status: 409,
          },
        );
      await c.query(`DELETE FROM hostel_blocks WHERE id = $1`, [id]);
      await this.audit.stage(ctx, c, {
        action: 'hostel.block.delete',
        entityType: 'hostel_block',
        entityId: id,
      });
      return { ok: true };
    });
  }

  // ---- room types ----------------------------------------------------------------------------------------
  async roomTypes(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query(
        `SELECT t.id::text, t.name, t.seater, t.ac, t.fee_group AS "feeGroup", t.status,
                (SELECT count(*)::int FROM hostel_rooms r WHERE r.room_type_id = t.id AND r.status <> 'closed') AS rooms
           FROM hostel_room_types t ORDER BY t.status, t.name`,
      );
      return r.rows;
    });
  }

  async saveRoomType(ctx: RequestContext, dto: RoomTypeDto, id?: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const prev = id
        ? (
            await c.query<{ fee_group: string | null }>(
              `SELECT fee_group FROM hostel_room_types WHERE id = $1`,
              [id],
            )
          ).rows[0]
        : undefined;
      const r = id
        ? await c.query<{ id: string }>(
            `UPDATE hostel_room_types SET name = $2, seater = $3, ac = $4, fee_group = $5, status = $6, updated_at = now()
              WHERE id = $1 RETURNING id::text`,
            [id, dto.name, dto.seater, dto.ac, dto.feeGroup ?? null, dto.status],
          )
        : await c.query<{ id: string }>(
            `INSERT INTO hostel_room_types (school_id, name, seater, ac, fee_group, status)
             VALUES (app.current_school_id(), $1, $2, $3, $4, $5)
             ON CONFLICT (school_id, name) DO NOTHING RETURNING id::text`,
            [dto.name, dto.seater, dto.ac, dto.feeGroup ?? null, dto.status],
          );
      if (!r.rows[0])
        throw new DomainError('hostel.room_type_taken', `Room type ${dto.name} already exists`, {
          status: 409,
        });
      await this.audit.stage(ctx, c, {
        action: id ? 'hostel.room_type.update' : 'hostel.room_type.create',
        entityType: 'hostel_room_type',
        entityId: r.rows[0].id,
        before: prev,
        after: dto,
      });
      // a new fee group re-prices the unpaid hostel months of everyone in rooms of this type
      let repriced = 0;
      if (id && prev && (prev.fee_group ?? null) !== (dto.feeGroup ?? null)) {
        const who = await c.query<{ student_id: string }>(
          `SELECT DISTINCT a.student_id::text FROM hostel_allotments a JOIN hostel_beds b ON b.id = a.bed_id
             JOIN hostel_rooms r ON r.id = b.room_id WHERE r.room_type_id = $1 AND a.to_date IS NULL`,
          [id],
        );
        for (const w of who.rows)
          if ((await this.syncFee(c, w.student_id, this.year(ctx))).synced) repriced++;
      }
      return { id: r.rows[0].id, repriced };
    });
  }

  // ---- rooms and beds ------------------------------------------------------------------------------------
  async rooms(ctx: RequestContext, hostelId?: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const only = await this.scope(ctx, c);
      const r = await c.query(
        `SELECT r.id::text, r.hostel_id::text AS "hostelId", h.name AS hostel, r.block_id::text AS "blockId", bl.name AS block,
                r.floor, r.room_no AS "roomNo", r.room_type_id::text AS "roomTypeId", t.name AS "roomType", t.seater, t.ac,
                t.fee_group AS "feeGroup", r.status, r.remarks,
                COALESCE((SELECT json_agg(json_build_object('id', b.id::text, 'label', b.label, 'status', b.status,
                                                            'used', EXISTS (SELECT 1 FROM hostel_allotments a WHERE a.bed_id = b.id))
                                          ORDER BY b.label)
                            FROM hostel_beds b WHERE b.room_id = r.id), '[]') AS beds
           FROM hostel_rooms r JOIN hostels h ON h.id = r.hostel_id JOIN hostel_room_types t ON t.id = r.room_type_id
           LEFT JOIN hostel_blocks bl ON bl.id = r.block_id
          WHERE ($1::bigint IS NULL OR r.hostel_id = $1) AND ($2::bigint[] IS NULL OR r.hostel_id = ANY ($2::bigint[]))
          ORDER BY h.name, bl.name NULLS FIRST, r.floor, r.room_no`,
        [hostelId ?? null, only],
      );
      return r.rows;
    });
  }

  private async checkBlock(
    c: PoolClient,
    hostelId: string,
    blockId: string | null | undefined,
    floor: number,
  ) {
    if (!blockId) return;
    const b = await c.query<{ floors: number }>(
      `SELECT floors FROM hostel_blocks WHERE id = $1 AND hostel_id = $2`,
      [blockId, hostelId],
    );
    if (!b.rows[0])
      throw new DomainError('hostel.block_mismatch', 'The block is not in this hostel', {
        status: 422,
      });
    if (floor >= b.rows[0].floors)
      throw new DomainError(
        'hostel.floor_out_of_range',
        `The block has ${String(b.rows[0].floors)} floor(s): 0 (ground) to ${String(b.rows[0].floors - 1)}`,
        { status: 422 },
      );
  }

  async createRoom(ctx: RequestContext, dto: RoomDto) {
    return this.db.tenant(requireTenant(ctx), (c) => this.createRoomIn(ctx, c, dto));
  }

  /** A room and its beds, inside the caller's transaction (the screen and the Excel upload). */
  async createRoomIn(ctx: RequestContext, c: PoolClient, dto: RoomDto) {
    {
      await this.checkBlock(c, dto.hostelId, dto.blockId, dto.floor);
      const t = await c.query<{ seater: number }>(
        `SELECT seater FROM hostel_room_types WHERE id = $1`,
        [dto.roomTypeId],
      );
      if (!t.rows[0]) throw new DomainError('not-found', 'Room type not found', { status: 404 });
      const r = await c.query<{ id: string }>(
        `INSERT INTO hostel_rooms (school_id, hostel_id, block_id, floor, room_no, room_type_id, status, remarks)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (hostel_id, room_no) DO NOTHING RETURNING id::text`,
        [
          dto.hostelId,
          dto.blockId ?? null,
          dto.floor,
          dto.roomNo,
          dto.roomTypeId,
          dto.status,
          dto.remarks ?? null,
        ],
      );
      if (!r.rows[0])
        throw new DomainError(
          'hostel.room_taken',
          `Room ${dto.roomNo} already exists in this hostel`,
          {
            status: 409,
          },
        );
      const n = dto.beds ?? t.rows[0].seater;
      for (let i = 0; i < n; i++)
        await c.query(
          `INSERT INTO hostel_beds (school_id, room_id, label) VALUES (app.current_school_id(), $1, $2)`,
          [r.rows[0].id, bedLabel(i)],
        );
      await this.audit.stage(ctx, c, {
        action: 'hostel.room.create',
        entityType: 'hostel_room',
        entityId: r.rows[0].id,
        after: { ...dto, beds: n },
      });
      return { id: r.rows[0].id, beds: n };
    }
  }

  async updateRoom(ctx: RequestContext, id: string, dto: RoomUpdateDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const cur = (
        await c.query<{
          hostel_id: string;
          block_id: string | null;
          floor: number;
          room_type_id: string;
        }>(
          `SELECT hostel_id::text, block_id::text, floor, room_type_id::text FROM hostel_rooms WHERE id = $1 FOR UPDATE`,
          [id],
        )
      ).rows[0];
      if (!cur) throw new DomainError('not-found', 'Room not found', { status: 404 });
      const hostelId = dto.hostelId ?? cur.hostel_id;
      const blockId = dto.blockId === undefined ? cur.block_id : dto.blockId;
      const floor = dto.floor ?? cur.floor;
      await this.checkBlock(c, hostelId, blockId, floor);
      const occupied = (
        await c.query(
          `SELECT 1 FROM hostel_allotments a JOIN hostel_beds b ON b.id = a.bed_id WHERE b.room_id = $1 AND a.to_date IS NULL LIMIT 1`,
          [id],
        )
      ).rowCount;
      if (occupied && dto.hostelId && dto.hostelId !== cur.hostel_id)
        throw new DomainError(
          'hostel.occupied',
          'Pupils hold beds in this room: it cannot move to another hostel',
          {
            status: 409,
          },
        );
      if (occupied && dto.status && dto.status !== 'active')
        throw new DomainError(
          'hostel.occupied',
          'Pupils hold beds in this room: transfer them before closing it or sending it for maintenance',
          { status: 409 },
        );
      try {
        await c.query(
          `UPDATE hostel_rooms SET hostel_id = $2, block_id = $3, floor = $4, room_no = COALESCE($5, room_no),
                  room_type_id = COALESCE($6, room_type_id), status = COALESCE($7, status),
                  remarks = CASE WHEN $8::boolean THEN $9 ELSE remarks END, updated_at = now()
            WHERE id = $1`,
          [
            id,
            hostelId,
            blockId,
            floor,
            dto.roomNo ?? null,
            dto.roomTypeId ?? null,
            dto.status ?? null,
            dto.remarks !== undefined,
            dto.remarks ?? null,
          ],
        );
      } catch (e) {
        if ((e as { code?: string }).code === '23505')
          throw new DomainError(
            'hostel.room_taken',
            `Room ${dto.roomNo ?? ''} already exists in this hostel`,
            {
              status: 409,
            },
          );
        throw e;
      }
      await this.audit.stage(ctx, c, {
        action: 'hostel.room.update',
        entityType: 'hostel_room',
        entityId: id,
        after: dto,
      });
      // a new room type re-prices the unpaid hostel months of the pupils in the room
      let repriced = 0;
      if (dto.roomTypeId && dto.roomTypeId !== cur.room_type_id) {
        const who = await c.query<{ student_id: string }>(
          `SELECT a.student_id::text FROM hostel_allotments a JOIN hostel_beds b ON b.id = a.bed_id
            WHERE b.room_id = $1 AND a.to_date IS NULL`,
          [id],
        );
        for (const w of who.rows)
          if ((await this.syncFee(c, w.student_id, this.year(ctx))).synced) repriced++;
      }
      return { id, repriced };
    });
  }

  async addBed(ctx: RequestContext, roomId: string, dto: BedDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{ id: string }>(
        `INSERT INTO hostel_beds (school_id, room_id, label, status) VALUES (app.current_school_id(), $1, $2, $3)
         ON CONFLICT (room_id, label) DO NOTHING RETURNING id::text`,
        [roomId, dto.label, dto.status],
      );
      if (!r.rows[0])
        throw new DomainError('hostel.bed_taken', `Bed ${dto.label} already exists in this room`, {
          status: 409,
        });
      await this.audit.stage(ctx, c, {
        action: 'hostel.bed.create',
        entityType: 'hostel_bed',
        entityId: r.rows[0].id,
        after: dto,
      });
      return { id: r.rows[0].id };
    });
  }

  async updateBed(ctx: RequestContext, id: string, dto: BedDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      if (dto.status === 'blocked') {
        const open = await c.query(
          `SELECT 1 FROM hostel_allotments WHERE bed_id = $1 AND to_date IS NULL`,
          [id],
        );
        if (open.rowCount)
          throw new DomainError(
            'hostel.occupied',
            'A pupil holds this bed: transfer or vacate first',
            { status: 409 },
          );
      }
      const r = await c.query(`UPDATE hostel_beds SET label = $2, status = $3 WHERE id = $1`, [
        id,
        dto.label,
        dto.status,
      ]);
      if (!r.rowCount) throw new DomainError('not-found', 'Bed not found', { status: 404 });
      await this.audit.stage(ctx, c, {
        action: 'hostel.bed.update',
        entityType: 'hostel_bed',
        entityId: id,
        after: dto,
      });
      return { id };
    });
  }

  async deleteBed(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const used = await c.query(`SELECT 1 FROM hostel_allotments WHERE bed_id = $1 LIMIT 1`, [id]);
      if (used.rowCount)
        throw new DomainError(
          'hostel.bed_in_use',
          'The bed has an allotment history: block it instead',
          {
            status: 409,
          },
        );
      await c.query(`DELETE FROM hostel_beds WHERE id = $1`, [id]);
      await this.audit.stage(ctx, c, {
        action: 'hostel.bed.delete',
        entityType: 'hostel_bed',
        entityId: id,
      });
      return { ok: true };
    });
  }

  // ---- wardens -------------------------------------------------------------------------------------------
  async setWardens(ctx: RequestContext, hostelId: string, dto: WardensDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const h = await c.query(`SELECT 1 FROM hostels WHERE id = $1`, [hostelId]);
      if (!h.rowCount) throw new DomainError('not-found', 'Hostel not found', { status: 404 });
      const ids = dto.wardens.map((w) => w.employeeId);
      const ok = await c.query<{ id: string }>(
        `SELECT id::text FROM employees WHERE id = ANY ($1::bigint[]) AND status = 'active' AND deleted_at IS NULL`,
        [ids],
      );
      if (ok.rowCount !== new Set(ids).size)
        throw new DomainError('hostel.warden_unknown', 'A warden is not an active staff member', {
          status: 422,
        });
      await c.query(
        `DELETE FROM hostel_wardens WHERE hostel_id = $1 AND NOT (employee_id = ANY ($2::bigint[]))`,
        [hostelId, ids],
      );
      for (const w of dto.wardens)
        await c.query(
          `INSERT INTO hostel_wardens (school_id, hostel_id, employee_id, is_head, created_by)
           VALUES (app.current_school_id(), $1, $2, $3, app.current_user_id())
           ON CONFLICT (hostel_id, employee_id) DO UPDATE SET is_head = EXCLUDED.is_head`,
          [hostelId, w.employeeId, w.isHead],
        );
      await this.audit.stage(ctx, c, {
        action: 'hostel.wardens.set',
        entityType: 'hostel',
        entityId: hostelId,
        after: dto,
      });
      return { wardens: dto.wardens.length };
    });
  }

  // ---- occupancy -----------------------------------------------------------------------------------------
  /** Every room and bed of the hostel(s) with who holds the bed on the day. */
  async board(ctx: RequestContext, q: BoardQueryDto) {
    const yearId = this.year(ctx);
    const on = q.on ?? new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const only = await this.scope(ctx, c);
      const r = await c.query(
        // eslint-disable-next-line no-restricted-syntax -- fixed fragments (place, section, joins); values are bound
        `SELECT r.id::text, r.hostel_id::text AS "hostelId", h.name AS hostel, bl.name AS block, r.floor, r.room_no AS "roomNo",
                t.name AS "roomType", t.seater, t.ac, r.status,
                COALESCE((SELECT json_agg(json_build_object(
                    'id', b.id::text, 'label', b.label, 'status', b.status,
                    'allotmentId', a.id::text, 'studentId', s.id::text, 'name', s.display_name, 'admissionNo', s.admission_no,
                    'gender', s.gender, 'section', ${section('$3')}, 'since', a.from_date::text) ORDER BY b.label)
                   FROM hostel_beds b
                   LEFT JOIN hostel_allotments a ON a.bed_id = b.id AND a.from_date <= $2::date AND (a.to_date IS NULL OR a.to_date >= $2::date)
                   LEFT JOIN students s ON s.id = a.student_id
                  WHERE b.room_id = r.id), '[]') AS beds
           FROM hostel_rooms r JOIN hostels h ON h.id = r.hostel_id JOIN hostel_room_types t ON t.id = r.room_type_id
           LEFT JOIN hostel_blocks bl ON bl.id = r.block_id
          WHERE r.status <> 'closed' AND h.status = 'active'
            AND ($1::bigint IS NULL OR r.hostel_id = $1) AND ($4::bigint[] IS NULL OR r.hostel_id = ANY ($4::bigint[]))
          ORDER BY h.name, bl.name NULLS FIRST, r.floor, r.room_no`,
        [q.hostelId ?? null, on, yearId, only],
      );
      type Bed = { status: string; studentId: string | null };
      const rooms = r.rows as Array<{ status: string; roomType: string; beds: Bed[] }>;
      const totals = { rooms: rooms.length, beds: 0, taken: 0, free: 0, blocked: 0 };
      const byType = new Map<
        string,
        { roomType: string; beds: number; taken: number; free: number }
      >();
      for (const room of rooms) {
        const t = byType.get(room.roomType) ?? {
          roomType: room.roomType,
          beds: 0,
          taken: 0,
          free: 0,
        };
        for (const b of room.beds) {
          const usable = room.status === 'active' && b.status === 'active';
          if (b.studentId) {
            totals.taken++;
            t.taken++;
          } else if (usable) {
            totals.free++;
            t.free++;
          } else totals.blocked++;
          if (usable || b.studentId) {
            totals.beds++;
            t.beds++;
          }
        }
        byType.set(room.roomType, t);
      }
      return { on, totals, byType: [...byType.values()], rooms };
    });
  }

  /** Free beds (active rooms, active beds) on a date, for the allot and transfer pickers. */
  async freeBeds(ctx: RequestContext, on: string, hostelId?: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query(
        // eslint-disable-next-line no-restricted-syntax -- fixed fragments (place, section, joins); values are bound
        `SELECT b.id::text, h.id::text AS "hostelId", h.name AS hostel, h.gender, bl.name AS block, r.floor, r.room_no AS "roomNo",
                b.label, t.name AS "roomType", t.fee_group AS "feeGroup",
                ${PLACE} AS place
           FROM hostel_beds b JOIN hostel_rooms r ON r.id = b.room_id JOIN hostels h ON h.id = r.hostel_id
           JOIN hostel_room_types t ON t.id = r.room_type_id LEFT JOIN hostel_blocks bl ON bl.id = r.block_id
          WHERE b.status = 'active' AND r.status = 'active' AND h.status = 'active'
            AND ($2::bigint IS NULL OR h.id = $2)
            AND NOT EXISTS (SELECT 1 FROM hostel_allotments a WHERE a.bed_id = b.id AND (a.to_date IS NULL OR a.to_date >= $1::date))
          ORDER BY h.name, bl.name NULLS FIRST, r.floor, r.room_no, b.label`,
        [on, hostelId ?? null],
      );
      return r.rows;
    });
  }

  /** Hostellers of the session (fee profile) with no bed today: the go-live and admissions to-do list. */
  async noBed(ctx: RequestContext) {
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query(
        // eslint-disable-next-line no-restricted-syntax -- fixed fragments (place, section, joins); values are bound
        `SELECT s.id::text AS "studentId", s.display_name AS name, s.admission_no AS "admissionNo", s.gender,
                ${section('$1')} AS section, p.hostel_from::text AS "hostelFrom", p.hostel_to::text AS "hostelTo"
           FROM student_fee_profiles p JOIN students s ON s.id = p.student_id AND s.deleted_at IS NULL AND s.status = 'active'
          WHERE p.academic_year_id = $1 AND p.hosteller
            AND EXISTS (SELECT 1 FROM enrolments e WHERE e.student_id = s.id AND e.academic_year_id = $1 AND e.status = 'active')
            AND (p.hostel_to IS NULL OR p.hostel_to >= date_trunc('month', CURRENT_DATE)::date)
            AND NOT EXISTS (SELECT 1 FROM hostel_allotments a WHERE a.student_id = s.id AND (a.to_date IS NULL OR a.to_date >= CURRENT_DATE))
          ORDER BY s.display_name`,
        [yearId],
      );
      return r.rows;
    });
  }

  /** The allotment register: every stay, with where, from and to. */
  async register(ctx: RequestContext, q: RegisterQueryDto) {
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const only = await this.scope(ctx, c);
      const r = await c.query(
        // eslint-disable-next-line no-restricted-syntax -- fixed fragments (place, section, joins); values are bound
        `SELECT a.id::text, s.id::text AS "studentId", s.display_name AS name, s.admission_no AS "admissionNo",
                ${section('$1')} AS section, h.name AS hostel, bl.name AS block, r.room_no AS "roomNo", b.label AS bed,
                t.name AS "roomType", a.kind, a.from_date::text AS "fromDate", a.to_date::text AS "toDate",
                a.end_reason AS "endReason", a.remarks, a.end_remarks AS "endRemarks"
           FROM hostel_allotments a JOIN students s ON s.id = a.student_id ${PLACE_JOINS}
          WHERE ($2::bigint IS NULL OR h.id = $2) AND ($7::bigint[] IS NULL OR h.id = ANY ($7::bigint[]))
            AND ($3::date IS NULL OR a.to_date IS NULL OR a.to_date >= $3::date)
            AND ($4::date IS NULL OR a.from_date <= $4::date)
            AND ($5 = 'all' OR ($5 = 'open') = (a.to_date IS NULL OR a.to_date >= CURRENT_DATE))
            AND ($6::text IS NULL OR s.search_text LIKE '%' || app.search_text($6) || '%')
          ORDER BY a.from_date DESC, a.id DESC
          LIMIT 2000`,
        [yearId, q.hostelId ?? null, q.from ?? null, q.to ?? null, q.open, q.q ?? null, only],
      );
      return r.rows;
    });
  }

  /** Pupils of the session by name or admission no., with the bed each holds today (the allot screen). */
  async search(ctx: RequestContext, q: string) {
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query(
        // eslint-disable-next-line no-restricted-syntax -- fixed fragments (place, section, joins); values are bound
        `SELECT s.id::text, s.display_name AS name, s.admission_no AS "admissionNo", s.gender, ${section('$2')} AS section,
                (SELECT ${PLACE} FROM hostel_allotments a ${PLACE_JOINS}
                  WHERE a.student_id = s.id AND a.from_date <= CURRENT_DATE AND (a.to_date IS NULL OR a.to_date >= CURRENT_DATE)
                  LIMIT 1) AS bed
           FROM students s
          WHERE s.deleted_at IS NULL AND s.search_text LIKE '%' || app.search_text($1) || '%'
            AND EXISTS (SELECT 1 FROM enrolments e WHERE e.student_id = s.id AND e.academic_year_id = $2 AND e.status = 'active')
          ORDER BY s.display_name
          LIMIT 20`,
        [q, yearId],
      );
      return r.rows;
    });
  }

  /** One pupil's hostel: the bed held now, the wardens, and every stay. */
  async student(ctx: RequestContext, studentId: string) {
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const pupil = (
        await c.query(
          // eslint-disable-next-line no-restricted-syntax -- fixed fragment (section); values are bound
          `SELECT s.id::text, s.display_name AS name, s.admission_no AS "admissionNo", s.gender, ${section('$2')} AS section
             FROM students s WHERE s.id = $1 AND s.deleted_at IS NULL`,
          [studentId, yearId],
        )
      ).rows[0];
      if (!pupil) throw new DomainError('not-found', 'Pupil not found', { status: 404 });
      const r = await c.query(
        // eslint-disable-next-line no-restricted-syntax -- fixed fragments (place, section, joins); values are bound
        `SELECT a.id::text, ${PLACE} AS place, h.id::text AS "hostelId", h.name AS hostel, bl.name AS block,
                r.room_no AS "roomNo", b.id::text AS "bedId", b.label AS bed, t.name AS "roomType", t.fee_group AS "feeGroup",
                a.kind, a.from_date::text AS "fromDate", a.to_date::text AS "toDate", a.end_reason AS "endReason",
                a.remarks, a.end_remarks AS "endRemarks"
           FROM hostel_allotments a ${PLACE_JOINS}
          WHERE a.student_id = $1
          ORDER BY a.from_date DESC, a.id DESC`,
        [studentId],
      );
      const current = r.rows.find((x: { toDate: string | null }) => x.toDate === null) as
        { hostelId: string } | undefined;
      const wardens = current
        ? (
            await c.query(
              `SELECT e.display_name AS name, e.mobile, w.is_head AS "isHead" FROM hostel_wardens w
                 JOIN employees e ON e.id = w.employee_id WHERE w.hostel_id = $1 ORDER BY w.is_head DESC, e.display_name`,
              [current.hostelId],
            )
          ).rows
        : [];
      return { pupil, current: current ?? null, wardens, history: r.rows };
    });
  }

  // ---- allot, transfer, vacate ---------------------------------------------------------------------------
  /** The bed, locked, and fit for a pupil from the date (free, active, the hostel takes the pupil's gender). */
  private async takeBed(c: PoolClient, bedId: string, from: string, gender: string) {
    const b = (
      await c.query<{ ok: boolean; hostel_gender: string; place: string }>(
        // eslint-disable-next-line no-restricted-syntax -- fixed fragments (place, section, joins); values are bound
        `SELECT (b.status = 'active' AND r.status = 'active' AND h.status = 'active') AS ok, h.gender AS hostel_gender,
                ${PLACE} AS place
           FROM hostel_beds b JOIN hostel_rooms r ON r.id = b.room_id JOIN hostels h ON h.id = r.hostel_id
           LEFT JOIN hostel_blocks bl ON bl.id = r.block_id
          WHERE b.id = $1 FOR UPDATE OF b`,
        [bedId],
      )
    ).rows[0];
    if (!b) throw new DomainError('not-found', 'Bed not found', { status: 404 });
    if (!b.ok)
      throw new DomainError(
        'hostel.bed_unavailable',
        `${b.place} is blocked, under maintenance or closed`,
        {
          status: 409,
        },
      );
    if (
      (b.hostel_gender === 'boys' && gender === 'female') ||
      (b.hostel_gender === 'girls' && gender === 'male')
    )
      throw new DomainError(
        'hostel.gender_mismatch',
        `The pupil is recorded as ${gender === 'female' ? 'a girl' : 'a boy'}, and ${b.place} is in a ${b.hostel_gender}' hostel. Correct the pupil's gender in the student record if it is wrong.`,
        { status: 422 },
      );
    const held = await c.query<{ name: string; from_date: string }>(
      `SELECT s.display_name AS name, a.from_date::text FROM hostel_allotments a JOIN students s ON s.id = a.student_id
        WHERE a.bed_id = $1 AND (a.to_date IS NULL OR a.to_date >= $2::date) LIMIT 1`,
      [bedId, from],
    );
    if (held.rows[0])
      throw new DomainError(
        'hostel.bed_taken',
        `${b.place} is held by ${held.rows[0].name} (since ${held.rows[0].from_date})`,
        { status: 409 },
      );
    return b.place;
  }

  private async pupil(c: PoolClient, studentId: string) {
    const s = (
      await c.query<{ name: string; gender: string }>(
        `SELECT display_name AS name, gender::text FROM students WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [studentId],
      )
    ).rows[0];
    if (!s) throw new DomainError('not-found', 'Pupil not found', { status: 404 });
    return s;
  }

  private async openStay(c: PoolClient, studentId: string) {
    return (
      await c.query<{ id: string; bed_id: string; from_date: string }>(
        `SELECT id::text, bed_id::text, from_date::text FROM hostel_allotments
          WHERE student_id = $1 AND to_date IS NULL FOR UPDATE`,
        [studentId],
      )
    ).rows[0];
  }

  async allot(ctx: RequestContext, dto: AllotDto) {
    return this.db.tenant(requireTenant(ctx), (c) => this.allotIn(ctx, c, dto));
  }

  /** Allot inside the caller's transaction (the screen and the Excel upload). */
  async allotIn(ctx: RequestContext, c: PoolClient, dto: AllotDto) {
    const yearId = this.year(ctx);
    {
      const s = await this.pupil(c, dto.studentId);
      if (await this.openStay(c, dto.studentId))
        throw new DomainError(
          'hostel.already_allotted',
          `${s.name} already holds a bed: use Transfer`,
          {
            status: 409,
          },
        );
      const later = await c.query<{ to_date: string }>(
        `SELECT to_date::text FROM hostel_allotments WHERE student_id = $1 AND to_date >= $2::date ORDER BY to_date DESC LIMIT 1`,
        [dto.studentId, dto.fromDate],
      );
      if (later.rows[0])
        throw new DomainError(
          'hostel.overlap',
          `${s.name} stayed in the hostel until ${later.rows[0].to_date}: the new stay must start after that`,
          { status: 409 },
        );
      const place = await this.takeBed(c, dto.bedId, dto.fromDate, s.gender);
      const a = await c.query<{ id: string }>(
        `INSERT INTO hostel_allotments (school_id, student_id, bed_id, from_date, kind, remarks, created_by)
         VALUES (app.current_school_id(), $1, $2, $3, 'allot', $4, app.current_user_id()) RETURNING id::text`,
        [dto.studentId, dto.bedId, dto.fromDate, dto.remarks ?? null],
      );
      await this.audit.stage(ctx, c, {
        action: 'hostel.allot',
        entityType: 'student',
        entityId: dto.studentId,
        after: { ...dto, place },
      });
      const fee = await this.syncFee(c, dto.studentId, yearId);
      return { id: a.rows[0]!.id, place, fee };
    }
  }

  async transfer(ctx: RequestContext, studentId: string, dto: TransferDto) {
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const s = await this.pupil(c, studentId);
      const open = await this.openStay(c, studentId);
      if (!open)
        throw new DomainError('hostel.not_allotted', `${s.name} holds no bed: use Allot`, {
          status: 409,
        });
      if (open.bed_id === dto.bedId)
        throw new DomainError('hostel.same_bed', `${s.name} already holds this bed`, {
          status: 422,
        });
      if (dto.onDate < open.from_date)
        throw new DomainError(
          'hostel.before_stay',
          `The stay on the present bed started on ${open.from_date}`,
          {
            status: 422,
          },
        );
      let id: string;
      if (dto.onDate === open.from_date) {
        // moved on the day the stay began: the stay simply is on the other bed
        const place = await this.takeBed(c, dto.bedId, dto.onDate, s.gender);
        await c.query(
          `UPDATE hostel_allotments SET bed_id = $2, remarks = COALESCE($3, remarks) WHERE id = $1`,
          [open.id, dto.bedId, dto.remarks ?? null],
        );
        id = open.id;
        await this.audit.stage(ctx, c, {
          action: 'hostel.transfer',
          entityType: 'student',
          entityId: studentId,
          after: { ...dto, place },
        });
        return {
          id,
          place,
          fee: await this.syncFee(c, studentId, yearId),
          paidMonths: await this.paidFrom(c, studentId, yearId, dto.onDate),
        };
      }
      await c.query(
        `UPDATE hostel_allotments SET to_date = $2, end_reason = 'transfer', end_remarks = $3, ended_at = now(), ended_by = app.current_user_id()
          WHERE id = $1`,
        [open.id, before(dto.onDate), dto.remarks ?? null],
      );
      const place = await this.takeBed(c, dto.bedId, dto.onDate, s.gender);
      const a = await c.query<{ id: string }>(
        `INSERT INTO hostel_allotments (school_id, student_id, bed_id, from_date, kind, remarks, created_by)
         VALUES (app.current_school_id(), $1, $2, $3, 'transfer', $4, app.current_user_id()) RETURNING id::text`,
        [studentId, dto.bedId, dto.onDate, dto.remarks ?? null],
      );
      id = a.rows[0]!.id;
      await this.audit.stage(ctx, c, {
        action: 'hostel.transfer',
        entityType: 'student',
        entityId: studentId,
        before: { bedId: open.bed_id },
        after: { ...dto, place },
      });
      const fee = await this.syncFee(c, studentId, yearId);
      return { id, place, fee, paidMonths: await this.paidFrom(c, studentId, yearId, dto.onDate) };
    });
  }

  async vacate(ctx: RequestContext, studentId: string, dto: VacateDto) {
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const s = await this.pupil(c, studentId);
      const open = await this.openStay(c, studentId);
      if (!open)
        throw new DomainError('hostel.not_allotted', `${s.name} holds no bed`, { status: 409 });
      if (dto.onDate < open.from_date)
        throw new DomainError('hostel.before_stay', `The stay started on ${open.from_date}`, {
          status: 422,
        });
      await c.query(
        `UPDATE hostel_allotments SET to_date = $2, end_reason = $3, end_remarks = $4, ended_at = now(), ended_by = app.current_user_id()
          WHERE id = $1`,
        [open.id, dto.onDate, dto.reason, dto.remarks ?? null],
      );
      await this.audit.stage(ctx, c, {
        action: 'hostel.vacate',
        entityType: 'student',
        entityId: studentId,
        after: dto,
      });
      const fee = await this.syncFee(c, studentId, yearId);
      const paidMonths = await this.paidFrom(c, studentId, yearId, nextMonth(dto.onDate));
      return { id: open.id, fee, paidMonths };
    });
  }

  /** Hostel months from a date that are already (partly) paid: they keep their charge; the fee desk settles any difference. */
  private async paidFrom(c: PoolClient, studentId: string, yearId: string, from: string) {
    const r = await c.query<{ m: string }>(
      `SELECT DISTINCT to_char(make_date(fp.year, fp.month, 1), 'Mon YYYY') AS m, make_date(fp.year, fp.month, 1) AS d
         FROM fee_demands d JOIN fee_periods fp ON fp.id = d.period_id
        WHERE d.student_id = $1 AND d.academic_year_id = $2 AND d.ledger = 'hostel' AND d.paid > 0
          AND make_date(fp.year, fp.month, 1) >= date_trunc('month', $3::date)
        ORDER BY 2`,
      [studentId, yearId, from],
    );
    return r.rows.map((x) => x.m);
  }

  /**
   * The fee profile follows the stays that touch the session: hosteller and the first and last month in
   * the hostel; then the session's demand is raised again (each month's hostel heads by the room type of
   * the bed held that month, app.hostel_fee_group_on). A
   * school without the fee set-up for the session still gets the allotment (synced = false, with why).
   */
  private async syncFee(
    c: PoolClient,
    studentId: string,
    yearId: string,
  ): Promise<{ synced: boolean; note?: string }> {
    const y = (
      await c.query<{ start_date: string; end_date: string }>(
        `SELECT start_date::text, end_date::text FROM academic_years WHERE id = $1`,
        [yearId],
      )
    ).rows[0];
    if (!y) return { synced: false, note: 'no session' };
    const span = (
      await c.query<{
        first: string | null;
        last: string | null;
        open: boolean;
        any: boolean;
      }>(
        `SELECT min(a.from_date)::text AS first, max(a.to_date)::text AS last, bool_or(a.to_date IS NULL) AS open, count(*) > 0 AS any
           FROM hostel_allotments a
          WHERE a.student_id = $1 AND a.from_date <= $3::date AND (a.to_date IS NULL OR a.to_date >= $2::date)`,
        [studentId, y.start_date, y.end_date],
      )
    ).rows[0]!;
    const month = (d: string) => `${d.slice(0, 7)}-01`;
    const hosteller = span.any;
    const from = hosteller && span.first && span.first > y.start_date ? month(span.first) : null;
    const to =
      hosteller && !span.open && span.last && span.last < y.end_date ? month(span.last) : null;
    await c.query('SAVEPOINT hostel_fee');
    try {
      await c.query(
        `INSERT INTO student_fee_profiles (school_id, student_id, academic_year_id, hosteller, hostel_from, hostel_to, created_by, updated_by)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5, app.current_user_id(), app.current_user_id())
         ON CONFLICT (student_id, academic_year_id) DO UPDATE SET hosteller = EXCLUDED.hosteller, hostel_from = EXCLUDED.hostel_from,
              hostel_to = EXCLUDED.hostel_to, updated_at = now(), updated_by = app.current_user_id()`,
        [studentId, yearId, hosteller, from, to],
      );
      const run = await c.query<{ run_id: string }>(
        `SELECT o_run_id::text AS run_id FROM app.generate_fee_demand($1, $2)`,
        [studentId, yearId],
      );
      await c.query(`SELECT app.apply_instalment_override($1, $2, $3)`, [
        studentId,
        yearId,
        run.rows[0]!.run_id,
      ]);
      await c.query('RELEASE SAVEPOINT hostel_fee');
      return { synced: true };
    } catch (e) {
      await c.query('ROLLBACK TO SAVEPOINT hostel_fee');
      const err = e as { code?: string; message?: string };
      if (err.code === 'P0001') return { synced: false, note: err.message ?? 'fee set-up missing' };
      throw e;
    }
  }
}

/** Bed labels A, B, ... Z, AA, AB ... */
export function bedLabel(i: number): string {
  let n = i;
  let s = '';
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

function nextMonth(iso: string): string {
  const [y, m] = day(iso).split('-').map(Number);
  const d = new Date(Date.UTC(y!, m!, 1));
  return d.toISOString().slice(0, 10);
}
