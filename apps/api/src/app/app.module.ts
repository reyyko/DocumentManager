import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { DocumentManagementModule } from '../modules/document-management/document-management.module';
import { documentManagementConfig } from '../config/document-management.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [documentManagementConfig],
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.getOrThrow<string>('documentManagement.redis.host'),
          port: configService.getOrThrow<number>('documentManagement.redis.port'),
        },
      }),
    }),
    DocumentManagementModule,
  ],
})
export class AppModule {}
