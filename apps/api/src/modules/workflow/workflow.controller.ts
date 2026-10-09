import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import {
  ActDto,
  CreateDefinitionDto,
  ListInstancesQueryDto,
  UpdateDefinitionDto,
  WORKFLOW,
} from './workflow.dto';
import { WorkflowService } from './workflow.service';
import { CancelDto, CommentDto, ReassignDto } from './workflow.dto';

@ApiTags('workflow')
@ApiBearerAuth()
@Controller('workflow')
export class WorkflowController {
  constructor(private readonly workflow: WorkflowService) {}

  @Get('definitions')
  @RequirePermission(WORKFLOW.definitionView, { description: 'View workflow definitions' })
  async definitions(@ReqCtx() ctx: RequestContext) {
    return { data: await this.workflow.definitions(ctx) };
  }

  @Get('options')
  @ApiOperation({ summary: 'Roles, designations and staff offered by the workflow editor' })
  @RequirePermission('workflow.definition.view')
  options(@ReqCtx() ctx: RequestContext) {
    return this.workflow.options(ctx);
  }

  @Post('definitions/defaults')
  @ApiOperation({ summary: 'Install the default definitions the school does not have yet' })
  @RequirePermission(WORKFLOW.definitionManage, {
    description: 'Edit workflow definitions and levels',
  })
  async defaults(@ReqCtx() ctx: RequestContext) {
    return { data: await this.workflow.installDefaults(ctx) };
  }

  @Post('definitions')
  @RequirePermission(WORKFLOW.definitionManage)
  create(@ReqCtx() ctx: RequestContext, @Body() body: CreateDefinitionDto) {
    return this.workflow.createDefinition(ctx, body);
  }

  @Patch('definitions/:id')
  @RequirePermission(WORKFLOW.definitionManage)
  update(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: UpdateDefinitionDto,
  ) {
    return this.workflow.updateDefinition(ctx, id, body);
  }

  @Get('inbox')
  @ApiOperation({ summary: 'Pending steps assigned to me' })
  @RequirePermission(WORKFLOW.inboxAct, {
    description: 'See and act on approval steps assigned to me',
  })
  async inbox(@ReqCtx() ctx: RequestContext) {
    return { data: await this.workflow.inbox(ctx) };
  }

  @Post('steps/:id/approve')
  @RequirePermission(WORKFLOW.inboxAct)
  approve(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: ActDto) {
    return this.workflow.act(ctx, id, 'approved', body);
  }

  @Post('steps/:id/reject')
  @RequirePermission(WORKFLOW.inboxAct)
  reject(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: ActDto) {
    return this.workflow.act(ctx, id, 'rejected', body);
  }

  @Get('instances')
  @RequirePermission(WORKFLOW.instanceView, {
    description: 'View workflow instances and their history',
  })
  async instances(@ReqCtx() ctx: RequestContext, @Query() q: ListInstancesQueryDto) {
    const { rows, total } = await this.workflow.instances(ctx, q);
    return { data: rows, page: { number: q.page, size: q.size, total } };
  }

  @Get('instances/:id')
  @RequirePermission(WORKFLOW.instanceView)
  get(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.workflow.get(ctx, id);
  }

  // ---- Sprint 17: v1 GA ----
  @Post('instances/:id/cancel')
  @ApiOperation({ summary: 'Cancel a pending approval (the requester, or a workflow manager)' })
  @RequirePermission(WORKFLOW.instanceView)
  cancel(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: CancelDto) {
    return this.workflow.cancel(ctx, id, body);
  }

  @Post('steps/:id/reassign')
  @ApiOperation({ summary: 'Hand a pending step to other members' })
  @RequirePermission(WORKFLOW.definitionManage)
  reassign(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: ReassignDto) {
    return this.workflow.reassign(ctx, id, body);
  }

  @Post('instances/:id/comments')
  @ApiOperation({ summary: 'Add a note to the history' })
  @RequirePermission(WORKFLOW.instanceView)
  async comment(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: CommentDto) {
    return { data: await this.workflow.comment(ctx, id, body) };
  }

  @Get('instances/:id/history')
  @ApiOperation({
    summary: 'Started, decisions, reminders, escalations, reassignments and comments',
  })
  @RequirePermission(WORKFLOW.instanceView)
  async history(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return { data: await this.workflow.history(ctx, id) };
  }
}
