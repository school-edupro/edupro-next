import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { AuthenticatedOnly, OtpExempt, Public, TenantOptional } from '../../common/auth/decorators';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { DbService } from '../../common/db/db.service';
import { ReqCtx, requireTenant, type RequestContext } from '../../common/http/request-context';
import { PLATFORM } from '../platform/platform.permissions';
import { OtpService } from './otp.service';

const App = z.enum(['admin', 'teacher', 'parent']);
const Device = z
  .string()
  .regex(/^[A-Za-z0-9_-]{20,100}$/)
  .optional();
const StartSchema = z.object({
  /** email or mobile number of the account */
  login: z.string().trim().min(3).max(120),
  app: App,
  deviceToken: Device,
  ip: z.string().max(45).optional(),
  userAgent: z.string().max(300).optional(),
});
class StartDto extends createZodDto(StartSchema) {}
const SecondSchema = z.object({ app: App, deviceToken: Device });
class SecondDto extends createZodDto(SecondSchema) {}
const VerifySchema = z.object({
  challengeId: z.string().uuid(),
  code: z.string().regex(/^\d{6}$/),
  remember: z.boolean().default(false),
  userAgent: z.string().max(300).optional(),
});
class VerifyDto extends createZodDto(VerifySchema) {}

/**
 * Sign-in with a one-time code by email (0136). The web apps call these from their server side (so limits
 * are per user, in the database: one code in 30 seconds, five in 15 minutes, five tries a code): the code
 * alone (public), or a code after One Auth (the One Auth token, before the session
 * is given). The school's sign-in screen lists codes shown on screen and forgets remembered devices.
 */
@ApiTags('auth')
@Controller('auth/otp')
export class OtpController {
  constructor(
    private readonly otp: OtpService,
    private readonly db: DbService,
  ) {}

  @Get('offered')
  @Public()
  @ApiOperation({ summary: 'Is sign-in with an emailed code offered on this installation?' })
  async offered() {
    return { offered: await this.otp.offered() };
  }

  @Post('start')
  @Public()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Code-only sign-in: send a code to the account named by email or mobile',
  })
  start(@Body() body: StartDto) {
    return this.otp.startLogin(body.login, body.app, body.deviceToken, {
      ip: body.ip,
      userAgent: body.userAgent,
      requestId: crypto.randomUUID(),
    });
  }

  @Post('verify')
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: 'Code-only sign-in: check the code and give the session' })
  verify(@Body() body: VerifyDto) {
    return this.otp.verify(body.challengeId, body.code, 'login', body.remember, {
      userAgent: body.userAgent,
    });
  }

  @Post('second-factor/start')
  @AuthenticatedOnly()
  @TenantOptional()
  @OtpExempt()
  @HttpCode(200)
  @ApiOperation({ summary: 'After One Auth: send a code when a school of the user asks one' })
  startSecond(@ReqCtx() ctx: RequestContext, @Body() body: SecondDto) {
    return this.otp.startSecondFactor(ctx, body.app, body.deviceToken);
  }

  @Post('second-factor/verify')
  @AuthenticatedOnly()
  @TenantOptional()
  @OtpExempt()
  @HttpCode(200)
  @ApiOperation({ summary: 'After One Auth: check the code and give the session' })
  verifySecond(@ReqCtx() ctx: RequestContext, @Body() body: VerifyDto) {
    return this.otp.verify(body.challengeId, body.code, 'second_factor', body.remember, {
      userAgent: body.userAgent,
      userId: ctx.user.id,
    });
  }

  @Get('screen-log')
  @RequirePermission(PLATFORM.settingsView)
  @ApiOperation({ summary: 'Codes shown on screen for this school (latest 200)' })
  async screenLog(@ReqCtx() ctx: RequestContext) {
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      const r = await c.query(
        `SELECT shown_at::text AS "shownAt", display_name AS "displayName", app, purpose, sent_to AS "sentTo", ip
           FROM app.otp_screen_log($1, 200)`,
        [tenant.schoolId],
      );
      // members without a usable email: they cannot get a code by mail
      const noEmail = await c.query(
        `SELECT u.id::text, u.display_name AS "displayName", u.email, u.mobile, m.person_type AS "personType"
           FROM user_school_memberships m JOIN users u ON u.id = m.user_id
          WHERE m.school_id = app.current_school_id() AND m.status = 'active' AND m.deleted_at IS NULL
            AND u.deleted_at IS NULL AND u.status = 'active'
            AND (u.email IS NULL OR u.email !~ '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$')
          ORDER BY m.person_type, u.display_name LIMIT 500`,
      );
      return { shown: r.rows, noEmail: noEmail.rows };
    });
  }

  @Post('forget-devices')
  @HttpCode(200)
  @RequirePermission(PLATFORM.settingsEdit)
  @ApiOperation({ summary: "Forget every remembered device of the school's users" })
  async forget(@ReqCtx() ctx: RequestContext) {
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      const r = await c.query<{ n: number }>(`SELECT app.otp_forget_devices($1) AS n`, [
        tenant.schoolId,
      ]);
      return { forgotten: r.rows[0]?.n ?? 0 };
    });
  }
}
