import { type StepResult, type ToolSet } from 'ai';

import { X_SEARCH_TOOL_ID } from 'src/engine/core-modules/tool-provider/constants/search-tool-ids.const';

export const countNativeXSearchCallsFromSteps = (
  steps: StepResult<ToolSet>[],
): number =>
  steps.reduce(
    (count, step) =>
      count +
      step.toolCalls.filter(
        (toolCall) => toolCall.toolName === X_SEARCH_TOOL_ID,
      ).length,
    0,
  );
