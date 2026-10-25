import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
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
  EnquiryDeskDto,
  InviteDto,
  ReplyDto,
  SourcesDto,
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
