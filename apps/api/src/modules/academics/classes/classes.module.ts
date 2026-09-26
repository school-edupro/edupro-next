import { Module } from '@nestjs/common';
import { ClassesController } from './classes.controller';
import { ClassesRepository } from './classes.repository';
import { ClassesService } from './classes.service';

@Module({
  controllers: [ClassesController],
  providers: [ClassesService, ClassesRepository],
  exports: [ClassesService],
})
export class ClassesModule {}
