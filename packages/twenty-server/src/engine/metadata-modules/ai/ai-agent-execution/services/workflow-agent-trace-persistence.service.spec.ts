import { type StepResult, type ToolSet } from 'ai';

import { FileAIChatService } from 'src/engine/core-modules/file/file-ai-chat/services/file-ai-chat.service';
import { AgentMessagePartEntity } from 'src/engine/metadata-modules/ai/ai-agent-execution/entities/agent-message-part.entity';
import { AgentMessageEntity } from 'src/engine/metadata-modules/ai/ai-agent-execution/entities/agent-message.entity';
import { AgentTurnEntity } from 'src/engine/metadata-modules/ai/ai-agent-execution/entities/agent-turn.entity';
import { WorkflowAgentTracePersistenceService } from 'src/engine/metadata-modules/ai/ai-agent-execution/services/workflow-agent-trace-persistence.service';
import { AgentChatThreadEntity } from 'src/engine/metadata-modules/ai/ai-chat/entities/agent-chat-thread.entity';

const createInsertResult = (id: string) =>
  ({
    identifiers: [{ id }],
  }) as never;

type TraceTestHarness = {
  service: WorkflowAgentTracePersistenceService;
  threadRepository: {
    findOne: jest.Mock;
    insert: jest.Mock;
    manager: { transaction: jest.Mock };
  };
  threadRepositoryInTx: { update: jest.Mock };
  turnRepository: { insert: jest.Mock };
  messageRepository: { insert: jest.Mock };
  messagePartRepository: { insert: jest.Mock };
  fileAIChatService: jest.Mocked<FileAIChatService>;
};

const createHarness = (): TraceTestHarness => {
  const threadRepositoryInTx = {
    update: jest.fn().mockResolvedValue(undefined),
  };
  const turnRepository = {
    insert: jest.fn().mockResolvedValue(createInsertResult('turn-1')),
  };
  const messageRepository = {
    insert: jest
      .fn()
      .mockResolvedValueOnce(createInsertResult('user-message-1'))
      .mockResolvedValueOnce(createInsertResult('assistant-message-1'))
      .mockResolvedValueOnce(createInsertResult('user-message-2'))
      .mockResolvedValueOnce(createInsertResult('assistant-message-2')),
  };
  const messagePartRepository = {
    insert: jest.fn().mockResolvedValue(undefined),
  };
  const entityManager = {
    getRepository: jest.fn((entity) => {
      if (entity === AgentChatThreadEntity) {
        return threadRepositoryInTx;
      }
      if (entity === AgentTurnEntity) {
        return turnRepository;
      }
      if (entity === AgentMessageEntity) {
        return messageRepository;
      }
      if (entity === AgentMessagePartEntity) {
        return messagePartRepository;
      }

      throw new Error(`Unexpected entity: ${String(entity)}`);
    }),
  };
  const threadRepository = {
    findOne: jest.fn(),
    insert: jest.fn(),
    manager: {
      transaction: jest.fn(async (callback) => callback(entityManager)),
    },
  };
  const fileAIChatService = {
    uploadFile: jest.fn(),
  } as unknown as jest.Mocked<FileAIChatService>;

  const service = new WorkflowAgentTracePersistenceService(
    threadRepository as never,
    fileAIChatService,
  );

  return {
    service,
    threadRepository,
    threadRepositoryInTx,
    turnRepository,
    messageRepository,
    messagePartRepository,
    fileAIChatService,
  };
};

const basePersistParams = {
  userPrompt: 'Do the thing',
  agentId: 'agent-1',
  workspaceId: 'workspace-1',
  workflowRunId: 'workflow-run-1',
  workflowStepId: 'workflow-step-1',
  totalInputTokens: 10,
  totalOutputTokens: 20,
  totalInputCredits: 30,
  totalOutputCredits: 40,
  contextWindowTokens: 50,
  conversationSize: 60,
};

const oneTextStep = [
  { content: [{ type: 'text', text: 'Answer' }] },
] as StepResult<ToolSet>[];

