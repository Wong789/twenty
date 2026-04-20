import { AiModelConfigService } from './ai-model-config.service';

import {
  WEB_SEARCH_TOOL_ID,
  X_SEARCH_TOOL_ID,
} from 'src/engine/core-modules/tool-provider/constants/search-tool-ids.const';
import {
  AI_SDK_OPENAI,
  AI_SDK_XAI,
} from 'src/engine/metadata-modules/ai/ai-models/constants/ai-sdk-package.const';
import { type RegisteredAiModel } from 'src/engine/metadata-modules/ai/ai-models/services/ai-model-registry.service';
import { type SdkProviderFactoryService } from 'src/engine/metadata-modules/ai/ai-models/services/sdk-provider-factory.service';

describe('AiModelConfigService', () => {
  const createService = (
    sdkProviderFactory: Partial<SdkProviderFactoryService>,
  ) =>
    new AiModelConfigService(sdkProviderFactory as SdkProviderFactoryService);

  const xSearchTool = { type: 'provider', id: 'xai.x_search', args: {} };
  const webSearchTool = { type: 'provider', id: 'xai.web_search', args: {} };

  it('keeps x search available for xAI chat when external web search is preferred', () => {
    const service = createService({
      getRawXaiProvider: jest.fn().mockReturnValue({
        tools: {
          xSearch: jest.fn().mockReturnValue(xSearchTool),
          webSearch: jest.fn().mockReturnValue(webSearchTool),
        },
      }),
    });

    const result = service.getChatNativeSearchPlan(
      {
        sdkPackage: AI_SDK_XAI,
        providerName: 'xai',
      } as RegisteredAiModel,
      { useProviderNativeWebSearch: false },
    );

    expect(result).toEqual({
      tools: {
        [X_SEARCH_TOOL_ID]: xSearchTool,
      },
      hasWebSearch: false,
      hasXSearch: true,
    });
  });

  it('exposes both x search and native web search for xAI chat when enabled', () => {
    const service = createService({
      getRawXaiProvider: jest.fn().mockReturnValue({
        tools: {
          xSearch: jest.fn().mockReturnValue(xSearchTool),
          webSearch: jest.fn().mockReturnValue(webSearchTool),
        },
      }),
    });

    const result = service.getChatNativeSearchPlan(
      {
        sdkPackage: AI_SDK_XAI,
        providerName: 'xai',
      } as RegisteredAiModel,
      { useProviderNativeWebSearch: true },
    );

    expect(result).toEqual({
      tools: {
        [WEB_SEARCH_TOOL_ID]: webSearchTool,
        [X_SEARCH_TOOL_ID]: xSearchTool,
      },
      hasWebSearch: true,
      hasXSearch: true,
    });
  });

  it('keeps OpenAI native web search disabled when external search is preferred', () => {
    const service = createService({
      getRawOpenAIProvider: jest.fn(),
    });

    const result = service.getChatNativeSearchPlan(
      {
        sdkPackage: AI_SDK_OPENAI,
        providerName: 'openai',
      } as RegisteredAiModel,
      { useProviderNativeWebSearch: false },
    );

    expect(result).toEqual({
      tools: {},
      hasWebSearch: false,
      hasXSearch: false,
    });
  });
});
