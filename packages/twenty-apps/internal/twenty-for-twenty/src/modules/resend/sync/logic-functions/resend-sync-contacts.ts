import { CoreApiClient } from 'twenty-client-sdk/core';
import { defineLogicFunction } from 'twenty-sdk/define';

import { RESEND_SYNC_CONTACTS_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER } from '@modules/resend/constants/universal-identifiers';
import { getResendClient } from '@modules/resend/shared/utils/get-resend-client';
import { logStepOutcome } from '@modules/resend/sync/utils/log-step-outcome';
import { runSyncStep } from '@modules/resend/sync/utils/run-sync-step';
import {
  summariseOutcomes,
  type SyncSummaryStep,
} from '@modules/resend/sync/utils/summarise-outcomes';
import { syncContacts } from '@modules/resend/sync/utils/sync-contacts';

type ResendSyncContactsSummary = {
  totalDurationMs: number;
  steps: SyncSummaryStep[];
};

export const resendSyncContactsHandler =
  async (): Promise<ResendSyncContactsSummary> => {
    const resendClient = getResendClient();
    const coreApiClient = new CoreApiClient();
    const syncedAt = new Date().toISOString();

    const contacts = await runSyncStep('CONTACTS', () =>
      syncContacts(resendClient, coreApiClient, syncedAt),
    );

    logStepOutcome(contacts);

    const { totalDurationMs, steps } = summariseOutcomes([contacts]);

    return { totalDurationMs, steps };
  };

export default defineLogicFunction({
  universalIdentifier: RESEND_SYNC_CONTACTS_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'resend-sync-contacts',
  description:
    'Syncs Resend contacts and links them to existing people by email. Resumes from its own cursor if the function timeouts mid-pagination.',
  timeoutSeconds: 300,
  handler: resendSyncContactsHandler,
  cronTriggerSettings: {
    pattern: '*/5 * * * *',
  },
});
