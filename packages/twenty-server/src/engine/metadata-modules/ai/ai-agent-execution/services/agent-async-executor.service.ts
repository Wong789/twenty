import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import {
  APICallError,
  generateText,
  jsonSchema,
  Output,
  stepCountIs,
  type ToolSet,
} from 'ai';
import { type ActorMetadata } from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';
import { type Repository } from 'typeorm';

import { type ToolProviderContext } from 'src/engine/core-modules/tool-provider/interfaces/tool-provider-context.type';
import { type ToolProviderAgent } from 'src/engine/core-modules/tool-provider/interfaces/tool-provider-agent.type';

import { isUserAuthContext } from 'src/engine/core-modules/auth/guards/is-user-auth-context.guard';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { ExceptionHandlerService } from 'src/engine/core-modules/exception-handler/exception-handler.service';
import { LazyToolRuntimeService } from 'src/engine/core-modules/tool-provider/services/lazy-tool-runtime.service';
import { ToolRegistryService } from 'src/engine/core-modules/tool-provider/services/tool-registry.service';
import {
  EXECUTE_TOOL_TOOL_NAME,
  LEARN_TOOLS_TOOL_NAME,
} from 'src/engine/core-modules/tool-provider/tools';
import { type ToolIndexEntry } from 'src/engine/core-modules/tool-provider/types/tool-index-entry.type';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { type AgentExecutionResult } from 'src/engine/metadata-modules/ai/ai-agent-execution/types/agent-execution-result.type';
import {
  AgentException,
  AgentExceptionCode,
} from 'src/engine/metadata-modules/ai/ai-agent/agent.exception';
import { AGENT_CONFIG } from 'src/engine/metadata-modules/ai/ai-agent/constants/agent-config.const';
import { WORKFLOW_SYSTEM_PROMPTS } from 'src/engine/metadata-modules/ai/ai-agent/constants/agent-system-prompts.const';
import { type AgentEntity } from 'src/engine/metadata-modules/ai/ai-agent/entities/agent.entity';
import { repairToolCall } from 'src/engine/metadata-modules/ai/ai-agent/utils/repair-tool-call.util';
import { countNativeWebSearchCallsFromSteps } from 'src/engine/metadata-modules/ai/ai-billing/utils/count-native-web-search-calls-from-steps.util';
import { extractCacheCreationTokensFromSteps } from 'src/engine/metadata-modules/ai/ai-billing/utils/extract-cache-creation-tokens.util';
import { mergeLanguageModelUsage } from 'src/engine/metadata-modules/ai/ai-billing/utils/merge-language-model-usage.util';
import { AI_TELEMETRY_CONFIG } from 'src/engine/metadata-modules/ai/ai-models/constants/ai-telemetry.const';
import { AgentModelConfigService } from 'src/engine/metadata-modules/ai/ai-models/services/agent-model-config.service';
import {
  AiModelRegistryService,
  type RegisteredAIModel,
} from 'src/engine/metadata-modules/ai/ai-models/services/ai-model-registry.service';
import { RoleTargetEntity } from 'src/engine/metadata-modules/role-target/role-target.entity';
import { type RolePermissionConfig } from 'src/engine/twenty-orm/types/role-permission-config';
import { ToolCategory } from 'twenty-shared/ai';

const WORKFLOW_AGENT_LAZY_TOOL_CATEGORIES = [
  ToolCategory.DATABASE_CRUD,
  ToolCategory.ACTION,
] as const;

const toToolProviderAgent = (agent: AgentEntity): ToolProviderAgent => ({
  modelId: agent.modelId,
  modelConfiguration: agent.modelConfiguration,
});

// Agent execution within workflows uses database and action tools only.
// Workflow tools are intentionally excluded to avoid circular dependencies
// and recursive workflow execution.
@Injectable()
export class AgentAsyncExecutorService {
  private readonly logger = new Logger(AgentAsyncExecutorService.name);

  constructor(
    private readonly aiModelRegistryService: AiModelRegistryService,
    private readonly agentModelConfigService: AgentModelConfigService,
    private readonly lazyToolRuntimeService: LazyToolRuntimeService,
    private readonly toolRegistry: ToolRegistryService,
    private readonly exceptionHandlerService: ExceptionHandlerService,
    @InjectRepository(RoleTargetEntity)
    private readonly roleTargetRepository: Repository<RoleTargetEntity>,
    @InjectRepository(WorkspaceEntity)
    private readonly workspaceRepository: Repository<WorkspaceEntity>,
  ) {}

