import { type AgentCapability } from '../types/agent-capability.type';

export const AGENT_CAPABILITY_DEFAULTS = {
  webSearch: true,
  twitterSearch: false,
  // Default-off because code execution is a higher-risk, billable capability.
  // Per-agent opt-in keeps existing workspaces from silently widening access.
  codeInterpreter: false,
} satisfies Record<AgentCapability, boolean>;
