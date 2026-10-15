import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { readSheet, templateSheet } from '../../common/excel/sheet';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import type { ImportDto } from './hostel.dto';
import { HostelService } from './hostel.service';

const HEADERS = [
  'Hostel code',
  'Block',
  'Floor',
  'Room no',
  'Room type',
  'Bed',
  'Admission no',
  'From date',
] as const;

/** Thrown at the end of a check run so nothing it did is kept. */
class DryRun extends Error {}

/**
 * Go-live in one sheet: each row is a bed (made when missing, with its block and room) and, when an
 * admission no. is given, the pupil allotted to it from the date. "Check" runs every row and keeps
 * nothing; "Apply" keeps the good rows. A row in error is reported with its Excel line.
 */
@Injectable()
export class HostelImportService {
  constructor(
    private readonly db: DbService,
    private readonly hostel: HostelService,
  ) {}

  async template(ctx: RequestContext) {
    const { hostels, types } = await this.db.tenant(requireTenant(ctx), async (c) => ({
      hostels: (
        await c.query<{ code: string }>(
          `SELECT code FROM hostels WHERE status = 'active' ORDER BY code`,
        )
      ).rows.map((r) => r.code),
      types: (
        await c.query<{ name: string }>(
          `SELECT name FROM hostel_room_types WHERE status = 'active' ORDER BY name`,
        )
      ).rows.map((r) => r.name),
    }));
    const bytes = await templateSheet({
      sheet: 'Hostel beds',
      columns: [
        { header: 'Hostel code', width: 14, options: hostels, required: true },
        { header: 'Block', width: 12 },
        { header: 'Floor', width: 8 },
        { header: 'Room no', width: 10, required: true },
        { header: 'Room type', width: 22, options: types, required: true },
        { header: 'Bed', width: 8, required: true },
        { header: 'Admission no', width: 16 },
        { header: 'From date', width: 14 },
      ],
      guide: [
        'One row per bed. Hostels and room types are set up on the screen first (Hostel -> Set-up).',
        'Block, room and bed are made when they do not exist yet; a room made here takes the room type given.',
        'Floor: 0 for the ground floor. A block made here gets enough floors for the rooms in the sheet.',
        'Admission no.: the pupil on that bed. Leave it empty for an empty bed.',
        'From date: when the pupil took the bed (YYYY-MM-DD or a date cell); empty = today.',
        'Allotting a pupil makes them a hosteller and raises the hostel fee from that month by the room type.',
        'Upload with "Check" first: nothing is kept and every problem is listed with its row. Then "Apply".',
      ],
    });
    return {
      filename: 'hostel-beds.xlsx',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      base64: bytes.toString('base64'),
    };
  }

  async upload(ctx: RequestContext, dto: ImportDto) {
    const rows = await readSheet(dto.fileBase64, [...HEADERS]);
    const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
    const result = {
      apply: dto.apply,
      rows: rows.length,
      beds: 0,
      rooms: 0,
      allotted: 0,
      feeNotSynced: 0,
      errors: [] as Array<{ row: number; message: string }>,
    };
    try {
      await this.db.tenant(requireTenant(ctx), async (c) => {
        for (const { row, cells } of rows) {
          await c.query('SAVEPOINT hostel_row');
          try {
            const made = await this.row(ctx, c, cells, today);
            result.beds += made.bed ? 1 : 0;
            result.rooms += made.room ? 1 : 0;
            result.allotted += made.allotted ? 1 : 0;
            result.feeNotSynced += made.feeNotSynced ? 1 : 0;
            await c.query('RELEASE SAVEPOINT hostel_row');
          } catch (e) {
            await c.query('ROLLBACK TO SAVEPOINT hostel_row');
            if (!(e instanceof DomainError)) throw e;
            result.errors.push({ row, message: e.message });
          }
        }
        if (!dto.apply) throw new DryRun();
      });
    } catch (e) {
      if (!(e instanceof DryRun)) throw e;
    }
    return result;
  }

