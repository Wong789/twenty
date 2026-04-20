import { Injectable } from '@nestjs/common';

import { ProviderOptions } from '@ai-sdk/provider-utils';
import { ToolSet } from 'ai';
import { isAgentCapabilityEnabled } from 'twenty-shared/ai';

import { type ToolProviderAgent } from 'src/engine/core-modules/tool-provider/interfaces/tool-provider-agent.type';
import {
  WEB_SEARCH_TOOL_ID,
  X_SEARCH_TOOL_ID,
} from 'src/engine/core-modules/tool-provider/constants/search-tool-ids.const';
import { AGENT_CONFIG } from 'src/engine/metadata-modules/ai/ai-agent/constants/agent-config.const';
import {
  AI_SDK_ANTHROPIC,
  AI_SDK_BEDROCK,
  AI_SDK_OPENAI,
  AI_SDK_XAI,
} from 'src/engine/metadata-modules/ai/ai-models/constants/ai-sdk-package.const';
import { type RegisteredAiModel } from 'src/engine/metadata-modules/ai/ai-models/services/ai-model-registry.service';
import { SdkProviderFactoryService } from 'src/engine/metadata-modules/ai/ai-models/services/sdk-provider-factory.service';

type NativeSearchToolEntry = [string, ToolSet[string]];
type ChatNativeSearchPlan = {
  tools: ToolSet;
  hasWebSearch: boolean;
  hasXSearch: boolean;
};

@Injectable()
export class AiModelConfigService {
  constructor(private readonly sdkProviderFactory: SdkProviderFactoryService) {}

  getProviderOptions(model: RegisteredAiModel): ProviderOptions {
    switch (model.sdkPackage) {
      case AI_SDK_XAI:
        return {};
      case AI_SDK_ANTHROPIC:
        return this.getAnthropicProviderOptions(model);
      case AI_SDK_BEDROCK:
        return this.getBedrockProviderOptions(model);
      default:
        return {};
    }
  }

  getNativeModelTools(
    model: RegisteredAiModel,
    agent: ToolProviderAgent,
    options: { useProviderNativeWebSearch: boolean },
  ): ToolSet {
    const modelConfiguration = agent.modelConfiguration ?? {};
    const isWebSearchEnabledForAgent = isAgentCapabilityEnabled(
      modelConfiguration,
      'webSearch',
    );
    const isTwitterSearchEnabledForAgent = isAgentCapabilityEnabled(
      modelConfiguration,
      'twitterSearch',
    );
    const shouldExposeProviderNativeWebSearch =
      options.useProviderNativeWebSearch && isWebSearchEnabledForAgent;

    const toolEntries = this.getNativeSearchToolEntries(model, {
      exposeWebSearch: shouldExposeProviderNativeWebSearch,
      exposeTwitterSearch: isTwitterSearchEnabledForAgent,
    });

    return Object.fromEntries(toolEntries) as ToolSet;
  }

  getChatNativeSearchPlan(
    model: RegisteredAiModel,
    options: { useProviderNativeWebSearch: boolean },
  ): ChatNativeSearchPlan {
    const toolEntries = this.getNativeSearchToolEntries(model, {
      exposeWebSearch: options.useProviderNativeWebSearch,
      exposeTwitterSearch: model.sdkPackage === AI_SDK_XAI,
    });

    return {
      tools: Object.fromEntries(toolEntries) as ToolSet,
      hasWebSearch: toolEntries.some(
        ([toolId]) => toolId === WEB_SEARCH_TOOL_ID,
      ),
      hasXSearch: toolEntries.some(([toolId]) => toolId === X_SEARCH_TOOL_ID),
    };
  }

  private getAnthropicProviderOptions(
    model: RegisteredAiModel,
  ): ProviderOptions {
    if (!model.supportsReasoning) {
      return {};
    }

    return {
      anthropic: {
        thinking: {
          type: 'enabled',
          budgetTokens: AGENT_CONFIG.REASONING_BUDGET_TOKENS,
        },
      },
    };
  }

  private getBedrockProviderOptions(model: RegisteredAiModel): ProviderOptions {
    if (!model.supportsReasoning) {
      return {};
    }

    return {
      bedrock: {
        thinking: {
          type: 'enabled',
          budgetTokens: AGENT_CONFIG.REASONING_BUDGET_TOKENS,
        },
      },
    };
  }

  private getNativeSearchToolEntries(
    model: RegisteredAiModel,
    options: {
      exposeWebSearch: boolean;
      exposeTwitterSearch: boolean;
    },
  ): NativeSearchToolEntry[] {
    if (!model.providerName) {
      return [];
    }

    switch (model.sdkPackage) {
      case AI_SDK_ANTHROPIC: {
        if (!options.exposeWebSearch) {
          return [];
        }

        const anthropicProvider =
          this.sdkProviderFactory.getRawAnthropicProvider(model.providerName);

        if (!anthropicProvider) {
          return [];
        }

        return [
          [WEB_SEARCH_TOOL_ID, anthropicProvider.tools.webSearch_20250305()],
        ];
      }
      case AI_SDK_BEDROCK: {
        if (!options.exposeWebSearch) {
          return [];
        }

        const bedrockProvider = this.sdkProviderFactory.getRawBedrockProvider(
          model.providerName,
        );

        if (!bedrockProvider) {
          return [];
        }

        return [
          [
            WEB_SEARCH_TOOL_ID,
            bedrockProvider.tools.webSearch_20250305() as ToolSet[string],
          ],
        ];
      }
      case AI_SDK_OPENAI: {
        if (!options.exposeWebSearch) {
          return [];
        }

        const openAiProvider = this.sdkProviderFactory.getRawOpenAIProvider(
          model.providerName,
        );

        if (!openAiProvider) {
          return [];
        }

        return [[WEB_SEARCH_TOOL_ID, openAiProvider.tools.webSearch()]];
      }
      case AI_SDK_XAI: {
        const xaiProvider = this.sdkProviderFactory.getRawXaiProvider(
          model.providerName,
        );

        if (!xaiProvider) {
          return [];
        }

        const toolEntries: NativeSearchToolEntry[] = [];

        if (options.exposeWebSearch) {
          toolEntries.push([
            WEB_SEARCH_TOOL_ID,
            xaiProvider.tools.webSearch() as ToolSet[string],
          ]);
        }

        if (options.exposeTwitterSearch) {
          toolEntries.push([
            X_SEARCH_TOOL_ID,
            xaiProvider.tools.xSearch() as ToolSet[string],
          ]);
        }

        return toolEntries;
      }
      default:
        return [];
    }
  }
}
