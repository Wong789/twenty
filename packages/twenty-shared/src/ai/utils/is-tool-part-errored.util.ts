import { type ToolUIPart } from 'ai';

export const isToolPartErrored = (state: ToolUIPart['state']): boolean =>
  state === 'output-error' || state === 'output-denied';
