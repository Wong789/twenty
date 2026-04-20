import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import {
  generateText,
  jsonSchema,
  Output,
  stepCountIs,
  type ToolSet,
} from 'ai';
import { type ActorMetadata } from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';
import { type Repository } from 'typeorm';

import { isUserAuthContext } from 'src/engine/core-modules/auth/guards/is-user-auth-context.guard';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { type ToolProviderAgent } from 'src/engine/core-modules/tool-provider/interfaces/tool-provider-agent.type';
import { ToolRegistryService } from 'src/engine/core-modules/tool-provider/services/tool-registry.service';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { type AgentExecutionResult } from 'src/engine/metadata-modules/ai/ai-agent-execution/types/agent-execution-result.type';
import { AGENT_CONFIG } from 'src/engine/metadata-modules/ai/ai-agent/constants/agent-config.const';
import { WORKFLOW_SYSTEM_PROMPTS } from 'src/engine/metadata-modules/ai/ai-agent/constants/agent-system-prompts.const';
import { type AgentEntity } from 'src/engine/metadata-modules/ai/ai-agent/entities/agent.entity';
import { repairToolCall } from 'src/engine/metadata-modules/ai/ai-agent/utils/repair-tool-call.util';
import { countNativeWebSearchCallsFromSteps } from 'src/engine/metadata-modules/ai/ai-billing/utils/count-native-web-search-calls-from-steps.util';
import { extractCacheCreationTokensFromSteps } from 'src/engine/metadata-modules/ai/ai-billing/utils/extract-cache-creation-tokens.util';
import { mergeLanguageModelUsage } from 'src/engine/metadata-modules/ai/ai-billing/utils/merge-language-model-usage.util';
import { AI_TELEMETRY_CONFIG } from 'src/engine/metadata-modules/ai/ai-models/constants/ai-telemetry.const';
import { AiModelConfigService } from 'src/engine/metadata-modules/ai/ai-models/services/ai-model-config.service';
import {
  AiModelRegistryService,
  RegisteredAiModel,
} from 'src/engine/metadata-modules/ai/ai-models/services/ai-model-registry.service';
import {
  AiException,
  AiExceptionCode,
} from 'src/engine/metadata-modules/ai/ai.exception';
import { RoleTargetEntity } from 'src/engine/metadata-modules/role-target/role-target.entity';
import { type RolePermissionConfig } from 'src/engine/twenty-orm/types/role-permission-config';
import { ToolCategory } from 'twenty-shared/ai';

