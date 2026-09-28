import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { Public } from '../../common/auth/decorators';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { ServiceKeysService } from '../shadow/service-keys.service';
import { GpsService } from './gps.service';

export const GPS = {
  view: 'transport.gps.view',
  familyTrack: 'transport.family.track',
} as const;

const TrailQuerySchema = z.object({
  minutes: z.coerce
    .number()
    .int()
    .min(5)
    .max(24 * 60)
    .default(120),
});
class TrailQueryDto extends createZodDto(TrailQuerySchema) {}

/** Sprint 17: GPS positions — vendor push (service key), the office's fleet view, the family's bus. */
@ApiTags('transport')
@ApiBearerAuth()
@Controller('transport/gps')
export class GpsController {
  constructor(
    private readonly gps: GpsService,
    private readonly keys: ServiceKeysService,
  ) {}

  @Post('positions')
  @Public()
  @ApiOperation({
    summary:
      'GPS vendor push (NeverSkip shape or a plain array), X-Service-Key with scope transport.gps',
  })
  async ingest(@Body() body: unknown, @Headers('x-service-key') key?: string) {
    const lookup = await this.keys.authenticate(key, 'transport.gps');
    const ctx = this.keys.machineContext(lookup.schoolId, lookup.name);
    return this.gps.ingest(ctx, GpsService.normalise(body));
  }

  @Get('fleet')
  @RequirePermission(GPS.view, { description: 'See vehicle positions' })
  async fleet(@ReqCtx() ctx: RequestContext) {
    return { data: await this.gps.fleet(ctx) };
  }

  @Get('vehicles/:id/trail')
  @RequirePermission(GPS.view)
  async trail(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Query() q: TrailQueryDto) {
    return { data: await this.gps.trail(ctx, id, q.minutes) };
  }

  @Get('mine')
  @ApiOperation({ summary: 'Where my child’s bus is' })
  @RequirePermission(GPS.familyTrack, {
    description: "A family sees the live position of its child's bus",
  })
  mine(@ReqCtx() ctx: RequestContext) {
    return this.gps.mine(ctx);
  }
}
