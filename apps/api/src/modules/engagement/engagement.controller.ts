import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import {
  AcknowledgeDto,
  AssignDto,
  CloseDto,
  CreateChangeRequestDto,
  CreateFeedbackDto,
  CreateQueryDto,
  DecideChangeDto,
  ENGAGEMENT,
  ListChangeRequestsDto,
  ListFeedbackDto,
  ListQueriesDto,
  PRIVACY,
  PublishNoticeDto,
  RateDto,
  RespondDto,
} from './engagement.dto';
import { FamilyService } from './family.service';
import { PrivacyService } from './privacy.service';
import { QueriesService } from './queries.service';

@ApiTags('engagement')
@ApiBearerAuth()
@Controller('engagement')
export class EngagementController {
  constructor(
    private readonly queries: QueriesService,
    private readonly family: FamilyService,
    private readonly privacy: PrivacyService,
  ) {}

  // ---- DPDP onboarding -----------------------------------------------------------------------------
  @Get('onboarding')
  @ApiOperation({ summary: 'The privacy notice to acknowledge (if any) and my consent purposes' })
  @RequirePermission(ENGAGEMENT.familyView)
  onboarding(@ReqCtx() ctx: RequestContext) {
    return this.privacy.onboarding(ctx);
  }

  @Post('onboarding/acknowledge')
  @ApiOperation({ summary: 'Acknowledge the current notice and record my consent choices' })
  @RequirePermission(ENGAGEMENT.familyView)
  acknowledge(@ReqCtx() ctx: RequestContext, @Body() dto: AcknowledgeDto) {
    return this.privacy.acknowledge(ctx, dto);
  }

  @Get('privacy-notices')
  @RequirePermission(PRIVACY.manage)
  notices(@ReqCtx() ctx: RequestContext) {
    return this.privacy.notices(ctx);
  }

  @Post('privacy-notices')
  @ApiOperation({
    summary: 'Publish a new privacy notice version; families acknowledge it on their next visit',
  })
  @RequirePermission(PRIVACY.manage)
  publish(@ReqCtx() ctx: RequestContext, @Body() dto: PublishNoticeDto) {
    return this.privacy.publish(ctx, dto);
  }

  // ---- queries: staff ------------------------------------------------------------------------------
  @Get('categories')
  @RequirePermission(ENGAGEMENT.queryView)
  async categories(@ReqCtx() ctx: RequestContext) {
    return { data: await this.queries.categories(ctx) };
  }

  @Get('queries')
  @ApiOperation({
    summary: 'Queries, complaints and leave requests visible to the viewer (scoped for teachers)',
  })
  @RequirePermission(ENGAGEMENT.queryView)
  list(@ReqCtx() ctx: RequestContext, @Query() q: ListQueriesDto) {
    return this.queries.list(ctx, q);
  }

  @Get('queries/:id')
  @RequirePermission(ENGAGEMENT.queryView)
  get(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.queries.get(ctx, id, ENGAGEMENT.queryView);
  }

  @Post('queries/:id/responses')
  @ApiOperation({
    summary:
      'Staff reply (or internal note); a reply marks the query answered and notifies the family',
  })
  @RequirePermission(ENGAGEMENT.queryRespond)
  respond(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: RespondDto) {
    return this.queries.respond(ctx, id, dto, ENGAGEMENT.queryRespond);
  }

  @Post('queries/:id/assign')
  @RequirePermission(ENGAGEMENT.queryRespond)
  assign(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: AssignDto) {
    return this.queries.assign(ctx, id, dto);
  }

  @Post('queries/:id/close')
  @RequirePermission(ENGAGEMENT.queryRespond)
  close(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: CloseDto) {
    return this.queries.close(ctx, id, dto);
  }

  // ---- queries: family -----------------------------------------------------------------------------
  @Get('mine/categories')
  @RequirePermission(ENGAGEMENT.queryCreate)
  async myCategories(@ReqCtx() ctx: RequestContext) {
    return { data: await this.queries.categories(ctx) };
  }

