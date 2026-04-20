import type { Resend } from 'resend';
import { CoreApiClient } from 'twenty-client-sdk/core';
import { isDefined } from '@utils/is-defined';

import type { DetailUpdateTemplateDto } from '@modules/resend/details/types/detail-update-template.dto';
import { toEmailsField } from '@modules/resend/shared/utils/to-emails-field';
import { withRateLimitRetry } from '@modules/resend/shared/utils/with-rate-limit-retry';

const UPDATE_RESEND_TEMPLATE: string = 'updateResendTemplate';

export const fetchAndApplyTemplateDetail = async (
  resend: Resend,
  client: CoreApiClient,
  resendId: string,
  twentyRecordId: string,
): Promise<void> => {
  const { data: detail, error } = await withRateLimitRetry(() =>
    resend.templates.get(resendId),
  );

  if (isDefined(error) || !isDefined(detail)) {
    throw new Error(
      `Failed to fetch template ${resendId}: ${JSON.stringify(error)}`,
    );
  }

  const dto: DetailUpdateTemplateDto = {
    fromAddress: toEmailsField(detail.from),
    subject: detail.subject ?? '',
    replyTo: toEmailsField(detail.reply_to),
    htmlBody: detail.html ?? '',
    textBody: detail.text ?? '',
  };

  await client.mutation({
    [UPDATE_RESEND_TEMPLATE]: {
      __args: { id: twentyRecordId, data: dto as Record<string, unknown> },
      id: true,
    },
  });
};
