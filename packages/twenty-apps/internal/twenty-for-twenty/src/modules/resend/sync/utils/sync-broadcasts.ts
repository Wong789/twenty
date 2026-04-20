import type { Resend } from 'resend';
import { CoreApiClient } from 'twenty-client-sdk/core';
import { isDefined } from '@utils/is-defined';

import type { CreateBroadcastDto } from '@modules/resend/sync/types/create-broadcast.dto';
import type { SyncResult } from '@modules/resend/sync/types/sync-result';
import type { SyncStepResult } from '@modules/resend/sync/types/sync-step-result';
import type { UpdateBroadcastDto } from '@modules/resend/sync/types/update-broadcast.dto';
import { forEachPage } from '@modules/resend/shared/utils/for-each-page';
import type { SegmentIdMap } from '@modules/resend/sync/utils/sync-segments';
import { toEmailsField } from '@modules/resend/shared/utils/to-emails-field';
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
          fetchDetail: async (id) => {
            const { data: detail, error } = await resend.broadcasts.get(id);

            if (isDefined(error) || !isDefined(detail)) {
              throw new Error(
                `Failed to fetch broadcast ${id}: ${JSON.stringify(error)}`,
              );
            }

            return detail;
          },
          mapCreateData: (detail, broadcast): CreateBroadcastDto => {
            const segmentId = isDefined(broadcast.segment_id)
              ? segmentMap.get(broadcast.segment_id)
              : undefined;

            const data: CreateBroadcastDto = {
              name: detail.name,
              subject: detail.subject,
              fromAddress: toEmailsField(detail.from),
              replyTo: toEmailsField(detail.reply_to),
              previewText: detail.preview_text ?? '',
              status: detail.status.toUpperCase(),
              createdAt: toIsoString(detail.created_at),
              scheduledAt: toIsoStringOrNull(detail.scheduled_at),
              sentAt: toIsoStringOrNull(detail.sent_at),
            };

            if (isDefined(segmentId)) {
              data.segmentId = segmentId;
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
          fetchDetailOnlyForCreate: true,
          client,
          objectNameSingular: 'resendBroadcast',
          objectNamePlural: 'resendBroadcasts',
        });

        aggregate.fetched += pageOutcome.result.fetched;
        aggregate.created += pageOutcome.result.created;
        aggregate.updated += pageOutcome.result.updated;
        aggregate.errors.push(...pageOutcome.result.errors);

        return { ok: pageOutcome.ok };
      },
      'broadcasts',
      { startCursor: resumeCursor, onCursorAdvance },
    );
  });

  return { result: aggregate, value: undefined };
};
