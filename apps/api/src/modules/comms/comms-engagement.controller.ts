import { Body, Controller, Get, Headers, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { Public } from '../../common/auth/decorators';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import {
  ConsentQueryDto,
  CreateGroupDto,
  CreateRequestDto,
  DeliveryReceiptDto,
  GroupMembersDto,
  ListRequestsQueryDto,
  RecordConsentDto,
  SelfConsentDto,
} from './comms.dto';
import { COMMS_S10 } from './comms.permissions';
import { ConsentsService } from './consents.service';
import { DeliveryService } from './delivery.service';
import { GroupsService } from './groups.service';
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
