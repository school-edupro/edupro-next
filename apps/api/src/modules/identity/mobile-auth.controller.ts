import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { AuthenticatedOnly, OtpExempt, Public, TenantOptional } from '../../common/auth/decorators';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { MobileAuthService } from './mobile-auth.service';

const Device = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{8,100}$/),
  name: z.string().trim().max(100).optional(),
  platform: z.enum(['android', 'ios', 'web']),
  appVersion: z.string().trim().max(40).optional(),
});
const MobileCodeSchema = z.object({
  challengeId: z.string().uuid(),
  code: z.string().regex(/^\d{6}$/),
  device: Device,
});
class MobileCodeDto extends createZodDto(MobileCodeSchema) {}
const MobileDeviceOnlySchema = z.object({ device: Device });
class MobileDeviceOnlyDto extends createZodDto(MobileDeviceOnlySchema) {}
const MobileRefreshSchema = z.object({
  refreshToken: z.string().regex(/^[A-Za-z0-9_-]{40,100}$/),
  deviceId: z.string().regex(/^[A-Za-z0-9_-]{8,100}$/),
  appVersion: z.string().trim().max(40).optional(),
});
class MobileRefreshDto extends createZodDto(MobileRefreshSchema) {}
const MobileHandoffSchema = z.object({
  app: z.enum(['parent', 'teacher']),
  /** the web app's page: a path (e.g. /library?tab=history) */
  to: z.string().trim().min(1).max(500),
});
class MobileHandoffDto extends createZodDto(MobileHandoffSchema) {}
const MobileRedeemSchema = z.object({
  code: z.string().regex(/^[A-Za-z0-9_-]{40,100}$/),
  app: z.enum(['parent', 'teacher']),
});
class MobileRedeemDto extends createZodDto(MobileRedeemSchema) {}

/**
 * The mobile app's sign-in and sessions (docs/design/89, phase A). The code itself is asked with
 * `POST /auth/otp/start` (`app: 'mobile'`); these routes turn it (or a One Auth token) into the phone's
 * session, renew it, list and sign out the person's phones, and open web pages inside the app.
 */
@ApiTags('auth')
@Controller('auth/mobile')
export class MobileAuthController {
  constructor(private readonly mobile: MobileAuthService) {}

  @Post('verify')
  @Public()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Mobile app: the one-time code signs the phone in (refresh token + access token)',
  })
  verify(@Body() body: MobileCodeDto) {
    return this.mobile.signInWithCode(body.challengeId, body.code, body.device);
  }

  @Post('refresh')
  @Public()
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Mobile app: a new access token; the refresh token turns into a new one (an old one again signs the phone out)',
  })
  refresh(@Body() body: MobileRefreshDto) {
    return this.mobile.refresh(body.refreshToken, {
      id: body.deviceId,
      appVersion: body.appVersion,
    });
  }

  @Post('one-auth')
  @AuthenticatedOnly()
  @TenantOptional()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Mobile app: a One Auth sign-in (its token on the request) becomes the phone session',
  })
  oneAuth(@ReqCtx() ctx: RequestContext, @Body() body: MobileDeviceOnlyDto) {
    return this.mobile.signInWithOneAuth(ctx, body.device);
  }

  @Post('second-factor/verify')
  @AuthenticatedOnly()
  @OtpExempt()
  @TenantOptional()
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Mobile app: One Auth, then the code the school asks — the phone session (multi-factor)',
  })
  secondFactor(@ReqCtx() ctx: RequestContext, @Body() body: MobileCodeDto) {
    return this.mobile.signInWithSecondFactor(ctx, body.challengeId, body.code, body.device);
  }

  @Get('devices')
  @AuthenticatedOnly()
  @TenantOptional()
  @ApiOperation({ summary: 'My signed-in phones (this one marked)' })
  devices(@ReqCtx() ctx: RequestContext) {
    return this.mobile.devices(ctx);
  }

  @Post('sign-out')
  @AuthenticatedOnly()
  @TenantOptional()
  @HttpCode(200)
  @ApiOperation({ summary: 'Mobile app: sign this phone out' })
  signOut(@ReqCtx() ctx: RequestContext) {
    return this.mobile.signOut(ctx);
  }

  @Post('devices/:id/sign-out')
  @AuthenticatedOnly()
  @TenantOptional()
  @HttpCode(200)
  @ApiOperation({ summary: 'Sign another of my phones out (a lost phone)' })
  signOutDevice(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.mobile.signOut(ctx, id);
  }

  @Post('web-handoff')
  @AuthenticatedOnly()
  @TenantOptional()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Mobile app: a one-time link (60 s) that opens a parent / staff web page signed in',
  })
  webHandoff(@ReqCtx() ctx: RequestContext, @Body() body: MobileHandoffDto) {
    return this.mobile.webHandoff(ctx, body.app, body.to);
  }

  @Post('web-handoff/redeem')
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: 'The web app turns the one-time link in for its session' })
  redeem(@Body() body: MobileRedeemDto) {
    return this.mobile.redeem(body.code, body.app);
  }
}
