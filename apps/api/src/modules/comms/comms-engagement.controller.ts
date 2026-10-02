import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { Public } from '../../common/auth/decorators';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import {
  ConsentQueryDto,
  CreateGroupDto,
  CreateRequestDto,
  DeliveryReceiptDto,
  GroupMembersDto,
  GroupUploadDto,
  PeopleSearchDto,
  UpdateGroupDto,
  ListRequestsQueryDto,
  RecipientSheetDto,
  RecordConsentDto,
  SelfConsentDto,
} from './comms.dto';
import { COMMS_S10 } from './comms.permissions';
import { ConsentsService } from './consents.service';
import { DeliveryService } from './delivery.service';
import { GroupsService, type GroupKind } from './groups.service';
import { RequestsService } from './requests.service';

@ApiTags('comms')
@ApiBearerAuth()
@Controller('comms/requests')
export class CommsRequestsController {
  constructor(private readonly requests: RequestsService) {}

  @Get()
  @ApiOperation({ summary: 'Message requests with approval status and delivery counts' })
  @RequirePermission(COMMS_S10.requestView)
  list(@ReqCtx() ctx: RequestContext, @Query() q: ListRequestsQueryDto) {
    return this.requests.list(ctx, q);
  }

  @Get('limits')
  @ApiOperation({ summary: 'Attachment size, quiet hours and the approval threshold for compose' })
  @RequirePermission(COMMS_S10.requestCreate)
  limits(@ReqCtx() ctx: RequestContext) {
    return this.requests.limits(ctx);
  }

