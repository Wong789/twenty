import { Injectable } from '@nestjs/common';

import { ProviderOptions } from '@ai-sdk/provider-utils';
import { ToolSet } from 'ai';
import { isAgentCapabilityEnabled } from 'twenty-shared/ai';

import { type ToolProviderAgent } from 'src/engine/core-modules/tool-provider/interfaces/tool-provider-agent.type';
import { AGENT_CONFIG } from 'src/engine/metadata-modules/ai/ai-agent/constants/agent-config.const';
import {
  AI_SDK_ANTHROPIC,
  AI_SDK_BEDROCK,
  AI_SDK_OPENAI,
  AI_SDK_XAI,
} from 'src/engine/metadata-modules/ai/ai-models/constants/ai-sdk-package.const';
import {
  AiModelRegistryService,
  RegisteredAIModel,
} from 'src/engine/metadata-modules/ai/ai-models/services/ai-model-registry.service';
import { SdkProviderFactoryService } from 'src/engine/metadata-modules/ai/ai-models/services/sdk-provider-factory.service';

@Injectable()
export class AgentModelConfigService {
  constructor(
    private readonly aiModelRegistryService: AiModelRegistryService,
    private readonly sdkProviderFactory: SdkProviderFactoryService,
  ) {}

  getProviderOptions(model: RegisteredAIModel): ProviderOptions {
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
    model: RegisteredAIModel,
    agent: ToolProviderAgent,
    options: { useProviderNativeWebSearch: boolean },
  ): ToolSet {
    const tools: ToolSet = {};
    const modelConfiguration = agent.modelConfiguration ?? {};

    switch (model.sdkPackage) {
      case AI_SDK_ANTHROPIC:
        if (
          options.useProviderNativeWebSearch &&
          isAgentCapabilityEnabled(modelConfiguration, 'webSearch')
        ) {
          const anthropicProvider = model.providerName
            ? this.sdkProviderFactory.getRawAnthropicProvider(
                model.providerName,
              )
            : undefined;

          if (anthropicProvider) {
            tools.web_search = anthropicProvider.tools.webSearch_20250305();
          }
        }
        break;
      case AI_SDK_BEDROCK: {
        if (
          options.useProviderNativeWebSearch &&
          isAgentCapabilityEnabled(modelConfiguration, 'webSearch')
        ) {
          const bedrockProvider = model.providerName
            ? this.sdkProviderFactory.getRawBedrockProvider(model.providerName)
            : undefined;

          if (bedrockProvider) {
            tools.web_search =
              bedrockProvider.tools.webSearch_20250305() as ToolSet[string];
          }
        }
        break;
      }
      case AI_SDK_OPENAI:
        if (
          options.useProviderNativeWebSearch &&
          isAgentCapabilityEnabled(modelConfiguration, 'webSearch')
        ) {
          const openaiProvider = model.providerName
            ? this.sdkProviderFactory.getRawOpenAIProvider(model.providerName)
            : undefined;

          if (openaiProvider) {
            tools.web_search = openaiProvider.tools.webSearch();
          }
        }
        break;
      case AI_SDK_XAI:
        if (!model.providerName) {
          break;
        }

        const xaiProvider = this.sdkProviderFactory.getRawXaiProvider(
          model.providerName,
        );

        if (!xaiProvider) {
          break;
        }

        if (
          options.useProviderNativeWebSearch &&
          isAgentCapabilityEnabled(modelConfiguration, 'webSearch')
        ) {
          tools.web_search = xaiProvider.tools.webSearch() as ToolSet[string];
        }

        if (isAgentCapabilityEnabled(modelConfiguration, 'twitterSearch')) {
          tools.x_search = xaiProvider.tools.xSearch() as ToolSet[string];
        }

        break;
    }

    return tools;
  }

  private getAnthropicProviderOptions(
    model: RegisteredAIModel,
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

  private getBedrockProviderOptions(model: RegisteredAIModel): ProviderOptions {
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
}
