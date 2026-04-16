jest.mock('ai', () => {
  const actual = jest.requireActual('ai');

  return {
    ...actual,
    generateText: jest.fn(),
  };
});

import { generateText, type ToolSet } from 'ai';

import { type LazyToolRuntimeService } from 'src/engine/core-modules/tool-provider/services/lazy-tool-runtime.service';
import { type ToolRegistryService } from 'src/engine/core-modules/tool-provider/services/tool-registry.service';
import { type ToolIndexEntry } from 'src/engine/core-modules/tool-provider/types/tool-index-entry.type';
import { type WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { AgentAsyncExecutorService } from 'src/engine/metadata-modules/ai/ai-agent-execution/services/agent-async-executor.service';
import { type AgentEntity } from 'src/engine/metadata-modules/ai/ai-agent/entities/agent.entity';
import { type AgentModelConfigService } from 'src/engine/metadata-modules/ai/ai-models/services/agent-model-config.service';
import {
  type AiModelRegistryService,
  type RegisteredAIModel,
} from 'src/engine/metadata-modules/ai/ai-models/services/ai-model-registry.service';
import { ToolCategory } from 'twenty-shared/ai';

const createTool = (name: string): ToolSet[string] =>
  ({
    description: name,
    inputSchema: {},
    execute: jest.fn(),
  }) as unknown as ToolSet[string];

const createToolIndexEntry = (
  name: string,
  category: ToolCategory,
): ToolIndexEntry => ({
  name,
  category,
  description: name,
  executionRef: { kind: 'static', toolId: name },
});

describe('AgentAsyncExecutorService', () => {
  const mockedGenerateText = jest.mocked(generateText);

  beforeEach(() => {
    mockedGenerateText.mockResolvedValue({
      text: 'Done',
      steps: [],
      usage: {} as never,
    } as never);
  });

  it('builds workflow execution with native tools eager and database/action tools lazy', async () => {
    const registeredModel = {
      modelId: 'openai/gpt-4o',
      sdkPackage: '@ai-sdk/openai',
      model: {} as never,
    } as RegisteredAIModel;

    const nativeModelTools = {
      web_search: createTool('web_search'),
    } as ToolSet;

    const runtimeTools = {
      web_search: createTool('web_search'),
      learn_tools: createTool('learn_tools'),
      execute_tool: createTool('execute_tool'),
    } as ToolSet;

    const lazyToolCatalog = [
      createToolIndexEntry('find_people', ToolCategory.DATABASE_CRUD),
      createToolIndexEntry('send_email', ToolCategory.ACTION),
    ];

    const aiModelRegistryService = {
      validateModelAvailability: jest.fn(),
      resolveModelForAgent: jest.fn().mockReturnValue(registeredModel),
    } as unknown as jest.Mocked<AiModelRegistryService>;

    const agentModelConfigService = {
      getProviderOptions: jest.fn().mockReturnValue({}),
    } as unknown as jest.Mocked<AgentModelConfigService>;

    const lazyToolRuntimeService = {
      buildToolRuntime: jest.fn().mockResolvedValue({
        toolCatalog: lazyToolCatalog,
        lazyToolCatalog,
        directTools: nativeModelTools,
        directToolNames: ['web_search'],
        runtimeTools,
      }),
    } as unknown as jest.Mocked<LazyToolRuntimeService>;

    const toolRegistry = {
      getToolsByCategories: jest.fn().mockResolvedValue(nativeModelTools),
    } as unknown as jest.Mocked<ToolRegistryService>;

    const roleTargetRepository = {
      findOne: jest.fn().mockResolvedValue({ roleId: 'agent-role-id' }),
    };

    const workspace = { id: 'workspace-id' } as WorkspaceEntity;
    const workspaceRepository = {
      findOneBy: jest.fn().mockResolvedValue(workspace),
    };

    const service = new AgentAsyncExecutorService(
      aiModelRegistryService,
      agentModelConfigService,
      lazyToolRuntimeService,
      toolRegistry,
      roleTargetRepository as never,
      workspaceRepository as never,
    );

    const agent = {
      id: 'agent-id',
      workspaceId: 'workspace-id',
      modelId: 'openai/gpt-4o',
      prompt: 'Use tools carefully.',
      modelConfiguration: {
        webSearch: { enabled: true },
        codeInterpreter: { enabled: false },
      },
      responseFormat: { type: 'text' },
    } as unknown as AgentEntity;

    await service.executeAgent({
      agent,
      userPrompt: 'Find the matching person.',
    });

    expect(toolRegistry.getToolsByCategories).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-id',
        roleId: 'agent-role-id',
        rolePermissionConfig: { intersectionOf: ['agent-role-id'] },
        agent: {
          modelId: 'openai/gpt-4o',
          modelConfiguration: agent.modelConfiguration,
        },
      }),
      {
        categories: [ToolCategory.NATIVE_MODEL],
        wrapWithErrorContext: false,
      },
    );

    expect(lazyToolRuntimeService.buildToolRuntime).toHaveBeenCalledWith({
      context: expect.objectContaining({
        workspaceId: 'workspace-id',
        roleId: 'agent-role-id',
        agent: {
          modelId: 'openai/gpt-4o',
          modelConfiguration: agent.modelConfiguration,
        },
      }),
      directTools: nativeModelTools,
      lazyToolCategories: [ToolCategory.DATABASE_CRUD, ToolCategory.ACTION],
    });

    expect(agentModelConfigService.getProviderOptions).toHaveBeenCalledWith(
      registeredModel,
    );
    expect(mockedGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: runtimeTools,
        system: expect.stringContaining('`find_people`'),
      }),
    );
  });
});
