import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { AdmissionCoreService } from './admission-core.service';
import { tablePdf } from './admission-pdf';
import { drawSlipsPdf, type Slip, type SlipField } from './draw-slips-pdf';
import { meritOrder } from './merit-order';
import type {
  DrawBlankDto,
  DrawGroupDto,
  DrawPlaceDto,
  DrawRecordDto,
  DrawRecordsQueryDto,
  DrawSettingsDto,
  DrawSettingsQueryDto,
  DrawTwinsDto,
} from './draw.dto';
import { slotWhen } from './process-engine';
import { AdmissionProcessService } from './process.service';
import { AdmissionScheduleService } from './schedule.service';

/** Candidates who may be drawn: registered, not yet decided out, offered or admitted. */
const ELIGIBLE = `a.cycle_id = $1 AND a.class_id = $2 AND ($3::bigint IS NULL OR a.category_id = $3::bigint)
  AND a.application_no IS NOT NULL AND a.status::text IN ('registered', 'under_review')`;

/** The slip as the legacy one was, until the school sets its own. */
const DEFAULTS = {
  heading: 'Draw slip - {class} ({points} points)',
  fields: ['name', 'father', 'number', 'sno', 'session', 'draw'] as SlipField[],
  drawAt: null as string | null,
  venue: null as string | null,
  footer: '*Admission subject to verification of documents of successful candidates.' as
    string | null,
  perPage: 4 as 2 | 4 | 6 | 8,
  showLogo: true,
};
export type DrawSettings = typeof DEFAULTS;

interface FormField {
  key: string;
  type?: string;
  maps?: string;
  docKind?: string;
}
interface Candidate {
  id: string;
  number: string;
  candidate: string | null;
  dob: string | null;
  mobile: string | null;
  points: string;
  merit: string;
  confirmed: boolean;
  category: string | null;
  stage: string | null;
  stageKind: string | null;
  data: Record<string, unknown>;
  fields: FormField[];
}

const dmy = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat('en-IN', {
        timeZone: 'UTC',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }).format(new Date(`${iso}T00:00:00Z`))
    : null;

/**
 * Draw of lots (docs/design/60, 62): the registered candidates of a class (and category) sharing a total
 * of the form's merit points (test and interview marks not added; Document check need not have
 * approved them), twins on one slip (found by the same date of birth and family mobile, confirmed or
 * split by the office), and the slips printed with the school's settings.
 */
