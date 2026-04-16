import { type FlatAgentWithRoleId } from 'src/engine/metadata-modules/flat-agent/types/flat-agent.type';

export type ToolProviderAgent = Pick<
  FlatAgentWithRoleId,
  'modelId' | 'modelConfiguration'
>;
