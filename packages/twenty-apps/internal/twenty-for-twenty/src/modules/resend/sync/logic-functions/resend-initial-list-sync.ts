import { CoreApiClient } from 'twenty-client-sdk/core';
import { defineLogicFunction } from 'twenty-sdk/define';

import { RESEND_INITIAL_LIST_SYNC_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER } from '@modules/resend/constants/universal-identifiers';
import { getResendClient } from '@modules/resend/shared/utils/get-resend-client';
import type { StepOutcome } from '@modules/resend/sync/types/step-outcome';
import { areAllSyncCursorsEmpty } from '@modules/resend/sync/utils/are-all-sync-cursors-empty';
import { logStepOutcome } from '@modules/resend/sync/utils/log-step-outcome';
import { orchestrateListSync } from '@modules/resend/sync/utils/orchestrate-list-sync';
import {
  isInitialSyncModeOn,
  setInitialSyncMode,
} from '@modules/resend/sync/utils/set-initial-sync-mode';
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

type ResendInitialListSyncSummary = {
  skipped: boolean;
  initialSyncCompleted: boolean;
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

export const resendInitialListSyncHandler =
  async (): Promise<ResendInitialListSyncSummary> => {
    if (!isInitialSyncModeOn()) {
      console.log(
        '[resend-initial-list-sync] INITIAL_SYNC_MODE is off - skipping tick',
      );

      return {
        skipped: true,
        initialSyncCompleted: false,
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
      syncEmails: () => syncEmails(resendClient, coreApiClient, syncedAt),
      syncBroadcasts: (segmentMap) =>
        syncBroadcasts(resendClient, coreApiClient, segmentMap),
    });

    for (const outcome of outcomes) {
      logStepOutcome(outcome);
    }

    const allStepsSucceeded = outcomes.every(
      (outcome) => outcome.status === 'ok',
    );

    let initialSyncCompleted = false;

    if (allStepsSucceeded) {
      try {
        const allCursorsCleared = await areAllSyncCursorsEmpty(coreApiClient);

        if (allCursorsCleared) {
          await setInitialSyncMode('false');
          initialSyncCompleted = true;
          console.log(
            '[resend-initial-list-sync] All lists fully paginated - INITIAL_SYNC_MODE flipped to false',
          );
        }
      } catch (error) {
        console.error(
          '[resend-initial-list-sync] Failed to flip INITIAL_SYNC_MODE off',
          error,
        );
      }
    }

    const { totalDurationMs, steps } = summariseOutcomes(outcomes);

    return {
      skipped: false,
      initialSyncCompleted,
      totalDurationMs,
      steps,
    };
  };

export default defineLogicFunction({
  universalIdentifier:
    RESEND_INITIAL_LIST_SYNC_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'resend-initial-list-sync',
  description:
    'Runs the initial Resend sync while INITIAL_SYNC_MODE is on. Fetches list pages and inlines broadcast/template details into each upsert.',
  timeoutSeconds: 300,
  handler: resendInitialListSyncHandler,
  cronTriggerSettings: {
    pattern: '*/5 * * * *',
  },
});
