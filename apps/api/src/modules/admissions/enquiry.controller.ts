import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { ADMISSIONS } from './admissions.dto';
import {
  EnquiryDto,
  EnquiryQueryDto,
  EnquiryReportQueryDto,
  EnquiryUpdateDto,
  FollowUpDto,
  BulkDto,
  DeskLinkDto,
  EnquiryDeskDto,
  EnquiryImportDto,
  InviteDto,
  MoveDto,
  RulesDto,
  ReplyDto,
  SourcesDto,
  StagesDto,
} from './enquiry.dto';
import { AdmissionEnquiryService, ENQUIRY_MANAGE } from './enquiry.service';

/** The enquiry desk of admissions (docs/design/39, part 8). */
@ApiTags('admissions')
@ApiBearerAuth()
@Controller('admissions/enquiries')
export class AdmissionEnquiryController {
  constructor(private readonly svc: AdmissionEnquiryService) {}

  @Get('meta')
  @RequirePermission(ENQUIRY_MANAGE, {
    description: 'Take admission enquiries, follow them up and invite families to register',
  })
  meta(@ReqCtx() ctx: RequestContext) {
    return this.svc.meta(ctx);
  }

  @Put('sources')
  @RequirePermission('admissions.setup.manage')
  sources(@ReqCtx() ctx: RequestContext, @Body() dto: SourcesDto) {
    return this.svc.saveSources(ctx, dto);
  }

  @Put('desk')
  @ApiOperation({ summary: 'How website enquiries are assigned and acknowledged' })
  @RequirePermission('admissions.setup.manage')
  desk(@ReqCtx() ctx: RequestContext, @Body() dto: EnquiryDeskDto) {
    return this.svc.saveDesk(ctx, dto);
  }

  @Put('stages')
  @ApiOperation({ summary: "The school's stages of a lead (docs/design/45)" })
  @RequirePermission('admissions.setup.manage')
  stages(@ReqCtx() ctx: RequestContext, @Body() dto: StagesDto) {
    return this.svc.saveStages(ctx, dto);
  }

  @Post('desk-link')
  @ApiOperation({ summary: 'A walk-in at the desk: an enquiry and the form link to the parent' })
  @RequirePermission(ENQUIRY_MANAGE)
  deskLink(@ReqCtx() ctx: RequestContext, @Body() dto: DeskLinkDto) {
    return this.svc.deskLink(ctx, dto);
  }

  @Put('rules')
  @ApiOperation({ summary: "The enquiry desk's assignment rules, with escalation" })
  @RequirePermission('admissions.setup.manage')
  rules(@ReqCtx() ctx: RequestContext, @Body() dto: RulesDto) {
    return this.svc.saveRules(ctx, dto);
  }

  @Post('bulk')
  @ApiOperation({ summary: 'Many leads at once: assign, move, score' })
  @RequirePermission(ENQUIRY_MANAGE)
  bulk(@ReqCtx() ctx: RequestContext, @Body() dto: BulkDto) {
    return this.svc.bulk(ctx, dto);
  }

  @Get('import-format.xlsx')
  @ApiOperation({ summary: 'The Excel format of enquiries to add' })
  @RequirePermission(ENQUIRY_MANAGE)
  async importFormat(@ReqCtx() ctx: RequestContext, @Res() reply: FastifyReply) {
    const f = await this.svc.importFormat(ctx);
    void reply
      .header('content-type', f.contentType)
      .header('content-disposition', `attachment; filename="${f.filename}"`)
      .send(f.bytes);
  }

  @Post('import')
  @HttpCode(200)
  @ApiOperation({ summary: 'Enquiries from an Excel sheet; duplicates left out' })
  @RequirePermission(ENQUIRY_MANAGE)
  importSheet(@ReqCtx() ctx: RequestContext, @Body() dto: EnquiryImportDto) {
    return this.svc.importSheet(ctx, dto.fileBase64);
  }

  @Get('report')
  @ApiOperation({ summary: 'Enquiry → registration → admission by source and class' })
  @RequirePermission(ADMISSIONS.applicationView)
  report(@ReqCtx() ctx: RequestContext, @Query() q: EnquiryReportQueryDto) {
    return this.svc.report(ctx, q);
  }

  @Get()
  @ApiOperation({ summary: 'Enquiries with what is due today and overdue' })
  @RequirePermission(ENQUIRY_MANAGE)
  list(@ReqCtx() ctx: RequestContext, @Query() q: EnquiryQueryDto) {
    return this.svc.list(ctx, q);
  }

  @Post()
  @RequirePermission(ENQUIRY_MANAGE)
  create(@ReqCtx() ctx: RequestContext, @Body() dto: EnquiryDto) {
    return this.svc.create(ctx, dto);
  }

  @Get(':id')
  @RequirePermission(ENQUIRY_MANAGE)
  get(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.get(ctx, id);
  }

  @Put(':id')
  @RequirePermission(ENQUIRY_MANAGE)
  update(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: EnquiryUpdateDto) {
    return this.svc.update(ctx, id, dto);
  }

  @Post(':id/followups')
  @RequirePermission(ENQUIRY_MANAGE)
  followUp(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: FollowUpDto) {
    return this.svc.followUp(ctx, id, dto);
  }

  @Post(':id/stage')
  @ApiOperation({ summary: 'Move a lead to an open stage, or to Lost with its reason' })
  @RequirePermission(ENQUIRY_MANAGE)
  move(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: MoveDto) {
    return this.svc.move(ctx, id, dto);
  }

  @Post(':id/reply')
  @ApiOperation({ summary: 'Reply to the family by email and / or SMS; kept with the follow-ups' })
  @RequirePermission(ENQUIRY_MANAGE)
  reply(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: ReplyDto) {
    return this.svc.reply(ctx, id, dto);
  }

  @Post(':id/invite')
  @ApiOperation({
    summary: 'Invite the family to register: a link that fills the form, by email / SMS / WhatsApp',
  })
  @RequirePermission(ENQUIRY_MANAGE)
  invite(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: InviteDto) {
    return this.svc.invite(ctx, id, dto);
  }
}
