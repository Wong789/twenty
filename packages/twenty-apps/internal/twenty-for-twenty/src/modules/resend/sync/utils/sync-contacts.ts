import type { Resend } from 'resend';
import { CoreApiClient } from 'twenty-client-sdk/core';
import { isDefined } from '@utils/is-defined';

import type { ContactDto } from '@modules/resend/sync/types/contact.dto';
import type { SyncResult } from '@modules/resend/sync/types/sync-result';
import type { SyncStepResult } from '@modules/resend/sync/types/sync-step-result';
import { findOrCreatePerson } from '@modules/resend/shared/utils/find-or-create-person';
import { forEachPage } from '@modules/resend/shared/utils/for-each-page';
import { getErrorMessage } from '@modules/resend/shared/utils/get-error-message';
import { getExistingRecordsMap } from '@modules/resend/sync/utils/get-existing-records-map';
import { toEmailsField } from '@modules/resend/shared/utils/to-emails-field';
import { toIsoString } from '@modules/resend/shared/utils/to-iso-string';
import { upsertRecords } from '@modules/resend/sync/utils/upsert-records';
import { withSyncCursor } from '@modules/resend/sync/cursor/utils/with-sync-cursor';

export const syncContacts = async (
  resend: Resend,
  client: CoreApiClient,
  syncedAt: string,
): Promise<SyncStepResult> => {
  const existingMap = await getExistingRecordsMap(client, 'resendContacts');

  const aggregate: SyncResult = {
    fetched: 0,
    created: 0,
    updated: 0,
    errors: [],
  };

  await withSyncCursor(client, 'CONTACTS', async ({ resumeCursor, onCursorAdvance }) => {
    await forEachPage(
      (paginationParameters) => resend.contacts.list(paginationParameters),
      async (pageContacts) => {
        const mapData = (
          contact: (typeof pageContacts)[number],
        ): ContactDto => ({
          email: toEmailsField(contact.email),
          name: {
            firstName: contact.first_name ?? '',
            lastName: contact.last_name ?? '',
          },
          unsubscribed: contact.unsubscribed,
          createdAt: toIsoString(contact.created_at),
          lastSyncedFromResend: syncedAt,
        });

        const pageResult = await upsertRecords({
          items: pageContacts,
          getId: (contact) => contact.id,
          mapCreateData: (_detail, item) => mapData(item),
          mapUpdateData: (_detail, item) => mapData(item),
          existingMap,
          client,
          objectNameSingular: 'resendContact',
        });

        aggregate.fetched += pageResult.fetched;
        aggregate.created += pageResult.created;
        aggregate.updated += pageResult.updated;
        aggregate.errors.push(...pageResult.errors);

        for (const contact of pageContacts) {
          const twentyId = existingMap.get(contact.id);

          if (!isDefined(twentyId)) {
            continue;
          }

          try {
            const personId = await findOrCreatePerson(client, contact.email, {
              firstName: contact.first_name ?? '',
              lastName: contact.last_name ?? '',
            });

            if (isDefined(personId)) {
              await client.mutation({
                updateResendContact: {
                  __args: { id: twentyId, data: { personId } },
                  id: true,
                },
              });
            }
          } catch (error) {
            const message = getErrorMessage(error);

            aggregate.errors.push(
              `resendContact ${contact.id} person link: ${message}`,
            );
          }
        }
      },
      'contacts',
      { startCursor: resumeCursor, onCursorAdvance },
    );
  });

  return { result: aggregate, value: undefined };
};
