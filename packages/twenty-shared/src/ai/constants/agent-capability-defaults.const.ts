import { type AgentCapability } from '../types/agent-capability.type';

export const AGENT_CAPABILITY_DEFAULTS = {
  webSearch: true,
  twitterSearch: false,
  // Default-off: unlike webSearch (free via model-native capability), codeInterpreter
  // has no free path — E2B bills per execution. Per-agent opt-in prevents silent
  // spend. Breaking for self-hosters on CODE_INTERPRETER_TYPE=E2B: existing agents
  // must flip the per-agent toggle to restore prior workspace-wide behavior.
  codeInterpreter: false,
} satisfies Record<AgentCapability, boolean>;
