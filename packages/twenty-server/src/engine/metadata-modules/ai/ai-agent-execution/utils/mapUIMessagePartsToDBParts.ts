import { type ExtendedUIMessagePart } from 'twenty-shared/ai';

import { type AgentMessagePartEntity } from 'src/engine/metadata-modules/ai/ai-agent-execution/entities/agent-message-part.entity';
import { mapPersistablePartsToDatabaseParts } from 'src/engine/metadata-modules/ai/ai-agent-execution/utils/mapPersistablePartsToDatabaseParts';
import { mapUIMessagePartsToPersistableParts } from 'src/engine/metadata-modules/ai/ai-agent-execution/utils/mapUIMessagePartsToPersistableParts';

export const mapUIMessagePartsToDBParts = (
  uiMessageParts: ExtendedUIMessagePart[],
  messageId: string,
  workspaceId: string,
): Partial<AgentMessagePartEntity>[] => {
  return mapPersistablePartsToDatabaseParts(
    mapUIMessagePartsToPersistableParts(uiMessageParts),
    messageId,
    workspaceId,
  );
};
