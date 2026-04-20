jest.mock('ai', () => {
  const actual = jest.requireActual('ai');

  return {
    ...actual,
    generateText: jest.fn(),
  };
});

import { generateText, type ToolSet } from 'ai';

import { type ToolRegistryService } from 'src/engine/core-modules/tool-provider/services/tool-registry.service';
import { type WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { AgentAsyncExecutorService } from 'src/engine/metadata-modules/ai/ai-agent-execution/services/agent-async-executor.service';
import { type AgentEntity } from 'src/engine/metadata-modules/ai/ai-agent/entities/agent.entity';
import { type AiModelConfigService } from 'src/engine/metadata-modules/ai/ai-models/services/ai-model-config.service';
import {
  type AiModelRegistryService,
  type RegisteredAiModel,
} from 'src/engine/metadata-modules/ai/ai-models/services/ai-model-registry.service';
import { ToolCategory } from 'twenty-shared/ai';

describe('AgentAsyncExecutorService', () => {
  const mockedGenerateText = jest.mocked(generateText);

  const registeredModel = {
    modelId: 'xai/grok',
    sdkPackage: '@ai-sdk/xai',
    model: {} as never,
  } as RegisteredAiModel;

  const createService = ({
    roleId,
    tools = {},
  }: {
    roleId?: string;
    tools?: ToolSet;
  }) => {
    const aiModelRegistryService = {
      validateModelAvailability: jest.fn(),
      resolveModelForAgent: jest.fn().mockResolvedValue(registeredModel),
    } as unknown as jest.Mocked<AiModelRegistryService>;

    const aiModelConfigService = {
      getProviderOptions: jest.fn().mockReturnValue({}),
    } as unknown as jest.Mocked<AiModelConfigService>;

    const toolRegistry = {
      getToolsByCategories: jest.fn().mockResolvedValue(tools),
    } as unknown as jest.Mocked<ToolRegistryService>;

    const roleTargetRepository = {
      findOne: jest.fn().mockResolvedValue(roleId ? { roleId } : null),
    };

    const workspaceRepository = {
      findOneBy: jest
        .fn()
        .mockResolvedValue({ id: 'workspace-id' } as WorkspaceEntity),
    };

    const service = new AgentAsyncExecutorService(
      aiModelRegistryService,
      aiModelConfigService,
      toolRegistry,
      roleTargetRepository as never,
      workspaceRepository as never,
    );

    return {
      service,
      aiModelConfigService,
      toolRegistry,
    };
  };

  const agent = {
    id: 'agent-id',
    workspaceId: 'workspace-id',
    modelId: 'xai/grok',
    prompt: 'Be helpful.',
    modelConfiguration: {
      webSearch: { enabled: true },
      twitterSearch: { enabled: true },
    },
    responseFormat: { type: 'text' },
  } as unknown as AgentEntity;

  beforeEach(() => {
    mockedGenerateText.mockReset();
    mockedGenerateText.mockResolvedValue({
      text: 'Done',
      steps: [],
      usage: {} as never,
    } as never);
  });

  it('does not load workflow tools when the agent has no explicit role', async () => {
    const { service, toolRegistry } = createService({
      roleId: undefined,
    });

    await service.executeAgent({
      agent,
      userPrompt: 'Find a record.',
      rolePermissionConfig: { unionOf: ['workflow-role-id'] },
    });

    expect(toolRegistry.getToolsByCategories).not.toHaveBeenCalled();
    expect(mockedGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: {},
      }),
    );
  });

  it('intersects the saved agent role with workflow execution permissions', async () => {
    const tools = {
      x_search: {
        description: 'Search X',
        inputSchema: {},
        execute: jest.fn(),
      },
    } as unknown as ToolSet;
    const { service, aiModelConfigService, toolRegistry } = createService({
      roleId: 'agent-role-id',
      tools,
    });

    await service.executeAgent({
      agent,
      userPrompt: 'Find a record.',
      rolePermissionConfig: { unionOf: ['workflow-role-id'] },
    });

    expect(toolRegistry.getToolsByCategories).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-id',
        roleId: 'agent-role-id',
        rolePermissionConfig: {
          intersectionOf: ['agent-role-id', 'workflow-role-id'],
        },
        agent: {
          modelId: 'xai/grok',
          modelConfiguration: agent.modelConfiguration,
        },
      }),
      {
        categories: [
          ToolCategory.DATABASE_CRUD,
          ToolCategory.ACTION,
          ToolCategory.NATIVE_MODEL,
        ],
        wrapWithErrorContext: false,
      },
    );
    expect(aiModelConfigService.getProviderOptions).toHaveBeenCalledWith(
      registeredModel,
    );
  });
});