  @Post('recipients-sheet')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Read an Excel list for compose: Admission No / Employee Code, or Name + Mobile / Email',
  })
  @RequirePermission(COMMS_S10.requestCreate)
  sheet(@ReqCtx() ctx: RequestContext, @Body() dto: RecipientSheetDto) {
    return this.requests.readSheet(ctx, dto);
  }

  @Post('preview')
  @ApiOperation({ summary: 'Counts the recipients of a draft (who would be skipped and why)' })
  @RequirePermission(COMMS_S10.requestCreate)
  preview(@ReqCtx() ctx: RequestContext, @Body() dto: CreateRequestDto) {
    return this.requests.preview(ctx, dto);
  }

  @Post()
  @ApiOperation({ summary: 'Compose a message request; it goes to the approval inbox' })
  @RequirePermission(COMMS_S10.requestCreate)
  create(@ReqCtx() ctx: RequestContext, @Body() dto: CreateRequestDto) {
    return this.requests.create(ctx, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One request with its recipients and their delivery state' })
  @RequirePermission(COMMS_S10.requestView)
  get(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.requests.get(ctx, id);
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancel a request that has not been dispatched yet' })
  @RequirePermission(COMMS_S10.requestCreate)
  cancel(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.requests.cancel(ctx, id);
  }
}

@ApiTags('comms')
@ApiBearerAuth()
@Controller('comms/groups')
export class CommsGroupsController {
  constructor(private readonly groups: GroupsService) {}

  @Get()
  @RequirePermission(COMMS_S10.groupView)
  async list(@ReqCtx() ctx: RequestContext) {
    return { data: await this.groups.list(ctx) };
  }

  @Post()
  @RequirePermission(COMMS_S10.groupManage)
  create(@ReqCtx() ctx: RequestContext, @Body() dto: CreateGroupDto) {
    return this.groups.create(ctx, dto);
  }

  @Get('rule-options')
  @ApiOperation({
    summary: 'Values for master-wise filters: houses, categories, departments, routes...',
  })
  @RequirePermission(COMMS_S10.groupView)
  ruleOptions(@ReqCtx() ctx: RequestContext) {
    return this.groups.ruleOptions(ctx);
  }

  @Get('people')
  @ApiOperation({ summary: 'Find students, employees or parents to add to a group' })
  @RequirePermission(COMMS_S10.groupView)
  async people(@ReqCtx() ctx: RequestContext, @Query() q: PeopleSearchDto) {
    return { data: await this.groups.searchPeople(ctx, q.q, q.types) };
  }

  @Get('template/:kind')
  @ApiOperation({ summary: 'Excel template for uploading the members of a group kind' })
  @RequirePermission(COMMS_S10.groupView)
  async template(@Param('kind') kind: string, @Res() reply: FastifyReply) {
    const k = (
      ['student', 'employee', 'student_teacher', 'external', 'mixed'].includes(kind)
        ? kind
        : 'student'
    ) as GroupKind;
    const bytes = await this.groups.template(k);
    void reply
      .header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('content-disposition', `attachment; filename="group-members-${k}.xlsx"`)
      .send(bytes);
  }

  @Get(':id')
  @RequirePermission(COMMS_S10.groupView)
  get(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.groups.get(ctx, id);
  }

  @Patch(':id')
  @RequirePermission(COMMS_S10.groupManage)
  update(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: UpdateGroupDto) {
    return this.groups.update(ctx, id, dto);
  }

  @Delete(':id')
  @RequirePermission(COMMS_S10.groupManage)
  remove(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.groups.remove(ctx, id);
  }

  @Post(':id/upload')
  @ApiOperation({
    summary:
      'Members from Excel: Admission No, Employee Code, or Name + Mobile / Email; dry run first',
  })
  @RequirePermission(COMMS_S10.groupManage)
  upload(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: GroupUploadDto) {
    return this.groups.upload(ctx, id, dto);
  }

  @Get(':id/members')
  @RequirePermission(COMMS_S10.groupView)
  async members(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return { data: await this.groups.members(ctx, id) };
  }

  @Put(':id/members')
  @RequirePermission(COMMS_S10.groupManage)
  updateMembers(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: GroupMembersDto,
  ) {
    return this.groups.updateMembers(ctx, id, dto);
  }
}

@ApiTags('comms')
@ApiBearerAuth()
@Controller('comms/consents')
export class CommsConsentsController {
  constructor(private readonly consents: ConsentsService) {}

  @Get('mine')
  @ApiOperation({ summary: 'My consent purposes and their current status' })
  @RequirePermission(COMMS_S10.consentSelf)
  mine(@ReqCtx() ctx: RequestContext) {
    return this.consents.mine(ctx);
  }

  @Post('mine')
  @ApiOperation({ summary: 'Grant or withdraw one of my consents' })
  @RequirePermission(COMMS_S10.consentSelf)
  recordSelf(@ReqCtx() ctx: RequestContext, @Body() dto: SelfConsentDto) {
    return this.consents.recordSelf(ctx, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Consent status and history of a member (office view)' })
  @RequirePermission(COMMS_S10.consentView)
  forUser(@ReqCtx() ctx: RequestContext, @Query() q: ConsentQueryDto) {
    return this.consents.forUser(ctx, q);
  }

  @Post()
  @ApiOperation({ summary: 'Record consent on behalf of a member (signed form)' })
  @RequirePermission(COMMS_S10.consentManage)
  record(@ReqCtx() ctx: RequestContext, @Body() dto: RecordConsentDto) {
    return this.consents.record(ctx, dto);
  }
}

@ApiTags('comms')
@Controller('comms/delivery')
export class CommsDeliveryController {
  constructor(private readonly delivery: DeliveryService) {}

  @Post('webhook')
  @Public()
  @ApiOperation({
    summary: 'Provider delivery receipt (shared token in x-webhook-token); applied once',
  })
  webhook(@Body() dto: DeliveryReceiptDto, @Headers('x-webhook-token') token?: string) {
    return this.delivery.receipt(dto, token);
  }
}

/** Provider webhooks (communication v2): MSG91 delivery reports and Meta WhatsApp statuses. */
@ApiTags('comms')
@Controller('comms/webhooks')
export class CommsWebhooksController {
  constructor(private readonly delivery: DeliveryService) {}

  @Post('msg91')
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: 'MSG91 delivery report (JSON); the shared token goes in ?token=' })
  msg91(@Body() body: unknown, @Query('token') token?: string) {
    return this.delivery.msg91(body, token);
  }

  @Get('meta')
  @Public()
  @ApiOperation({ summary: 'Meta webhook subscription check (hub.challenge)' })
  async metaVerify(@Query() q: Record<string, string | undefined>, @Res() reply: FastifyReply) {
    const challenge = await this.delivery.metaVerify(q);
    void reply.header('content-type', 'text/plain').send(challenge);
  }

  @Post('meta')
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: 'Meta WhatsApp statuses (sent, delivered, read, failed), signed' })
  meta(
    @Req() req: FastifyRequest,
    @Body() body: unknown,
    @Headers('x-hub-signature-256') signature?: string,
  ) {
    const raw = (req as unknown as { rawBody?: Buffer }).rawBody ?? JSON.stringify(body);
    return this.delivery.meta(raw, signature, body);
  }
}
