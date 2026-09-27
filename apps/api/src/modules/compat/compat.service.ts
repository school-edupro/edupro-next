import { Inject, Injectable } from '@nestjs/common';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { SignJWT } from 'jose';
import { CacheService } from '../../common/cache/cache.service';
import { DbService } from '../../common/db/db.service';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { ENV, type Env } from '../../config/env';
import { AccessService } from '../access/access.service';
import { SchoolService } from '../platform/school.service';
import { SettingsService } from '../platform/settings.service';
import { HandshakePayloadSchema, type HandshakeDto } from './compat.dto';

/** Legacy envelope: the current apps switch on `status` and read `info`; errors still travel as HTTP 200. */
export interface LegacyResult<T> {
  status: boolean;
  info: string;
  msg?: string;
  data?: T;
}

/** Module matrix of the current teacher app (t-webservices/get_module_permissions.php), by teacher type. */
export const TEACHER_MODULES: Record<string, string[]> = {
  daily_work: ['subjectteacher', 'classteacher', 'classcoordinator', 'coordinator'],
  attendance: ['classteacher', 'classcoordinator', 'coordinator'],
  exam_attendance: ['classteacher', 'classcoordinator', 'coordinator'],
  exam_marks: ['subjectteacher'],
  exam_remark: ['classteacher', 'classcoordinator', 'coordinator'],
  assignment: ['subjectteacher', 'classteacher', 'classcoordinator', 'coordinator'],
  indicator: ['indicator'],
  res_query: ['classteacher', 'classcoordinator', 'coordinator'],
  health_static: ['classteacher', 'classcoordinator', 'coordinator'],
  dossier: ['classteacher', 'classcoordinator', 'coordinator'],
  cr_lesson_planner: ['classteacher', 'classcoordinator', 'coordinator'],
  upload_notice: ['classteacher', 'classcoordinator', 'coordinator'],
};

const ROLE_TO_TEACHER_TYPE: Record<string, string> = {
  class_teacher: 'classteacher',
  subject_teacher: 'subjectteacher',
  academic_coordinator: 'coordinator',
};

/**
 * Compatibility API (S4-05, WP14): keeps the current student and teacher apps working against the new
 * platform. The handshake accepts the token the central auth server issues today, resolves the person in
 * our identity model and returns a short-lived app session; the read endpoints reproduce the legacy shapes.
 */
