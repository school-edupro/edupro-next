import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../../common/http/request-context';
import { CreateClassDto, CreateClassSectionDto, ListClassesQueryDto, UpdateClassDto } from './classes.dto';
import { PERMISSIONS } from './classes.permissions';
import { ClassesService } from './classes.service';

/**
 * Reference module controller (docs/design/01-reference-module.md). Every handler declares its permission;
 * DTOs are zod classes validated by the global ZodValidationPipe; ids are numeric strings.
 */
@ApiTags('academics')
@ApiBearerAuth()
@Controller('academics/classes')
export class ClassesController {
  constructor(private readonly classes: ClassesService) {}

  @Get()
  @ApiOperation({ summary: 'List classes' })
  @RequirePermission(PERMISSIONS.view, { description: 'View classes' })
  list(@ReqCtx() ctx: RequestContext, @Query() query: ListClassesQueryDto) {
    return this.classes.list(ctx, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a class' })
  @RequirePermission(PERMISSIONS.view)
  get(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.classes.get(ctx, id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a class' })
  @RequirePermission(PERMISSIONS.create, { description: 'Create a class' })
  create(@ReqCtx() ctx: RequestContext, @Body() body: CreateClassDto) {
    return this.classes.create(ctx, body);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a class' })
  @RequirePermission(PERMISSIONS.edit, { description: 'Edit a class' })
  update(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: UpdateClassDto) {
    return this.classes.update(ctx, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Soft-delete a class (refused while it has sections in an open year)' })
  @RequirePermission(PERMISSIONS.delete, { description: 'Soft-delete a class' })
  async remove(@ReqCtx() ctx: RequestContext, @Param('id') id: string): Promise<void> {
    await this.classes.remove(ctx, id);
  }

  @Get(':id/sections')
  @ApiOperation({ summary: 'List sections of a class in the working academic year (scoped for teachers)' })
  @RequirePermission(PERMISSIONS.sectionView, { description: 'View sections (scoped)' })
  async sections(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return { data: await this.classes.listSections(ctx, id) };
  }

  @Post(':id/sections')
  @ApiOperation({ summary: 'Create a section in the working academic year' })
  @RequirePermission(PERMISSIONS.sectionCreate, { description: 'Create a section' })
  createSection(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: CreateClassSectionDto) {
    return this.classes.createSection(ctx, id, body);
  }
}
