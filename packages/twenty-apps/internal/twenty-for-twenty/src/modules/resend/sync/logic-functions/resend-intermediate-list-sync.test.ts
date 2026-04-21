import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { INITIAL_SYNC_MODE_ENV_VAR_NAME } from '@modules/resend/constants/sync-config';
import { resendIntermediateListSyncHandler } from '@modules/resend/sync/logic-functions/resend-intermediate-list-sync';

const originalFlag = process.env[INITIAL_SYNC_MODE_ENV_VAR_NAME];

describe('resend-intermediate-list-sync handler', () => {
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

    const result = await resendIntermediateListSyncHandler();

    expect(result).toEqual({
      skipped: true,
      totalDurationMs: 0,
      steps: [],
    });
  });
});
