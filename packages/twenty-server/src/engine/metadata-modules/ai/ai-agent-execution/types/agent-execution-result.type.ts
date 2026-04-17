import { type LanguageModelUsage, type StepResult, type ToolSet } from 'ai';

export interface AgentExecutionResult {
  result: object;
  usage: LanguageModelUsage;
  cacheCreationTokens: number;
  nativeWebSearchCallCount: number;
  steps?: StepResult<ToolSet>[];
}
