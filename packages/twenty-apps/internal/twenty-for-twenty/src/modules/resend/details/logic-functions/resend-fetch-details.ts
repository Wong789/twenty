import { CoreApiClient } from 'twenty-client-sdk/core';
import { defineLogicFunction } from 'twenty-sdk/define';

import {
  DETAILS_FETCH_BATCH_SIZE,
  DETAILS_FETCH_HARD_CAP,
  DETAILS_FETCH_SOFT_DEADLINE_MS,
} from '@modules/resend/constants/sync-config';
import { RESEND_FETCH_DETAILS_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER } from '@modules/resend/constants/universal-identifiers';
import { fetchPendingDetailRows } from '@modules/resend/details/utils/fetch-pending-detail-rows';
import { processDetailRow } from '@modules/resend/details/utils/process-detail-row';
import { getResendClient } from '@modules/resend/shared/utils/get-resend-client';
import { isInitialSyncModeOn } from '@modules/resend/sync/utils/set-initial-sync-mode';

type ResendFetchDetailsSummary = {
  skipped: boolean;
  processed: number;
  done: number;
  pendingRetry: number;
  failed: number;
  durationMs: number;
};

export const resendFetchDetailsHandler =
  async (): Promise<ResendFetchDetailsSummary> => {
    if (isInitialSyncModeOn()) {
      console.log(
        '[resend-fetch-details] INITIAL_SYNC_MODE is on - skipping tick',
      );

      return {
        skipped: true,
        processed: 0,
        done: 0,
        pendingRetry: 0,
        failed: 0,
        durationMs: 0,
      };
    }

    const startedAt = Date.now();
    const resendClient = getResendClient();
    const coreApiClient = new CoreApiClient();

    let processed = 0;
    let done = 0;
    let pendingRetry = 0;
    let failed = 0;

    while (
      processed < DETAILS_FETCH_HARD_CAP &&
      Date.now() - startedAt < DETAILS_FETCH_SOFT_DEADLINE_MS
    ) {
      const remaining = DETAILS_FETCH_HARD_CAP - processed;
      const batchSize = Math.min(DETAILS_FETCH_BATCH_SIZE, remaining);
      const batch = await fetchPendingDetailRows(coreApiClient, batchSize);

      if (batch.length === 0) break;

      for (const row of batch) {
        if (Date.now() - startedAt >= DETAILS_FETCH_SOFT_DEADLINE_MS) break;

        const outcome = await processDetailRow(
          resendClient,
          coreApiClient,
          row,
        );

        processed++;

        if (outcome.status === 'done') {
          done++;
        } else if (outcome.status === 'failed') {
          failed++;
        } else {
          pendingRetry++;
        }
      }

      if (batch.length < batchSize) break;
    }

    const durationMs = Date.now() - startedAt;

    console.log(
      `[resend-fetch-details] processed=${processed} done=${done} pendingRetry=${pendingRetry} failed=${failed} in ${durationMs}ms`,
    );

    return {
      skipped: false,
      processed,
      done,
      pendingRetry,
      failed,
      durationMs,
    };
  };

export default defineLogicFunction({
  universalIdentifier: RESEND_FETCH_DETAILS_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'resend-fetch-details',
  description:
    'Drains the resendDetailToFetch queue by calling Resend get endpoints and filling in detail fields. Runs every 5 minutes while INITIAL_SYNC_MODE is off.',
  timeoutSeconds: 300,
  handler: resendFetchDetailsHandler,
  cronTriggerSettings: {
    pattern: '*/5 * * * *',
  },
});
