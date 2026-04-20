import type { Resend } from 'resend';
import { CoreApiClient } from 'twenty-client-sdk/core';
import { isDefined } from '@utils/is-defined';

import type { EnqueueDetailFetchInput } from '@modules/resend/details/utils/enqueue-detail-fetch';
import { enqueueDetailFetches } from '@modules/resend/details/utils/enqueue-detail-fetches';
import type { CreateTemplateDto } from '@modules/resend/sync/types/create-template.dto';
import type { SyncResult } from '@modules/resend/sync/types/sync-result';
import type { SyncStepResult } from '@modules/resend/sync/types/sync-step-result';
import type { UpdateTemplateDto } from '@modules/resend/sync/types/update-template.dto';
import { forEachPage } from '@modules/resend/shared/utils/for-each-page';
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
        const pageOutcome = await upsertRecords({
          items: pageTemplates,
          getId: (template) => template.id,
          mapCreateData: (_detail, template): CreateTemplateDto => ({
            name: template.name,
            alias: template.alias ?? '',
            status: template.status.toUpperCase(),
            createdAt: toIsoString(template.created_at),
            resendUpdatedAt: toIsoString(template.updated_at),
            publishedAt: toIsoStringOrNull(template.published_at),
          }),
          mapUpdateData: (_detail, template): UpdateTemplateDto => ({
            name: template.name,
            alias: template.alias ?? '',
            status: template.status.toUpperCase(),
            resendUpdatedAt: toIsoString(template.updated_at),
            publishedAt: toIsoStringOrNull(template.published_at),
          }),
          client,
          objectNameSingular: 'resendTemplate',
          objectNamePlural: 'resendTemplates',
        });

        aggregate.fetched += pageOutcome.result.fetched;
        aggregate.created += pageOutcome.result.created;
        aggregate.updated += pageOutcome.result.updated;
        aggregate.errors.push(...pageOutcome.result.errors);

        const enqueueInputs: EnqueueDetailFetchInput[] = [];

        for (const template of pageTemplates) {
          const twentyId = pageOutcome.twentyIdByResendId.get(template.id);

          if (!isDefined(twentyId)) continue;

          enqueueInputs.push({
            entityType: 'TEMPLATE',
            resendId: template.id,
            twentyRecordId: twentyId,
          });
        }

        const enqueueOutcome = await enqueueDetailFetches(client, enqueueInputs);

        aggregate.errors.push(...enqueueOutcome.errors);

        return { ok: pageOutcome.ok && enqueueOutcome.errors.length === 0 };
      },
      'templates',
      { startCursor: resumeCursor, onCursorAdvance },
    );
  });

  return { result: aggregate, value: undefined };
};
