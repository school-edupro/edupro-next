import { randomUUID } from 'node:crypto';
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthenticatedOnly, Public } from '../../common/auth/decorators';
import { ENV, type Env } from '../../config/env';
import { PowService } from '../admissions/public/pow.service';
import { PublicThrottle, PublicThrottleGuard } from '../admissions/public/public-throttle.guard';
import { ConsentPublicService } from './consent-public.service';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import {
  CONSENT,
  ConsentFileQueryDto,
  ConsentFormDto,
  ConsentListQueryDto,
  ConsentRegisterQueryDto,
  ConsentRespondDto,
  ConsentStatusDto,
  ConsentDecideDto,
  ConsentEditDto,
  ConsentNotifyDto,
  ConsentSharesDto,
  MineFormQueryDto,
  PublicOtpDto,
  PublicRespondDto,
  PublicUploadDto,
  PublicVerifyDto,
} from './consent-forms.dto';
import { ConsentFormsService } from './consent-forms.service';

const file = (f: { bytes: Buffer; filename: string; contentType: string }) => ({
  filename: f.filename,
  contentType: f.contentType,
  base64: f.bytes.toString('base64'),
});

/** Consent forms (docs/design/28-consent-forms.md): the office's builder and register, and answering. */
@ApiTags('engagement')
@ApiBearerAuth()
@Controller('engagement')
export class ConsentFormsController {
  constructor(
    private readonly svc: ConsentFormsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Post('consent-forms/:id/public-link')
  @ApiOperation({ summary: 'A new public link (the old link and QR stop working)' })
  // a manager, or a share of this form (checked in the service)
  @AuthenticatedOnly()
  rotate(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.rotateLink(ctx, id);
  }

  @Get('consent-forms/:id/qr')
  // a manager, or a share of this form (checked in the service)
  @AuthenticatedOnly()
  qr(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.qr(ctx, id, this.env.PUBLIC_APP_URL);
  }

  @Get('consent-forms/:id/analytics')
  // a manager, or a share of this form (checked in the service)
  @AuthenticatedOnly()
  analytics(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.analytics(ctx, id);
  }

  @Get('consent-forms')
  // managers see every form, anyone else the forms shared with them
  @AuthenticatedOnly()
  list(@ReqCtx() ctx: RequestContext, @Query() q: ConsentListQueryDto) {
    return this.svc.list(ctx, q);
  }

  @Get('consent-forms/dashboard')
  @ApiOperation({ summary: 'All forms at a glance: response, approvals, fees, classes, trend' })
  // managers see every form, anyone else the forms shared with them
  @AuthenticatedOnly()
  dashboard(@ReqCtx() ctx: RequestContext) {
    return this.svc.dashboard(ctx);
  }

  @Get('consent-forms/lists')
  // a manager, or a share of this form (checked in the service)
  @AuthenticatedOnly()
  lists(@ReqCtx() ctx: RequestContext) {
    return this.svc.builderLists(ctx);
  }

  @Post('consent-forms')
  @RequirePermission(CONSENT.manage, {
    description: 'Build consent forms, fill them for families and read the register',
  })
  create(@ReqCtx() ctx: RequestContext, @Body() body: ConsentFormDto) {
    return this.svc.create(ctx, body);
  }

  @Get('consent-forms/:id')
  // a manager, or a share of this form (checked in the service)
  @AuthenticatedOnly()
  get(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.get(ctx, id);
  }

  @Put('consent-forms/:id')
  // a manager, or a share of this form (checked in the service)
  @AuthenticatedOnly()
  update(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: ConsentFormDto) {
    return this.svc.update(ctx, id, body);
  }

  @Post('consent-forms/:id/copy')
  @RequirePermission(CONSENT.manage)
  copy(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.copy(ctx, id);
  }

  @Put('consent-forms/:id/status')
  @ApiOperation({
    summary: 'Publish (tells the audience in the app), close, archive, back to draft',
  })
  // a manager, or a share of this form (checked in the service)
  @AuthenticatedOnly()
  status(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: ConsentStatusDto) {
    return this.svc.setStatus(ctx, id, body);
  }

  @Post('consent-forms/:id/notify')
  @ApiOperation({ summary: 'An app notification again to those who have not answered' })
  // a manager, or a share of this form (checked in the service)
  @AuthenticatedOnly()
  notify(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: ConsentNotifyDto) {
    return this.svc.notifyPending(ctx, id, body);
  }

  @Delete('consent-forms/:id')
  @RequirePermission(CONSENT.manage)
  remove(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.remove(ctx, id);
  }

  @Get('consent-forms/:id/register')
  // a manager, or a share of this form (checked in the service)
  @AuthenticatedOnly()
  register(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Query() q: ConsentRegisterQueryDto,
  ) {
    return this.svc.register(ctx, id, q);
  }

  @Get('consent-forms/:id/register/file')
  // a manager, or a share of this form (checked in the service)
  @AuthenticatedOnly()
  async registerFile(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Query() q: ConsentFileQueryDto,
  ) {
    return file(await this.svc.registerFile(ctx, id, q));
  }

  @Post('consent-forms/:id/responses')
  @ApiOperation({ summary: 'The office fills the form on behalf of a family or a staff member' })
  // a manager, or a share of this form (checked in the service)
  @AuthenticatedOnly()
  fill(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: ConsentRespondDto) {
    return this.svc.fillForOffice(ctx, id, body);
  }

  @Get('consent-forms/:id/responses/:rid')
  // a manager, or a share of this form (checked in the service)
  @AuthenticatedOnly()
  response(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Param('rid') rid: string) {
    return this.svc.response(ctx, id, rid);
  }

  @Get('consent-forms/:id/responses/:rid/pdf')
  // a manager, or a share of this form (checked in the service)
  @AuthenticatedOnly()
  responsePdf(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Param('rid') rid: string) {
    return this.svc.responsePdf(ctx, id, rid);
  }

  @Get('consent-forms/:id/responses/:rid/signatures/:key')
  // a manager, or a share of this form (checked in the service)
  @AuthenticatedOnly()
  signature(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Param('rid') rid: string,
    @Param('key') key: string,
  ) {
    return this.svc.signature(ctx, id, rid, key);
  }

  @Get('consent-forms/:id/shares')
  @ApiOperation({ summary: 'Whom the form is shared with (staff or roles, view or edit)' })
  @RequirePermission(CONSENT.manage)
  shares(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.shares(ctx, id);
  }

  @Put('consent-forms/:id/shares')
  @RequirePermission(CONSENT.manage)
  setShares(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: ConsentSharesDto,
  ) {
    return this.svc.setShares(ctx, id, body);
  }

  @Get('mine/consent-shared')
  @ApiOperation({ summary: 'The consent forms shared with me' })
  @AuthenticatedOnly()
  sharedWithMe(@ReqCtx() ctx: RequestContext) {
    return this.svc.sharedWithMe(ctx);
  }

  // ---- families and staff ----
  @Get('mine/consent-forms')
  @ApiOperation({ summary: 'The forms for my children and for me (staff)' })
  @AuthenticatedOnly()
  mine(@ReqCtx() ctx: RequestContext) {
    return this.svc.mine(ctx);
  }

  @Get('mine/consent-forms/responses/:rid/pdf')
  @AuthenticatedOnly()
  minePdf(@ReqCtx() ctx: RequestContext, @Param('rid') rid: string) {
    return this.svc.minePdf(ctx, rid);
  }

  @Get('mine/consent-forms/:id')
  @AuthenticatedOnly()
  mineForm(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Query() q: MineFormQueryDto) {
    return this.svc.mineForm(ctx, id, q.studentId, q.responseId);
  }

  @Put('mine/consent-forms/responses/:rid')
  @ApiOperation({ summary: 'Change my answer until the form’s edit date, while not yet decided' })
  @AuthenticatedOnly()
  edit(@ReqCtx() ctx: RequestContext, @Param('rid') rid: string, @Body() body: ConsentEditDto) {
    return this.svc.editMine(ctx, rid, body);
  }

  @Get('mine/consent-approvals')
  @ApiOperation({
    summary: 'Answers waiting for my approval (class teacher, role or named approver)',
  })
  @AuthenticatedOnly()
  approvals(@ReqCtx() ctx: RequestContext) {
    return this.svc.myApprovals(ctx);
  }

  @Post('mine/consent-approvals/:stepId')
  @AuthenticatedOnly()
  decide(
    @ReqCtx() ctx: RequestContext,
    @Param('stepId') stepId: string,
    @Body() body: ConsentDecideDto,
  ) {
    return this.svc.decide(ctx, stepId, body);
  }

  @Post('mine/consent-forms/:id/responses')
  @ApiOperation({ summary: 'Answer a form for a child (family) or for myself (staff)' })
  @AuthenticatedOnly()
  respond(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: ConsentRespondDto) {
    return this.svc.respondMine(ctx, id, body);
  }
}

/** A bare request context for the public link (no user, no school until the link is resolved). */
const baseCtx = (req: { id?: string; ip?: string }): RequestContext =>
  ({
    requestId: req.id && /^[0-9a-f-]{36}$/i.test(req.id) ? req.id : randomUUID(),
    ip: req.ip,
  }) as RequestContext;

/**
 * The public link and QR of a consent form (no login; docs/design/28-consent-forms.md, part 3): the
 * code is asked after a proof of work; the pass ("cf." token) is sent as a Bearer.
 */
@ApiTags('public')
@Controller('public/consent-forms')
@UseGuards(PublicThrottleGuard)
export class PublicConsentFormsController {
  constructor(
    private readonly svc: ConsentPublicService,
    private readonly pow: PowService,
  ) {}