  private async row(
    ctx: RequestContext,
    c: PoolClient,
    cells: Record<string, string>,
    today: string,
  ) {
    const out = { bed: false, room: false, allotted: false, feeNotSynced: false };
    const need = (k: (typeof HEADERS)[number]) => {
      const v = (cells[k] ?? '').trim();
      if (!v) throw new DomainError('validation-failed', `${k} is empty`);
      return v;
    };
    const hostel = (
      await c.query<{ id: string }>(`SELECT id::text FROM hostels WHERE upper(code) = upper($1)`, [
        need('Hostel code'),
      ])
    ).rows[0];
    if (!hostel)
      throw new DomainError('validation-failed', `No hostel with code "${cells['Hostel code']}"`);
    const type = (
      await c.query<{ id: string }>(
        `SELECT id::text FROM hostel_room_types WHERE lower(name) = lower($1) AND status = 'active'`,
        [need('Room type')],
      )
    ).rows[0];
    if (!type) throw new DomainError('validation-failed', `No room type "${cells['Room type']}"`);
    const floorText = (cells.Floor ?? '').trim();
    const floor = floorText === '' ? 0 : Number(floorText);
    if (!Number.isInteger(floor) || floor < 0 || floor > 40)
      throw new DomainError(
        'validation-failed',
        'Floor must be a whole number from 0 (ground) to 40',
      );
    // the block, made (or given more floors) when the sheet needs it
    let blockId: string | null = null;
    const blockName = (cells.Block ?? '').trim();
    if (blockName) {
      const b = await c.query<{ id: string }>(
        `INSERT INTO hostel_blocks (school_id, hostel_id, name, floors) VALUES (app.current_school_id(), $1, $2, $3)
         ON CONFLICT (hostel_id, name) DO UPDATE SET floors = GREATEST(hostel_blocks.floors, EXCLUDED.floors)
         RETURNING id::text`,
        [hostel.id, blockName.slice(0, 40), floor + 1],
      );
      blockId = b.rows[0]!.id;
    }
    const roomNo = need('Room no').slice(0, 20);
    let room = (
      await c.query<{ id: string; room_type_id: string }>(
        `SELECT id::text, room_type_id::text FROM hostel_rooms WHERE hostel_id = $1 AND room_no = $2`,
        [hostel.id, roomNo],
      )
    ).rows[0];
    if (!room) {
      const made = await this.hostel.createRoomIn(ctx, c, {
        hostelId: hostel.id,
        blockId,
        floor,
        roomNo,
        roomTypeId: type.id,
        status: 'active',
        beds: 0,
      });
      room = { id: made.id, room_type_id: type.id };
      out.room = true;
    } else if (room.room_type_id !== type.id)
      throw new DomainError(
        'validation-failed',
        `Room ${roomNo} is already set up with another room type`,
      );
    const label = need('Bed').toUpperCase().slice(0, 10);
    let bed = (
      await c.query<{ id: string }>(
        `SELECT id::text FROM hostel_beds WHERE room_id = $1 AND label = $2`,
        [room.id, label],
      )
    ).rows[0];
    if (!bed) {
      bed = (
        await c.query<{ id: string }>(
          `INSERT INTO hostel_beds (school_id, room_id, label) VALUES (app.current_school_id(), $1, $2) RETURNING id::text`,
          [room.id, label],
        )
      ).rows[0]!;
      out.bed = true;
    }
    const adm = (cells['Admission no'] ?? '').trim();
    if (adm) {
      const st = (
        await c.query<{ id: string }>(
          `SELECT id::text FROM students WHERE lower(admission_no) = lower($1) AND deleted_at IS NULL LIMIT 1`,
          [adm],
        )
      ).rows[0];
      if (!st) throw new DomainError('validation-failed', `No pupil with admission no. "${adm}"`);
      const from = (cells['From date'] ?? '').trim().slice(0, 10) || today;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from))
        throw new DomainError('validation-failed', 'From date must be YYYY-MM-DD');
      const a = await this.hostel.allotIn(ctx, c, {
        studentId: st.id,
        bedId: bed.id,
        fromDate: from,
      });
      out.allotted = true;
      out.feeNotSynced = !a.fee.synced;
    }
    return out;
  }
}
