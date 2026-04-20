import type { Resend } from 'resend';
import { CoreApiClient } from 'twenty-client-sdk/core';
import { isDefined } from '@utils/is-defined';

import type { DetailUpdateEmailDto } from '@modules/resend/details/types/detail-update-email.dto';
import { withRateLimitRetry } from '@modules/resend/shared/utils/with-rate-limit-retry';

const UPDATE_RESEND_EMAIL: string = 'updateResendEmail';

export const fetchAndApplyEmailDetail = async (
  resend: Resend,
  client: CoreApiClient,
  resendId: string,
  twentyRecordId: string,
): Promise<void> => {
  const { data: detail, error } = await withRateLimitRetry(() =>
    resend.emails.get(resendId),
  );

  if (isDefined(error) || !isDefined(detail)) {
    throw new Error(
      `Failed to fetch email ${resendId}: ${JSON.stringify(error)}`,
    );
  }

  const dto: DetailUpdateEmailDto = {
    htmlBody: detail.html ?? '',
    textBody: detail.text ?? '',
    tags: detail.tags,
  };

  await client.mutation({
    [UPDATE_RESEND_EMAIL]: {
      __args: { id: twentyRecordId, data: dto as Record<string, unknown> },
      id: true,
    },
  });
};