  @Get(':schoolCode/:token')
  @Public()
  @PublicThrottle(60)
  info(@Param('schoolCode') schoolCode: string, @Param('token') token: string) {
    return this.svc.info(schoolCode, token);
  }

  @Post(':schoolCode/:token/otp')
  @Public()
  @PublicThrottle(10)
  @ApiOperation({
    summary: 'A one-time code to a mobile / email, or to the family mobile of a pupil',
  })
  async otp(
    @Param('schoolCode') schoolCode: string,
    @Param('token') token: string,
    @Body() body: PublicOtpDto,
    @Req() req: { ip?: string },
  ) {
    await this.pow.consume(body.challenge, body.nonce);
    return this.svc.otp(schoolCode, token, body, req.ip);
  }

  @Post(':schoolCode/:token/otp/verify')
  @Public()
  @PublicThrottle(20)
  verify(
    @Param('schoolCode') schoolCode: string,
    @Param('token') token: string,
    @Body() body: PublicVerifyDto,
  ) {
    return this.svc.verify(schoolCode, token, body);
  }

  @Get(':schoolCode/:token/me')
  @Public()
  @PublicThrottle(60)
  me(
    @Param('schoolCode') schoolCode: string,
    @Param('token') token: string,
    @Headers('authorization') auth?: string,
  ) {
    return this.svc.me(schoolCode, token, auth);
  }

