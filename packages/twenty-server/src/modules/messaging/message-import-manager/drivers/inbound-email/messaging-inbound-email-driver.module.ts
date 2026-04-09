import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { TwentyConfigModule } from 'src/engine/core-modules/twenty-config/twenty-config.module';
import { ConnectedAccountEntity } from 'src/engine/metadata-modules/connected-account/entities/connected-account.entity';
import { MessageChannelEntity } from 'src/engine/metadata-modules/message-channel/entities/message-channel.entity';
import { WorkspaceDataSourceModule } from 'src/engine/workspace-datasource/workspace-datasource.module';
import { InboundEmailS3ClientProvider } from 'src/modules/messaging/message-import-manager/drivers/inbound-email/providers/inbound-email-s3-client.provider';
import { InboundEmailParserService } from 'src/modules/messaging/message-import-manager/drivers/inbound-email/services/inbound-email-parser.service';
import { InboundEmailStorageService } from 'src/modules/messaging/message-import-manager/drivers/inbound-email/services/inbound-email-storage.service';

// Thin driver module that provides the low-level primitives for inbound
// email: S3 client, storage (list/get/move), and MIME parser. The import
// orchestration service lives in MessagingImportManagerModule so it can
// reuse the save-messages pipeline without a circular import.
@Module({
  imports: [
    TwentyConfigModule,
    WorkspaceDataSourceModule,
    TypeOrmModule.forFeature([MessageChannelEntity, ConnectedAccountEntity]),
  ],
  providers: [
    InboundEmailS3ClientProvider,
    InboundEmailStorageService,
    InboundEmailParserService,
  ],
  exports: [
    InboundEmailS3ClientProvider,
    InboundEmailStorageService,
    InboundEmailParserService,
  ],
})
export class MessagingInboundEmailDriverModule {}
