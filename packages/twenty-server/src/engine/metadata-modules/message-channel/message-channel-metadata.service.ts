import { randomBytes } from 'crypto';

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { isNonEmptyString } from '@sniptt/guards';
import { In, Repository } from 'typeorm';

import {
  ConnectedAccountProvider,
  MessageChannelContactAutoCreationPolicy,
  MessageChannelPendingGroupEmailsAction,
  MessageChannelSyncStage,
  MessageChannelSyncStatus,
  MessageChannelType,
  MessageChannelVisibility,
} from 'twenty-shared/types';

import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { ConnectedAccountMetadataService } from 'src/engine/metadata-modules/connected-account/connected-account-metadata.service';
import { CreateEmailForwardingChannelOutput } from 'src/engine/metadata-modules/message-channel/dtos/create-email-forwarding-channel.output';
import { MessageChannelDTO } from 'src/engine/metadata-modules/message-channel/dtos/message-channel.dto';
import { MessageChannelEntity } from 'src/engine/metadata-modules/message-channel/entities/message-channel.entity';
import {
  MessageChannelException,
  MessageChannelExceptionCode,
} from 'src/engine/metadata-modules/message-channel/message-channel.exception';
import {
  INBOUND_EMAIL_LOCAL_PART_PREFIX,
  INBOUND_EMAIL_LOCAL_PART_RANDOM_BYTES,
} from 'src/modules/messaging/message-import-manager/drivers/inbound-email/constants/inbound-email.constants';

@Injectable()
export class MessageChannelMetadataService {
  constructor(
    @InjectRepository(MessageChannelEntity)
    private readonly repository: Repository<MessageChannelEntity>,
    private readonly connectedAccountMetadataService: ConnectedAccountMetadataService,
    private readonly twentyConfigService: TwentyConfigService,
  ) {}

  async findAll(workspaceId: string): Promise<MessageChannelDTO[]> {
    return this.repository.find({ where: { workspaceId } });
  }

  async findByUserWorkspaceId({
    userWorkspaceId,
    workspaceId,
  }: {
    userWorkspaceId: string;
    workspaceId: string;
  }): Promise<MessageChannelDTO[]> {
    const userAccountIds =
      await this.connectedAccountMetadataService.getUserConnectedAccountIds({
        userWorkspaceId,
        workspaceId,
      });

    return this.findByConnectedAccountIds({
      connectedAccountIds: userAccountIds,
      workspaceId,
    });
  }

  async findByConnectedAccountIdForUser({
    connectedAccountId,
    userWorkspaceId,
    workspaceId,
  }: {
    connectedAccountId: string;
    userWorkspaceId: string;
    workspaceId: string;
  }): Promise<MessageChannelDTO[]> {
    await this.connectedAccountMetadataService.verifyOwnership({
      id: connectedAccountId,
      userWorkspaceId,
      workspaceId,
    });

    return this.findByConnectedAccountId({ connectedAccountId, workspaceId });
  }

  async findByConnectedAccountId({
    connectedAccountId,
    workspaceId,
  }: {
    connectedAccountId: string;
    workspaceId: string;
  }): Promise<MessageChannelDTO[]> {
    return this.repository.find({
      where: { connectedAccountId, workspaceId },
    });
  }

  async findByConnectedAccountIds({
    connectedAccountIds,
    workspaceId,
  }: {
    connectedAccountIds: string[];
    workspaceId: string;
  }): Promise<MessageChannelDTO[]> {
    if (connectedAccountIds.length === 0) {
      return [];
    }

    return this.repository.find({
      where: { connectedAccountId: In(connectedAccountIds), workspaceId },
    });
  }

  async findById({
    id,
    workspaceId,
  }: {
    id: string;
    workspaceId: string;
  }): Promise<MessageChannelDTO | null> {
    return this.repository.findOne({ where: { id, workspaceId } });
  }

  async verifyOwnership({
    id,
    userWorkspaceId,
    workspaceId,
  }: {
    id: string;
    userWorkspaceId: string;
    workspaceId: string;
  }): Promise<MessageChannelEntity> {
    const messageChannel = await this.repository.findOne({
      where: { id, workspaceId },
    });

    if (!messageChannel) {
      throw new MessageChannelException(
        `Message channel ${id} not found`,
        MessageChannelExceptionCode.MESSAGE_CHANNEL_NOT_FOUND,
      );
    }

    const userAccountIds =
      await this.connectedAccountMetadataService.getUserConnectedAccountIds({
        userWorkspaceId,
        workspaceId,
      });

    if (!userAccountIds.includes(messageChannel.connectedAccountId)) {
      throw new MessageChannelException(
        `Message channel ${id} does not belong to user workspace ${userWorkspaceId}`,
        MessageChannelExceptionCode.MESSAGE_CHANNEL_OWNERSHIP_VIOLATION,
      );
    }

    return messageChannel;
  }

