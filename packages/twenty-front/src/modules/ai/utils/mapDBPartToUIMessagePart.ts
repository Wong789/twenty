import { type ReasoningUIPart, type ToolUIPart } from 'ai';
import {
  type ExtendedFileUIPart,
  type ExtendedUIMessagePart,
  getToolApproval,
} from 'twenty-shared/ai';
import { type AgentMessagePart } from '~/generated-metadata/graphql';

// Maps GraphQL DTO fields to UI message parts.
// A parallel mapping for TypeORM entities exists in the server at:
// packages/twenty-server/src/engine/metadata-modules/ai/ai-agent-execution/utils/mapDBPartsToUIMessageParts.ts

export const mapDBPartToUIMessagePart = (
  part: AgentMessagePart,
): ExtendedUIMessagePart => {
  switch (part.type) {
    case 'text':
      return {
        type: 'text',
        text: part.textContent ?? '',
      };
    case 'reasoning':
      return {
        type: 'reasoning',
        text: part.reasoningContent ?? '',
        state: part.state as ReasoningUIPart['state'],
      };
    case 'file':
      return {
        type: 'file',
        mediaType: part.fileMediaType ?? 'application/octet-stream',
        filename: part.fileFilename ?? '',
        url: part.fileUrl ?? '',
        fileId: part.fileId ?? '',
      } as ExtendedFileUIPart;
    case 'source-url':
      return {
        type: 'source-url',
        sourceId: part.sourceUrlSourceId ?? '',
        url: part.sourceUrlUrl ?? '',
        title: part.sourceUrlTitle ?? '',
        providerMetadata: part.providerMetadata ?? undefined,
      };
    case 'source-document':
      return {
        type: 'source-document',
        sourceId: part.sourceDocumentSourceId ?? '',
        mediaType: part.sourceDocumentMediaType ?? '',
        title: part.sourceDocumentTitle ?? '',
        filename: part.sourceDocumentFilename ?? '',
        providerMetadata: part.providerMetadata ?? undefined,
      };
    case 'step-start':
      return {
        type: part.type,
      };
    case 'data-routing-status':
      return {
        type: part.type,
        data: {
          text: part.textContent ?? '',
          state: part.state ?? '',
        },
      };
    default:
      {
        if (part.type.includes('tool-') === true) {
          const approval = getToolApproval(part.errorDetails);

          return {
            type: part.type as `tool-${string}`,
            toolCallId: part.toolCallId ?? '',
            input: part.toolInput ?? {},
            output: part.toolOutput,
            state: part.state,
            ...(part.errorMessage ? { errorText: part.errorMessage } : {}),
            ...(approval ? { approval } : {}),
          } as ToolUIPart;
        }
      }
      throw new Error(`Unsupported part type: ${part.type}`);
  }
};
