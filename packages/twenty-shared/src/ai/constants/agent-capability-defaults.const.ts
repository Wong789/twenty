import { type AgentCapability } from '../types/agent-capability.type';

export const AGENT_CAPABILITY_DEFAULTS = {
  webSearch: true,
  twitterSearch: false,
  // Opt-in per agent: admins explicitly enable code execution via ModelConfiguration.
  // This is to prevent accidental code execution by default.
  // but will it break existing agents?
  // is it worth the migration? @FelixMalfait
  // is the flag on on prod?
  codeInterpreter: false,
} satisfies Record<AgentCapability, boolean>;
