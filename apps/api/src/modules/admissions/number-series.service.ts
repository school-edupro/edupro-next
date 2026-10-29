import { Injectable } from '@nestjs/common';
import type { AdmissionAnswers, AdmissionCondition, PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import {
  fillPrefix,
  numberTaken,
  seriesPick,
  seriesPlace,
  seriesPreview,
  seriesText,
  unknownPlaceholder,
  type SeriesKind,
} from './number-series';
import type { NumberSeriesDto, NumberSeriesRenumberDto, NumberSeriesTestDto } from './scores.dto';

/**
 * Number series of admission (docs/design/48, part 5): for Registration no. and for Admission no., a
 * series per session and class (or every class), and optionally form answers (round, student type,
 * board), each with a prefix, the next number and its digits. Two series of a session may not make the
 * same numbers, and a series may not start on a number already given. The prefix may hold {SESSION},
 * {YYYY}, {YY} and {CLASS}; a series can be tried without using it, and registrations already made can
 * be renumbered from it, their old numbers kept (docs/design/63).
 */
@Injectable()
export class AdmissionNumberSeriesService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  private async listWith(c: PoolClient) {
    const r = await c.query<{
      id: string;
      kind: SeriesKind;
      cycle_id: string;
      cycle_name: string;
      class_id: string | null;
      class_name: string | null;
      conditions: AdmissionCondition[];
      name: string;
      prefix: string;
      next_no: string;
      digits: number;
      last_given: string | null;
      given: number;
      year: string | null;
      code: string | null;
    }>(
      // a series for every class fills {CLASS} with the session's first class, as a sample
      `SELECT s.id::text, s.kind, s.cycle_id::text, y.name AS cycle_name, s.class_id::text, cl.name AS class_name,
              s.conditions, s.name, s.prefix, s.next_no::text, s.digits, s.last_given, s.given, ay.name AS year,
              COALESCE(cl.code, (SELECT c2.code FROM admission_class_criteria k JOIN classes c2 ON c2.id = k.class_id
                                  WHERE k.cycle_id = s.cycle_id ORDER BY c2.display_order, c2.name LIMIT 1)) AS code
         FROM admission_number_series s JOIN admission_cycles y ON y.id = s.cycle_id
         JOIN academic_years ay ON ay.id = y.academic_year_id
         LEFT JOIN classes cl ON cl.id = s.class_id
        WHERE s.status = 'active' AND y.deleted_at IS NULL
        ORDER BY y.opens_at DESC, s.kind DESC, cl.display_order NULLS FIRST, s.id`,
    );
    return r.rows.map((x) => ({
      id: x.id,
      kind: x.kind,
      cycleId: x.cycle_id,
      cycleName: x.cycle_name,
      classId: x.class_id,
      className: x.class_name,
      conditions: x.conditions,
      name: x.name,
      prefix: x.prefix,
      nextNo: Number(x.next_no),
      digits: x.digits,
      next: seriesText(
        fillPrefix(x.prefix, { session: x.year ?? '', classCode: x.code }),
        x.next_no,
        x.digits,
      ),
      // {CLASS} in a series for every class: the sample is one class's; each class gets its own code
      perClass: !x.class_id && x.prefix.includes('{CLASS}'),
      lastGiven: x.last_given,
      given: x.given,
    }));
  }

  async list(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const cycles = await c.query<{
        id: string;
        name: string;
        code: string;
        year: string | null;
        registrations: number;
      }>(
        `SELECT y.id::text, y.name, y.code, ay.name AS year,
                (SELECT count(*)::int FROM applications a WHERE a.cycle_id = y.id AND a.application_no IS NOT NULL) AS registrations
           FROM admission_cycles y JOIN academic_years ay ON ay.id = y.academic_year_id
          WHERE y.deleted_at IS NULL ORDER BY y.opens_at DESC`,
      );
      const classes = await c.query<{ cycle_id: string; id: string; name: string; code: string }>(
        `SELECT k.cycle_id::text, cl.id::text, cl.name, cl.code FROM admission_class_criteria k JOIN classes cl ON cl.id = k.class_id
          ORDER BY cl.display_order, cl.name`,
      );
      return {
        series: await this.listWith(c),
        cycles: cycles.rows.map((y) => ({
          id: y.id,
          name: y.name,
          // the default when no series matches: APP/<code>/00001 and the school's admission series
          defaultRegistration: `APP/${y.code}/00001`,
          // for the placeholders' live sample, and the session the page opens on
          session: (y.year ?? '').replace(/^Session\s+/i, ''),
          registrations: y.registrations,
          classes: classes.rows
            .filter((k) => k.cycle_id === y.id)
            .map((k) => ({ id: k.id, name: k.name, code: k.code })),
        })),
      };
    });
  }

  async save(ctx: RequestContext, id: string | null, dto: NumberSeriesDto) {
    if (id && !/^\d{1,18}$/.test(id))
      throw new DomainError('not-found', 'Series not found', { status: 404 });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const y = await c.query(
        `SELECT 1 FROM admission_cycles WHERE id = $1 AND deleted_at IS NULL`,
        [dto.cycleId],
      );
      if (!y.rows.length)
        throw new DomainError('validation-failed', 'Choose a session', { status: 400 });
      if (dto.classId) {
        const k = await c.query(
          `SELECT 1 FROM admission_class_criteria WHERE cycle_id = $1 AND class_id = $2`,
          [dto.cycleId, dto.classId],
        );
        if (!k.rows.length)
          throw new DomainError('validation-failed', 'The class is not in that session', {
            status: 400,
          });
      }
      const odd = unknownPlaceholder(dto.prefix);
      if (odd)
        throw new DomainError(
          'validation-failed',
          `${odd} is not a placeholder: use {SESSION}, {YYYY}, {YY} or {CLASS}`,
          { status: 400 },
        );
      const place = await seriesPlace(c, dto.cycleId, dto.classId ?? null);
      const first = dto.classId
        ? place
        : {
            ...place,
            classCode:
              (
                await c.query<{ code: string }>(
                  `SELECT cl.code FROM admission_class_criteria k JOIN classes cl ON cl.id = k.class_id
                    WHERE k.cycle_id = $1 ORDER BY cl.display_order, cl.name LIMIT 1`,
                  [dto.cycleId],
                )
              ).rows[0]?.code ?? null,
          };
      const next = seriesText(fillPrefix(dto.prefix, first), dto.nextNo, dto.digits);
      // two series of a session making the same numbers would give one twice
      const others = (await this.listWith(c)).filter(
        (s) => s.id !== id && s.kind === dto.kind && s.cycleId === dto.cycleId,
      );
      const clash = others.find((s) => {
        const a = dto.prefix.toLowerCase();
        const b = s.prefix.toLowerCase();
        return (
          (a.startsWith(b) || b.startsWith(a)) && a.length + dto.digits === b.length + s.digits
        );
      });
      if (clash)
        throw new DomainError(
          'conflict',
          `“${clash.name}” makes numbers like ${clash.next} too: give this series another prefix`,
          { status: 409 },
        );
      if (await numberTaken(c, dto.kind, next)) {
        // changing only the name of a series in use keeps its next number
        const same = id
          ? await c.query(
              `SELECT 1 FROM admission_number_series WHERE id = $1 AND prefix = $2 AND next_no = $3 AND digits = $4`,
              [id, dto.prefix, dto.nextNo, dto.digits],
            )
          : { rows: [] };
        if (!same.rows.length)
          throw new DomainError(
            'conflict',
            `${next} is given already: start the series after the last number given`,
            { status: 409 },
          );
      }
      const params = [
        dto.kind,
        dto.cycleId,
        dto.classId ?? null,
        dto.name,
        JSON.stringify(dto.conditions),
        dto.prefix,
        dto.nextNo,
        dto.digits,
      ];
      const r = id
        ? await c.query<{ id: string }>(
            `UPDATE admission_number_series SET kind = $1, cycle_id = $2, class_id = $3, name = $4, conditions = $5::jsonb,
                    prefix = $6, next_no = $7, digits = $8, updated_at = now()
              WHERE id = $9 AND status = 'active' RETURNING id::text`,
            [...params, id],
          )
        : await c.query<{ id: string }>(
            `INSERT INTO admission_number_series (school_id, kind, cycle_id, class_id, name, conditions, prefix, next_no, digits)
             VALUES (app.current_school_id(), $1, $2, $3, $4, $5::jsonb, $6, $7, $8) RETURNING id::text`,
            params,
          );
      if (!r.rows[0]) throw new DomainError('not-found', 'Series not found', { status: 404 });
      await this.audit.stage(ctx, c, {
        action: `admissions.number_series.${id ? 'update' : 'create'}`,
        entityType: 'admission_number_series',
        entityId: r.rows[0].id,
        after: { kind: dto.kind, name: dto.name, next },
      });
      return { series: await this.listWith(c) };
    });
  }

  /**
   * Test a series (docs/design/63): the series a registration of the class with these answers would
   * take and the number it would get now, nothing used; none: the default numbers.
   */
  async test(ctx: RequestContext, dto: NumberSeriesTestDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const k = await c.query<{ code: string }>(
        `SELECT y.code FROM admission_class_criteria k JOIN admission_cycles y ON y.id = k.cycle_id
          WHERE k.cycle_id = $1 AND k.class_id = $2 AND y.deleted_at IS NULL`,
        [dto.cycleId, dto.classId],
      );
      if (!k.rows[0])
        throw new DomainError('validation-failed', 'The class is not in that session', {
          status: 400,
        });
      const got = await seriesPreview(c, dto.kind, {
        cycle_id: dto.cycleId,
        class_id: dto.classId,
        data: dto.answers,
      });
      return got
        ? { series: { id: got.id, name: got.name }, number: got.number, usual: null }
        : {
            series: null,
            number: null,
            // the default numbers when no series fits
            usual:
              dto.kind === 'registration'
                ? `APP/${k.rows[0].code}/… (the default numbers)`
                : 'the school’s last admission no. + 1 (the default)',
          };
    });
  }

  /**
   * Registrations already made, numbered again from their series (docs/design/63): those of the
   * series' session (and class) not yet admitted whose best series is this one, in registration order;
   * each keeps its old number (searchable), with a line in its history. A preview first; applying needs
   * a reason. Admission numbers are never renumbered.
   */
  async renumber(ctx: RequestContext, id: string, dto: NumberSeriesRenumberDto) {
    if (!/^\d{1,18}$/.test(id))
      throw new DomainError('not-found', 'Series not found', { status: 404 });
    if (dto.apply && !dto.reason)
      throw new DomainError('validation-failed', 'Give the reason for renumbering', {
        status: 400,
      });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{
        id: string;
        kind: SeriesKind;
        cycle_id: string;
        class_id: string | null;
        name: string;
        prefix: string;
        next_no: string;
        digits: number;
      }>(
        `SELECT id::text, kind, cycle_id::text, class_id::text, name, prefix, next_no::text, digits
           FROM admission_number_series WHERE id = $1 AND status = 'active' FOR UPDATE`,
        [id],
      );
      const s = r.rows[0];
      if (!s) throw new DomainError('not-found', 'Series not found', { status: 404 });
      if (s.kind !== 'registration')
        throw new DomainError(
          'validation-failed',
          'Admission numbers are on students’ records: they are not renumbered',
          { status: 400 },
        );
      const apps = await c.query<{
        id: string;
        number: string;
        candidate: string | null;
        class_id: string;
        data: AdmissionAnswers | null;
      }>(
        `SELECT a.id::text, a.application_no AS number, a.candidate_name AS candidate, a.class_id::text, a.data
           FROM applications a
          WHERE a.cycle_id = $1 AND ($2::bigint IS NULL OR a.class_id = $2::bigint) AND a.application_no IS NOT NULL
            AND a.admission_no IS NULL AND a.status::text NOT IN ('draft', 'admitted')
          ORDER BY a.registered_at NULLS LAST, a.id`,
        [s.cycle_id, s.class_id],
      );
      const places = new Map<string, Awaited<ReturnType<typeof seriesPlace>>>();
      const used = new Set<string>();
      const taken = async (no: string, self: string) => {
        if (used.has(no.toLowerCase())) return true;
        const t = await c.query(
          `SELECT 1 FROM applications WHERE lower(application_no) = lower($1) AND id <> $2 LIMIT 1`,
          [no, self],
        );
        return t.rows.length > 0;
      };
      let n = BigInt(s.next_no);
      const rows: Array<{ id: string; candidate: string | null; from: string; to: string }> = [];
      let skipped = 0;
      for (const a of apps.rows) {
        const best = await seriesPick(c, 'registration', {
          cycle_id: s.cycle_id,
          class_id: a.class_id,
          data: a.data,
        });
        if (best?.id !== s.id) continue;
        if (!places.has(a.class_id))
          places.set(a.class_id, await seriesPlace(c, s.cycle_id, a.class_id));
        const prefix = fillPrefix(s.prefix, places.get(a.class_id)!);
        // a number this series made already stays
        if (
          a.number.toLowerCase().startsWith(prefix.toLowerCase()) &&
          /^\d+$/.test(a.number.slice(prefix.length)) &&
          a.number.length - prefix.length >= s.digits
        ) {
          skipped += 1;
          continue;
        }
        let to = seriesText(prefix, n, s.digits);
        while (await taken(to, a.id)) {
          n += 1n;
          to = seriesText(prefix, n, s.digits);
        }
        used.add(to.toLowerCase());
        n += 1n;
        rows.push({ id: a.id, candidate: a.candidate, from: a.number, to });
      }
      if (dto.apply && rows.length) {
        for (const x of rows) {
          await c.query(
            `UPDATE applications SET application_no = $2, previous_numbers = array_append(previous_numbers, $3),
                    updated_at = now() WHERE id = $1`,
            [x.id, x.to, x.from],
          );
          await c.query(
            `INSERT INTO application_events (school_id, application_id, from_status, to_status, note, actor_user_id)
             SELECT app.current_school_id(), a.id, a.status, a.status, $2, $3 FROM applications a WHERE a.id = $1`,
            [
              x.id,
              `Registration no. ${x.from} → ${x.to} (renumbered from “${s.name}”): ${dto.reason ?? ''}`.slice(
                0,
                500,
              ),
              ctx.user.id,
            ],
          );
        }
        await c.query(
          `UPDATE admission_number_series SET next_no = $2, last_given = $3, given = given + $4, updated_at = now()
            WHERE id = $1`,
          [s.id, n.toString(), rows[rows.length - 1]!.to, rows.length],
        );
        await this.audit.stage(ctx, c, {
          action: 'admissions.number_series.renumber',
          entityType: 'admission_number_series',
          entityId: s.id,
          after: { renumbered: rows.length, reason: dto.reason },
        });
      }
      return {
        applied: Boolean(dto.apply && rows.length),
        rows,
        skipped,
        series: await this.listWith(c),
      };
    });
  }

  async archive(ctx: RequestContext, id: string) {
    if (!/^\d{1,18}$/.test(id))
      throw new DomainError('not-found', 'Series not found', { status: 404 });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query(
        `UPDATE admission_number_series SET status = 'inactive', updated_at = now() WHERE id = $1 AND status = 'active'`,
        [id],
      );
      if (!r.rowCount) throw new DomainError('not-found', 'Series not found', { status: 404 });
      await this.audit.stage(ctx, c, {
        action: 'admissions.number_series.archive',
        entityType: 'admission_number_series',
        entityId: id,
      });
      return { series: await this.listWith(c) };
    });
  }
}
