jest.mock('ai', () => {
  const actual = jest.requireActual('ai');

  return {
    ...actual,
    generateText: jest.fn(),
  };
});

import { generateText, type ToolSet } from 'ai';

import { WEB_SEARCH_TOOL_ID } from 'src/engine/core-modules/tool-provider/constants/search-tool-ids.const';
import { type ToolRegistryService } from 'src/engine/core-modules/tool-provider/services/tool-registry.service';
import { type WebSearchService } from 'src/engine/core-modules/web-search/web-search.service';
import { type WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { AgentAsyncExecutorService } from 'src/engine/metadata-modules/ai/ai-agent-execution/services/agent-async-executor.service';
import { WORKFLOW_SYSTEM_PROMPTS } from 'src/engine/metadata-modules/ai/ai-agent/constants/agent-system-prompts.const';
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
    roleScopedTools = {},
    noRoleFallbackActionTools = {},
    nativeModelTools = {},
  }: {
    roleId?: string;
    roleScopedTools?: ToolSet;
    noRoleFallbackActionTools?: ToolSet;
    nativeModelTools?: ToolSet;
  }) => {
    const aiModelRegistryService = {
      validateModelAvailability: jest.fn(),
      resolveModelForAgent: jest.fn().mockResolvedValue(registeredModel),
    } as unknown as jest.Mocked<AiModelRegistryService>;

    const aiModelConfigService = {
      getProviderOptions: jest.fn().mockReturnValue({}),
      getNativeModelTools: jest.fn().mockReturnValue(nativeModelTools),
    } as unknown as jest.Mocked<AiModelConfigService>;

    const toolRegistry = {
      getToolsByCategories: jest
        .fn()
        .mockImplementation((_context, options) => {
          if (
            options.categories?.includes(ToolCategory.DATABASE_CRUD) &&
            options.categories?.includes(ToolCategory.ACTION)
          ) {
            return Promise.resolve(roleScopedTools);
          }

          if (
            options.categories?.length === 1 &&
            options.categories[0] === ToolCategory.ACTION
          ) {
            return Promise.resolve(noRoleFallbackActionTools);
          }

          return Promise.resolve({});
        }),
    } as unknown as jest.Mocked<ToolRegistryService>;

    const webSearchService = {
      shouldUseNativeSearch: jest.fn().mockReturnValue(true),
    } as unknown as jest.Mocked<WebSearchService>;

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
      webSearchService,
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

  it('keeps native and fallback tools available when the agent has no explicit role', async () => {
    const noRoleFallbackActionTools = {
      web_search: {
        description: 'Search the web',
        inputSchema: {},
        execute: jest.fn(),
      },
      code_interpreter: {
        description: 'Run code',
        inputSchema: {},
        execute: jest.fn(),
      },
    } as unknown as ToolSet;
    const nativeModelTools = {
      x_search: {
        description: 'Search X',
        inputSchema: {},
        execute: jest.fn(),
      },
    } as unknown as ToolSet;
    const { service, aiModelConfigService, toolRegistry } = createService({
      roleId: undefined,
      noRoleFallbackActionTools,
      nativeModelTools,
    });

    await service.executeAgent({
      agent,
      userPrompt: 'Find a record.',
      rolePermissionConfig: { unionOf: ['workflow-role-id'] },
    });

    expect(toolRegistry.getToolsByCategories).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-id',
        roleId: 'workflow-role-id',
        rolePermissionConfig: { unionOf: ['workflow-role-id'] },
        executionScope: 'workflow_agent',
        agent: {
          modelId: 'xai/grok',
          modelConfiguration: agent.modelConfiguration,
        },
      }),
      {
        categories: [ToolCategory.ACTION],
        wrapWithErrorContext: false,
      },
    );
    expect(aiModelConfigService.getNativeModelTools).toHaveBeenCalledWith(
      registeredModel,
      {
        modelId: 'xai/grok',
        modelConfiguration: agent.modelConfiguration,
      },
      { useProviderNativeWebSearch: true },
    );
    expect(mockedGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        system: `${WORKFLOW_SYSTEM_PROMPTS.BASE}\n\n${agent.prompt}`,
        tools: {
          ...noRoleFallbackActionTools,
          ...nativeModelTools,
        },
      }),
    );
  });

  it('uses a workflow system prompt that guards against unverified claims', async () => {
    const { service } = createService({
      roleId: undefined,
    });

    await service.executeAgent({
      agent,
      userPrompt: 'Find the latest news.',
      rolePermissionConfig: { unionOf: ['workflow-role-id'] },
    });

    expect(mockedGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        system: expect.stringContaining(
          'If recent or external information cannot be verified with the available tools, say so',
        ),
      }),
    );
    expect(mockedGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        system: expect.stringContaining(
          'Never invent search results, news, X posts, URLs, handles, or record data',
        ),
      }),
    );
  });

  it('intersects the saved agent role with workflow execution permissions', async () => {
    const roleScopedTools = {
      find_companies: {
        description: 'Find companies',
        inputSchema: {},
        execute: jest.fn(),
      },
    } as unknown as ToolSet;
    const nativeModelTools = {
      x_search: {
        description: 'Search X',
        inputSchema: {},
        execute: jest.fn(),
      },
    } as unknown as ToolSet;
    const { service, aiModelConfigService, toolRegistry } = createService({
      roleId: 'agent-role-id',
      roleScopedTools,
      nativeModelTools,
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
        executionScope: 'workflow_agent',
        agent: {
          modelId: 'xai/grok',
          modelConfiguration: agent.modelConfiguration,
        },
      }),
      {
        categories: [ToolCategory.DATABASE_CRUD, ToolCategory.ACTION],
        wrapWithErrorContext: false,
      },
    );
    expect(toolRegistry.getToolsByCategories).toHaveBeenCalledTimes(1);
    expect(aiModelConfigService.getNativeModelTools).toHaveBeenCalledWith(
      registeredModel,
      {
        modelId: 'xai/grok',
        modelConfiguration: agent.modelConfiguration,
      },
      { useProviderNativeWebSearch: true },
    );
    expect(aiModelConfigService.getProviderOptions).toHaveBeenCalledWith(
      registeredModel,
    );
    expect(mockedGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: {
          ...roleScopedTools,
          ...nativeModelTools,
        },
      }),
    );
  });

  it('does not load external web search when native web search is already available', async () => {
    const noRoleFallbackActionTools = {
      web_search: {
        description: 'Search the web',
        inputSchema: {},
        execute: jest.fn(),
      },
    } as unknown as ToolSet;
    const nativeModelTools = {
      [WEB_SEARCH_TOOL_ID]: {
        description: 'Native search the web',
        inputSchema: {},
        execute: jest.fn(),
      },
    } as unknown as ToolSet;
    const { service, toolRegistry } = createService({
      roleId: undefined,
      noRoleFallbackActionTools,
      nativeModelTools,
    });

    await service.executeAgent({
      agent,
      userPrompt: 'Find a record.',
      rolePermissionConfig: { unionOf: ['workflow-role-id'] },
    });

    expect(toolRegistry.getToolsByCategories).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-id',
        roleId: 'workflow-role-id',
      }),
      {
        categories: [ToolCategory.ACTION],
        wrapWithErrorContext: false,
      },
    );
    expect(mockedGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: nativeModelTools,
      }),
    );
  });
});
