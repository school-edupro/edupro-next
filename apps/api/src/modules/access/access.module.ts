import { Global, Module } from '@nestjs/common';
import { ScopePolicy } from '../../common/access/scope.policy';
import { AccessController } from './access.controller';
import { AccessService } from './access.service';

@Global()
@Module({
  controllers: [AccessController],
  providers: [AccessService, ScopePolicy],
  exports: [AccessService, ScopePolicy],
})
export class AccessModule {}
