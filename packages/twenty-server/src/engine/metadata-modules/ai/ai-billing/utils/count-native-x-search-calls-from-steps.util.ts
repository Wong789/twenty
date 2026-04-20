import { type StepResult, type ToolSet } from 'ai';

import { SEARCH_TOOL_NAMES } from 'src/engine/core-modules/tool-provider/constants/search-tool-names.const';

export const countNativeXSearchCallsFromSteps = (
  steps: StepResult<ToolSet>[],
): number =>
  steps.reduce(
    (count, step) =>
      count +
      step.toolCalls.filter(
        (toolCall) => toolCall.toolName === SEARCH_TOOL_NAMES.xSearch,
      ).length,
    0,
  );