@Injectable()
export class CompatService {
  constructor(
    private readonly db: DbService,
    private readonly settings: SettingsService,
    private readonly school: SchoolService,
    private readonly access: AccessService,
    private readonly cache: CacheService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private verifySignature(
    token: string,
  ): ReturnType<typeof HandshakePayloadSchema.safeParse> | null {
    const [body, mac] = token.split('.');
    if (!body || !mac) return null;
    const expected = createHmac('sha256', this.env.COMPAT_HANDSHAKE_SECRET)
      .update(body)
      .digest('base64url');
    const a = Buffer.from(mac);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    try {
      return HandshakePayloadSchema.safeParse(
        JSON.parse(Buffer.from(body, 'base64url').toString('utf8')),
      );
    } catch {
      return null;
    }
  }

  /** Test and tooling helper: signs a payload the way the central auth server does. */
  signHandshake(payload: Record<string, unknown>): string {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const mac = createHmac('sha256', this.env.COMPAT_HANDSHAKE_SECRET)
      .update(body)
      .digest('base64url');
    return `${body}.${mac}`;
  }

  async handshake(
    dto: HandshakeDto,
    meta: { ip?: string; userAgent?: string },
  ): Promise<LegacyResult<Record<string, unknown>>> {
    const parsed = this.verifySignature(dto.token);
    if (!parsed || !parsed.success) return { status: false, info: 'Invalid token' };
    const p = parsed.data;
    if (p.exp < Math.floor(Date.now() / 1000)) return { status: false, info: 'Token expired' };
    // Replay protection (S6-09 leftover, closed in S11): a handshake token is accepted once during its validity.
    const ttl = Math.max(60, p.exp - Math.floor(Date.now() / 1000) + 60);
    const seen = await this.cache.incr(
      `compat:handshake:${createHash('sha256').update(dto.token).digest('hex')}`,
      ttl,
    );
    if (seen > 1) return { status: false, info: 'Token already used' };
    const mobile = p.mobile_number ? p.mobile_number.replace(/\D/g, '').slice(-10) : null;
    const schoolRef = String(p.school_id);

    // Cross-tenant by nature: no school context exists yet, so the lookup is a SECURITY DEFINER routine (0013).
    const found = await this.db.global(async (c) => {
      const r = await c.query<{
        user_id: string;
        oneauth_sub: string;
        display_name: string;
        school_id: string;
        person_type: string;
        school_name: string;
      }>(
        'SELECT o_user_id::text AS user_id, o_oneauth_sub AS oneauth_sub, o_display_name AS display_name, o_school_id::text AS school_id, o_person_type AS person_type, o_school_name AS school_name FROM app.compat_lookup($1, $2, $3)',
        [schoolRef, p.user_id_string, mobile],
      );
      return r.rows[0] ?? null;
    });

    await this.db.global((c) =>
      c.query(
        `INSERT INTO login_events (user_id, school_id, method, outcome, ip, user_agent, detail)
         VALUES ($1, $2, 'compat', $3::login_outcome, $4::inet, $5, $6::jsonb)`,
        [
          found?.user_id ?? null,
          found?.school_id ?? null,
          found ? 'success' : 'denied',
          meta.ip ?? null,
          meta.userAgent ?? null,
          JSON.stringify({ legacyUser: p.user_id_string, type: dto.type ?? p.user_type ?? null }),
        ],
      ),
    );
    if (!found) return { status: false, info: 'Please contact to Administrator' };

    const token = await new SignJWT({ sid: found.school_id, typ: found.person_type })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(found.oneauth_sub)
      .setIssuer('edupro-compat')
      .setAudience('edupro-compat')
      .setIssuedAt()
      .setExpirationTime(`${this.env.COMPAT_TOKEN_HOURS}h`)
      .sign(new TextEncoder().encode(this.env.COMPAT_JWT_SECRET));

    return {
      status: true,
      info: 'Logged in successfully',
      data: {
        user_id: p.user_id_string,
        user_name: found.display_name,
        school_id: found.school_id,
        school_name: found.school_name,
        is_student: found.person_type === 'student',
        is_employee: found.person_type === 'employee',
        is_parent: found.person_type === 'guardian',
        token: `compat.${token}`,
        requested_at: Math.floor(Date.now() / 1000),
      },
    };
  }

  /** GetMenuDetail: `{ items: [...] }` from the school setting compat.student_menu. */
  async menu(ctx: RequestContext): Promise<{ items: Array<Record<string, unknown>> }> {
    const tenant = requireTenant(ctx);
    const setting = (await this.settings.current(tenant)).find(
      (s) => s.key === 'compat.student_menu',
    );
    const value = (setting?.value ?? []) as Array<{
      menu_name: string;
      menu_link: string;
      link_order: number;
      category: string;
    }>;
    return {
      items: value.map((m) => ({
        menu_name: m.menu_name,
        menu_link: m.menu_link,
        status: '1',
        link_order: String(m.link_order),
        IconId: '',
        IconURL: '',
        Time_Stamp: '',
        app_icon_url: '',
        category: m.category ?? '',
        category_priority: '',
      })),
    };
  }

  /** GetSchoolConfig: `{ items: [config] }` from the school profile. */
  async schoolConfig(ctx: RequestContext): Promise<{ items: Array<Record<string, unknown>> }> {
    const tenant = requireTenant(ctx);
    const s = await this.school.get(tenant);
    const address = s.address as Record<string, string>;
    const contact = s.contact as Record<string, string>;
    return {
      items: [
        {
          SchoolId: s.id,
          PREFIX: s.code,
          SchoolName: s.name,
          SchoolAddress: [address.line1, address.city, address.state, address.pincode]
            .filter(Boolean)
            .join(', '),
          PhoneNo: contact.phone ?? '',
          LogoURL: (s.branding as Record<string, string>).logoUrl ?? '',
          Class: '',
          AccountNo: '',
          AffiliationNo: s.affiliationNo ?? '',
          SchoolNo: '',
          website: contact.website ?? '',
          facebook: '',
          school_geo: '',
          School_Eamil: contact.email ?? '',
          youtube: '',
          help: contact.help ?? '',
        },
      ],
    };
  }

  /** get_module_permissions: the legacy matrix plus the caller's teacher types derived from held roles. */
  async modulePermissions(
    ctx: RequestContext,
  ): Promise<LegacyResult<{ modules: Record<string, string>; teacher_types: string[] }>> {
    const tenant = requireTenant(ctx);
    const roles = await this.db.tenant(tenant, async (c) => {
      const r = await c.query<{ code: string }>(
        `SELECT r.code FROM user_roles ur JOIN roles r ON r.id = ur.role_id
          WHERE ur.user_id = app.current_user_id() AND ur.revoked_at IS NULL AND ur.valid_from <= CURRENT_DATE
            AND (ur.valid_to IS NULL OR ur.valid_to >= CURRENT_DATE)`,
      );
      return r.rows.map((x) => x.code);
    });
    void this.access;
    const types = [
      ...new Set(
        roles.map((code) => ROLE_TO_TEACHER_TYPE[code]).filter((t): t is string => Boolean(t)),
      ),
    ];
    const modules: Record<string, string> = {};
    for (const [module, allowed] of Object.entries(TEACHER_MODULES))
      modules[module] = allowed.join(', ');
    return { status: true, info: 'ok', data: { modules, teacher_types: types } };
  }
}
