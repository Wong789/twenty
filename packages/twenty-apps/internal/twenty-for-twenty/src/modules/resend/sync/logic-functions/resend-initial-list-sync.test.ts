import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { INITIAL_SYNC_MODE_ENV_VAR_NAME } from '@modules/resend/constants/sync-config';
import { resendInitialListSyncHandler } from '@modules/resend/sync/logic-functions/resend-initial-list-sync';

const originalFlag = process.env[INITIAL_SYNC_MODE_ENV_VAR_NAME];

describe('resend-initial-list-sync handler', () => {
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

  it('skips without touching Resend when INITIAL_SYNC_MODE is off', async () => {
    process.env[INITIAL_SYNC_MODE_ENV_VAR_NAME] = 'false';

    const result = await resendInitialListSyncHandler();

    expect(result).toEqual({
      skipped: true,
      initialSyncCompleted: false,
      totalDurationMs: 0,
      steps: [],
    });
  });

  it('skips when INITIAL_SYNC_MODE is unset', async () => {
    delete process.env[INITIAL_SYNC_MODE_ENV_VAR_NAME];

    const result = await resendInitialListSyncHandler();

    expect(result.skipped).toBe(true);
  });
});
