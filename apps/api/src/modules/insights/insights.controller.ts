import { Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { InsightsService } from './insights.service';

export const INSIGHTS = {
  dashboardView: 'insights.dashboard.view',
  martRefresh: 'insights.mart.refresh',
} as const;

const DashboardQuerySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
export class DashboardQueryDto extends createZodDto(DashboardQuerySchema) {}

/** Sprint 12 (AI track): principal dashboard v1 and the reporting marts. */
@ApiTags('insights')
@ApiBearerAuth()
@Controller('insights')
export class InsightsController {
  constructor(private readonly insights: InsightsService) {}

  @Get('principal')
  @ApiOperation({
    summary:
      'Principal dashboard: attendance, fees, admissions, communication, approvals, readers, alerts',
  })
  @RequirePermission(INSIGHTS.dashboardView, {
    description: 'View the principal and department dashboards',
  })
  principal(@ReqCtx() ctx: RequestContext, @Query() q: DashboardQueryDto) {
    return this.insights.principal(ctx, q.date);
  }

  @Get('marts')
  @ApiOperation({ summary: 'Refresh status of every reporting mart' })
  @RequirePermission(INSIGHTS.dashboardView)
  async marts(@ReqCtx() ctx: RequestContext) {
    return { data: await this.insights.martStatus(ctx) };
  }

  @Post('marts/refresh')
  @ApiOperation({ summary: 'Rebuild the marts of the working school now' })
  @RequirePermission(INSIGHTS.martRefresh, { description: 'Refresh the reporting marts on demand' })
  refresh(@ReqCtx() ctx: RequestContext) {
    return this.insights.refresh(ctx);
  }
}
