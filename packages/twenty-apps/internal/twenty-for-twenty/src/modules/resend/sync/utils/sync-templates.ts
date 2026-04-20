import type { Resend } from 'resend';
import { CoreApiClient } from 'twenty-client-sdk/core';
import { isDefined } from '@utils/is-defined';

import type { CreateTemplateDto } from '@modules/resend/sync/types/create-template.dto';
import type { SyncResult } from '@modules/resend/sync/types/sync-result';
import type { SyncStepResult } from '@modules/resend/sync/types/sync-step-result';
import type { UpdateTemplateDto } from '@modules/resend/sync/types/update-template.dto';
import { forEachPage } from '@modules/resend/shared/utils/for-each-page';
import { getExistingRecordsMap } from '@modules/resend/sync/utils/get-existing-records-map';
import { toEmailsField } from '@modules/resend/shared/utils/to-emails-field';
import {
  toIsoString,
  toIsoStringOrNull,
} from '@modules/resend/shared/utils/to-iso-string';
import { upsertRecords } from '@modules/resend/sync/utils/upsert-records';
import { withSyncCursor } from '@modules/resend/sync/cursor/utils/with-sync-cursor';

export const syncTemplates = async (
  resend: Resend,
  client: CoreApiClient,
): Promise<SyncStepResult> => {
  const existingMap = await getExistingRecordsMap(client, 'resendTemplates');

  const aggregate: SyncResult = {
    fetched: 0,
    created: 0,
    updated: 0,
    errors: [],
  };

  await withSyncCursor(client, 'TEMPLATES', async ({ resumeCursor, onCursorAdvance }) => {
    await forEachPage(
      (paginationParameters) => resend.templates.list(paginationParameters),
      async (pageTemplates) => {
        const pageResult = await upsertRecords({
          items: pageTemplates,
          getId: (template) => template.id,
          fetchDetail: async (id) => {
            const { data: detail, error } = await resend.templates.get(id);

            if (isDefined(error) || !isDefined(detail)) {
              throw new Error(
                `Failed to fetch template ${id}: ${JSON.stringify(error)}`,
              );
            }

            return detail;
          },
          mapCreateData: (detail): CreateTemplateDto => ({
            name: detail.name,
            alias: detail.alias ?? '',
            status: detail.status.toUpperCase(),
            fromAddress: toEmailsField(detail.from),
            subject: detail.subject ?? '',
            replyTo: toEmailsField(detail.reply_to),
            htmlBody: detail.html ?? '',
            textBody: detail.text ?? '',
            createdAt: toIsoString(detail.created_at),
            resendUpdatedAt: toIsoString(detail.updated_at),
            publishedAt: toIsoStringOrNull(detail.published_at),
          }),
          mapUpdateData: (detail, template): UpdateTemplateDto => ({
            name: template.name,
            alias: template.alias ?? '',
            status: template.status.toUpperCase(),
            fromAddress: toEmailsField(detail.from),
            subject: detail.subject ?? '',
            replyTo: toEmailsField(detail.reply_to),
            htmlBody: detail.html ?? '',
            textBody: detail.text ?? '',
            resendUpdatedAt: toIsoString(template.updated_at),
            publishedAt: toIsoStringOrNull(template.published_at),
          }),
          existingMap,
          client,
          objectNameSingular: 'resendTemplate',
        });

        aggregate.fetched += pageResult.fetched;
        aggregate.created += pageResult.created;
        aggregate.updated += pageResult.updated;
        aggregate.errors.push(...pageResult.errors);
      },
      'templates',
      { startCursor: resumeCursor, onCursorAdvance },
    );
  });

  return { result: aggregate, value: undefined };
};