type EffectiveAgentPermissions = {
  agentRoleId: string;
  rolePermissionConfig: RolePermissionConfig;
};

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
    private readonly aiModelConfigService: AiModelConfigService,
    private readonly toolRegistry: ToolRegistryService,
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

  private describeRolePermissionConfig(
    rolePermissionConfig?: RolePermissionConfig,
  ): string {
    if (!rolePermissionConfig) {
      return 'none';
    }

    if ('shouldBypassPermissionChecks' in rolePermissionConfig) {
      return 'bypass';
    }

    if ('intersectionOf' in rolePermissionConfig) {
      return `intersectionOf=[${rolePermissionConfig.intersectionOf.join(', ')}]`;
    }

    if ('unionOf' in rolePermissionConfig) {
      return `unionOf=[${rolePermissionConfig.unionOf.join(', ')}]`;
    }

    return 'unknown';
  }

  private extractAttemptedToolNames(
    steps: Array<{ toolCalls: Array<{ toolName: string }> }>,
  ): string[] {
    return steps.flatMap((step) =>
      step.toolCalls.map((toolCall) => toolCall.toolName),
    );
  }

  private async getEffectiveRolePermissionConfig(
    agentId: string,
    workspaceId: string,
    rolePermissionConfig?: RolePermissionConfig,
  ): Promise<EffectiveAgentPermissions | undefined> {
    const roleTarget = await this.roleTargetRepository.findOne({
      where: {
        agentId,
        workspaceId,
      },
      select: ['roleId'],
    });

    const agentRoleId = roleTarget?.roleId;

    if (!agentRoleId) {
      return undefined;
    }

    const workflowRoleIds = this.extractRoleIds(rolePermissionConfig);

    return {
      agentRoleId,
      rolePermissionConfig: {
        intersectionOf: [...new Set([agentRoleId, ...workflowRoleIds])],
      },
    };
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
    let registeredModel: RegisteredAiModel | undefined;
    let generatedToolNames: string[] = [];
    let effectiveAgentPermissions: EffectiveAgentPermissions | undefined;

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

      registeredModel =
        await this.aiModelRegistryService.resolveModelForAgent(agent);

      let tools: ToolSet = {};
      let providerOptions = {};
      const workflowRoleIds = this.extractRoleIds(rolePermissionConfig);

      if (agent) {
        effectiveAgentPermissions = await this.getEffectiveRolePermissionConfig(
          agent.id,
          agent.workspaceId,
          rolePermissionConfig,
        );

        if (effectiveAgentPermissions) {
          tools = await this.toolRegistry.getToolsByCategories(
            {
              workspaceId: agent.workspaceId,
              roleId: effectiveAgentPermissions.agentRoleId,
              rolePermissionConfig:
                effectiveAgentPermissions.rolePermissionConfig,
              executionScope: 'workflow_agent',
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
            },
            {
              categories: [
                ToolCategory.DATABASE_CRUD,
                ToolCategory.ACTION,
                ToolCategory.NATIVE_MODEL,
              ],
              wrapWithErrorContext: false,
            },
          );
        }

        providerOptions =
          this.aiModelConfigService.getProviderOptions(registeredModel);

        generatedToolNames = Object.keys(tools).sort();

        this.logger.log(
          `Workflow agent tool context: agentId=${agent.id} modelId=${registeredModel.modelId} workflowRoleIds=[${workflowRoleIds.join(', ')}] savedAgentRoleId=${effectiveAgentPermissions?.agentRoleId ?? 'none'} effectiveRolePermissionConfig=${this.describeRolePermissionConfig(effectiveAgentPermissions?.rolePermissionConfig)} toolCount=${generatedToolNames.length}`,
        );

        if (generatedToolNames.length > 0) {
          this.logger.log(
            `Workflow agent generated tools for ${agent.id}: ${generatedToolNames.join(', ')}`,
          );
        }
      }

      const textResponse = await generateText({
        system: `${WORKFLOW_SYSTEM_PROMPTS.BASE}\n\n${agent ? agent.prompt : ''}`,
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

      const attemptedToolNames = this.extractAttemptedToolNames(
        textResponse.steps,
      );

      this.logger.log(
        `Workflow agent model response: agentId=${agent?.id ?? 'none'} modelId=${registeredModel.modelId} finishReason=${textResponse.finishReason} stepCount=${textResponse.steps.length} attemptedToolCalls=[${attemptedToolNames.join(', ')}]`,
      );

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
        throw new AiException(
          'Failed to generate structured output from execution results',
          AiExceptionCode.AGENT_EXECUTION_FAILED,
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
      if (error instanceof AiException) {
        throw error;
      }

      const errorDetails =
        typeof error === 'object' && error !== null
          ? {
              name: 'name' in error ? error.name : undefined,
              message: 'message' in error ? error.message : undefined,
              statusCode: 'statusCode' in error ? error.statusCode : undefined,
              responseBody:
                'responseBody' in error ? error.responseBody : undefined,
              cause: 'cause' in error ? error.cause : undefined,
            }
          : { message: String(error) };

      this.logger.error(
        `Workflow agent execution failed: agentId=${agent?.id ?? 'none'} modelId=${registeredModel?.modelId ?? 'unknown'} savedAgentRoleId=${effectiveAgentPermissions?.agentRoleId ?? 'none'} toolCount=${generatedToolNames.length} error=${JSON.stringify(errorDetails)}`,
      );

      throw new AiException(
        error instanceof Error ? error.message : 'Agent execution failed',
        AiExceptionCode.AGENT_EXECUTION_FAILED,
      );
    }
  }
}
