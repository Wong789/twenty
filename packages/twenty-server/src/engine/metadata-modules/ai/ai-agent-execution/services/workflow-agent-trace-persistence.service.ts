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
import { mapGenerateTextStepsToPersistableParts } from 'src/engine/metadata-modules/ai/ai-agent-execution/utils/mapGenerateTextStepsToPersistableParts';
import { mapPersistablePartsToDatabaseParts } from 'src/engine/metadata-modules/ai/ai-agent-execution/utils/mapPersistablePartsToDatabaseParts';
import { AgentChatThreadEntity } from 'src/engine/metadata-modules/ai/ai-chat/entities/agent-chat-thread.entity';
import { FileAIChatService } from 'src/engine/core-modules/file/file-ai-chat/services/file-ai-chat.service';

const MAX_THREAD_TITLE_LENGTH = 100;
const POSTGRES_UNIQUE_VIOLATION_CODE = '23505';

type WorkflowTraceThreadKey = {
  workspaceId: string;
  workflowRunId: string;
  workflowStepId: string;
};

type WorkflowTraceThreadStats = {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalInputCredits: number;
  totalOutputCredits: number;
  contextWindowTokens: number;
  conversationSize: number;
};

type PersistTraceParams = WorkflowTraceThreadKey &
  WorkflowTraceThreadStats & {
    steps: StepResult<ToolSet>[];
    userPrompt: string;
    agentId: string | null;
  };

const isUniqueViolationError = (error: unknown): error is { code: string } =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code: unknown }).code === POSTGRES_UNIQUE_VIOLATION_CODE;

const buildColumnIncrementExpression =
  (columnName: string, delta: number) => () =>
    `"${columnName}" + ${delta}`;

@Injectable()
export class WorkflowAgentTracePersistenceService {
  private readonly logger = new Logger(
    WorkflowAgentTracePersistenceService.name,
  );

  constructor(
    @InjectRepository(AgentChatThreadEntity)
    private readonly threadRepository: Repository<AgentChatThreadEntity>,
    private readonly fileAIChatService: FileAIChatService,
  ) {}

  async persistTrace(
    params: PersistTraceParams,
  ): Promise<{ turnId: string; threadId: string }> {
    const persistableParts = await mapGenerateTextStepsToPersistableParts({
      steps: params.steps,
      uploadGeneratedFile: async ({ file, filename }) => {
        // Files are uploaded before the DB transaction; a later transaction
        // failure can leave orphan uploads, which is acceptable here because
        // the files are cheap to regenerate and keeping DB transactions short
        // matters more than strict storage rollback.
        const uploadedFile = await this.fileAIChatService.uploadFile({
          file,
          filename,
          workspaceId: params.workspaceId,
        });

        return {
          fileId: uploadedFile.id,
          filename,
        };
      },
    });

    const threadId = await this.ensureWorkflowTraceThread(params);

    const turnId = await this.threadRepository.manager.transaction(
      async (entityManager) => {
        await this.applyThreadAggregates(entityManager, threadId, params);

        return this.insertTurnWithMessages(entityManager, {
          threadId,
          persistableParts,
          userPrompt: params.userPrompt,
          agentId: params.agentId,
          workspaceId: params.workspaceId,
        });
      },
    );

    this.logger.log(
      `Persisted workflow agent trace: turnId=${turnId} threadId=${threadId} steps=${params.steps.length} parts=${persistableParts.length}`,
    );

    return { turnId, threadId };
  }

  private async ensureWorkflowTraceThread(
    params: WorkflowTraceThreadKey & { userPrompt: string },
  ): Promise<string> {
    const { workspaceId, workflowRunId, workflowStepId } = params;
    const existingThread = await this.findWorkflowTraceThread({
      workspaceId,
      workflowRunId,
      workflowStepId,
    });

    if (existingThread) {
      return existingThread.id;
    }

    try {
      const insertResult = await this.threadRepository.insert({
        workspaceId,
        userWorkspaceId: null,
        workflowRunId,
        workflowStepId,
        title: params.userPrompt.substring(0, MAX_THREAD_TITLE_LENGTH),
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalInputCredits: 0,
        totalOutputCredits: 0,
      });

      return insertResult.identifiers[0].id as string;
    } catch (error) {
      // A concurrent persistTrace for the same (workspaceId, workflowRunId,
      // workflowStepId) can race past findOne and hit the partial unique
      // index. Re-read to get the winning thread id instead of failing.
      if (!isUniqueViolationError(error)) {
        throw error;
      }

      const winningThread = await this.findWorkflowTraceThread({
        workspaceId,
        workflowRunId,
        workflowStepId,
      });

      if (!winningThread) {
        throw error;
      }

      return winningThread.id;
    }
  }