describe('WorkflowAgentTracePersistenceService', () => {
  it('creates a new thread with zero-initialized stats and applies the run stats inside the transaction', async () => {
    const harness = createHarness();

    harness.threadRepository.findOne.mockResolvedValueOnce(null);
    harness.threadRepository.insert.mockResolvedValueOnce(
      createInsertResult('thread-1'),
    );

    const persistedTrace = await harness.service.persistTrace({
      ...basePersistParams,
      steps: oneTextStep,
    });

    expect(persistedTrace).toEqual({
      turnId: 'turn-1',
      threadId: 'thread-1',
    });

    expect(harness.threadRepository.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        userWorkspaceId: null,
        workflowRunId: 'workflow-run-1',
        workflowStepId: 'workflow-step-1',
        title: 'Do the thing',
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalInputCredits: 0,
        totalOutputCredits: 0,
      }),
    );

    expect(harness.threadRepositoryInTx.update).toHaveBeenCalledWith(
      'thread-1',
      expect.objectContaining({
        title: 'Do the thing',
        totalInputTokens: expect.any(Function),
        totalOutputTokens: expect.any(Function),
        totalInputCredits: expect.any(Function),
        totalOutputCredits: expect.any(Function),
        contextWindowTokens: 50,
        conversationSize: 60,
      }),
    );

    const updatePayload = harness.threadRepositoryInTx.update.mock.calls[0][1];

    expect(updatePayload.totalInputTokens()).toBe('"totalInputTokens" + 10');
    expect(updatePayload.totalOutputTokens()).toBe('"totalOutputTokens" + 20');
    expect(updatePayload.totalInputCredits()).toBe('"totalInputCredits" + 30');
    expect(updatePayload.totalOutputCredits()).toBe(
      '"totalOutputCredits" + 40',
    );

    expect(harness.messageRepository.insert).toHaveBeenCalledTimes(2);
    expect(harness.messagePartRepository.insert).toHaveBeenCalledTimes(2);
    expect(harness.fileAIChatService.uploadFile).not.toHaveBeenCalled();
  });

  it('reuses the existing thread when the same workflow step executes again', async () => {
    const harness = createHarness();

    harness.threadRepository.findOne.mockResolvedValueOnce({ id: 'thread-1' });

    const persistedTrace = await harness.service.persistTrace({
      ...basePersistParams,
      userPrompt: 'Second prompt',
      totalInputTokens: 11,
      steps: oneTextStep,
    });

    expect(persistedTrace.threadId).toBe('thread-1');
    expect(harness.threadRepository.insert).not.toHaveBeenCalled();

    const updatePayload = harness.threadRepositoryInTx.update.mock.calls[0][1];

    expect(updatePayload.title).toBe('Second prompt');
    expect(updatePayload.totalInputTokens()).toBe('"totalInputTokens" + 11');
  });

  it('recovers when a concurrent persist wins the unique-index race', async () => {
    const harness = createHarness();
    const uniqueViolation = Object.assign(new Error('duplicate'), {
      code: '23505',
    });

    harness.threadRepository.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'thread-winner' });
    harness.threadRepository.insert.mockRejectedValueOnce(uniqueViolation);

    const persistedTrace = await harness.service.persistTrace({
      ...basePersistParams,
      steps: oneTextStep,
    });

    expect(persistedTrace.threadId).toBe('thread-winner');
    expect(harness.threadRepository.findOne).toHaveBeenCalledTimes(2);
  });

  it('skips assistant part inserts when the step produced no persistable parts', async () => {
    const harness = createHarness();

    harness.threadRepository.findOne.mockResolvedValueOnce(null);
    harness.threadRepository.insert.mockResolvedValueOnce(
      createInsertResult('thread-1'),
    );

    await harness.service.persistTrace({
      ...basePersistParams,
      steps: [] as StepResult<ToolSet>[],
    });

    // Only the user prompt part is inserted; no assistant parts.
    expect(harness.messagePartRepository.insert).toHaveBeenCalledTimes(1);
  });
});
