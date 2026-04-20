import type { Resend } from 'resend';
import { CoreApiClient } from 'twenty-client-sdk/core';
import { isDefined } from '@utils/is-defined';

import type { DetailUpdateBroadcastDto } from '@modules/resend/details/types/detail-update-broadcast.dto';
import { toEmailsField } from '@modules/resend/shared/utils/to-emails-field';
import { withRateLimitRetry } from '@modules/resend/shared/utils/with-rate-limit-retry';

const UPDATE_RESEND_BROADCAST: string = 'updateResendBroadcast';

export const fetchAndApplyBroadcastDetail = async (
  resend: Resend,
  client: CoreApiClient,
  resendId: string,
  twentyRecordId: string,
): Promise<void> => {
  const { data: detail, error } = await withRateLimitRetry(() =>
    resend.broadcasts.get(resendId),
  );

  if (isDefined(error) || !isDefined(detail)) {
    throw new Error(
      `Failed to fetch broadcast ${resendId}: ${JSON.stringify(error)}`,
    );
  }

  const dto: DetailUpdateBroadcastDto = {
    subject: detail.subject ?? '',
    fromAddress: toEmailsField(detail.from),
    replyTo: toEmailsField(detail.reply_to),
    previewText: detail.preview_text ?? '',
  };

  await client.mutation({
    [UPDATE_RESEND_BROADCAST]: {
      __args: { id: twentyRecordId, data: dto as Record<string, unknown> },
      id: true,
    },
  });
};
