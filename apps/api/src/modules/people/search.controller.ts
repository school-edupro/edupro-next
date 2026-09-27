import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { SearchQueryDto } from './people.dto';
import { PEOPLE } from './people.permissions';
import { SearchService } from './search.service';

@ApiTags('people')
@ApiBearerAuth()
@Controller('people')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get('search')
  @ApiOperation({ summary: 'Search students, guardians and employees by name, number or mobile' })
  @RequirePermission(PEOPLE.search, { description: 'Search people by name, number or mobile' })
  async find(@ReqCtx() ctx: RequestContext, @Query() q: SearchQueryDto) {
    return { data: await this.search.search(ctx, q.q, q.limit) };
  }
}
