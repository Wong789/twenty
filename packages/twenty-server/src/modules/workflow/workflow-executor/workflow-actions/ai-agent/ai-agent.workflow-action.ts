import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { resolveInput } from 'twenty-shared/utils';
import { type Repository } from 'typeorm';

import { type WorkflowAction } from 'src/modules/workflow/workflow-executor/interfaces/workflow-action.interface';

import { AgentAsyncExecutorService } from 'src/engine/metadata-modules/ai/ai-agent-execution/services/agent-async-executor.service';
import { WorkflowAgentTracePersistenceService } from 'src/engine/metadata-modules/ai/ai-agent-execution/services/workflow-agent-trace-persistence.service';
import { AgentEntity } from 'src/engine/metadata-modules/ai/ai-agent/entities/agent.entity';
import { AiBillingService } from 'src/engine/metadata-modules/ai/ai-billing/services/ai-billing.service';
import { computeCostBreakdown } from 'src/engine/metadata-modules/ai/ai-billing/utils/compute-cost-breakdown.util';
import { convertDollarsToBillingCredits } from 'src/engine/metadata-modules/ai/ai-billing/utils/convert-dollars-to-billing-credits.util';
import { AiModelRegistryService } from 'src/engine/metadata-modules/ai/ai-models/services/ai-model-registry.service';
import { UsageOperationType } from 'src/engine/core-modules/usage/enums/usage-operation-type.enum';
import { WebSearchService } from 'src/engine/core-modules/web-search/web-search.service';
import { AUTO_SELECT_SMART_MODEL_ID } from 'twenty-shared/constants';
import {
  WorkflowStepExecutorException,
  WorkflowStepExecutorExceptionCode,
} from 'src/modules/workflow/workflow-executor/exceptions/workflow-step-executor.exception';
import { WorkflowExecutionContextService } from 'src/modules/workflow/workflow-executor/services/workflow-execution-context.service';
import { type WorkflowActionInput } from 'src/modules/workflow/workflow-executor/types/workflow-action-input';
import { type WorkflowActionOutput } from 'src/modules/workflow/workflow-executor/types/workflow-action-output.type';
import { findStepOrThrow } from 'src/modules/workflow/workflow-executor/utils/find-step-or-throw.util';

import { isWorkflowAiAgentAction } from './guards/is-workflow-ai-agent-action.guard';

@Injectable()
export class AiAgentWorkflowAction implements WorkflowAction {
  private readonly logger = new Logger(AiAgentWorkflowAction.name);

  constructor(
    private readonly aiAgentExecutionService: AgentAsyncExecutorService,
    private readonly aiBillingService: AiBillingService,
    private readonly aiModelRegistryService: AiModelRegistryService,
    private readonly webSearchService: WebSearchService,
    private readonly workflowExecutionContextService: WorkflowExecutionContextService,
    private readonly tracePersistenceService: WorkflowAgentTracePersistenceService,
    @InjectRepository(AgentEntity)
    private readonly agentRepository: Repository<AgentEntity>,
  ) {}

  async execute({
    currentStepId,
    steps,
    context,
    runInfo,
  }: WorkflowActionInput): Promise<WorkflowActionOutput> {
    const step = findStepOrThrow({
      stepId: currentStepId,
      steps,
    });

    if (!isWorkflowAiAgentAction(step)) {
      throw new WorkflowStepExecutorException(
        'Step is not an AI Agent action',
        WorkflowStepExecutorExceptionCode.INVALID_STEP_TYPE,
      );
    }

    const { agentId, prompt } = step.settings.input;
    const workspaceId = runInfo.workspaceId;

    let agent: AgentEntity | null = null;

    if (agentId) {
      agent = await this.agentRepository.findOne({
        where: {
          id: agentId,
          workspaceId,
        },
      });
    }

    if (agentId && !agent) {
      throw new WorkflowStepExecutorException(
        `Agent with id ${agentId} not found`,
        WorkflowStepExecutorExceptionCode.INVALID_STEP_INPUT,
      );
    }

    const modelId = agent?.modelId ?? AUTO_SELECT_SMART_MODEL_ID;

    const executionContext =
      await this.workflowExecutionContextService.getExecutionContext(runInfo);

    const userWorkspaceId =
      executionContext.authContext.type === 'user'
        ? executionContext.authContext.userWorkspaceId
        : null;

    const resolvedPrompt = resolveInput(prompt, context) as string;

    const {
      result,
      usage,
      cacheCreationTokens,
      nativeWebSearchCallCount,
      steps: executionSteps,
    } = await this.aiAgentExecutionService.executeAgent({
      agent,
      userPrompt: resolvedPrompt,
      actorContext: executionContext.isActingOnBehalfOfUser
        ? executionContext.initiator
        : undefined,
      rolePermissionConfig: executionContext.rolePermissionConfig,
      authContext: executionContext.authContext,
    });

    await this.aiBillingService.calculateAndBillUsage(
      modelId,
      { usage, cacheCreationTokens },
      workspaceId,
      UsageOperationType.AI_WORKFLOW_TOKEN,
      agent?.id || null,
      userWorkspaceId,
    );

    if (this.webSearchService.shouldUseNativeSearch()) {
      this.aiBillingService.billNativeWebSearchUsage(
        nativeWebSearchCallCount,
        workspaceId,
        userWorkspaceId,
      );
    }

    if (executionSteps) {
      try {
        const modelConfiguration =
          this.aiModelRegistryService.getEffectiveModelConfig(modelId);
        const usageBreakdown = computeCostBreakdown(modelConfiguration, {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cachedInputTokens: usage.inputTokenDetails?.cacheReadTokens,
          reasoningTokens: usage.outputTokenDetails?.reasoningTokens,
          cacheCreationTokens,
        });

        await this.tracePersistenceService.persistTrace({
          steps: executionSteps,
          userPrompt: resolvedPrompt,
          agentId: agent?.id ?? null,
          workspaceId,
          workflowRunId: runInfo.workflowRunId,
          workflowStepId: currentStepId,
          totalInputTokens: usageBreakdown.tokenCounts.totalInputTokens,
          totalOutputTokens: usage.outputTokens ?? 0,
          totalInputCredits: Math.round(
            convertDollarsToBillingCredits(usageBreakdown.inputCostInDollars),
          ),
          totalOutputCredits: Math.round(
            convertDollarsToBillingCredits(usageBreakdown.outputCostInDollars),
          ),
          contextWindowTokens: modelConfiguration.contextWindowTokens,
          conversationSize: usageBreakdown.tokenCounts.totalInputTokens,
        });
      } catch (error) {
        this.logger.error(
          `Failed to persist workflow agent trace for run ${runInfo.workflowRunId} step ${currentStepId}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }

    return {
      result,
    };
  }
}
