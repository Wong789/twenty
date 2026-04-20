import { CoreApiClient } from 'twenty-client-sdk/core';
import { defineLogicFunction } from 'twenty-sdk/define';

import { SYNC_RESEND_DATA_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER } from '@modules/resend/constants/universal-identifiers';
import { getResendClient } from '@modules/resend/shared/utils/get-resend-client';
import type { StepOutcome } from '@modules/resend/sync/types/step-outcome';
import { logStepOutcome } from '@modules/resend/sync/utils/log-step-outcome';
import { orchestrateSyncResend } from '@modules/resend/sync/utils/orchestrate-sync-resend';
import { reportAndThrowIfErrors } from '@modules/resend/sync/utils/report-and-throw-if-errors';
import { runSyncStep } from '@modules/resend/sync/utils/run-sync-step';
import { syncBroadcasts } from '@modules/resend/sync/utils/sync-broadcasts';
import { syncContacts } from '@modules/resend/sync/utils/sync-contacts';
import { syncEmails } from '@modules/resend/sync/utils/sync-emails';
import { syncSegments } from '@modules/resend/sync/utils/sync-segments';
import { syncTemplates } from '@modules/resend/sync/utils/sync-templates';

const SYNC_STEPS = [
  'SEGMENTS',
  'TEMPLATES',
  'CONTACTS',
  'EMAILS',
  'BROADCASTS',
] as const;

type SyncStep = (typeof SYNC_STEPS)[number];

type SyncResendDataPayload = {
  step?: SyncStep | 'ALL';
};

const isSyncStep = (value: unknown): value is SyncStep =>
  typeof value === 'string' && (SYNC_STEPS as readonly string[]).includes(value);

const runSingleStep = async (
  step: SyncStep,
): Promise<ReadonlyArray<StepOutcome<unknown>>> => {
  const resendClient = getResendClient();
  const coreApiClient = new CoreApiClient();
  const syncedAt = new Date().toISOString();

  switch (step) {
    case 'SEGMENTS':
      return [
        await runSyncStep('SEGMENTS', () =>
          syncSegments(resendClient, coreApiClient, syncedAt),
        ),
      ];
    case 'TEMPLATES':
      return [
        await runSyncStep('TEMPLATES', () =>
          syncTemplates(resendClient, coreApiClient),
        ),
      ];
    case 'CONTACTS':
      return [
        await runSyncStep('CONTACTS', () =>
          syncContacts(resendClient, coreApiClient, syncedAt),
        ),
      ];
    case 'EMAILS':
      return [
        await runSyncStep('EMAILS', () =>
          syncEmails(resendClient, coreApiClient, syncedAt),
        ),
      ];
    case 'BROADCASTS': {
      const segmentMap = await syncSegments(
        resendClient,
        coreApiClient,
        syncedAt,
      ).then(({ value }) => value);

      return [
        await runSyncStep('BROADCASTS', () =>
          syncBroadcasts(resendClient, coreApiClient, segmentMap),
        ),
      ];
    }
  }
};

const runAllSteps = async (): Promise<ReadonlyArray<StepOutcome<unknown>>> => {
  const resendClient = getResendClient();
  const coreApiClient = new CoreApiClient();
  const syncedAt = new Date().toISOString();

  return orchestrateSyncResend({
    syncSegments: () => syncSegments(resendClient, coreApiClient, syncedAt),
    syncTemplates: () => syncTemplates(resendClient, coreApiClient),
    syncContacts: () => syncContacts(resendClient, coreApiClient, syncedAt),
    syncEmails: () => syncEmails(resendClient, coreApiClient, syncedAt),
    syncBroadcasts: (segmentMap) =>
      syncBroadcasts(resendClient, coreApiClient, segmentMap),
  });
};

const handler = async (payload?: SyncResendDataPayload): Promise<void> => {
  const step = payload?.step ?? 'ALL';

  const outcomes =
    step === 'ALL' || !isSyncStep(step)
      ? await runAllSteps()
      : await runSingleStep(step);

  for (const outcome of outcomes) {
    logStepOutcome(outcome);
  }

  reportAndThrowIfErrors(outcomes);
};

export default defineLogicFunction({
  universalIdentifier: SYNC_RESEND_DATA_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'sync-resend-data',
  description:
    'Syncs emails, contacts, templates, broadcasts, and segments from Resend every 5 minutes',
  timeoutSeconds: 300,
  handler,
  cronTriggerSettings: {
    pattern: '*/5 * * * *',
  },
});
