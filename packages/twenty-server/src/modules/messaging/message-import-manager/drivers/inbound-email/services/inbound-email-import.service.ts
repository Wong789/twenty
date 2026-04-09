import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { MessageChannelType } from 'twenty-shared/types';
import { Repository } from 'typeorm';

import { ConnectedAccountEntity } from 'src/engine/metadata-modules/connected-account/entities/connected-account.entity';
import { MessageChannelEntity } from 'src/engine/metadata-modules/message-channel/entities/message-channel.entity';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { InboundEmailParserService } from 'src/modules/messaging/message-import-manager/drivers/inbound-email/services/inbound-email-parser.service';
import { InboundEmailS3ClientProvider } from 'src/modules/messaging/message-import-manager/drivers/inbound-email/providers/inbound-email-s3-client.provider';
import { InboundEmailStorageService } from 'src/modules/messaging/message-import-manager/drivers/inbound-email/services/inbound-email-storage.service';
import { extractEnvelopeRecipient } from 'src/modules/messaging/message-import-manager/drivers/inbound-email/utils/extract-envelope-recipient.util';
import { MessagingSaveMessagesAndEnqueueContactCreationService } from 'src/modules/messaging/message-import-manager/services/messaging-save-messages-and-enqueue-contact-creation.service';

export type InboundEmailImportOutcome =
  | { kind: 'imported'; workspaceId: string; messageChannelId: string }
  | { kind: 'unmatched'; recipient: string | null }
  | { kind: 'loop_dropped'; workspaceId: string }
  | { kind: 'unconfigured' }
  | { kind: 'parse_failed'; error: string }
  | { kind: 'persist_failed'; error: string };

// Orchestrates the "pull one S3 object, import it" cycle. Kept independent
// of BullMQ so it can be unit-tested directly; the job is a thin shell.
@Injectable()
export class InboundEmailImportService {
  private readonly logger = new Logger(InboundEmailImportService.name);

  constructor(
    private readonly inboundEmailS3ClientProvider: InboundEmailS3ClientProvider,
    private readonly inboundEmailStorageService: InboundEmailStorageService,
    private readonly inboundEmailParserService: InboundEmailParserService,
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly messagingSaveMessagesAndEnqueueContactCreationService: MessagingSaveMessagesAndEnqueueContactCreationService,
    @InjectRepository(MessageChannelEntity)
    private readonly messageChannelRepository: Repository<MessageChannelEntity>,
    @InjectRepository(ConnectedAccountEntity)
    private readonly connectedAccountRepository: Repository<ConnectedAccountEntity>,
  ) {}

  async importFromS3Key(s3Key: string): Promise<InboundEmailImportOutcome> {
    if (!this.inboundEmailS3ClientProvider.isConfigured()) {
      this.logger.warn(
        `Skipping inbound email import for ${s3Key}: forwarding is not configured.`,
      );

      return { kind: 'unconfigured' };
    }

    const inboundDomain = this.inboundEmailS3ClientProvider.getDomain();

    let rawMessage: Buffer;

    try {
      rawMessage = await this.inboundEmailStorageService.getRawMessage(s3Key);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      this.logger.error(
        `Failed to download inbound email from S3 key ${s3Key}: ${message}`,
      );

      return { kind: 'parse_failed', error: message };
    }

    let parsedInbound;

    try {
      parsedInbound = await this.inboundEmailParserService.parse(
        rawMessage,
        s3Key,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      this.logger.error(
        `Failed to parse inbound email ${s3Key}: ${message}`,
      );
      await this.safeMove(s3Key, 'failed');

      return { kind: 'parse_failed', error: message };
    }

    const recipient = extractEnvelopeRecipient(parsedInbound.parsed, inboundDomain);

    if (!recipient) {
      this.logger.warn(
        `No recipient at ${inboundDomain} found for inbound email ${s3Key}`,
      );
      await this.safeMove(s3Key, 'unmatched');

      return { kind: 'unmatched', recipient: null };
    }

    const messageChannel = await this.messageChannelRepository.findOne({
      where: {
        handle: recipient,
        type: MessageChannelType.EMAIL_FORWARDING,
      },
    });

    if (!messageChannel) {
      this.logger.warn(
        `No forwarding channel matches recipient ${recipient} (key ${s3Key})`,
      );
      await this.safeMove(s3Key, 'unmatched');

      return { kind: 'unmatched', recipient };
    }

    const workspaceId = messageChannel.workspaceId;

    if (
      parsedInbound.originWorkspaceId &&
      parsedInbound.originWorkspaceId === workspaceId
    ) {
      this.logger.log(
        `Dropping loopback email ${s3Key} for workspace ${workspaceId}`,
      );
      await this.safeMove(s3Key, 'processed');

      return { kind: 'loop_dropped', workspaceId };
    }

    const connectedAccount = await this.connectedAccountRepository.findOne({
      where: {
        id: messageChannel.connectedAccountId,
        workspaceId,
      },
    });

    if (!connectedAccount) {
      this.logger.error(
        `Forwarding channel ${messageChannel.id} has no connected account`,
      );
      await this.safeMove(s3Key, 'failed');

      return { kind: 'persist_failed', error: 'connected_account_missing' };
    }

    const authContext = buildSystemAuthContext(workspaceId);

    try {
      await this.globalWorkspaceOrmManager.executeInWorkspaceContext(
        async () => {
          await this.messagingSaveMessagesAndEnqueueContactCreationService.saveMessagesAndEnqueueContactCreation(
            [parsedInbound.message],
            messageChannel,
            connectedAccount,
            workspaceId,
          );
        },
        authContext,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      this.logger.error(
        `Failed to persist inbound email ${s3Key} for workspace ${workspaceId}: ${message}`,
      );
      await this.safeMove(s3Key, 'failed');

      return { kind: 'persist_failed', error: message };
    }

    await this.safeMove(s3Key, 'processed');

    return {
      kind: 'imported',
      workspaceId,
      messageChannelId: messageChannel.id,
    };
  }

  private async safeMove(
    s3Key: string,
    destination: 'processed' | 'unmatched' | 'failed',
  ): Promise<void> {
    try {
      if (destination === 'processed') {
        await this.inboundEmailStorageService.moveToProcessed(s3Key);
      } else if (destination === 'unmatched') {
        await this.inboundEmailStorageService.moveToUnmatched(s3Key);
      } else {
        await this.inboundEmailStorageService.moveToFailed(s3Key);
      }
    } catch (error) {
      this.logger.error(
        `Failed to archive inbound email ${s3Key} to ${destination}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
