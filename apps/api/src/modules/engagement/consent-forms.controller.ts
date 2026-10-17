import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthenticatedOnly } from '../../common/auth/decorators';
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
  MineFormQueryDto,
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
  constructor(private readonly svc: ConsentFormsService) {}

  @Get('consent-forms')
  @RequirePermission(CONSENT.manage, {
    description: 'Build consent forms, fill them for families and read the register',
  })
  list(@ReqCtx() ctx: RequestContext, @Query() q: ConsentListQueryDto) {
    return this.svc.list(ctx, q);
  }

  @Get('consent-forms/lists')
  @RequirePermission(CONSENT.manage)
  lists(@ReqCtx() ctx: RequestContext) {
    return this.svc.builderLists(ctx);
  }

  @Post('consent-forms')
  @RequirePermission(CONSENT.manage)
  create(@ReqCtx() ctx: RequestContext, @Body() body: ConsentFormDto) {
    return this.svc.create(ctx, body);
  }

  @Get('consent-forms/:id')
  @RequirePermission(CONSENT.manage)
  get(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.get(ctx, id);
  }

  @Put('consent-forms/:id')
  @RequirePermission(CONSENT.manage)
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
  @RequirePermission(CONSENT.manage)
  status(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: ConsentStatusDto) {
    return this.svc.setStatus(ctx, id, body);
  }

  @Post('consent-forms/:id/notify')
  @ApiOperation({ summary: 'An app notification again to those who have not answered' })
  @RequirePermission(CONSENT.manage)
  notify(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: ConsentNotifyDto) {
    return this.svc.notifyPending(ctx, id, body);
  }

  @Delete('consent-forms/:id')
  @RequirePermission(CONSENT.manage)
  remove(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.remove(ctx, id);
  }

  @Get('consent-forms/:id/register')
  @RequirePermission(CONSENT.manage)
  register(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Query() q: ConsentRegisterQueryDto,
  ) {
    return this.svc.register(ctx, id, q);
  }

  @Get('consent-forms/:id/register/file')
  @RequirePermission(CONSENT.manage)
  async registerFile(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Query() q: ConsentFileQueryDto,
  ) {
    return file(await this.svc.registerFile(ctx, id, q));
  }

  @Post('consent-forms/:id/responses')
  @ApiOperation({ summary: 'The office fills the form on behalf of a family or a staff member' })
  @RequirePermission(CONSENT.manage)
  fill(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: ConsentRespondDto) {
    return this.svc.fillForOffice(ctx, id, body);
  }

  @Get('consent-forms/:id/responses/:rid')
  @RequirePermission(CONSENT.manage)
  response(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Param('rid') rid: string) {
    return this.svc.response(ctx, id, rid);
  }

  @Get('consent-forms/:id/responses/:rid/pdf')
  @RequirePermission(CONSENT.manage)
  responsePdf(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Param('rid') rid: string) {
    return this.svc.responsePdf(ctx, id, rid);
  }

  @Get('consent-forms/:id/responses/:rid/signatures/:key')
  @RequirePermission(CONSENT.manage)
  signature(@ReqCtx() ctx: RequestContext, @Param('rid') rid: string, @Param('key') key: string) {
    return this.svc.signature(ctx, rid, key);
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
