import {
  Body,
  Controller,
  Delete,
  Param,
  Post,
  UseFilters,
  UseGuards,
} from '@nestjs/common';

import { PermissionFlagType } from 'twenty-shared/constants';

import { InjectRepository } from '@nestjs/typeorm';
import type { ExtendedUIMessage } from 'twenty-shared/ai';
import { isDefined } from 'twenty-shared/utils';
import type { Repository } from 'typeorm';

import { RestApiExceptionFilter } from 'src/engine/api/rest/rest-api-exception.filter';
import {
  BillingException,
  BillingExceptionCode,
} from 'src/engine/core-modules/billing/billing.exception';
import { BillingProductKey } from 'src/engine/core-modules/billing/enums/billing-product-key.enum';
import { BillingRestApiExceptionFilter } from 'src/engine/core-modules/billing/filters/billing-api-exception.filter';
import { BillingService } from 'src/engine/core-modules/billing/services/billing.service';
import { RedisClientService } from 'src/engine/core-modules/redis-client/redis-client.service';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import type { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { AuthUserWorkspaceId } from 'src/engine/decorators/auth/auth-user-workspace-id.decorator';
import { AuthWorkspace } from 'src/engine/decorators/auth/auth-workspace.decorator';
import { JwtAuthGuard } from 'src/engine/guards/jwt-auth.guard';
import { SettingsPermissionGuard } from 'src/engine/guards/settings-permission.guard';
import { WorkspaceAuthGuard } from 'src/engine/guards/workspace-auth.guard';
import {
  AgentException,
  AgentExceptionCode,
} from 'src/engine/metadata-modules/ai/ai-agent/agent.exception';
import { AgentRestApiExceptionFilter } from 'src/engine/metadata-modules/ai/ai-agent/filters/agent-api-exception.filter';
import type { BrowsingContextType } from 'src/engine/metadata-modules/ai/ai-agent/types/browsingContext.type';
import { AgentChatThreadEntity } from 'src/engine/metadata-modules/ai/ai-chat/entities/agent-chat-thread.entity';
import { getCancelChannel } from 'src/engine/metadata-modules/ai/ai-chat/utils/get-cancel-channel.util';
import { AgentChatEventPublisherService } from 'src/engine/metadata-modules/ai/ai-chat/services/agent-chat-event-publisher.service';
import { AgentChatStreamingService } from 'src/engine/metadata-modules/ai/ai-chat/services/agent-chat-streaming.service';
import { AgentChatService } from 'src/engine/metadata-modules/ai/ai-chat/services/agent-chat.service';
import { AiModelRegistryService } from 'src/engine/metadata-modules/ai/ai-models/services/ai-model-registry.service';

@Controller('rest/agent-chat')
@UseGuards(JwtAuthGuard, WorkspaceAuthGuard)
@UseFilters(
  RestApiExceptionFilter,
  AgentRestApiExceptionFilter,
  BillingRestApiExceptionFilter,
)
export class AgentChatController {
  constructor(
    private readonly agentStreamingService: AgentChatStreamingService,
    private readonly agentChatService: AgentChatService,
    private readonly eventPublisherService: AgentChatEventPublisherService,
    private readonly billingService: BillingService,
    private readonly twentyConfigService: TwentyConfigService,
    private readonly aiModelRegistryService: AiModelRegistryService,
    private readonly redisClientService: RedisClientService,
    @InjectRepository(AgentChatThreadEntity)
    private readonly threadRepository: Repository<AgentChatThreadEntity>,
  ) {}

  @Post(':threadId/message')
  @UseGuards(SettingsPermissionGuard(PermissionFlagType.AI))
  async sendMessage(
    @Param('threadId') threadId: string,
    @Body()
    body: {
      text: string;
      messages?: ExtendedUIMessage[];
      browsingContext?: BrowsingContextType | null;
      modelId?: string;
    },
    @AuthUserWorkspaceId() userWorkspaceId: string,
    @AuthWorkspace() workspace: WorkspaceEntity,
  ) {
    if (this.aiModelRegistryService.getAvailableModels().length === 0) {
      throw new AgentException(
        'No AI models are available. Configure at least one AI provider.',
        AgentExceptionCode.API_KEY_NOT_CONFIGURED,
      );
    }

    const resolvedModelId = body.modelId ?? workspace.smartModel;

    this.aiModelRegistryService.validateModelAvailability(
      resolvedModelId,
      workspace,
    );

    if (this.twentyConfigService.get('IS_BILLING_ENABLED')) {
      const canBill = await this.billingService.canBillMeteredProduct(
        workspace.id,
        BillingProductKey.WORKFLOW_NODE_EXECUTION,
      );

      if (!canBill) {
        throw new BillingException(
          'Credits exhausted',
          BillingExceptionCode.BILLING_CREDITS_EXHAUSTED,
        );
      }
    }

    const thread = await this.threadRepository.findOne({
      where: { id: threadId, userWorkspaceId },
    });

    if (!isDefined(thread)) {
      throw new AgentException(
        'Thread not found',
        AgentExceptionCode.AGENT_EXECUTION_FAILED,
      );
    }

    // Server decides: if the thread has an active stream, queue the message;
    // otherwise start streaming immediately.
    if (isDefined(thread.activeStreamId)) {
      const message = await this.agentChatService.queueMessage({
        threadId,
        text: body.text,
      });

      await this.eventPublisherService.publish({
        threadId,
        workspaceId: workspace.id,
        event: { type: 'queue-updated' },
      });

      return { messageId: message.id, queued: true };
    }

    const result = await this.agentStreamingService.streamAgentChat({
      threadId,
      messages: body.messages ?? [],
      browsingContext: body.browsingContext ?? null,
      modelId: body.modelId,
      userWorkspaceId,
      workspace,
    });

    return { messageId: threadId, queued: false, streamId: result.streamId };
  }

  @Delete(':threadId/stream')
  @UseGuards(SettingsPermissionGuard(PermissionFlagType.AI))
  async stopAgentChatStream(
    @Param('threadId') threadId: string,
    @AuthUserWorkspaceId() userWorkspaceId: string,
  ) {
    const thread = await this.threadRepository.findOne({
      where: { id: threadId, userWorkspaceId },
    });

    if (!isDefined(thread) || !isDefined(thread.activeStreamId)) {
      return { success: true };
    }

    const redis = this.redisClientService.getClient();

    await redis.publish(getCancelChannel(threadId), 'cancel');

    await this.threadRepository.update(
      { id: threadId, userWorkspaceId },
      { activeStreamId: null },
    );

    return { success: true };
  }

  @Delete('queue/:messageId')
  @UseGuards(SettingsPermissionGuard(PermissionFlagType.AI))
  async deleteQueuedMessage(
    @Param('messageId') messageId: string,
    @AuthUserWorkspaceId() userWorkspaceId: string,
    @AuthWorkspace() workspace: WorkspaceEntity,
  ) {
    const message = await this.agentChatService.findQueuedMessage(messageId);

    if (!isDefined(message)) {
      throw new AgentException(
        'Queued message not found',
        AgentExceptionCode.AGENT_EXECUTION_FAILED,
      );
    }

    const thread = await this.threadRepository.findOne({
      where: { id: message.threadId, userWorkspaceId },
    });

    if (!isDefined(thread)) {
      throw new AgentException(
        'Thread not found',
        AgentExceptionCode.AGENT_EXECUTION_FAILED,
      );
    }

    const deleted = await this.agentChatService.deleteQueuedMessage(messageId);

    if (deleted) {
      await this.eventPublisherService.publish({
        threadId: message.threadId,
        workspaceId: workspace.id,
        event: { type: 'queue-updated' },
      });
    }

    return { success: deleted };
  }
}
