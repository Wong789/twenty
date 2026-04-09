import { Scope } from '@nestjs/common';

import { Process } from 'src/engine/core-modules/message-queue/decorators/process.decorator';
import { Processor } from 'src/engine/core-modules/message-queue/decorators/processor.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { InboundEmailImportService } from 'src/modules/messaging/message-import-manager/drivers/inbound-email/services/inbound-email-import.service';

export type MessagingInboundEmailImportJobData = {
  s3Key: string;
};

// One job per S3 object. Keeping the unit of work small means a single bad
// message can be retried or moved to `failed/` without blocking the rest
// of the queue, and lets BullMQ do the per-message dedupe/backoff we want.
@Processor({
  queueName: MessageQueue.messagingQueue,
  scope: Scope.REQUEST,
})
export class MessagingInboundEmailImportJob {
  constructor(
    private readonly inboundEmailImportService: InboundEmailImportService,
  ) {}

  @Process(MessagingInboundEmailImportJob.name)
  async handle(data: MessagingInboundEmailImportJobData): Promise<void> {
    await this.inboundEmailImportService.importFromS3Key(data.s3Key);
  }
}
