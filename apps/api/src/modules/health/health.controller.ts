import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/auth/decorators';
import { DbService } from '../../common/db/db.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly db: DbService) {}

  @Get()
  @Public()
  @ApiOperation({ summary: 'Liveness and database readiness' })
  async health() {
    try {
      const ok = await this.db.global(async (c) => {
        const r = await c.query<{ ok: number }>('SELECT 1 AS ok');
        return r.rows[0]?.ok === 1;
      });
      if (!ok) throw new Error('unexpected result');
      return { status: 'ok', database: 'ok', time: new Date().toISOString() };
    } catch {
      throw new ServiceUnavailableException({ type: 'dependency-unavailable', detail: 'database' });
    }
  }
}
