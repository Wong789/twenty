import { CoreApiClient } from 'twenty-client-sdk/core';
import { defineLogicFunction } from 'twenty-sdk/define';

import { INTERMEDIATE_SYNC_EMAILS_MAX_AGE_MS } from '@modules/resend/constants/sync-config';
import { RESEND_SYNC_EMAILS_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER } from '@modules/resend/constants/universal-identifiers';
import { getResendClient } from '@modules/resend/shared/utils/get-resend-client';
import { logStepOutcome } from '@modules/resend/sync/utils/log-step-outcome';
import { runSyncStep } from '@modules/resend/sync/utils/run-sync-step';
import { isInitialSyncModeOn } from '@modules/resend/sync/utils/set-initial-sync-mode';
import {
  summariseOutcomes,
  type SyncSummaryStep,
} from '@modules/resend/sync/utils/summarise-outcomes';
import { syncEmails } from '@modules/resend/sync/utils/sync-emails';

type ResendSyncEmailsSummary = {
  totalDurationMs: number;
  steps: SyncSummaryStep[];
};

export const resendSyncEmailsHandler =
  async (): Promise<ResendSyncEmailsSummary> => {
    const resendClient = getResendClient();
    const coreApiClient = new CoreApiClient();
    const syncedAt = new Date().toISOString();

    const initialMode = isInitialSyncModeOn();

    const emails = await runSyncStep('EMAILS', () =>
      initialMode
        ? syncEmails(resendClient, coreApiClient, syncedAt)
        : syncEmails(resendClient, coreApiClient, syncedAt, {
            stopBeforeCreatedAtMs: INTERMEDIATE_SYNC_EMAILS_MAX_AGE_MS,
            resumable: false,
          }),
    );

    logStepOutcome(emails);

    const { totalDurationMs, steps } = summariseOutcomes([emails]);

    return { totalDurationMs, steps };
  };

export default defineLogicFunction({
  universalIdentifier: RESEND_SYNC_EMAILS_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'resend-sync-emails',
  description:
    'Syncs Resend emails and links them to existing people by email. In initial sync mode it does a full resumable pass; in intermediate mode it only fetches emails created in the last 7 days and does not persist a cursor.',
  timeoutSeconds: 300,
  handler: resendSyncEmailsHandler,
  cronTriggerSettings: {
    pattern: '*/5 * * * *',
  },
});
