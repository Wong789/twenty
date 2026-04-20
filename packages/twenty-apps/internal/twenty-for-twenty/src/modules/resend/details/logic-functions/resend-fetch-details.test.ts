import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { INITIAL_SYNC_MODE_ENV_VAR_NAME } from '@modules/resend/constants/sync-config';
import { resendFetchDetailsHandler } from '@modules/resend/details/logic-functions/resend-fetch-details';

const originalFlag = process.env[INITIAL_SYNC_MODE_ENV_VAR_NAME];

describe('resend-fetch-details handler', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    if (typeof originalFlag === 'string') {
      process.env[INITIAL_SYNC_MODE_ENV_VAR_NAME] = originalFlag;
    } else {
      delete process.env[INITIAL_SYNC_MODE_ENV_VAR_NAME];
    }
  });

  it('skips without touching Resend when INITIAL_SYNC_MODE is on', async () => {
    process.env[INITIAL_SYNC_MODE_ENV_VAR_NAME] = 'true';

    const result = await resendFetchDetailsHandler();

    expect(result).toEqual({
      skipped: true,
      processed: 0,
      done: 0,
      pendingRetry: 0,
      failed: 0,
      durationMs: 0,
    });
  });
});
