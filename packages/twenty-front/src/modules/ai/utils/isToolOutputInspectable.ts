import { isDefined } from 'twenty-shared/utils';

export const isToolOutputInspectable = (output: unknown): boolean => {
  if (!isDefined(output)) {
    return false;
  }

  if (Array.isArray(output)) {
    return output.length > 0;
  }

  if (typeof output === 'object') {
    return Object.keys(output).length > 0;
  }

  if (typeof output === 'string') {
    return output.trim().length > 0;
  }

  return true;
};