  @Get('mine/queries')
  @RequirePermission(ENGAGEMENT.queryCreate)
  mine(@ReqCtx() ctx: RequestContext, @Query() q: ListQueriesDto) {
    return this.queries.list(ctx, q);
  }

  @Post('mine/queries')
  @ApiOperation({ summary: 'Raise a query, complaint or leave request for my child' })
  @RequirePermission(ENGAGEMENT.queryCreate)
  create(@ReqCtx() ctx: RequestContext, @Body() dto: CreateQueryDto) {
    return this.queries.create(ctx, dto);
  }

  @Get('mine/queries/:id')
  @RequirePermission(ENGAGEMENT.queryCreate)
  getMine(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.queries.get(ctx, id, ENGAGEMENT.queryCreate);
  }

  @Post('mine/queries/:id/responses')
  @RequirePermission(ENGAGEMENT.queryCreate)
  reply(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: RespondDto) {
    return this.queries.respond(ctx, id, dto, ENGAGEMENT.queryCreate);
  }

  @Post('mine/queries/:id/rate')
  @RequirePermission(ENGAGEMENT.queryCreate)
  rate(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: RateDto) {
    return this.queries.rate(ctx, id, dto);
  }

  // ---- feedback ------------------------------------------------------------------------------------
  @Post('feedback')
  @RequirePermission(ENGAGEMENT.feedbackCreate)
  createFeedback(@ReqCtx() ctx: RequestContext, @Body() dto: CreateFeedbackDto) {
    return this.family.createFeedback(ctx, dto);
  }

  @Get('feedback')
  @RequirePermission(ENGAGEMENT.feedbackView)
  listFeedback(@ReqCtx() ctx: RequestContext, @Query() q: ListFeedbackDto) {
    return this.family.listFeedback(ctx, q);
  }

  // ---- profile change requests ---------------------------------------------------------------------
  @Get('family')
  @ApiOperation({
    summary: 'My children: profile, guardians, class teacher, route and my consents',
  })
  @RequirePermission(ENGAGEMENT.familyView)
  familyView(@ReqCtx() ctx: RequestContext) {
    return this.family.family(ctx);
  }

  @Post('change-requests')
  @RequirePermission(ENGAGEMENT.changeCreate)
  createChange(@ReqCtx() ctx: RequestContext, @Body() dto: CreateChangeRequestDto) {
    return this.family.createChangeRequest(ctx, dto);
  }

  @Get('change-requests/profile-fields')
  @ApiOperation({ summary: 'Profile fields a family may ask to change, with drop-down options' })
  @RequirePermission(ENGAGEMENT.changeCreate)
  profileFields(@ReqCtx() ctx: RequestContext, @Query('studentId') studentId?: string) {
    return this.family.familyProfileFields(
      ctx,
      studentId && /^\d{1,18}$/.test(studentId) ? studentId : undefined,
    );
  }

  @Get('change-requests/mine')
  @RequirePermission(ENGAGEMENT.changeCreate)
  myChanges(@ReqCtx() ctx: RequestContext, @Query() q: ListChangeRequestsDto) {
    return this.family.listChangeRequests(ctx, q, true);
  }

  @Get('change-requests')
  @RequirePermission(ENGAGEMENT.changeView)
  listChanges(@ReqCtx() ctx: RequestContext, @Query() q: ListChangeRequestsDto) {
    return this.family.listChangeRequests(ctx, q, false);
  }

  @Post('change-requests/:id/decide')
  @ApiOperation({
    summary: 'Approve (applies the change with an audit row) or reject a profile change request',
  })
  @RequirePermission(ENGAGEMENT.changeDecide)
  decide(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: DecideChangeDto) {
    return this.family.decideChange(ctx, id, dto);
  }
}