  private extractRoleIds(
    rolePermissionConfig?: RolePermissionConfig,
  ): string[] {
    if (!rolePermissionConfig) {
      return [];
    }

    if ('intersectionOf' in rolePermissionConfig) {
      return rolePermissionConfig.intersectionOf;
    }

    if ('unionOf' in rolePermissionConfig) {
      return rolePermissionConfig.unionOf;
    }

    return [];
  }

  private async getEffectiveRolePermissionConfig(
    agentId: string,
    workspaceId: string,
    rolePermissionConfig?: RolePermissionConfig,
  ): Promise<RolePermissionConfig | undefined> {
    const roleTarget = await this.roleTargetRepository.findOne({
      where: {
        agentId,
        workspaceId,
      },
      select: ['roleId'],
    });

    const agentRoleId = roleTarget?.roleId;
    const configRoleIds = this.extractRoleIds(rolePermissionConfig);

    const allRoleIds = agentRoleId
      ? [...new Set([...configRoleIds, agentRoleId])]
      : configRoleIds;

    if (allRoleIds.length === 0) {
      return undefined;
    }

    return { intersectionOf: allRoleIds };
  }

  private buildWorkflowToolCatalogPrompt({
    toolCatalog,
    directToolNames,
  }: {
    toolCatalog: ToolIndexEntry[];
    directToolNames: string[];
  }): string {
    const toolsByCategory = new Map<ToolCategory, ToolIndexEntry[]>();

    for (const tool of toolCatalog) {
      const existing = toolsByCategory.get(tool.category) ?? [];

      existing.push(tool);
      toolsByCategory.set(tool.category, existing);
    }

    const directToolsSection =
      directToolNames.length > 0
        ? `Direct native model tools available now: ${directToolNames.map((toolName) => `\`${toolName}\``).join(', ')}.`
        : 'No direct native model tools are available.';

    const sections = [
      `## Available Workflow Tools

${directToolsSection}

