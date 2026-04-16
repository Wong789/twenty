import { AGENT_CAPABILITY_DEFAULTS } from '../constants/agent-capability-defaults.const';
import { type AgentCapability } from '../types/agent-capability.type';
import { type ModelConfiguration } from '../types/model-configuration.type';

export const isAgentCapabilityEnabled = (
  modelConfiguration: ModelConfiguration | null | undefined,
  capability: AgentCapability,
): boolean => {
  return (
    modelConfiguration?.[capability]?.enabled ??
    AGENT_CAPABILITY_DEFAULTS[capability]
  );
};
