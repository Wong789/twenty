import {
  type ExtendedFileUIPart,
  type ExtendedUIMessagePart,
} from 'twenty-shared/ai';

import { type AgentMessagePartEntity } from 'src/engine/metadata-modules/ai/ai-agent-execution/entities/agent-message-part.entity';

// Maps TypeORM entity fields to UI message parts.
// A parallel mapping for GraphQL DTOs exists in the frontend at:
// packages/twenty-front/src/modules/ai/utils/mapDBPartToUIMessagePart.ts

const getToolApproval = (
  errorDetails: Record<string, unknown> | null,
):
  | {
      id: string;
      approved?: boolean;
      reason?: string;
    }
  | undefined => {
  const approval =
    errorDetails &&
    typeof errorDetails === 'object' &&
    'approval' in errorDetails &&
    typeof errorDetails.approval === 'object' &&
    errorDetails.approval !== null
      ? (errorDetails.approval as Record<string, unknown>)
      : null;

  if (!approval || typeof approval.id !== 'string') {
    return undefined;
  }

  return {
    id: approval.id,
    approved:
      typeof approval.approved === 'boolean' ? approval.approved : undefined,
    reason: typeof approval.reason === 'string' ? approval.reason : undefined,
  };
};

export const mapDBPartToUIMessagePart = (
  part: AgentMessagePartEntity,
): ExtendedUIMessagePart | null => {
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
        state: (part.state as 'streaming' | 'done') ?? 'done',
      };
    case 'file':
      return {
        type: 'file',
        mediaType: part.file?.mimeType ?? 'application/octet-stream',
        filename: part.fileFilename ?? '',
        url: '',
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
        type: 'step-start',
      };
    case 'data-routing-status':
      return null;
    default: {
      if (part.type.includes('tool-') && part.toolCallId) {
        const approval = getToolApproval(part.errorDetails);

        return {
          type: part.type,
          toolCallId: part.toolCallId,
          input: part.toolInput ?? {},
          output: part.toolOutput,
          state: part.state,
          ...(part.errorMessage ? { errorText: part.errorMessage } : {}),
          ...(approval ? { approval } : {}),
        } as ExtendedUIMessagePart;
      }

      return null;
    }
  }
};
