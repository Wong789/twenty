import { type AgentMessagePartEntity } from 'src/engine/metadata-modules/ai/ai-agent-execution/entities/agent-message-part.entity';
import { type PersistableAgentMessagePart } from 'src/engine/metadata-modules/ai/ai-agent-execution/types/persistable-agent-message-part.type';

const isPersistableToolPart = (
  part: PersistableAgentMessagePart,
): part is Extract<PersistableAgentMessagePart, { type: `tool-${string}` }> => {
  return part.type.startsWith('tool-');
};

const assertUnreachable = (value: never): never => {
  throw new Error(`Unsupported persistable part: ${JSON.stringify(value)}`);
};

export const mapPersistablePartsToDBParts = (
  parts: PersistableAgentMessagePart[],
  messageId: string,
  workspaceId: string,
): Partial<AgentMessagePartEntity>[] => {
  return parts.map((part, index) => {
    const basePart: Partial<AgentMessagePartEntity> = {
      messageId,
      orderIndex: index,
      type: part.type,
      workspaceId,
    };

    if (isPersistableToolPart(part)) {
      return {
        ...basePart,
        toolName: part.toolName,
        toolCallId: part.toolCallId,
        toolInput: part.input,
        toolOutput: part.output,
        errorMessage: part.errorText,
        errorDetails: part.approval ? { approval: part.approval } : null,
        state: part.state,
      };
    }

    switch (part.type) {
      case 'text':
        return {
          ...basePart,
          textContent: part.text,
        };
      case 'reasoning':
        return {
          ...basePart,
          reasoningContent: part.text,
          state: part.state ?? null,
        };
      case 'file':
        return {
          ...basePart,
          fileFilename: part.filename,
          fileId: part.fileId,
        };
      case 'source-url':
        return {
          ...basePart,
          sourceUrlSourceId: part.sourceId,
          sourceUrlUrl: part.url,
          sourceUrlTitle: part.title,
          providerMetadata:
            (part.providerMetadata as AgentMessagePartEntity['providerMetadata']) ??
            null,
        };
      case 'source-document':
        return {
          ...basePart,
          sourceDocumentSourceId: part.sourceId,
          sourceDocumentMediaType: part.mediaType,
          sourceDocumentTitle: part.title,
          sourceDocumentFilename: part.filename ?? null,
          providerMetadata:
            (part.providerMetadata as AgentMessagePartEntity['providerMetadata']) ??
            null,
        };
      case 'step-start':
        return basePart;
      case 'data-routing-status':
        return {
          ...basePart,
          textContent: part.text,
          state: part.state,
        };
      default:
        return assertUnreachable(part);
    }
  });
};
