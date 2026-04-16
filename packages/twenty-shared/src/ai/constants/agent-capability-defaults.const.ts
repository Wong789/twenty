import { type AgentCapability } from '../types/agent-capability.type';

export const AGENT_CAPABILITY_DEFAULTS = {
  webSearch: true,
  twitterSearch: false,
  codeInterpreter: true,
} satisfies Record<AgentCapability, boolean>;
