import { Command, CommandRunner } from 'nest-commander';

import { InjectMessageQueue } from 'src/engine/core-modules/message-queue/decorators/message-queue.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import {
  MESSAGING_INBOUND_EMAIL_POLL_CRON_PATTERN,
  MessagingInboundEmailPollCronJob,
} from 'src/modules/messaging/message-import-manager/crons/jobs/messaging-inbound-email-poll.cron.job';

@Command({
  name: 'cron:messaging:inbound-email-poll',
  description:
    'Starts a cron job to poll the SES inbound S3 bucket and enqueue one import job per message.',
})
export class MessagingInboundEmailPollCronCommand extends CommandRunner {
  constructor(
    @InjectMessageQueue(MessageQueue.cronQueue)
    private readonly messageQueueService: MessageQueueService,
  ) {
    super();
  }

  async run(): Promise<void> {
    await this.messageQueueService.addCron<undefined>({
      jobName: MessagingInboundEmailPollCronJob.name,
      data: undefined,
      options: {
        repeat: { pattern: MESSAGING_INBOUND_EMAIL_POLL_CRON_PATTERN },
      },
    });
  }
}