  @Get(':schoolCode/:token/responses/:rid')
  @Public()
  @PublicThrottle(60)
  answer(
    @Param('schoolCode') schoolCode: string,
    @Param('token') token: string,
    @Param('rid') rid: string,
    @Headers('authorization') auth?: string,
  ) {
    return this.svc.answer(schoolCode, token, auth, rid);
  }

  @Get(':schoolCode/:token/responses/:rid/pdf')
  @Public()
  @PublicThrottle(30)
  pdf(
    @Param('schoolCode') schoolCode: string,
    @Param('token') token: string,
    @Param('rid') rid: string,
    @Headers('authorization') auth?: string,
  ) {
    return this.svc.pdf(schoolCode, token, auth, rid);
  }

  @Post(':schoolCode/:token/uploads')
  @Public()
  @PublicThrottle(30)
  upload(
    @Req() req: { id?: string; ip?: string },
    @Param('schoolCode') schoolCode: string,
    @Param('token') token: string,
    @Body() body: PublicUploadDto,
    @Headers('authorization') auth?: string,
  ) {
    return this.svc.upload(schoolCode, token, auth, body, baseCtx(req));
  }

  @Post(':schoolCode/:token/responses')
  @Public()
  @PublicThrottle(20)
  respond(
    @Req() req: { id?: string; ip?: string },
    @Param('schoolCode') schoolCode: string,
    @Param('token') token: string,
    @Body() body: PublicRespondDto,
    @Headers('authorization') auth?: string,
  ) {
    return this.svc.respond(schoolCode, token, auth, body, baseCtx(req));
  }

  @Put(':schoolCode/:token/responses/:rid')
  @Public()
  @PublicThrottle(20)
  edit(
    @Req() req: { id?: string; ip?: string },
    @Param('schoolCode') schoolCode: string,
    @Param('token') token: string,
    @Param('rid') rid: string,
    @Body() body: PublicRespondDto,
    @Headers('authorization') auth?: string,
  ) {
    return this.svc.edit(schoolCode, token, auth, rid, body, baseCtx(req));
  }

  @Post(':schoolCode/:token/responses/:rid/pay')
  @Public()
  @PublicThrottle(10)
  pay(
    @Req() req: { id?: string; ip?: string },
    @Param('schoolCode') schoolCode: string,
    @Param('token') token: string,
    @Param('rid') rid: string,
    @Body() body: { gatewayId?: string } | undefined,
    @Headers('authorization') auth?: string,
  ) {
    const gw = /^\d{1,18}$/.test(String(body?.gatewayId ?? ''))
      ? String(body!.gatewayId)
      : undefined;
    return this.svc.pay(schoolCode, token, auth, rid, baseCtx(req), gw);
  }
}
