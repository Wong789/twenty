import {
  RATE_LIMIT_BASE_DELAY_MS,
  RATE_LIMIT_MAX_RETRIES,
  RATE_LIMIT_MIN_INTERVAL_MS,
} from '@modules/resend/constants/sync-config';

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

const isRateLimitError = (error: unknown): boolean => {
  const text =
    error instanceof Error
      ? error.message
      : typeof error === 'object' && error !== null
        ? JSON.stringify(error)
        : '';
  const lower = text.toLowerCase();

  return (
    lower.includes('rate limit') ||
    lower.includes('rate_limit') ||
    lower.includes('too many requests')
  );
};

let lastCallTimestamp = 0;

export const withRateLimitRetry = async <T>(
  fn: () => Promise<T>,
): Promise<T> => {
  for (let attempt = 0; attempt <= RATE_LIMIT_MAX_RETRIES; attempt++) {
    const elapsed = Date.now() - lastCallTimestamp;

    if (elapsed < RATE_LIMIT_MIN_INTERVAL_MS) {
      await sleep(RATE_LIMIT_MIN_INTERVAL_MS - elapsed);
    }

    lastCallTimestamp = Date.now();

    try {
      return await fn();
    } catch (error) {
      if (!isRateLimitError(error) || attempt === RATE_LIMIT_MAX_RETRIES) {
        throw error;
      }

      const delayMs = RATE_LIMIT_BASE_DELAY_MS * 2 ** attempt;

      console.warn(
        `[resend] Rate limited, retrying in ${delayMs}ms (attempt ${attempt + 1}/${RATE_LIMIT_MAX_RETRIES})`,
      );
      await sleep(delayMs);
    }
  }

  throw new Error('Unreachable');
};
