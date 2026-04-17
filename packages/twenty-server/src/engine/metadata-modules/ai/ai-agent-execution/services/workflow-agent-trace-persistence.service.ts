import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { type StepResult, type ToolSet } from 'ai';
import { EntityManager, Repository } from 'typeorm';
import { type QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';

import {
  AgentMessageEntity,
  AgentMessageRole,
} from 'src/engine/metadata-modules/ai/ai-agent-execution/entities/agent-message.entity';
import { AgentMessagePartEntity } from 'src/engine/metadata-modules/ai/ai-agent-execution/entities/agent-message-part.entity';
import { AgentTurnEntity } from 'src/engine/metadata-modules/ai/ai-agent-execution/entities/agent-turn.entity';
import { AgentChatThreadEntity } from 'src/engine/metadata-modules/ai/ai-chat/entities/agent-chat-thread.entity';
import { mapGenerateTextStepsToUIMessageParts } from 'src/engine/metadata-modules/ai/ai-agent-execution/utils/mapGenerateTextStepsToUIMessageParts';
import { mapUIMessagePartsToDBParts } from 'src/engine/metadata-modules/ai/ai-agent-execution/utils/mapUIMessagePartsToDBParts';

const MAX_THREAD_TITLE_LENGTH = 100;

@Injectable()
export class WorkflowAgentTracePersistenceService {
  private readonly logger = new Logger(
    WorkflowAgentTracePersistenceService.name,
  );

  constructor(
    @InjectRepository(AgentChatThreadEntity)
    private readonly threadRepository: Repository<AgentChatThreadEntity>,
  ) {}

  async persistTrace({
    steps,
    userPrompt,
    agentId,
    workspaceId,
    workflowRunId,
    workflowStepId,
    totalInputTokens,
    totalOutputTokens,
    totalInputCredits,
    totalOutputCredits,
    contextWindowTokens,
    conversationSize,
  }: {
    steps: StepResult<ToolSet>[];
    userPrompt: string;
    agentId: string | null;
    workspaceId: string;
    workflowRunId: string;
    workflowStepId: string;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalInputCredits: number;
    totalOutputCredits: number;
    contextWindowTokens: number;
    conversationSize: number;
  }): Promise<{ turnId: string; threadId: string }> {
    const title = userPrompt.substring(0, MAX_THREAD_TITLE_LENGTH);
    const uiParts = mapGenerateTextStepsToUIMessageParts(steps);
    const persistedTrace = await this.threadRepository.manager.transaction(
      async (entityManager) => {
        const threadId = await this.insertThread({
          entityManager,
          workspaceId,
          title,
          workflowRunId,
          workflowStepId,
          totalInputTokens,
          totalOutputTokens,
          totalInputCredits,
          totalOutputCredits,
          contextWindowTokens,
          conversationSize,
        });
        const turnId = await this.insertTurn({
          entityManager,
          threadId,
          agentId,
          workspaceId,
        });
        const userMessageId = await this.insertUserMessage({
          entityManager,
          threadId,
          turnId,
          workspaceId,
        });

        await entityManager.getRepository(AgentMessagePartEntity).insert({
          messageId: userMessageId,
          orderIndex: 0,
          type: 'text',
          textContent: userPrompt,
          workspaceId,
        });

        const assistantMessageId = await this.insertAssistantMessage({
          entityManager,
          threadId,
          turnId,
          agentId,
          workspaceId,
        });

        if (uiParts.length > 0) {
          const dbParts = mapUIMessagePartsToDBParts(
            uiParts,
            assistantMessageId,
            workspaceId,
          );

          if (dbParts.length > 0) {
            await entityManager
              .getRepository(AgentMessagePartEntity)
              .insert(
                dbParts as QueryDeepPartialEntity<AgentMessagePartEntity>[],
              );
          }
        }

        return { turnId, threadId };
      },
    );

    this.logger.log(
      `Persisted workflow agent trace: turnId=${persistedTrace.turnId} threadId=${persistedTrace.threadId} steps=${steps.length} parts=${uiParts.length}`,
    );

    return persistedTrace;
  }

  private async insertThread({
    entityManager,
    workspaceId,
    title,
    workflowRunId,
    workflowStepId,
    totalInputTokens,
    totalOutputTokens,
    totalInputCredits,
    totalOutputCredits,
    contextWindowTokens,
    conversationSize,
  }: {
    entityManager: EntityManager;
    workspaceId: string;
    title: string;
    workflowRunId: string;
    workflowStepId: string;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalInputCredits: number;
    totalOutputCredits: number;
    contextWindowTokens: number;
    conversationSize: number;
  }) {
    const insertResult = await entityManager
      .getRepository(AgentChatThreadEntity)
      .insert({
        workspaceId,
        userWorkspaceId: null,
        workflowRunId,
        workflowStepId,
        title,
        totalInputTokens,
        totalOutputTokens,
        totalInputCredits,
        totalOutputCredits,
        contextWindowTokens,
        conversationSize,
      });

    return insertResult.identifiers[0].id as string;
  }

  private async insertTurn({
    entityManager,
    threadId,
    agentId,
    workspaceId,
  }: {
    entityManager: EntityManager;
    threadId: string;
    agentId: string | null;
    workspaceId: string;
  }) {
    const insertResult = await entityManager
      .getRepository(AgentTurnEntity)
      .insert({
        threadId,
        agentId,
        workspaceId,
      });

    return insertResult.identifiers[0].id as string;
  }

  private async insertUserMessage({
    entityManager,
    threadId,
    turnId,
    workspaceId,
  }: {
    entityManager: EntityManager;
    threadId: string;
    turnId: string;
    workspaceId: string;
  }) {
    const insertResult = await entityManager
      .getRepository(AgentMessageEntity)
      .insert({
        threadId,
        turnId,
        role: AgentMessageRole.USER,
        processedAt: new Date(),
        workspaceId,
      });

    return insertResult.identifiers[0].id as string;
  }

  private async insertAssistantMessage({
    entityManager,
    threadId,
    turnId,
    agentId,
    workspaceId,
  }: {
    entityManager: EntityManager;
    threadId: string;
    turnId: string;
    agentId: string | null;
    workspaceId: string;
  }) {
    const insertResult = await entityManager
      .getRepository(AgentMessageEntity)
      .insert({
        threadId,
        turnId,
        role: AgentMessageRole.ASSISTANT,
        agentId,
        processedAt: new Date(),
        workspaceId,
      });

    return insertResult.identifiers[0].id as string;
  }
}
