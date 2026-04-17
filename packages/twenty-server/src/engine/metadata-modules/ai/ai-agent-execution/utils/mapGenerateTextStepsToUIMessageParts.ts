import { type StepResult, type ToolSet } from 'ai';
import { type ExtendedUIMessagePart } from 'twenty-shared/ai';

export const mapGenerateTextStepsToUIMessageParts = (
  steps: StepResult<ToolSet>[],
): ExtendedUIMessagePart[] => {
  const parts: ExtendedUIMessagePart[] = [];

  for (let i = 0; i < steps.length; i++) {
    if (i > 0) {
      parts.push({ type: 'step-start' });
    }

    const step = steps[i];

    for (const contentPart of step.content) {
      switch (contentPart.type) {
        case 'text':
          if (contentPart.text.length > 0) {
            parts.push({ type: 'text', text: contentPart.text });
          }
          break;

        case 'reasoning':
          parts.push({
            type: 'reasoning',
            text: contentPart.text,
          } as ExtendedUIMessagePart);
          break;

        case 'tool-call':
          parts.push({
            type: `tool-${contentPart.toolName}`,
            toolCallId: contentPart.toolCallId,
            input: contentPart.input,
            state: 'input-available',
          } as unknown as ExtendedUIMessagePart);
          break;

        case 'tool-result':
          parts.push({
            type: `tool-${contentPart.toolName}`,
            toolCallId: contentPart.toolCallId,
            input: contentPart.input,
            output: contentPart.output,
            state: 'output-available',
          } as unknown as ExtendedUIMessagePart);
          break;

        case 'tool-error':
          parts.push({
            type: `tool-${contentPart.toolName}`,
            toolCallId: contentPart.toolCallId,
            input: contentPart.input,
            errorText: String(contentPart.error),
            state: 'output-error',
          } as unknown as ExtendedUIMessagePart);
          break;

        case 'source':
          if ('url' in contentPart) {
            parts.push({
              type: 'source-url',
              sourceId: contentPart.id,
              url: contentPart.url,
              title: contentPart.title ?? '',
              providerMetadata: contentPart.providerMetadata,
            } as ExtendedUIMessagePart);
          }
          break;

        default:
          break;
      }
    }
  }

  return parts;
};
