import { isDefined } from '@utils/is-defined';
import type { Resend } from 'resend';
import { CoreApiClient } from 'twenty-client-sdk/core';

import { findOrCreatePeopleByEmail } from '@modules/resend/shared/utils/find-or-create-people-by-email';
import { forEachPage } from '@modules/resend/shared/utils/for-each-page';
import { getErrorMessage } from '@modules/resend/shared/utils/get-error-message';
import { mapLastEvent } from '@modules/resend/shared/utils/map-last-event';
import { toEmailsField } from '@modules/resend/shared/utils/to-emails-field';
import {
  toIsoString,
  toIsoStringOrNull,
} from '@modules/resend/shared/utils/to-iso-string';
import { withSyncCursor } from '@modules/resend/sync/cursor/utils/with-sync-cursor';
import type { CreateEmailDto } from '@modules/resend/sync/types/create-email.dto';
import type { SyncResult } from '@modules/resend/sync/types/sync-result';
import type { SyncStepResult } from '@modules/resend/sync/types/sync-step-result';
import type { UpdateEmailDto } from '@modules/resend/sync/types/update-email.dto';
import { upsertRecords } from '@modules/resend/sync/utils/upsert-records';

export type SyncEmailsOptions = {
  stopBeforeCreatedAtMs?: number;
  resumable?: boolean;
};

export const syncEmails = async (
  resend: Resend,
  client: CoreApiClient,
  syncedAt: string,
  options?: SyncEmailsOptions,
): Promise<SyncStepResult> => {
  const aggregate: SyncResult = {
    fetched: 0,
    created: 0,
    updated: 0,
    errors: [],
  };

  const resumable = options?.resumable ?? true;
  const stopBeforeCreatedAtMs = options?.stopBeforeCreatedAtMs;
  const cutoffTimestampMs = isDefined(stopBeforeCreatedAtMs)
    ? Date.now() - stopBeforeCreatedAtMs
    : undefined;

  await withSyncCursor(
    client,
    'EMAILS',
    async ({ resumeCursor, onCursorAdvance }) => {
      await forEachPage(
        (paginationParameters) => resend.emails.list(paginationParameters),
        async (pageEmails) => {
          const pageOutcome = await upsertRecords({
            items: pageEmails,
            getId: (email) => email.id,
            mapCreateData: (_detail, email): CreateEmailDto => {
              const mappedLastEvent = mapLastEvent(email.last_event);

              return {
                subject: email.subject,
                fromAddress: toEmailsField(email.from),
                toAddresses: toEmailsField(email.to),
                ccAddresses: toEmailsField(email.cc),
                bccAddresses: toEmailsField(email.bcc),
                replyToAddresses: toEmailsField(email.reply_to),
                ...(isDefined(mappedLastEvent) && {
                  lastEvent: mappedLastEvent,
                }),
                createdAt: toIsoString(email.created_at),
                scheduledAt: toIsoStringOrNull(email.scheduled_at),
                lastSyncedFromResend: syncedAt,
              };
            },
            mapUpdateData: (_detail, email): UpdateEmailDto => {
              const mappedLastEvent = mapLastEvent(email.last_event);

              return {
                subject: email.subject,
                fromAddress: toEmailsField(email.from),
                toAddresses: toEmailsField(email.to),
                ccAddresses: toEmailsField(email.cc),
                bccAddresses: toEmailsField(email.bcc),
                replyToAddresses: toEmailsField(email.reply_to),
                ...(isDefined(mappedLastEvent) && {
                  lastEvent: mappedLastEvent,
                }),
                scheduledAt: toIsoStringOrNull(email.scheduled_at),
                lastSyncedFromResend: syncedAt,
              };
            },
            client,
            objectNameSingular: 'resendEmail',
            objectNamePlural: 'resendEmails',
          });

          aggregate.fetched += pageOutcome.result.fetched;
          aggregate.created += pageOutcome.result.created;
          aggregate.updated += pageOutcome.result.updated;
          aggregate.errors.push(...pageOutcome.result.errors);

          let personLinkOk = true;

          const primaryToByEmail = new Map<string, string>();

          for (const email of pageEmails) {
            const primaryTo = Array.isArray(email.to) ? email.to[0] : email.to;

            if (typeof primaryTo === 'string' && primaryTo.length > 0) {
              primaryToByEmail.set(email.id, primaryTo);
            }
          }

          const personIdByEmail = await findOrCreatePeopleByEmail(
            client,
            Array.from(primaryToByEmail.values()).map((primaryTo) => ({
              email: primaryTo,
            })),
          );

          for (const email of pageEmails) {
            const twentyId = pageOutcome.twentyIdByResendId.get(email.id);

            if (!isDefined(twentyId)) {
              continue;
            }

            const primaryTo = primaryToByEmail.get(email.id);

            if (!isDefined(primaryTo)) {
              continue;
            }

            const personId = personIdByEmail.get(
              primaryTo.trim().toLowerCase(),
            );

            if (!isDefined(personId)) {
              continue;
            }

            try {
              await client.mutation({
                updateResendEmail: {
                  __args: { id: twentyId, data: { personId } },
                  id: true,
                },
              });
            } catch (error) {
              const message = getErrorMessage(error);

              aggregate.errors.push(
                `resendEmail ${email.id} person link: ${message}`,
              );
              personLinkOk = false;
            }
          }

          const reachedCutoff =
            isDefined(cutoffTimestampMs) &&
            pageEmails.some(
              (email) =>
                new Date(email.created_at).getTime() < cutoffTimestampMs,
            );

          return {
            ok: pageOutcome.ok && personLinkOk,
            stop: reachedCutoff,
          };
        },
        'emails',
        {
          startCursor: resumable ? resumeCursor : undefined,
          ...(resumable && { onCursorAdvance }),
        },
      );
    },
  );

  return { result: aggregate, value: undefined };
};
