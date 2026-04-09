import { Logger } from '@nestjs/common';

import { SentryCronMonitor } from 'src/engine/core-modules/cron/sentry-cron-monitor.decorator';
import { ExceptionHandlerService } from 'src/engine/core-modules/exception-handler/exception-handler.service';
import { InjectMessageQueue } from 'src/engine/core-modules/message-queue/decorators/message-queue.decorator';
import { Process } from 'src/engine/core-modules/message-queue/decorators/process.decorator';
import { Processor } from 'src/engine/core-modules/message-queue/decorators/processor.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { InboundEmailS3ClientProvider } from 'src/modules/messaging/message-import-manager/drivers/inbound-email/providers/inbound-email-s3-client.provider';
import { InboundEmailStorageService } from 'src/modules/messaging/message-import-manager/drivers/inbound-email/services/inbound-email-storage.service';
import {
  MessagingInboundEmailImportJob,
  type MessagingInboundEmailImportJobData,
} from 'src/modules/messaging/message-import-manager/jobs/messaging-inbound-email-import.job';

// BullMQ cron patterns are minute-based at the finest; every minute is
// fine for a forwarding inbox since SES writes are eventually consistent
// anyway. Single-leader election comes from BullMQ's repeatable-job dedupe,
// so multiple workers can run this cron safely.
export const MESSAGING_INBOUND_EMAIL_POLL_CRON_PATTERN = '* * * * *';

@Processor(MessageQueue.cronQueue)
export class MessagingInboundEmailPollCronJob {
  private readonly logger = new Logger(MessagingInboundEmailPollCronJob.name);

  constructor(
    @InjectMessageQueue(MessageQueue.messagingQueue)
    private readonly messageQueueService: MessageQueueService,
    private readonly inboundEmailS3ClientProvider: InboundEmailS3ClientProvider,
    private readonly inboundEmailStorageService: InboundEmailStorageService,
    private readonly twentyConfigService: TwentyConfigService,
    private readonly exceptionHandlerService: ExceptionHandlerService,
  ) {}

  @Process(MessagingInboundEmailPollCronJob.name)
  @SentryCronMonitor(
    MessagingInboundEmailPollCronJob.name,
    MESSAGING_INBOUND_EMAIL_POLL_CRON_PATTERN,
  )
  async handle(): Promise<void> {
    if (!this.inboundEmailS3ClientProvider.isConfigured()) {
      return;
    }

    try {
      const batchSize = this.twentyConfigService.get(
        'INBOUND_EMAIL_POLL_BATCH_SIZE',
      );
      const keys = await this.inboundEmailStorageService.listIncoming(batchSize);

      if (keys.length === 0) {
        return;
      }

      this.logger.log(`Enqueuing ${keys.length} inbound emails for import`);

      for (const s3Key of keys) {
        await this.messageQueueService.add<MessagingInboundEmailImportJobData>(
          MessagingInboundEmailImportJob.name,
          { s3Key },
        );
      }
    } catch (error) {
      this.exceptionHandlerService.captureExceptions([error]);
    }
  }
}
