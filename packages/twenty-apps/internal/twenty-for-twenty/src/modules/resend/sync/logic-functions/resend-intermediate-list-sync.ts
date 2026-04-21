import { CoreApiClient } from 'twenty-client-sdk/core';
import { defineLogicFunction } from 'twenty-sdk/define';

import { INTERMEDIATE_SYNC_EMAILS_MAX_AGE_MS } from '@modules/resend/constants/sync-config';
import { RESEND_INTERMEDIATE_LIST_SYNC_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER } from '@modules/resend/constants/universal-identifiers';
import { getResendClient } from '@modules/resend/shared/utils/get-resend-client';
import type { StepOutcome } from '@modules/resend/sync/types/step-outcome';
import { logStepOutcome } from '@modules/resend/sync/utils/log-step-outcome';
import { orchestrateListSync } from '@modules/resend/sync/utils/orchestrate-list-sync';
import { isInitialSyncModeOn } from '@modules/resend/sync/utils/set-initial-sync-mode';
import { syncBroadcasts } from '@modules/resend/sync/utils/sync-broadcasts';
import { syncContacts } from '@modules/resend/sync/utils/sync-contacts';
import { syncEmails } from '@modules/resend/sync/utils/sync-emails';
import { syncSegments } from '@modules/resend/sync/utils/sync-segments';
import { syncTemplates } from '@modules/resend/sync/utils/sync-templates';

type SyncSummaryStep = {
  name: string;
  status: 'ok' | 'failed' | 'skipped';
  fetched: number;
  created: number;
  updated: number;
  errorCount: number;
  durationMs: number;
};

type ResendIntermediateListSyncSummary = {
  skipped: boolean;
  totalDurationMs: number;
  steps: SyncSummaryStep[];
};

const summariseOutcomes = (
  outcomes: ReadonlyArray<StepOutcome<unknown>>,
): { totalDurationMs: number; steps: SyncSummaryStep[] } => {
  let totalDurationMs = 0;

  const steps: SyncSummaryStep[] = outcomes.map((outcome) => {
    if (outcome.status === 'ok') {
      totalDurationMs += outcome.durationMs;

      return {
        name: outcome.name,
        status: 'ok',
        fetched: outcome.result.fetched,
        created: outcome.result.created,
        updated: outcome.result.updated,
        errorCount: outcome.result.errors.length,
        durationMs: outcome.durationMs,
      };
    }

    if (outcome.status === 'failed') {
      totalDurationMs += outcome.durationMs;

      return {
        name: outcome.name,
        status: 'failed',
        fetched: 0,
        created: 0,
        updated: 0,
        errorCount: 1,
        durationMs: outcome.durationMs,
      };
    }

    return {
      name: outcome.name,
      status: 'skipped',
      fetched: 0,
      created: 0,
      updated: 0,
      errorCount: 0,
      durationMs: 0,
    };
  });

  return { totalDurationMs, steps };
};

export const resendIntermediateListSyncHandler =
  async (): Promise<ResendIntermediateListSyncSummary> => {
    if (isInitialSyncModeOn()) {
      console.log(
        '[resend-intermediate-list-sync] INITIAL_SYNC_MODE is on - skipping tick',
      );

      return {
        skipped: true,
        totalDurationMs: 0,
        steps: [],
      };
    }

    const resendClient = getResendClient();
    const coreApiClient = new CoreApiClient();
    const syncedAt = new Date().toISOString();

    const outcomes = await orchestrateListSync({
      syncSegments: () => syncSegments(resendClient, coreApiClient, syncedAt),
      syncTemplates: () => syncTemplates(resendClient, coreApiClient),
      syncContacts: () => syncContacts(resendClient, coreApiClient, syncedAt),
      syncEmails: () =>
        syncEmails(resendClient, coreApiClient, syncedAt, {
          stopBeforeCreatedAtMs: INTERMEDIATE_SYNC_EMAILS_MAX_AGE_MS,
          resumable: false,
        }),
      syncBroadcasts: (segmentMap) =>
        syncBroadcasts(resendClient, coreApiClient, segmentMap),
    });

    for (const outcome of outcomes) {
      logStepOutcome(outcome);
    }

    const { totalDurationMs, steps } = summariseOutcomes(outcomes);

    return {
      skipped: false,
      totalDurationMs,
      steps,
    };
  };

export default defineLogicFunction({
  universalIdentifier:
    RESEND_INTERMEDIATE_LIST_SYNC_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'resend-intermediate-list-sync',
  description:
    'Recurring Resend list sync that runs after the initial sync completes. Re-syncs contacts, segments, templates and broadcasts in full, while emails are limited to records created in the last 7 days.',
  timeoutSeconds: 300,
  handler: resendIntermediateListSyncHandler,
  cronTriggerSettings: {
    pattern: '*/15 * * * *',
  },
});
