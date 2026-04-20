import type { Resend } from 'resend';
import { CoreApiClient } from 'twenty-client-sdk/core';
import { isDefined } from '@utils/is-defined';

import type { EnqueueDetailFetchInput } from '@modules/resend/details/utils/enqueue-detail-fetch';
import { enqueueDetailFetches } from '@modules/resend/details/utils/enqueue-detail-fetches';
import type { CreateBroadcastDto } from '@modules/resend/sync/types/create-broadcast.dto';
import type { SyncResult } from '@modules/resend/sync/types/sync-result';
import type { SyncStepResult } from '@modules/resend/sync/types/sync-step-result';
import type { UpdateBroadcastDto } from '@modules/resend/sync/types/update-broadcast.dto';
import { forEachPage } from '@modules/resend/shared/utils/for-each-page';
import type { SegmentIdMap } from '@modules/resend/sync/utils/sync-segments';
import {
  toIsoString,
  toIsoStringOrNull,
} from '@modules/resend/shared/utils/to-iso-string';
import { upsertRecords } from '@modules/resend/sync/utils/upsert-records';
import { withSyncCursor } from '@modules/resend/sync/cursor/utils/with-sync-cursor';

export const syncBroadcasts = async (
  resend: Resend,
  client: CoreApiClient,
  segmentMap: SegmentIdMap,
): Promise<SyncStepResult> => {
  const aggregate: SyncResult = {
    fetched: 0,
    created: 0,
    updated: 0,
    errors: [],
  };

  await withSyncCursor(client, 'BROADCASTS', async ({ resumeCursor, onCursorAdvance }) => {
    await forEachPage(
      (paginationParameters) => resend.broadcasts.list(paginationParameters),
      async (pageBroadcasts) => {
        const pageOutcome = await upsertRecords({
          items: pageBroadcasts,
          getId: (broadcast) => broadcast.id,
          mapCreateData: (_detail, broadcast): CreateBroadcastDto => {
            const data: CreateBroadcastDto = {
              name: broadcast.name,
              status: broadcast.status.toUpperCase(),
              createdAt: toIsoString(broadcast.created_at),
              scheduledAt: toIsoStringOrNull(broadcast.scheduled_at),
              sentAt: toIsoStringOrNull(broadcast.sent_at),
            };

            if (isDefined(broadcast.segment_id)) {
              const segmentId = segmentMap.get(broadcast.segment_id);

              if (isDefined(segmentId)) {
                data.segmentId = segmentId;
              }
            }

            return data;
          },
          mapUpdateData: (_detail, broadcast): UpdateBroadcastDto => {
            const data: UpdateBroadcastDto = {
              status: broadcast.status.toUpperCase(),
              scheduledAt: toIsoStringOrNull(broadcast.scheduled_at),
              sentAt: toIsoStringOrNull(broadcast.sent_at),
            };

            if (!isDefined(broadcast.segment_id)) {
              data.segmentId = null;
            } else {
              const segmentId = segmentMap.get(broadcast.segment_id);

              if (isDefined(segmentId)) {
                data.segmentId = segmentId;
              } else {
                console.warn(
                  `[sync] broadcast ${broadcast.id}: segment ${broadcast.segment_id} not found in lookup map; leaving segmentId untouched`,
                );
              }
            }

            return data;
          },
          client,
          objectNameSingular: 'resendBroadcast',
          objectNamePlural: 'resendBroadcasts',
        });

        aggregate.fetched += pageOutcome.result.fetched;
        aggregate.created += pageOutcome.result.created;
        aggregate.updated += pageOutcome.result.updated;
        aggregate.errors.push(...pageOutcome.result.errors);

        const enqueueInputs: EnqueueDetailFetchInput[] = [];

        for (const broadcast of pageBroadcasts) {
          const twentyId = pageOutcome.twentyIdByResendId.get(broadcast.id);

          if (!isDefined(twentyId)) continue;

          enqueueInputs.push({
            entityType: 'BROADCAST',
            resendId: broadcast.id,
            twentyRecordId: twentyId,
          });
        }

        const enqueueOutcome = await enqueueDetailFetches(client, enqueueInputs);

        aggregate.errors.push(...enqueueOutcome.errors);

        return { ok: pageOutcome.ok && enqueueOutcome.errors.length === 0 };
      },
      'broadcasts',
      { startCursor: resumeCursor, onCursorAdvance },
    );
  });

  return { result: aggregate, value: undefined };
};