For database and action tools, first call \`${LEARN_TOOLS_TOOL_NAME}\` with the exact tool name to learn its schema, then call \`${EXECUTE_TOOL_TOOL_NAME}\` with matching arguments. Do not call tools that are not listed below.`,
    ];

    for (const category of WORKFLOW_AGENT_LAZY_TOOL_CATEGORIES) {
      const tools = toolsByCategory.get(category);

      if (!tools || tools.length === 0) {
        continue;
      }

      sections.push(`### ${category}
${tools.map((tool) => `- \`${tool.name}\``).join('\n')}`);
    }

    return sections.join('\n\n');
  }

  async executeAgent({
    agent,
    userPrompt,
    actorContext,
    rolePermissionConfig,
    authContext,
  }: {
    agent: AgentEntity | null;
    userPrompt: string;
    actorContext?: ActorMetadata;
    rolePermissionConfig?: RolePermissionConfig;
    authContext?: WorkspaceAuthContext;
  }): Promise<AgentExecutionResult> {
    let resolvedModelForLog: RegisteredAIModel | undefined;
    let lazyWorkflowToolCount = 0;

    try {
      if (agent) {
        const workspace = await this.workspaceRepository.findOneBy({
          id: agent.workspaceId,
        });

        if (workspace) {
          this.aiModelRegistryService.validateModelAvailability(
            agent.modelId,
            workspace,
          );
        }
      }

      const registeredModel =
        await this.aiModelRegistryService.resolveModelForAgent(agent);

      resolvedModelForLog = registeredModel;

      let tools: ToolSet = {};
      let providerOptions = {};
      let workflowToolCatalogPrompt = '';

      if (agent) {
        const effectiveRoleConfig = await this.getEffectiveRolePermissionConfig(
          agent.id,
          agent.workspaceId,
          rolePermissionConfig,
        );

        const roleId = this.extractRoleIds(effectiveRoleConfig)[0] ?? '';
        const toolProviderContext: ToolProviderContext = {
          workspaceId: agent.workspaceId,
          roleId,
          rolePermissionConfig: effectiveRoleConfig ?? { unionOf: [] },
          authContext,
          actorContext,
          agent: toToolProviderAgent(agent),
          userId:
            isDefined(authContext) && isUserAuthContext(authContext)
              ? authContext.user.id
              : undefined,
          userWorkspaceId:
            isDefined(authContext) && isUserAuthContext(authContext)
              ? authContext.userWorkspaceId
              : undefined,
        };

        const nativeModelTools = await this.toolRegistry.getToolsByCategories(
          toolProviderContext,
          {
            categories: [ToolCategory.NATIVE_MODEL],
            wrapWithErrorContext: false,
          },
        );

        const toolRuntime = await this.lazyToolRuntimeService.buildToolRuntime({
          context: toolProviderContext,
          directTools: nativeModelTools,
          lazyToolCategories: WORKFLOW_AGENT_LAZY_TOOL_CATEGORIES,
        });

        tools = toolRuntime.runtimeTools;
        lazyWorkflowToolCount = toolRuntime.lazyToolCatalog.length;
        workflowToolCatalogPrompt = this.buildWorkflowToolCatalogPrompt({
          toolCatalog: toolRuntime.lazyToolCatalog,
          directToolNames: toolRuntime.directToolNames,
        });

        providerOptions =
          this.agentModelConfigService.getProviderOptions(registeredModel);
      }

      const runtimeToolCount = Object.keys(tools).length;

      this.logger.log(
        `Generated ${runtimeToolCount} runtime tools and ${lazyWorkflowToolCount} lazy workflow tools for agent`,
      );

      const textResponse = await generateText({
        system: `${WORKFLOW_SYSTEM_PROMPTS.BASE}\n\n${workflowToolCatalogPrompt}\n\n${agent ? agent.prompt : ''}`,
        tools,
        model: registeredModel.model,
        prompt: userPrompt,
        stopWhen: stepCountIs(AGENT_CONFIG.MAX_STEPS),
        providerOptions,
        experimental_telemetry: AI_TELEMETRY_CONFIG,
        experimental_repairToolCall: async ({
          toolCall,
          tools: toolsForRepair,
          inputSchema,
          error,
        }) => {
          return repairToolCall({
            toolCall,
            tools: toolsForRepair,
            inputSchema,
            error,
            model: registeredModel.model,
          });
        },
      });

      const cacheCreationTokens = extractCacheCreationTokensFromSteps(
        textResponse.steps,
      );

      const nativeWebSearchCallCount = countNativeWebSearchCallsFromSteps(
        textResponse.steps,
      );

      const agentSchema =
        agent?.responseFormat?.type === 'json'
          ? agent.responseFormat.schema
          : undefined;

      if (!agentSchema) {
        return {
          result: { response: textResponse.text },
          usage: textResponse.usage,
          cacheCreationTokens,
          nativeWebSearchCallCount,
        };
      }

      const structuredResult = await generateText({
        system: WORKFLOW_SYSTEM_PROMPTS.OUTPUT_GENERATOR,
        model: registeredModel.model,
        prompt: `Based on the following execution results, generate the structured output according to the schema:

                 Execution Results: ${textResponse.text}

                 Please generate the structured output based on the execution results and context above.`,
        output: Output.object({ schema: jsonSchema(agentSchema) }),
        experimental_telemetry: AI_TELEMETRY_CONFIG,
      });

      if (structuredResult.output == null) {
        throw new AgentException(
          'Failed to generate structured output from execution results',
          AgentExceptionCode.AGENT_EXECUTION_FAILED,
        );
      }

      return {
        result: structuredResult.output as object,
        usage: mergeLanguageModelUsage(
          textResponse.usage,
          structuredResult.usage,
        ),
        cacheCreationTokens,
        nativeWebSearchCallCount,
      };
    } catch (error) {
      if (error instanceof AgentException) {
        throw error;
      }

      const cause =
        error instanceof Error
          ? (error as Error & { cause?: unknown }).cause
          : undefined;
      const apiCallError = APICallError.isInstance(error)
        ? error
        : APICallError.isInstance(cause)
          ? cause
          : undefined;
      const statusSuffix = apiCallError?.statusCode
        ? ` status=${apiCallError.statusCode}`
        : '';
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      this.logger.error(
        `Workflow agent execution failed [workspace=${agent?.workspaceId} agent=${agent?.id} model=${resolvedModelForLog?.modelId}${statusSuffix}]: ${errorMessage}`,
        error instanceof Error ? error.stack : undefined,
      );

      this.exceptionHandlerService.captureExceptions(
        [error],
        agent ? { workspace: { id: agent.workspaceId } } : undefined,
      );

      throw new AgentException(
        error instanceof Error ? error.message : 'Agent execution failed',
        AgentExceptionCode.AGENT_EXECUTION_FAILED,
      );
    }
  }
}