  private findWorkflowTraceThread(key: WorkflowTraceThreadKey) {
    return this.threadRepository.findOne({
      where: key,
      select: ['id'],
    });
  }

  private async applyThreadAggregates(
    entityManager: EntityManager,
    threadId: string,
    params: WorkflowTraceThreadStats & { userPrompt: string },
  ): Promise<void> {
    await entityManager.getRepository(AgentChatThreadEntity).update(threadId, {
      title: params.userPrompt.substring(0, MAX_THREAD_TITLE_LENGTH),
      totalInputTokens: buildColumnIncrementExpression(
        'totalInputTokens',
        params.totalInputTokens,
      ),
      totalOutputTokens: buildColumnIncrementExpression(
        'totalOutputTokens',
        params.totalOutputTokens,
      ),
      totalInputCredits: buildColumnIncrementExpression(
        'totalInputCredits',
        params.totalInputCredits,
      ),
      totalOutputCredits: buildColumnIncrementExpression(
        'totalOutputCredits',
        params.totalOutputCredits,
      ),
      contextWindowTokens: params.contextWindowTokens,
      conversationSize: params.conversationSize,
    });
  }

  private async insertTurnWithMessages(
    entityManager: EntityManager,
    params: {
      threadId: string;
      persistableParts: Awaited<
        ReturnType<typeof mapGenerateTextStepsToPersistableParts>
      >;
      userPrompt: string;
      agentId: string | null;
      workspaceId: string;
    },
  ): Promise<string> {
    const { threadId, persistableParts, userPrompt, agentId, workspaceId } =
      params;
    const turnId = await this.insertAndGetId(
      entityManager.getRepository(AgentTurnEntity),
      { threadId, agentId, workspaceId },
    );
    const userMessageId = await this.insertMessage(entityManager, {
      threadId,
      turnId,
      role: AgentMessageRole.USER,
      agentId: null,
      workspaceId,
    });

    await entityManager.getRepository(AgentMessagePartEntity).insert({
      messageId: userMessageId,
      orderIndex: 0,
      type: 'text',
      textContent: userPrompt,
      workspaceId,
    });

    const assistantMessageId = await this.insertMessage(entityManager, {
      threadId,
      turnId,
      role: AgentMessageRole.ASSISTANT,
      agentId,
      workspaceId,
    });

    if (persistableParts.length > 0) {
      const databaseParts = mapPersistablePartsToDatabaseParts(
        persistableParts,
        assistantMessageId,
        workspaceId,
      );

      await entityManager
        .getRepository(AgentMessagePartEntity)
        .insert(
          databaseParts as QueryDeepPartialEntity<AgentMessagePartEntity>[],
        );
    }

    return turnId;
  }

  private insertMessage(
    entityManager: EntityManager,
    params: {
      threadId: string;
      turnId: string;
      role: AgentMessageRole;
      agentId: string | null;
      workspaceId: string;
    },
  ): Promise<string> {
    return this.insertAndGetId(
      entityManager.getRepository(AgentMessageEntity),
      {
        threadId: params.threadId,
        turnId: params.turnId,
        role: params.role,
        agentId: params.agentId,
        processedAt: new Date(),
        workspaceId: params.workspaceId,
      },
    );
  }

  private async insertAndGetId<T extends { id: string }>(
    repository: Repository<T>,
    payload: QueryDeepPartialEntity<T>,
  ): Promise<string> {
    const insertResult = await repository.insert(payload);

    return insertResult.identifiers[0].id as string;
  }
}
