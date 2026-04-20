import type { StepOutcome } from '@modules/resend/sync/types/step-outcome';
import type { SyncStepResult } from '@modules/resend/sync/types/sync-step-result';
import {
  runSyncStep,
  skipDueToFailedDependencies,
} from '@modules/resend/sync/utils/run-sync-step';
import type { SegmentIdMap } from '@modules/resend/sync/utils/sync-segments';

export type SyncResendDependencies = {
  syncSegments: () => Promise<SyncStepResult<SegmentIdMap>>;
  syncTemplates: () => Promise<SyncStepResult>;
  syncContacts: () => Promise<SyncStepResult>;
  syncEmails: () => Promise<SyncStepResult>;
  syncBroadcasts: (segmentMap: SegmentIdMap) => Promise<SyncStepResult>;
};

export const orchestrateSyncResend = async (
  dependencies: SyncResendDependencies,
): Promise<ReadonlyArray<StepOutcome<unknown>>> => {
  const [segments, templates, contacts, emails] = await Promise.all([
    runSyncStep('SEGMENTS', dependencies.syncSegments),
    runSyncStep('TEMPLATES', dependencies.syncTemplates),
    runSyncStep('CONTACTS', dependencies.syncContacts),
    runSyncStep('EMAILS', dependencies.syncEmails),
  ]);

  const broadcasts =
    segments.status === 'ok'
      ? await runSyncStep('BROADCASTS', () =>
          dependencies.syncBroadcasts(segments.value),
        )
      : skipDueToFailedDependencies('BROADCASTS', { segments });

  return [segments, templates, contacts, emails, broadcasts];
};