  async create(
    data: Partial<MessageChannelEntity> & {
      workspaceId: string;
      handle: string;
      connectedAccountId: string;
      visibility: MessageChannelVisibility;
      type: MessageChannelType;
      syncStage: MessageChannelSyncStage;
    },
  ): Promise<MessageChannelDTO> {
    const entity = this.repository.create(data);

    return this.repository.save(entity);
  }

  async update({
    id,
    workspaceId,
    data,
  }: {
    id: string;
    workspaceId: string;
    data: Partial<MessageChannelEntity>;
  }): Promise<MessageChannelDTO> {
    await this.repository.update(
      { id, workspaceId },
      data as Record<string, unknown>,
    );

    return this.repository.findOneOrFail({ where: { id, workspaceId } });
  }

  async createEmailForwardingChannel({
    userWorkspaceId,
    workspaceId,
  }: {
    userWorkspaceId: string;
    workspaceId: string;
  }): Promise<CreateEmailForwardingChannelOutput> {
    const inboundEmailDomain = this.twentyConfigService.get(
      'INBOUND_EMAIL_DOMAIN',
    );
    const inboundEmailBucket = this.twentyConfigService.get(
      'INBOUND_EMAIL_S3_BUCKET',
    );
    const inboundEmailRegion =
      this.twentyConfigService.get('INBOUND_EMAIL_S3_REGION') ||
      this.twentyConfigService.get('AWS_SES_REGION');

    if (
      !isNonEmptyString(inboundEmailDomain) ||
      !isNonEmptyString(inboundEmailBucket) ||
      !isNonEmptyString(inboundEmailRegion)
    ) {
      throw new MessageChannelException(
        'Email forwarding is not configured: INBOUND_EMAIL_DOMAIN, INBOUND_EMAIL_S3_BUCKET, and a region (INBOUND_EMAIL_S3_REGION or AWS_SES_REGION) must all be set',
        MessageChannelExceptionCode.EMAIL_FORWARDING_NOT_CONFIGURED,
      );
    }

    const localPart =
      INBOUND_EMAIL_LOCAL_PART_PREFIX +
      randomBytes(INBOUND_EMAIL_LOCAL_PART_RANDOM_BYTES).toString('hex');

    const forwardingAddress = `${localPart}@${inboundEmailDomain}`;

    const connectedAccount = await this.connectedAccountMetadataService.create({
      workspaceId,
      handle: forwardingAddress,
      provider: ConnectedAccountProvider.EMAIL_FORWARDING,
      userWorkspaceId,
      accessToken: null,
      refreshToken: null,
    });

    const messageChannel = await this.create({
      workspaceId,
      handle: forwardingAddress,
      connectedAccountId: connectedAccount.id,
      type: MessageChannelType.EMAIL_FORWARDING,
      visibility: MessageChannelVisibility.SHARE_EVERYTHING,
      // Forwarding channels are ready immediately — they don't go through the
      // mailbox sync state machine. MESSAGE_LIST_FETCH_PENDING + ACTIVE tells
      // the UI "this channel is working" while the S3 poll cron (which
      // explicitly skips EMAIL_FORWARDING) won't touch it.
      syncStage: MessageChannelSyncStage.MESSAGE_LIST_FETCH_PENDING,
      syncStatus: MessageChannelSyncStatus.ACTIVE,
      isSyncEnabled: true,
      isContactAutoCreationEnabled: true,
      contactAutoCreationPolicy:
        MessageChannelContactAutoCreationPolicy.SENT_AND_RECEIVED,
      excludeGroupEmails: false,
      excludeNonProfessionalEmails: false,
      pendingGroupEmailsAction: MessageChannelPendingGroupEmailsAction.NONE,
    });

    return { messageChannel, forwardingAddress };
  }

  async delete({
    id,
    workspaceId,
  }: {
    id: string;
    workspaceId: string;
  }): Promise<MessageChannelDTO> {
    const messageChannel = await this.repository.findOneOrFail({
      where: { id, workspaceId },
    });

    await this.repository.delete({ id, workspaceId });

    return messageChannel;
  }
}
