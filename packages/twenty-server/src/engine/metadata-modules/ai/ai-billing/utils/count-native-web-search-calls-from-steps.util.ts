import { type StepResult, type ToolSet } from 'ai';

import { WEB_SEARCH_TOOL_ID } from 'src/engine/core-modules/tool-provider/constants/search-tool-ids.const';

export const countNativeWebSearchCallsFromSteps = (
  steps: StepResult<ToolSet>[],
): number =>
  steps.reduce(
    (count, step) =>
      count +
      step.toolCalls.filter(
        (toolCall) => toolCall.toolName === WEB_SEARCH_TOOL_ID,
      ).length,
    0,
  );