@Injectable()
export class AdmissionDrawService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly core: AdmissionCoreService,
    private readonly schedule: AdmissionScheduleService,
    private readonly process: AdmissionProcessService,
  ) {}

  /** The sessions with their classes, and the categories, for the page's choices. */
  async options(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const cycles = await c.query<{ id: string; name: string }>(
        `SELECT id::text, name FROM admission_cycles WHERE deleted_at IS NULL ORDER BY opens_at DESC, id DESC`,
      );
      const classes = await c.query<{ cycle_id: string; id: string; name: string }>(
        `SELECT k.cycle_id::text, cl.id::text, cl.name FROM admission_class_criteria k JOIN classes cl ON cl.id = k.class_id
          ORDER BY cl.display_order, cl.name`,
      );
      // registered candidates with merit points who may still be drawn: the page opens where there are some
      const counts = await c.query<{ cycle_id: string; class_id: string; n: number }>(
        `SELECT cycle_id::text, class_id::text, count(*)::int AS n FROM applications
          WHERE form_points IS NOT NULL AND application_no IS NOT NULL AND status::text IN ('registered', 'under_review')
          GROUP BY 1, 2`,
      );
      const n = (cycleId: string, classId: string) =>
        counts.rows.find((x) => x.cycle_id === cycleId && x.class_id === classId)?.n ?? 0;
      const categories = await c.query<{ id: string; name: string }>(
        `SELECT id::text, name FROM admission_fee_categories WHERE status = 'active' ORDER BY sort_order, name`,
      );
      return {
        cycles: cycles.rows.map((y) => ({
          ...y,
          classes: classes.rows
            .filter((k) => k.cycle_id === y.id)
            .map((k) => ({ id: k.id, name: k.name, withPoints: n(y.id, k.id) })),
        })),
        categories: categories.rows,
      };
    });
  }

  private async placeOf(c: PoolClient, p: DrawPlaceDto) {
    const r = await c.query<{ cycle: string; class_name: string; category: string | null }>(
      `SELECT y.name AS cycle, cl.name AS class_name,
              (SELECT name FROM admission_fee_categories WHERE id = $3::bigint) AS category
         FROM admission_cycles y JOIN admission_class_criteria k ON k.cycle_id = y.id AND k.class_id = $2
         JOIN classes cl ON cl.id = k.class_id
        WHERE y.id = $1 AND y.deleted_at IS NULL`,
      [p.cycleId, p.classId, p.categoryId ?? null],
    );
    const x = r.rows[0];
    if (!x)
      throw new DomainError('not-found', 'That class is not in this session', { status: 404 });
    if (p.categoryId && !x.category)
      throw new DomainError('not-found', 'No such category', { status: 404 });
    return { cycle: x.cycle, className: x.class_name, category: x.category };
  }

  /**
   * Each total of the form's merit points (docs/design/62): the registered candidates with it, and how
   * many of them Document check has confirmed (for the office's eye; every one gets a slip).
   */
  async totals(ctx: RequestContext, p: DrawPlaceDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const place = await this.placeOf(c, p);
      const r = await c.query<{ points: string; candidates: number; confirmed: number }>(
        // eslint-disable-next-line no-restricted-syntax -- ELIGIBLE is a constant; values are bound parameters
        `SELECT trim_scale(a.form_points)::text AS points, count(*)::int AS candidates,
                count(*) FILTER (WHERE a.points_confirmed_at IS NOT NULL)::int AS confirmed
           FROM applications a WHERE ${ELIGIBLE} AND a.form_points IS NOT NULL
          GROUP BY a.form_points ORDER BY a.form_points DESC`,
        [p.cycleId, p.classId, p.categoryId ?? null],
      );
      return { place, totals: r.rows };
    });
  }

  /** The candidates of a points total, in registration order. */
  private async candidatesOf(c: PoolClient, p: DrawGroupDto): Promise<Candidate[]> {
    const r = await c.query<{
      id: string;
      number: string;
      candidate: string | null;
      dob: string | null;
      mobile: string | null;
      points: string;
      merit: string;
      confirmed: boolean;
      category: string | null;
      stage: string | null;
      stage_kind: string | null;
      data: Record<string, unknown> | null;
      def: { fields?: FormField[] } | null;
    }>(
      // eslint-disable-next-line no-restricted-syntax -- ELIGIBLE is a constant; values are bound parameters
      `SELECT a.id::text, a.application_no AS number, a.candidate_name AS candidate, a.child_dob::text AS dob,
              a.contact_mobile AS mobile, COALESCE(trim_scale(a.form_points)::text, '-') AS points,
              trim_scale(a.merit)::text AS merit,
              a.points_confirmed_at IS NOT NULL AS confirmed, k.name AS category, st.name AS stage, st.kind AS stage_kind, a.data,
              COALESCE(a.form_snapshot, f.def) AS def
         FROM applications a LEFT JOIN admission_fee_categories k ON k.id = a.category_id
         LEFT JOIN admission_forms f ON f.id = a.form_id
         LEFT JOIN admission_stages st ON st.id::text = (a.process_steps -> a.stage_no ->> 'stageId')
        WHERE ${ELIGIBLE} AND a.form_points = $4::numeric
        ORDER BY a.application_no, a.id`,
      [p.cycleId, p.classId, p.categoryId ?? null, p.points],
    );
    return r.rows.map(({ stage_kind, def, ...x }) => ({
      ...x,
      stageKind: stage_kind,
      data: x.data ?? {},
      fields: def?.fields ?? [],
    }));
  }

  /** A form answer by what the field maps to (or its key), as text. */
  private answer(x: Candidate, maps: string) {
    const f = x.fields.find((y) => y.maps === maps) ?? x.fields.find((y) => y.key === maps);
    const v = f ? x.data[f.key] : undefined;
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  }

  /**
   * Twins among the candidates: the same date of birth and family mobile, joined with the pairs the
   * office confirmed; a pair the office split stays apart. Each group: its ids and state.
   */
  private async twinsOf(c: PoolClient, list: Candidate[]) {
    const ids = list.map((x) => x.id);
    const key = (a: string, b: string) => (BigInt(a) < BigInt(b) ? `${a}:${b}` : `${b}:${a}`);
    const edges = new Map<string, 'found' | 'paired'>();
    const split = new Set<string>();
    const byKey = new Map<string, string[]>();
    for (const x of list) {
      const mobile = (x.mobile ?? '').replace(/\D/g, '').slice(-10);
      if (!x.dob || mobile.length < 10) continue;
      const k = `${x.dob}|${mobile}`;
      byKey.set(k, [...(byKey.get(k) ?? []), x.id]);
    }
    for (const g of byKey.values())
      for (let i = 0; i < g.length; i++)
        for (let j = i + 1; j < g.length; j++) edges.set(key(g[i]!, g[j]!), 'found');
    if (ids.length) {
      const rows = await c.query<{ a: string; b: string; state: 'paired' | 'split' }>(
        `SELECT app_a::text AS a, app_b::text AS b, state FROM admission_twin_pairs
          WHERE app_a = ANY($1::bigint[]) AND app_b = ANY($1::bigint[])`,
        [ids],
      );
      for (const r of rows.rows) {
        const k = key(r.a, r.b);
        if (r.state === 'split') {
          if (edges.delete(k)) split.add(k);
        } else edges.set(k, 'paired');
      }
    }
    // joined into groups
    const parent = new Map(ids.map((id) => [id, id]));
    const root = (id: string): string => {
      const p = parent.get(id)!;
      if (p === id) return id;
      const r = root(p);
      parent.set(id, r);
      return r;
    };
    for (const k of edges.keys()) {
      const [a, b] = k.split(':') as [string, string];
      parent.set(root(a), root(b));
    }
    const groups = new Map<string, string[]>();
    for (const id of ids) groups.set(root(id), [...(groups.get(root(id)) ?? []), id]);
    const out: Array<{ ids: string[]; state: 'found' | 'paired' | 'split' }> = [];
    for (const g of groups.values()) {
      if (g.length < 2) continue;
      const mine = [...edges.entries()].filter(([k]) => k.split(':').every((id) => g.includes(id)));
      out.push({ ids: g, state: mine.every(([, s]) => s === 'paired') ? 'paired' : 'found' });
    }
    for (const k of split) out.push({ ids: k.split(':'), state: 'split' });
    return out;
  }

  /**
   * A points total's candidates, every registered one on the slips (whether or not Document check has
   * confirmed the points yet), the twins, and how many slips that makes.
   */
  async group(ctx: RequestContext, p: DrawGroupDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const place = await this.placeOf(c, p);
      const ready = await this.candidatesOf(c, p);
      const twins = await this.twinsOf(c, ready);
      const joined = twins.filter((t) => t.state !== 'split');
      const meritNo = await this.meritNos(c, p.cycleId, p.classId);
      return {
        place,
        points: p.points,
        candidates: ready.map((x) => ({
          id: x.id,
          number: x.number,
          candidate: x.candidate,
          father: this.answer(x, 'father_name'),
          dob: x.dob,
          points: x.points,
          merit: x.merit,
          meritNo: meritNo.get(x.id) ?? null,
          confirmed: x.confirmed,
          category: x.category,
          stage: x.stage,
        })),
        twins,
        slips: ready.length - joined.reduce((n, t) => n + t.ids.length - 1, 0),
      };
    });
  }

  /** Twins confirmed on one slip, or split onto a slip each (every pair of the group). */
  async setTwins(ctx: RequestContext, dto: DrawTwinsDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const ids = [...new Set(dto.ids)];
      const r = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM applications WHERE id = ANY($1::bigint[]) AND cycle_id = $2 AND class_id = $3`,
        [ids, dto.cycleId, dto.classId],
      );
      if (ids.length < 2 || r.rows[0]!.n !== ids.length)
        throw new DomainError(
          'validation-failed',
          'Twins must be two or more registrations of the same class and session',
          { status: 400 },
        );
      for (let i = 0; i < ids.length; i++)
        for (let j = i + 1; j < ids.length; j++) {
          const [a, b] =
            BigInt(ids[i]!) < BigInt(ids[j]!) ? [ids[i]!, ids[j]!] : [ids[j]!, ids[i]!];
          await c.query(
            `INSERT INTO admission_twin_pairs (school_id, cycle_id, class_id, app_a, app_b, state, set_by)
             VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6)
             ON CONFLICT (app_a, app_b) DO UPDATE SET state = EXCLUDED.state, set_by = EXCLUDED.set_by, set_at = now()`,
            [dto.cycleId, dto.classId, a, b, dto.state, ctx.user.id],
          );
        }
      await this.audit.stage(ctx, c, {
        action: `admissions.draw.twins_${dto.state}`,
        entityType: 'applications',
        entityId: ids[0]!,
        after: { ids, state: dto.state },
      });
      return { ids, state: dto.state };
    });
  }

  private async settingsOf(c: PoolClient, cycleId: string, classId?: string | null) {
    const r = await c.query<{
      class_id: string | null;
      heading: string;
      fields: SlipField[];
      draw_at: Date | null;
      venue: string | null;
      footer: string | null;
      per_page: 2 | 4 | 6 | 8;
      show_logo: boolean;
    }>(
      `SELECT class_id::text, heading, fields, draw_at, venue, footer, per_page, show_logo FROM admission_draw_settings
        WHERE cycle_id = $1 AND (class_id IS NULL OR class_id = $2::bigint) ORDER BY class_id NULLS LAST`,
      [cycleId, classId ?? null],
    );
    const x = r.rows[0];
    const settings: DrawSettings = x
      ? {
          heading: x.heading,
          fields: x.fields,
          drawAt: x.draw_at?.toISOString() ?? null,
          venue: x.venue,
          footer: x.footer,
          perPage: x.per_page,
          showLogo: x.show_logo,
        }
      : DEFAULTS;
    // whose settings these are: the class's own, the session's, or the defaults
    const from: 'class' | 'session' | 'defaults' = !x
      ? 'defaults'
      : x.class_id && classId
        ? 'class'
        : 'session';
    return { from, settings };
  }

  /** The slips' settings of a session, or as a class prints them (its own, else the session's). */
  async settings(ctx: RequestContext, q: DrawSettingsQueryDto) {
    return this.db.tenant(requireTenant(ctx), (c) => this.settingsOf(c, q.cycleId, q.classId));
  }

  async saveSettings(ctx: RequestContext, dto: DrawSettingsDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const params = [
        dto.cycleId,
        dto.classId ?? null,
        dto.heading,
        dto.fields,
        dto.drawAt,
        dto.venue || null,
        dto.footer || null,
        dto.perPage,
        dto.showLogo,
        ctx.user.id,
      ];
      const upd = await c.query(
        `UPDATE admission_draw_settings SET heading = $3, fields = $4::text[], draw_at = $5, venue = $6, footer = $7,
                per_page = $8, show_logo = $9, updated_by = $10, updated_at = now()
          WHERE cycle_id = $1 AND class_id IS NOT DISTINCT FROM $2::bigint`,
        params,
      );
      if (!upd.rowCount)
        await c.query(
          `INSERT INTO admission_draw_settings (school_id, cycle_id, class_id, heading, fields, draw_at, venue, footer, per_page,
                                                show_logo, updated_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4::text[], $5, $6, $7, $8, $9, $10)`,
          params,
        );
      await this.audit.stage(ctx, c, {
        action: 'admissions.draw.settings',
        entityType: 'admission_cycles',
        entityId: dto.cycleId,
        after: { classId: dto.classId ?? null, heading: dto.heading, fields: dto.fields },
      });
      return this.settingsOf(c, dto.cycleId, dto.classId);
    });
  }

  /** A class's own settings removed: it prints with the session's again. */
  async clearSettings(ctx: RequestContext, q: DrawSettingsQueryDto) {
    if (!q.classId)
      throw new DomainError('validation-failed', 'Choose the class whose own settings to remove', {
        status: 400,
      });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await c.query(`DELETE FROM admission_draw_settings WHERE cycle_id = $1 AND class_id = $2`, [
        q.cycleId,
        q.classId,
      ]);
      return this.settingsOf(c, q.cycleId, q.classId);
    });
  }

  /** Each live registration's place in the class's merit list (the score report's rank). */
  private async meritNos(c: PoolClient, cycleId: string, classId: string) {
    const seed = await c.query<{ seed: string | null }>(
      `SELECT merit_seed AS seed FROM admission_class_criteria WHERE cycle_id = $1 AND class_id = $2`,
      [cycleId, classId],
    );
    const r = await c.query<{
      id: string;
      number: string | null;
      merit: string | null;
      dob: string | null;
    }>(
      `SELECT id::text, application_no AS number, merit::text, child_dob::text AS dob FROM applications
        WHERE cycle_id = $1 AND class_id = $2 AND form_id IS NOT NULL
          AND status::text NOT IN ('draft', 'cancelled', 'withdrawn', 'rejected')`,
      [cycleId, classId],
    );
    const { order } = meritOrder(
      r.rows.map((x) => ({ ...x, merit: x.merit !== null ? Number(x.merit) : null })),
      seed.rows[0]?.seed ?? null,
    );
    return new Map(order.map((x) => [x.id, String(x.rank)]));
  }

  /** Blank slips in the class's layout (its heading, the details as lines to write on). */
  async blank(ctx: RequestContext, q: DrawBlankDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const place = await this.placeOf(c, q);
      const { settings } = await this.settingsOf(c, q.cycleId, q.classId);
      const { head, logo } = await this.core.school(c);
      const fill = (t: string) =>
        t
          .replaceAll('{merit}', '____')
          .replaceAll('{points}', '____')
          .replaceAll('{class}', place.className)
          .replaceAll('{category}', '')
          .replaceAll('{session}', place.cycle)
          .replace(/\s{2,}/g, ' ')
          .trim();
      const draw = settings.drawAt
        ? `${slotWhen(new Date(settings.drawAt))}${settings.venue ? ` · ${settings.venue}` : ''}`
        : settings.venue;
      const empty: Slip = {
        sno: 0,
        names: [''],
        numbers: [''],
        father: null,
        mother: null,
        dob: null,
        points: '',
        merit: '',
        meritNo: null,
        category: null,
        photos: [],
        blank: true,
      };
      const bytes = await drawSlipsPdf({
        school: head,
        logo: settings.showLogo ? logo : null,
        heading: fill(settings.heading),
        fields: settings.fields.filter((f) => f !== 'photo'),
        session: place.cycle,
        draw,
        footer: settings.footer ? fill(settings.footer) : null,
        perPage: settings.perPage,
        slips: Array.from({ length: q.pages * settings.perPage }, () => empty),
        title: `Blank draw slips - ${place.className}`,
      });
      return {
        filename: `blank-draw-slips-${place.className}.pdf`.toLowerCase().replace(/[^\w.-]+/g, '-'),
        contentType: 'application/pdf',
        base64: bytes.toString('base64'),
      };
    });
  }

  /** The slips of a points total as a PDF: one per registered candidate, twins on one. */
  async slips(ctx: RequestContext, p: DrawGroupDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const place = await this.placeOf(c, p);
      const ready = await this.candidatesOf(c, p);
      if (!ready.length)
        throw new DomainError(
          'admissions.nothing_to_draw',
          'No registered candidate has this points total',
          { status: 409 },
        );
      const twins = (await this.twinsOf(c, ready)).filter((t) => t.state !== 'split');
      const { settings } = await this.settingsOf(c, p.cycleId, p.classId);
      const { head, logo } = await this.core.school(c);
      const fill = (t: string) =>
        t
          // {points} kept from the first slips: the group's total either way
          .replaceAll('{points}', p.points)
          .replaceAll('{merit}', p.points)
          .replaceAll('{class}', place.className)
          .replaceAll('{category}', place.category ?? '')
          .replaceAll('{session}', place.cycle)
          .replace(/\s{2,}/g, ' ')
          .trim();
      const photoOf = async (x: Candidate) => {
        const f = x.fields.find(
          (y) =>
            y.type === 'photo' &&
            (y.docKind === 'photo' || (!y.docKind && /student|child|candidate/.test(y.key))),
        );
        const v = f ? x.data[f.key] : undefined;
        const id = Array.isArray(v) && typeof v[0] === 'string' ? v[0] : null;
        return id ? await this.core.fileBytes(c, id) : null;
      };
      const wantPhoto = settings.fields.includes('photo');
      const meritNo = await this.meritNos(c, p.cycleId, p.classId);
      const slips: Slip[] = [];
      const done = new Set<string>();
      for (const x of ready) {
        if (done.has(x.id)) continue;
        const group = twins.find((t) => t.ids.includes(x.id))?.ids ?? [x.id];
        const members = ready.filter((y) => group.includes(y.id));
        for (const y of members) done.add(y.id);
        const photos = wantPhoto
          ? (await Promise.all(members.map(photoOf))).filter(
              (f): f is { contentType: string; bytes: Buffer } => Boolean(f),
            )
          : [];
        slips.push({
          sno: slips.length + 1,
          names: members.map((y) => y.candidate ?? y.number),
          numbers: members.map((y) => y.number),
          father: this.answer(x, 'father_name'),
          mother: this.answer(x, 'mother_name'),
          dob: dmy(x.dob),
          points: x.points,
          merit: x.merit,
          meritNo: meritNo.get(x.id) ?? null,
          category: x.category,
          photos,
        });
      }
      const draw = settings.drawAt
        ? `${slotWhen(new Date(settings.drawAt))}${settings.venue ? ` · ${settings.venue}` : ''}`
        : settings.venue;
      const bytes = await drawSlipsPdf({
        school: head,
        logo: settings.showLogo ? logo : null,
        heading: fill(settings.heading),
        fields: settings.fields,
        session: place.cycle,
        draw,
        footer: settings.footer ? fill(settings.footer) : null,
        perPage: settings.perPage,
        slips,
        title: `Draw slips - ${place.className} - ${p.points} points`,
      });
      return {
        filename: `draw-slips-${place.className}-${p.points}-points.pdf`
          .toLowerCase()
          .replace(/[^\w.-]+/g, '-'),
        contentType: 'application/pdf',
        slips: slips.length,
        base64: bytes.toString('base64'),
      };
    });
  }

  // ---- the draw made by hand (part 3) -------------------------------------------------------------
  /**
   * The drawn order checked against the slips: each number a slip of this points total (a twin slip by
   * either number), none twice, every drawn candidate at Selection; the first `seats` offered (a twin
   * slip at the boundary offers both), the rest wait-listed in drawn order; slips not drawn stay.
   */
  private async planOf(c: PoolClient, dto: DrawRecordDto) {
    const ready = await this.candidatesOf(c, dto);
    const twins = (await this.twinsOf(c, ready)).filter((t) => t.state !== 'split');
    const slips: Array<{ ids: string[]; numbers: string[]; names: string[]; at: Candidate[] }> = [];
    const done = new Set<string>();
    for (const x of ready) {
      if (done.has(x.id)) continue;
      const group = twins.find((t) => t.ids.includes(x.id))?.ids ?? [x.id];
      const at = ready.filter((y) => group.includes(y.id));
      for (const y of at) done.add(y.id);
      slips.push({
        ids: at.map((y) => y.id),
        numbers: at.map((y) => y.number),
        names: at.map((y) => y.candidate ?? y.number),
        at,
      });
    }
    const byNumber = new Map<string, number>();
    slips.forEach((sl, i) => sl.numbers.forEach((n) => byNumber.set(n.toUpperCase(), i)));
    const errors: string[] = [];
    const drawn: number[] = [];
    for (const raw of dto.numbers) {
      const n = raw.trim();
      if (!n) continue;
      const i = byNumber.get(n.toUpperCase());
      if (i === undefined) errors.push(`${n}: not a slip of ${dto.points} points here`);
      else if (drawn.includes(i)) errors.push(`${n}: drawn twice`);
      else drawn.push(i);
    }
    if (!drawn.length && !errors.length) errors.push('Enter the registration numbers as drawn');
    for (const i of drawn)
      for (const y of slips[i]!.at)
        if (y.stageKind !== 'selection')
          errors.push(
            `${y.number} ${y.candidate ?? ''}: at ${y.stage ?? 'no stage'}, not Selection`.replace(
              /\s+:/,
              ':',
            ),
          );
    let used = 0;
    const order = drawn.map((i, k) => {
      const sl = slips[i]!;
      const offered = used < dto.seats;
      if (offered) used += sl.ids.length;
      return {
        rank: k + 1,
        ids: sl.ids,
        numbers: sl.numbers,
        names: sl.names,
        outcome: offered ? ('offered' as const) : ('waitlisted' as const),
      };
    });
    const left = await this.schedule.room(c, dto.cycleId, dto.classId, dto.categoryId ?? null);
    if (dto.seats > left)
      errors.push(
        `Only ${String(left)} seat${left === 1 ? ' is' : 's are'} left in this class${dto.categoryId ? ' and category' : ''}`,
      );
    return {
      errors,
      order,
      seats: dto.seats,
      seatsLeft: left,
      extraSeats: Math.max(0, used - dto.seats),
      notDrawn: slips
        .filter((_, i) => !drawn.includes(i))
        .map((sl) => ({ numbers: sl.numbers, names: sl.names })),
    };
  }

  /** The drawn order checked: who would be offered, who waits, what is wrong; nothing changes. */
  async check(ctx: RequestContext, dto: DrawRecordDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.placeOf(c, dto);
      return this.planOf(c, dto);
    });
  }

  /** The draw recorded: the first seats offered (the offer email), the rest wait-listed in order. */
  async record(ctx: RequestContext, dto: DrawRecordDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const place = await this.placeOf(c, dto);
      const plan = await this.planOf(c, dto);
      if (plan.errors.length)
        throw new DomainError(
          'validation-failed',
          `Check the drawn order: ${plan.errors.slice(0, 5).join('; ')}${plan.errors.length > 5 ? ` and ${String(plan.errors.length - 5)} more` : ''}`,
          { status: 400 },
        );
      for (const sl of plan.order) {
        const note = `Draw of lots by slips (${dto.points} points), slip ${String(sl.rank)} drawn`;
        for (const [k, id] of sl.ids.entries())
          if (sl.outcome === 'offered')
            // a twin on the same slip is offered even past the last seat
            await this.schedule.offerOne(c, ctx, id, dto.cycleId, note, dto.offerMessage, {
              overRoom: k > 0,
            });
          else await this.process.decideWith(c, ctx, id, { decision: 'waitlist' }, { note });
      }
      const r = await c.query<{ id: string }>(
        `INSERT INTO admission_hand_draws (school_id, cycle_id, class_id, category_id, points, seats, slips, offered,
                                           waitlisted, extra_seats, drawn_by)
         VALUES (app.current_school_id(), $1, $2, $3, $4::numeric, $5, $6::jsonb, $7, $8, $9, $10) RETURNING id::text`,
        [
          dto.cycleId,
          dto.classId,
          dto.categoryId ?? null,
          dto.points,
          dto.seats,
          JSON.stringify(plan.order),
          plan.order.filter((x) => x.outcome === 'offered').reduce((n, x) => n + x.ids.length, 0),
          plan.order
            .filter((x) => x.outcome === 'waitlisted')
            .reduce((n, x) => n + x.ids.length, 0),
          plan.extraSeats,
          ctx.user.id,
        ],
      );
      await this.audit.stage(ctx, c, {
        action: 'admissions.draw.record',
        entityType: 'admission_cycles',
        entityId: dto.cycleId,
        after: {
          classId: dto.classId,
          className: place.className,
          points: dto.points,
          seats: dto.seats,
          order: plan.order.map((x) => x.numbers.join(' & ')),
        },
      });
      return { id: r.rows[0]!.id, ...plan };
    });
  }

  /** The draws recorded for a class, newest first. */
  async records(ctx: RequestContext, q: DrawRecordsQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{
        id: string;
        points: string;
        category: string | null;
        seats: number;
        offered: number;
        waitlisted: number;
        extra_seats: number;
        by: string | null;
        at: Date;
      }>(
        `SELECT d.id::text, trim_scale(d.points)::text AS points, k.name AS category, d.seats, d.offered, d.waitlisted,
                d.extra_seats, u.display_name AS by, d.drawn_at AS at
           FROM admission_hand_draws d LEFT JOIN admission_fee_categories k ON k.id = d.category_id
           LEFT JOIN users u ON u.id = d.drawn_by
          WHERE d.cycle_id = $1 AND d.class_id = $2 ORDER BY d.drawn_at DESC, d.id DESC`,
        [q.cycleId, q.classId],
      );
      return r.rows.map((x) => ({
        id: x.id,
        points: x.points,
        category: x.category,
        seats: x.seats,
        offered: x.offered,
        waitlisted: x.waitlisted,
        extraSeats: x.extra_seats,
        by: x.by,
        at: x.at.toISOString(),
      }));
    });
  }

  /** A recorded draw's result on the letterhead: each slip in drawn order, offered or wait-listed. */
  async recordPdf(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{
        cycle: string;
        class_name: string;
        category: string | null;
        points: string;
        seats: number;
        slips: Array<{ rank: number; numbers: string[]; names: string[]; outcome: string }>;
        by: string | null;
        at: Date;
      }>(
        `SELECT y.name AS cycle, cl.name AS class_name, k.name AS category, trim_scale(d.points)::text AS points, d.seats,
                d.slips, u.display_name AS by, d.drawn_at AS at
           FROM admission_hand_draws d JOIN admission_cycles y ON y.id = d.cycle_id JOIN classes cl ON cl.id = d.class_id
           LEFT JOIN admission_fee_categories k ON k.id = d.category_id LEFT JOIN users u ON u.id = d.drawn_by
          WHERE d.id = $1`,
        [id],
      );
      const x = r.rows[0];
      if (!x) throw new DomainError('not-found', 'No such draw', { status: 404 });
      const { head, logo } = await this.core.school(c);
      let wait = 0;
      const bytes = await tablePdf({
        school: head,
        logo,
        title: `Draw of lots result · ${x.class_name}`,
        subtitle: `${x.cycle}${x.category ? ` · ${x.category}` : ''} · ${x.points} points · ${String(x.seats)} seat${x.seats === 1 ? '' : 's'}`,
        lines: [`Drawn ${slotWhen(x.at)}${x.by ? ` · recorded by ${x.by}` : ''}`],
        columns: [
          { h: 'Drawn', w: 44 },
          { h: 'Registration no.', w: 150 },
          { h: 'Candidate', w: 201 },
          { h: 'Result', w: 120 },
        ],
        rows: x.slips.map((sl) => [
          String(sl.rank),
          sl.numbers.join(' & '),
          sl.names.join(' & '),
          sl.outcome === 'offered' ? 'Offered a seat' : `Waiting list ${String((wait += 1))}`,
        ]),
        printedAt: slotWhen(new Date()),
      });
      return {
        filename: `draw-result-${x.class_name}-${x.points}-points.pdf`
          .toLowerCase()
          .replace(/[^\w.-]+/g, '-'),
        contentType: 'application/pdf',
        base64: bytes.toString('base64'),
      };
    });
  }
}
